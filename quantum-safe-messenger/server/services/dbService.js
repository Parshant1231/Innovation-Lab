const { query, withTransaction } = require('../config/database')
const { presence, queue: redisQueue } = require('../config/redis')

// ────────────────────────────────────────────────────────────────
// USER OPERATIONS
// ────────────────────────────────────────────────────────────────

async function getUserById(userId) {
  const res = await query(
    'SELECT id, username, email, status, reliable_delivery, created_at FROM users WHERE id = $1',
    [userId]
  )
  return res.rows[0] || null
}

async function getUserByUsername(username) {
  const res = await query(
    'SELECT id, username, email, status FROM users WHERE username = $1',
    [username.toLowerCase()]
  )
  return res.rows[0] || null
}

async function updateUserStatus(userId, status) {
  await query(
    'UPDATE users SET status = $1 WHERE id = $2',
    [status, userId]
  )
}

async function updateReliableDelivery(userId, enabled) {
  await query(
    'UPDATE users SET reliable_delivery = $1 WHERE id = $2',
    [enabled, userId]
  )
}

// ────────────────────────────────────────────────────────────────
// DEVICE OPERATIONS
// ────────────────────────────────────────────────────────────────

async function registerDevice(userId, { deviceName, kyberPublicKey, dilithiumPublicKey }) {
  const res = await query(
    `INSERT INTO devices (user_id, device_name, kyber_public_key, dilithium_public_key)
     VALUES ($1, $2, $3, $4)
     RETURNING id, device_id, device_name, registered_at`,
    [userId, deviceName || 'Unknown Device', kyberPublicKey, dilithiumPublicKey]
  )
  return res.rows[0]
}

async function getUserDevices(userId) {
  const res = await query(
    `SELECT id, device_id, device_name, kyber_public_key, dilithium_public_key, last_seen
     FROM devices WHERE user_id = $1 ORDER BY registered_at ASC`,
    [userId]
  )
  return res.rows
}

async function updateDeviceLastSeen(deviceId) {
  await query('UPDATE devices SET last_seen = NOW() WHERE device_id = $1', [deviceId])
}

// ────────────────────────────────────────────────────────────────
// MESSAGE OPERATIONS
// ────────────────────────────────────────────────────────────────

async function storeMessage({ chatId, senderId, recipientId, ciphertext, iv, authTag, sequenceNum }) {
  const res = await query(
    `INSERT INTO messages (chat_id, sender_id, recipient_id, ciphertext, iv, auth_tag, sequence_num, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent')
     RETURNING id, created_at`,
    [chatId, senderId, recipientId, ciphertext, iv, authTag, sequenceNum]
  )
  return res.rows[0]
}

async function getChatHistory(chatId, limit = 50, before = null) {
  const params = [chatId, limit]
  let whereClause = 'WHERE chat_id = $1'
  if (before) {
    whereClause += ' AND created_at < $3'
    params.push(before)
  }
  const res = await query(
    `SELECT id, sender_id, recipient_id, ciphertext, iv, auth_tag, sequence_num, status, created_at
     FROM messages ${whereClause}
     ORDER BY sequence_num DESC LIMIT $2`,
    params
  )
  return res.rows.reverse() // return in chronological order
}

async function updateMessageStatus(messageId, status) {
  await query(
    'UPDATE messages SET status = $1 WHERE id = $2',
    [status, messageId]
  )
}

// ────────────────────────────────────────────────────────────────
// HYBRID QUEUE — CORE ROUTING LOGIC
//
// Three paths depending on recipient status + user preference:
//   PATH A: Online → direct WS push (0 storage)
//   PATH B: Offline, default → Redis SETEX 48h (RAM only)
//   PATH C: Offline, reliable mode → PostgreSQL 7-day TTL
// ────────────────────────────────────────────────────────────────

async function routeMessage(payload, wsConnections) {
  const { recipientId, deviceId, sequenceNum } = payload
  const isOnline = await presence.isOnline(recipientId)

  if (isOnline) {
    // PATH A — Direct delivery, zero storage
    const ws = wsConnections.get(recipientId)
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'receive_message', data: payload }))
      return { path: 'A', delivered: true }
    }
  }

  // Recipient is offline — get their preference
  const userResult = await query(
    'SELECT reliable_delivery FROM users WHERE id = $1',
    [recipientId]
  )
  const reliableDelivery = userResult.rows[0]?.reliable_delivery || false

  if (reliableDelivery) {
    // PATH C — PostgreSQL queue (opt-in)
    await queueMessagePostgres(payload)
    return { path: 'C', delivered: false, queued: 'postgres' }
  } else {
    // PATH B — Redis queue (default, in-memory)
    await redisQueue.enqueue(deviceId, sequenceNum, payload)
    return { path: 'B', delivered: false, queued: 'redis' }
  }
}

