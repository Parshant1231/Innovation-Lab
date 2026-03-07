const { verifyToken } = require('../services/authService')

// ── Auth middleware — attach req.user on valid JWT ─────────────
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' })
    }

    const token = authHeader.split(' ')[1]
    const user = await verifyToken(token)
    req.user = user // { userId, username, tokenId }
    next()
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Unauthorized' })
  }
}

// ── Optional auth — attach user if token present, don't fail ──
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      req.user = await verifyToken(token)
    }
  } catch (_) {
    // silent fail — user just won't have req.user
  }
  next()
}

module.exports = { authenticate, optionalAuth }
