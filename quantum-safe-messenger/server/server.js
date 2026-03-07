require('dotenv').config()
const express = require('express')
const http = require('http')
const WebSocket = require('ws')

const { testConnection } = require('./config/database')
const { redis, presence } = require('./config/redis')
const {
  corsMiddleware,
  helmetMiddleware,
  globalLimiter,
  authLimiter,
  sanitizeBody,
  suspiciousLogger,
} = require('./middleware/security')
const { authenticate } = require('./middleware/auth')
const authService = require('./services/authService')
const dbService = require('./services/dbService')

const PORT = process.env.PORT || 3001
const app = express()
const server = http.createServer(app)

// ── Active WS connections: userId → WebSocket ──────────────────
const wsConnections = new Map()

// ────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ────────────────────────────────────────────────────────────────
app.use(helmetMiddleware)
app.use(corsMiddleware)
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))
app.use(sanitizeBody)
app.use(suspiciousLogger)
app.use(globalLimiter)

// ────────────────────────────────────────────────────────────────
// REST API ROUTES
// ────────────────────────────────────────────────────────────────

// ── Health check ────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await redis.ping()
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: { api: 'ok', redis: 'ok' },
      version: '1.0.0-phase1'
    })
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message })
  }
})

// ── AUTH: Register ──────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body
    const result = await authService.register({ username, email, password })
    res.status(201).json({ success: true, ...result })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Registration failed' })
  }
})

// ── AUTH: Login ─────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body
    const result = await authService.login({ usernameOrEmail, password })
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Login failed' })
  }
})

// ── AUTH: Refresh tokens ─────────────────────────────────────────
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' })
    const tokens = await authService.refreshTokens(refreshToken)
    res.json({ success: true, ...tokens })
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message })
  }
})

// ── AUTH: Logout ────────────────────────────────────────────────
app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    await authService.logout(req.user.userId, req.user.tokenId)
    res.json({ success: true, message: 'Logged out' })
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

// ── AUTH: Logout all devices ─────────────────────────────────────
app.post('/api/auth/logout-all', authenticate, async (req, res) => {
  try {
    await authService.logoutAll(req.user.userId)
    res.json({ success: true, message: 'Logged out from all devices' })
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

// ── USER: Get current user ───────────────────────────────────────
app.get('/api/user/me', authenticate, async (req, res) => {
  try {
    const user = await dbService.getUserById(req.user.userId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ success: true, user })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// ── USER: Get user by username ───────────────────────────────────
app.get('/api/user/:username', authenticate, async (req, res) => {
  try {
    const user = await dbService.getUserByUsername(req.params.username)
    if (!user) return res.status(404).json({ error: 'User not found' })
    // Never expose sensitive fields to other users
    res.json({ success: true, user: { id: user.id, username: user.username, status: user.status } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// ── USER: Update reliable delivery preference ────────────────────
app.put('/api/user/settings/reliable-delivery', authenticate, async (req, res) => {
  try {
    const { enabled } = req.body
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' })
    }
    await dbService.updateReliableDelivery(req.user.userId, enabled)
    res.json({
      success: true,
      message: enabled
        ? 'Reliable delivery enabled — encrypted messages stored up to 7 days'
        : 'Reliable delivery disabled — messages stored in RAM for 48 hours only',
      warning: enabled
        ? 'Your encrypted messages will be stored server-side for up to 7 days. They remain unreadable without your device key.'
        : null
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' })
  }
})

// ── Chat history ─────────────────────────────────────────────────
app.get('/api/chat/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params
    const { limit = 50, before } = req.query
    const messages = await dbService.getChatHistory(chatId, parseInt(limit), before)
    res.json({ success: true, messages })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// ────────────────────────────────────────────────────────────────
// WEBSOCKET SERVER
// Phase 1: Authentication + presence only
// Phase 3: Full message routing with hybrid queue
// ────────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' })

wss.on('connection', (ws, req) => {
  ws.userId = null
  ws.deviceId = null
  ws.isAlive = true

  console.log('[WS] New connection from', req.socket.remoteAddress)

  ws.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString())

      // ── Authenticate first ───────────────────────────────────
      if (msg.type === 'authenticate') {
        try {
          const user = await authService.verifyToken(msg.token)
          ws.userId = user.userId
          ws.username = user.username

          // Register in connections map
          wsConnections.set(user.userId, ws)

          // Mark online in Redis
          await presence.setOnline(user.userId)
          await dbService.updateUserStatus(user.userId, 'online')

          // Flush queued messages for this device
          if (msg.deviceId) {
            ws.deviceId = msg.deviceId
            await dbService.updateDeviceLastSeen(msg.deviceId)
            await dbService.flushQueue(user.userId, msg.deviceId, async (payload) => {
              ws.send(JSON.stringify({ type: 'receive_message', data: payload }))
            })
          }

          ws.send(JSON.stringify({
            type: 'authenticated',
            userId: user.userId,
            username: user.username,
          }))

          console.log(`[WS] ✓ Authenticated: ${user.username}`)
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }))
          ws.close()
        }
        return
      }

      // ── All other events require authentication ──────────────
      if (!ws.userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }))
        return
      }

      // ── Ping/pong keepalive ──────────────────────────────────
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
        return
      }

      // ── Placeholder for Phase 3: message routing ─────────────
      // send_chat_message, typing_start, typing_stop,
      // mark_message_read, delivery_ack → implemented in Phase 3

      console.log(`[WS] Event: ${msg.type} from ${ws.username}`)

    } catch (err) {
      console.error('[WS] Message parse error:', err.message)
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
    }
  })

  ws.on('pong', () => { ws.isAlive = true })

  ws.on('close', async () => {
    if (ws.userId) {
      wsConnections.delete(ws.userId)
      await presence.setOffline(ws.userId)
      await dbService.updateUserStatus(ws.userId, 'offline')
      console.log(`[WS] Disconnected: ${ws.username}`)
    }
  })

  ws.on('error', (err) => {
    console.error('[WS] Socket error:', err.message)
  })
})

// ── Heartbeat — detect dead connections every 30s ───────────────
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      if (ws.userId) wsConnections.delete(ws.userId)
      return ws.terminate()
    }
    ws.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on('close', () => clearInterval(heartbeat))

// ── 404 handler ──────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// ────────────────────────────────────────────────────────────────
// STARTUP
// ────────────────────────────────────────────────────────────────
async function start() {
  console.log('\n⚛  QuantumSafe Messenger — Backend Server')
  console.log('─'.repeat(48))

  // Check database
  const dbOk = await testConnection()
  if (!dbOk) {
    console.error('[Server] Cannot start without database connection')
    process.exit(1)
  }

  // Check Redis
  try {
    await redis.ping()
    console.log('[Server] ✓ Redis connected')
  } catch (err) {
    console.error('[Server] ✗ Redis connection failed:', err.message)
    process.exit(1)
  }

  server.listen(PORT, () => {
    console.log(`[Server] ✓ REST API running on port ${PORT}`)
    console.log(`[Server] ✓ WebSocket running on ws://localhost:${PORT}/ws`)
    console.log(`[Server] ✓ Health: http://localhost:${PORT}/api/health`)
    console.log('─'.repeat(48))
    console.log('[Server] Phase 1 complete — Auth + DB + Redis + WebSocket ready\n')
  })
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down gracefully...')
  server.close(() => {
    redis.disconnect()
    process.exit(0)
  })
})

start()

module.exports = { app, server, wsConnections }