// PATH C helper — PostgreSQL queue insert
async function queueMessagePostgres({ chatId, senderId, recipientId, deviceId, ciphertext, iv, authTag, sequenceNum }) {
  await query(
    `INSERT INTO message_queue
       (chat_id, sender_id, recipient_id, device_id, ciphertext, iv, auth_tag, sequence_num)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [chatId, senderId, recipientId, deviceId, ciphertext, iv, authTag, sequenceNum]
  )
}

// ── Flush queue on reconnect ─────────────────────────────────────
// Called when a device sends the "authenticate" WS event
// Checks Redis first (default path), then PostgreSQL (opt-in path)
async function flushQueue(userId, deviceId, sendToSocket) {
  const flushed = []
  const expired = []

  // ── STEP 1: Flush Redis queue (PATH B) ──────────────────────
  const redisMessages = await redisQueue.flush(deviceId)
  for (const msg of redisMessages) {
    try {
      await sendToSocket(msg.payload)
      // Delete immediately after confirmed delivery
      await redisQueue.acknowledge(deviceId, msg.sequenceNum)
      flushed.push({ source: 'redis', sequenceNum: msg.sequenceNum })
    } catch (err) {
      console.error(`[Queue] Failed to deliver Redis msg seq:${msg.sequenceNum}`, err.message)
    }
  }

  // ── STEP 2: Flush PostgreSQL queue if user has reliable mode (PATH C) ──
  const userResult = await query('SELECT reliable_delivery FROM users WHERE id = $1', [userId])
  if (userResult.rows[0]?.reliable_delivery) {
    const pgMessages = await query(
      `SELECT * FROM message_queue
       WHERE device_id = $1 AND ttl_expires > NOW()
       ORDER BY sequence_num ASC`,
      [deviceId]
    )
    for (const msg of pgMessages.rows) {
      try {
        await sendToSocket({
          chatId: msg.chat_id,
          senderId: msg.sender_id,
          recipientId: msg.recipient_id,
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          authTag: msg.auth_tag,
          sequenceNum: msg.sequence_num,
        })
        // Delete immediately after delivery — don't wait for TTL
        await query('DELETE FROM message_queue WHERE id = $1', [msg.id])
        flushed.push({ source: 'postgres', sequenceNum: msg.sequence_num })
      } catch (err) {
        console.error(`[Queue] Failed to deliver PG msg seq:${msg.sequence_num}`, err.message)
      }
    }
  }

  // ── STEP 3: Notify senders of expired Redis messages ─────────
  // (Handled separately by a background TTL expiry listener in Phase 3)

  console.log(`[Queue] Flushed ${flushed.length} messages for device ${deviceId}`)
  return { flushed, expired }
}

// ── Cleanup expired PG queue entries ────────────────────────────
async function cleanupExpiredQueue() {
  const res = await query('DELETE FROM message_queue WHERE ttl_expires < NOW() RETURNING id')
  if (res.rowCount > 0) {
    console.log(`[Queue] Cleaned up ${res.rowCount} expired queue entries`)
  }
  return res.rowCount
}

// ────────────────────────────────────────────────────────────────
// PUBLIC KEY OPERATIONS
// ────────────────────────────────────────────────────────────────

async function storePublicKey(userId, deviceId, { kyberKey, dilithiumKey }) {
  await query(
    `INSERT INTO public_keys (user_id, device_id, kyber_key, dilithium_key)
     VALUES ($1, $2, $3, $4)`,
    [userId, deviceId, kyberKey, dilithiumKey]
  )
}

async function getLatestPublicKey(userId) {
  const res = await query(
    `SELECT pk.kyber_key, pk.dilithium_key, pk.device_id, pk.expires_at
     FROM public_keys pk
     JOIN devices d ON d.id = pk.device_id
     WHERE pk.user_id = $1 AND pk.expires_at > NOW()
     ORDER BY pk.created_at DESC LIMIT 1`,
    [userId]
  )
  return res.rows[0] || null
}

module.exports = {
  getUserById,
  getUserByUsername,
  updateUserStatus,
  updateReliableDelivery,
  registerDevice,
  getUserDevices,
  updateDeviceLastSeen,
  storeMessage,
  getChatHistory,
  updateMessageStatus,
  routeMessage,
  flushQueue,
  cleanupExpiredQueue,
  storePublicKey,
  getLatestPublicKey,
}
