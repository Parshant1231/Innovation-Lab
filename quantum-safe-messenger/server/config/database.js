require('dotenv').config()
const { Pool } = require('pg')

// ── Connection pool ─────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,               // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
})

// ── Log connections in dev ──────────────────────────────────────
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DB] New client connected to PostgreSQL')
  }
})

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message)
})

// ── Health check ────────────────────────────────────────────────
async function testConnection() {
  try {
    const client = await pool.connect()
    await client.query('SELECT NOW()')
    client.release()
    console.log('[DB] ✓ PostgreSQL connected')
    return true
  } catch (err) {
    console.error('[DB] ✗ PostgreSQL connection failed:', err.message)
    return false
  }
}

// ── Query helper with error handling ────────────────────────────
async function query(text, params) {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    if (process.env.NODE_ENV === 'development' && duration > 200) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80))
    }
    return res
  } catch (err) {
    console.error('[DB] Query error:', err.message, '| Query:', text.substring(0, 80))
    throw err
  }
}

// ── Transaction helper ──────────────────────────────────────────
async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { pool, query, withTransaction, testConnection }
