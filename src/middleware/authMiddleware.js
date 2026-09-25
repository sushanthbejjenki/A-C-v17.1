const jwt = require('jsonwebtoken');
const environment = require('../config/environment');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  let token = null;

  // 1. Check cookies first
  if (req.cookies && req.cookies[environment.sessionCookieName]) {
    token = req.cookies[environment.sessionCookieName];
  }

  // 2. Check Authorization header
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please sign in.'
    });
  }

  try {
    const decoded = jwt.verify(token, environment.jwtSecret);
    const userId = decoded.sub || decoded.id;
    const user = await User.findById(userId);

    if (!user) {
      res.clearCookie(environment.sessionCookieName, { path: '/' });
      return res.status(401).json({
        success: false,
        message: 'Account no longer exists.'
      });
    }

    if (!user.isActive) {
      res.clearCookie(environment.sessionCookieName, { path: '/' });
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Please contact support.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    res.clearCookie(environment.sessionCookieName, { path: '/' });
    return res.status(401).json({
      success: false,
      message: 'Session expired or invalid. Please sign in again.'
    });
  }
}

// Optional auth helper: attaches user if token present, but doesn't block if missing
async function optionalAuth(req, res, next) {
  let token = null;
  if (req.cookies && req.cookies[environment.sessionCookieName]) {
    token = req.cookies[environment.sessionCookieName];
  }
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, environment.jwtSecret);
    const user = await User.findById(decoded.sub || decoded.id);
    if (user && user.isActive) {
      req.user = user;
    }
  } catch {
    // Ignore invalid optional tokens
  }
  next();
}

module.exports = {
  requireAuth,
  optionalAuth
};
