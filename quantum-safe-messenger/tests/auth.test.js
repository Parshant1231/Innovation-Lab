/**
 * Phase 1 — Auth Service Tests
 * Tests JWT generation, bcrypt hashing, token verification, and session management.
 * Run: npm test
 */

// Mock Redis and DB for unit tests
jest.mock('../server/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}))

jest.mock('../server/config/redis', () => ({
  redis: { ping: jest.fn().mockResolvedValue('PONG') },
  sessions: {
    set: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(undefined),
    deleteAll: jest.fn().mockResolvedValue(undefined),
  },
  presence: {
    setOnline: jest.fn(),
    setOffline: jest.fn(),
    isOnline: jest.fn().mockResolvedValue(false),
  },
  queue: {
    enqueue: jest.fn(),
    flush: jest.fn().mockResolvedValue([]),
    acknowledge: jest.fn(),
  },
  rateLimiter: { increment: jest.fn(), get: jest.fn() },
}))

const { query } = require('../server/config/database')
const { sessions } = require('../server/config/redis')

// Set env before importing authService
process.env.JWT_SECRET = 'test_secret_that_is_long_enough_for_hs256_minimum_32_chars'
process.env.BCRYPT_ROUNDS = '4' // fast for tests
process.env.JWT_EXPIRES_IN = '15m'
process.env.JWT_REFRESH_EXPIRES_IN = '7d'

const authService = require('../server/services/authService')

// ── REGISTER ────────────────────────────────────────────────────
describe('register()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('registers a new user and returns tokens', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })  // no existing user
      .mockResolvedValueOnce({              // insert user
        rows: [{ id: 'user-123', username: 'alice', email: 'alice@test.com', created_at: new Date() }]
      })

    const result = await authService.register({
      username: 'alice',
      email: 'alice@test.com',
      password: 'securepassword123'
    })

    expect(result.user.username).toBe('alice')
    expect(result.accessToken).toBeDefined()
    expect(result.refreshToken).toBeDefined()
    expect(sessions.set).toHaveBeenCalledTimes(1)
  })

  it('rejects short username', async () => {
    await expect(authService.register({ username: 'ab', email: 'a@b.com', password: 'password123' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('3') })
  })

  it('rejects invalid email', async () => {
    await expect(authService.register({ username: 'alice', email: 'notanemail', password: 'password123' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejects short password', async () => {
    await expect(authService.register({ username: 'alice', email: 'a@b.com', password: 'short' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejects duplicate username', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] })
    await expect(authService.register({ username: 'alice', email: 'a@b.com', password: 'password123' }))
      .rejects.toMatchObject({ status: 409 })
  })
})

// ── LOGIN ────────────────────────────────────────────────────────
describe('login()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('logs in with correct credentials', async () => {
    const bcrypt = require('bcryptjs')
    const hash = await bcrypt.hash('mypassword', 4)

    query.mockResolvedValueOnce({
      rows: [{ id: 'user-123', username: 'alice', email: 'alice@test.com', password_hash: hash, status: 'offline' }]
    })

    const result = await authService.login({ usernameOrEmail: 'alice', password: 'mypassword' })
    expect(result.user.username).toBe('alice')
    expect(result.accessToken).toBeDefined()
  })

  it('rejects wrong password', async () => {
    const bcrypt = require('bcryptjs')
    const hash = await bcrypt.hash('correctpassword', 4)

    query.mockResolvedValueOnce({
      rows: [{ id: 'user-123', username: 'alice', email: 'alice@test.com', password_hash: hash, status: 'offline' }]
    })

    await expect(authService.login({ usernameOrEmail: 'alice', password: 'wrongpassword' }))
      .rejects.toMatchObject({ status: 401 })
  })

  it('rejects non-existent user', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(authService.login({ usernameOrEmail: 'nobody', password: 'password' }))
      .rejects.toMatchObject({ status: 401 })
  })
})

// ── VERIFY TOKEN ─────────────────────────────────────────────────
describe('verifyToken()', () => {
  beforeEach(() => jest.clearAllMocks())

  it('verifies a valid token', async () => {
    const bcrypt = require('bcryptjs')
    const hash = await bcrypt.hash('pass', 4)
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'alice', email: 'a@b.com', created_at: new Date() }] })

    const { accessToken } = await authService.register({ username: 'alice', email: 'a@b.com', password: 'password123' })
    sessions.exists.mockResolvedValue(true)

    const decoded = await authService.verifyToken(accessToken)
    expect(decoded.username).toBe('alice')
  })

  it('rejects a revoked token (not in Redis)', async () => {
    const bcrypt = require('bcryptjs')
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'alice', email: 'a@b.com', created_at: new Date() }] })

    const { accessToken } = await authService.register({ username: 'alice', email: 'a@b.com', password: 'password123' })
    sessions.exists.mockResolvedValue(false) // simulate revoked

    await expect(authService.verifyToken(accessToken)).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a malformed token', async () => {
    await expect(authService.verifyToken('not.a.real.token'))
      .rejects.toMatchObject({ status: 401 })
  })
})
