require('dotenv').config()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { query } = require('../config/database')
const { sessions } = require('../config/redis')

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12')
const JWT_SECRET    = process.env.JWT_SECRET
const JWT_EXPIRES   = process.env.JWT_EXPIRES_IN || '15m'
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d'

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('[Auth] JWT_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32')
}

// ── Token helpers ──────────────────────────────────────────────
function generateTokenPair(userId, username) {
  const tokenId = uuidv4() // unique ID for this token — stored in Redis for revocation

  const accessToken = jwt.sign(
    { sub: userId, username, tokenId, type: 'access' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES, issuer: 'qsm', algorithm: 'HS256' }
  )

  const refreshToken = jwt.sign(
    { sub: userId, username, tokenId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES, issuer: 'qsm', algorithm: 'HS256' }
  )

  return { accessToken, refreshToken, tokenId }
}

function parseExpiryToSeconds(expiry) {
  const match = expiry.match(/^(\d+)([smhd])$/)
  if (!match) return 900
  const val = parseInt(match[1])
  const unit = match[2]
  const map = { s: 1, m: 60, h: 3600, d: 86400 }
  return val * map[unit]
}

// ── REGISTER ───────────────────────────────────────────────────
async function register({ username, email, password }) {
  // Input validation
  if (!username || !email || !password) {
    throw { status: 400, message: 'Username, email and password are required' }
  }
  if (username.length < 3 || username.length > 32) {
    throw { status: 400, message: 'Username must be 3–32 characters' }
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw { status: 400, message: 'Username can only contain letters, numbers and underscores' }
  }
  if (password.length < 8) {
    throw { status: 400, message: 'Password must be at least 8 characters' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw { status: 400, message: 'Invalid email address' }
  }

  // Check uniqueness
  const existing = await query(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username.toLowerCase(), email.toLowerCase()]
  )
  if (existing.rows.length > 0) {
    throw { status: 409, message: 'Username or email already taken' }
  }

  // Hash password — bcrypt cost 12 (~300ms intentionally slow)
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  // Insert user — note: password_hash only, never plaintext
  const result = await query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, created_at`,
    [username.toLowerCase(), email.toLowerCase(), passwordHash]
  )
  const user = result.rows[0]

  // Generate tokens
  const { accessToken, refreshToken, tokenId } = generateTokenPair(user.id, user.username)

  // Store tokenId in Redis for revocation capability
  await sessions.set(user.id, tokenId, parseExpiryToSeconds(JWT_EXPIRES))

  console.log(`[Auth] ✓ Registered: ${user.username} (${user.id})`)

  return {
    user: { id: user.id, username: user.username, email: user.email, createdAt: user.created_at },
    accessToken,
    refreshToken
  }
}

// ── LOGIN ──────────────────────────────────────────────────────
async function login({ usernameOrEmail, password }) {
  if (!usernameOrEmail || !password) {
    throw { status: 400, message: 'Credentials required' }
  }

  // Look up by username or email
  const result = await query(
    `SELECT id, username, email, password_hash, status
     FROM users
     WHERE username = $1 OR email = $1`,
    [usernameOrEmail.toLowerCase()]
  )

  if (result.rows.length === 0) {
    // Timing-safe: still hash to prevent user enumeration via timing
    await bcrypt.hash('dummy', BCRYPT_ROUNDS)
    throw { status: 401, message: 'Invalid credentials' }
  }

  const user = result.rows[0]
  const passwordMatch = await bcrypt.compare(password, user.password_hash)

  if (!passwordMatch) {
    throw { status: 401, message: 'Invalid credentials' }
  }

  const { accessToken, refreshToken, tokenId } = generateTokenPair(user.id, user.username)
  await sessions.set(user.id, tokenId, parseExpiryToSeconds(JWT_EXPIRES))

  console.log(`[Auth] ✓ Login: ${user.username}`)

  return {
    user: { id: user.id, username: user.username, email: user.email, status: user.status },
    accessToken,
    refreshToken
  }
}

// ── VERIFY TOKEN ───────────────────────────────────────────────
async function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: 'qsm', algorithms: ['HS256'] })

    if (decoded.type !== 'access') {
      throw { status: 401, message: 'Invalid token type' }
    }

    // Check Redis — if deleted, token was revoked (user logged out)
    const active = await sessions.exists(decoded.sub, decoded.tokenId)
    if (!active) {
      throw { status: 401, message: 'Session expired — please log in again' }
    }

    return { userId: decoded.sub, username: decoded.username, tokenId: decoded.tokenId }
  } catch (err) {
    if (err.status) throw err
    if (err.name === 'TokenExpiredError') throw { status: 401, message: 'Token expired' }
    throw { status: 401, message: 'Invalid token' }
  }
}

// ── REFRESH TOKEN ──────────────────────────────────────────────
async function refreshTokens(refreshToken) {
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET, { issuer: 'qsm', algorithms: ['HS256'] })

    if (decoded.type !== 'refresh') {
      throw { status: 401, message: 'Invalid token type' }
    }

    // Revoke old tokenId
    await sessions.delete(decoded.sub, decoded.tokenId)

    // Issue fresh pair
    const { accessToken, refreshToken: newRefresh, tokenId } = generateTokenPair(decoded.sub, decoded.username)
    await sessions.set(decoded.sub, tokenId, parseExpiryToSeconds(JWT_EXPIRES))

    return { accessToken, refreshToken: newRefresh }
  } catch (err) {
    if (err.status) throw err
    throw { status: 401, message: 'Invalid refresh token' }
  }
}

// ── LOGOUT ─────────────────────────────────────────────────────
async function logout(userId, tokenId) {
  await sessions.delete(userId, tokenId)
  console.log(`[Auth] ✓ Logout: ${userId}`)
}

// ── LOGOUT ALL DEVICES ─────────────────────────────────────────
async function logoutAll(userId) {
  await sessions.deleteAll(userId)
  console.log(`[Auth] ✓ Logout all devices: ${userId}`)
}

module.exports = { register, login, verifyToken, refreshTokens, logout, logoutAll }
