require('dotenv').config()
const Redis = require('ioredis')

// ── Redis client ────────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) return null // stop retrying after 10 attempts
    return Math.min(times * 200, 2000) // backoff: 200ms, 400ms, ... 2000ms
  },
  lazyConnect: false,
})

redis.on('connect', () => console.log('[Redis] ✓ Connected'))
redis.on('error', (err) => console.error('[Redis] ✗ Error:', err.message))
redis.on('reconnecting', () => console.log('[Redis] Reconnecting...'))

// ────────────────────────────────────────────────────────────────
// SESSION HELPERS
// JWT tokens stored in Redis enable instant revocation (logout)
// Key: session:{userId}:{tokenId}  TTL: matches JWT expiry
// ────────────────────────────────────────────────────────────────
const sessions = {
  async set(userId, tokenId, ttlSeconds) {
    const key = `session:${userId}:${tokenId}`
    await redis.setex(key, ttlSeconds, '1')
  },
  async exists(userId, tokenId) {
    const key = `session:${userId}:${tokenId}`
    return await redis.exists(key) === 1
  },
  async delete(userId, tokenId) {
    const key = `session:${userId}:${tokenId}`
    await redis.del(key)
  },
  async deleteAll(userId) {
    // Logout all devices
    const keys = await redis.keys(`session:${userId}:*`)
    if (keys.length > 0) await redis.del(...keys)
  }
}

// ────────────────────────────────────────────────────────────────
// PRESENCE HELPERS
// Track which users are online via WebSocket connections
// Key: presence:{userId}  Value: comma-separated socketIds
// ────────────────────────────────────────────────────────────────
const presence = {
  async setOnline(userId) {
    await redis.setex(`presence:${userId}`, 86400, 'online') // 24h TTL auto-cleanup
  },
  async setOffline(userId) {
    await redis.del(`presence:${userId}`)
  },
  async isOnline(userId) {
    return await redis.exists(`presence:${userId}`) === 1
  },
  async getOnlineUsers(userIds) {
    if (!userIds.length) return []
    const pipeline = redis.pipeline()
    userIds.forEach(id => pipeline.exists(`presence:${id}`))
    const results = await pipeline.exec()
    return userIds.filter((id, i) => results[i][1] === 1)
  }
}

// ────────────────────────────────────────────────────────────────
// OFFLINE QUEUE HELPERS — DEFAULT PATH (in-memory, 48h TTL)
// This is the core of the hybrid queue strategy.
// Key: queue:{deviceId}:{sequenceNum}  TTL: 172800s (48 hours)
// ────────────────────────────────────────────────────────────────
const QUEUE_TTL = parseInt(process.env.REDIS_QUEUE_TTL_SECONDS || '172800') // 48h default

const queue = {
  // Store a message in Redis queue for an offline device
  async enqueue(deviceId, sequenceNum, payload) {
    const key = `queue:${deviceId}:${sequenceNum}`
    await redis.setex(key, QUEUE_TTL, JSON.stringify(payload))
  },

  // Get all queued messages for a device on reconnect
  async flush(deviceId) {
    const pattern = `queue:${deviceId}:*`
    const keys = await redis.keys(pattern)
    if (!keys.length) return []

    // Sort by sequence number (last part of key)
    keys.sort((a, b) => {
      const seqA = parseInt(a.split(':')[2])
      const seqB = parseInt(b.split(':')[2])
      return seqA - seqB
    })

    const pipeline = redis.pipeline()
    keys.forEach(k => pipeline.get(k))
    const results = await pipeline.exec()

    return keys.map((key, i) => ({
      key,
      sequenceNum: parseInt(key.split(':')[2]),
      payload: results[i][1] ? JSON.parse(results[i][1]) : null
    })).filter(m => m.payload !== null)
  },

  // Delete a specific queued message after delivery_ack
  async acknowledge(deviceId, sequenceNum) {
    const key = `queue:${deviceId}:${sequenceNum}`
    await redis.del(key)
  },

  // Delete all queued messages for a device (e.g. account deletion)
  async clearDevice(deviceId) {
    const keys = await redis.keys(`queue:${deviceId}:*`)
    if (keys.length > 0) await redis.del(...keys)
  }
}

// ────────────────────────────────────────────────────────────────
// RATE LIMIT HELPERS
// Sliding window counter per IP
// ────────────────────────────────────────────────────────────────
const rateLimiter = {
  async increment(ip, windowSeconds) {
    const key = `ratelimit:${ip}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, windowSeconds) // set TTL on first hit
    return count
  },
  async get(ip) {
    return parseInt(await redis.get(`ratelimit:${ip}`) || '0')
  }
}

module.exports = { redis, sessions, presence, queue, rateLimiter }
