require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { pool } = require('../config/database')

async function migrate() {
  console.log('[Migrate] Running schema migration...')
  const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf-8')
  try {
    await pool.query(schema)
    console.log('[Migrate] ✓ Schema applied successfully')
  } catch (err) {
    console.error('[Migrate] ✗ Migration failed:', err.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

migrate()
