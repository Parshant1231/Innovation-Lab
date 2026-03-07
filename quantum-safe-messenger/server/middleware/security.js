require('dotenv').config()
const helmet = require('helmet')
const cors = require('cors')
const rateLimit = require('express-rate-limit')

// ── CORS ────────────────────────────────────────────────────────
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}
const corsMiddleware = cors(corsOptions)

// ── Helmet — HTTP security headers ─────────────────────────────
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
})

// ── Global rate limiter — 100 requests / 15 min per IP ─────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => true,  // disabled in dev
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: (req) => true,  // disabled in dev
})

// ── Request sanitizer — strip dangerous keys from body ─────────
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    // Remove any keys that look like prototype pollution attempts
    const dangerous = ['__proto__', 'constructor', 'prototype']
    dangerous.forEach(key => {
      delete req.body[key]
    })
  }
  next()
}

// ── Log suspicious requests ─────────────────────────────────────
function suspiciousLogger(req, res, next) {
  const suspicious = [
    '/admin', '/wp-admin', '/phpmyadmin', '/.env',
    '/config', '/backup', '/dump', '/sql',
    '/api/internal', '/api/v0'
  ]
  const isSuspicious = suspicious.some(path => req.path.startsWith(path))
  if (isSuspicious) {
    console.warn(`[Security] ⚠️ Suspicious request: ${req.method} ${req.path} from ${req.ip}`)
  }
  next()
}

module.exports = {
  corsMiddleware,
  helmetMiddleware,
  globalLimiter,
  authLimiter,
  sanitizeBody,
  suspiciousLogger,
}
