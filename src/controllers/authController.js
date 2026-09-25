const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const environment = require('../config/environment');
const { isValidEmail, isValidPhone, isValidPassword } = require('../utils/validators');

function signToken(user, sessionId) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      id: user._id.toString(),
      username: user.username,
      role: user.role,
      sid: sessionId
    },
    environment.jwtSecret,
    { expiresIn: environment.jwtExpiresIn }
  );
}

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || '—';
}

async function register(req, res, next) {
  try {
    const rawName = req.body.name || req.body.fullName || '';
    const name = String(rawName).trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '');
  const requestedRole = String(req.body.role || '').trim().toLowerCase();
    const confirmPassword = String(req.body.confirmPassword || '');

    if (!name || !email || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, username, and password are required.',
        message: 'Name, email, username, and password are required.'
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match.',
        message: 'Passwords do not match.'
      });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Name must be between 2 and 100 characters.',
        message: 'Name must be between 2 and 100 characters.'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address.',
        message: 'Please enter a valid email address.'
      });
    }

    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3–30 characters and contain only letters, numbers, dot, dash, or underscore.',
        message: 'Username must be 3–30 characters and contain only letters, numbers, dot, dash, or underscore.'
      });
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid phone number.',
        message: 'Please enter a valid phone number.'
      });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be between 8 and 128 characters.',
        message: 'Password must be between 8 and 128 characters.'
      });
    }

    // Check uniqueness
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      const isEmail = existingUser.email === email;
      return res.status(409).json({
        success: false,
        error: isEmail ? 'Email is already registered.' : 'Username is already registered.',
        message: isEmail ? 'Email is already registered.' : 'Username is already registered.'
      });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      name,
      email,
      username,
      phone,
      passwordHash,
      role: 'user',
      isActive: true
    });

    return res.status(201).json({
      success: true,
      ok: true,
      message: 'Registration successful. You can now sign in.',
      user: {
        id: user._id.toString(),
        name: user.name,
        fullName: user.name,
        email: user.email,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
}

function getISTDayRange(date = new Date()) {
  const dateString = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
  return {
    date: dateString,
    start: new Date(`${dateString}T00:00:00+05:30`),
    end: new Date(`${dateString}T23:59:59.999+05:30`)
  };
}

async function countSuccessfulLoginsToday(userId) {
  const { start, end } = getISTDayRange();
  return LoginLog.countDocuments({ userId, success: true, timestamp: { $gte: start, $lte: end } });
}

async function login(req, res, next) {
  const ip = getClientIp(req);
  const userAgent = req.get('user-agent') || '—';
  const rawIdentifier = req.body.username || req.body.email || req.body.identifier || '';
  const identifier = String(rawIdentifier).trim().toLowerCase();
  const password = String(req.body.password || '');
  const requestedRole = String(req.body.role || '').trim().toLowerCase();

  try {
    if (!identifier || !password) {
      await LoginLog.create({
        username: identifier || '(empty)',
        email: identifier.includes('@') ? identifier : '',
        success: false,
        role: null,
        ip,
        userAgent,
        failureReason: 'Missing credentials'
      });

      return res.status(400).json({
        success: false,
        error: 'Username/Email and password are required.',
        message: 'Username/Email and password are required.'
      });
    }

    // Find by username or email
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    // Constant-time compare against dummy hash if user not found to prevent timing enumeration
    const fallbackHash = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOqY2Q4b5bQ7nVf3h6Xz9aP2cW8mJ0K1S';
    const isValid = await bcrypt.compare(password, user ? user.passwordHash : fallbackHash);

    const portalMismatch = requestedRole === 'intern' ? (!user || user.role !== 'employee' || user.employeeType !== 'intern') : requestedRole === 'employee' ? (!user || user.role !== 'employee' || user.employeeType === 'intern') : (requestedRole && (!user || user.role !== requestedRole));
    if (!user || !isValid || portalMismatch) {
      await LoginLog.create({
        userId: user ? user._id : null,
        username: user ? user.username : identifier,
        email: user ? user.email : (identifier.includes('@') ? identifier : ''),
        success: false,
        role: user ? user.role : null,
        ip,
        userAgent,
        failureReason: portalMismatch ? 'Incorrect login portal' : 'Invalid credentials'
      });

      return res.status(401).json({
        success: false,
        error: portalMismatch ? (requestedRole === 'intern' ? 'This account is not an intern account.' : `This account is not a ${requestedRole} account.`) : 'Invalid username or password.',
        message: portalMismatch ? (requestedRole === 'intern' ? 'This account is not an intern account.' : `This account is not a ${requestedRole} account.`) : 'Invalid username or password.'
      });
    }

    if (!user.isActive) {
      await LoginLog.create({
        userId: user._id,
        username: user.username,
        email: user.email,
        success: false,
        role: user.role,
        ip,
        userAgent,
        failureReason: 'Account deactivated'
      });

      return res.status(403).json({
        success: false,
        error: 'Your account is deactivated. Please contact support.',
        message: 'Your account is deactivated. Please contact support.'
      });
    }

    // Employee portal login is independent of attendance. Check-in/check-out limits are enforced by the attendance controller.

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Create a unique session id so every login/logout cycle can be measured.
    const sessionId = crypto.randomUUID();
    await LoginLog.create({
      userId: user._id, username: user.username, email: user.email, success: true, role: user.role,
      ip, userAgent, sessionId, failureReason: ''
    });

    const token = signToken(user, sessionId);

    // Set secure HTTP-only cookie
    res.cookie(environment.sessionCookieName, token, {
      httpOnly: true,
      sameSite: environment.cookieSameSite,
      secure: environment.isProduction || environment.cookieSameSite === 'none',
      maxAge: environment.sessionCookieMaxAge,
      path: '/'
    });

    return res.json({
      success: true,
      ok: true,
      message: 'Login successful.',
      token,
      user: user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res) {
  try {
    const token = req.cookies?.[environment.sessionCookieName];
    if (token) {
      try {
        const decoded = jwt.verify(token, environment.jwtSecret);
        if (decoded?.sid && decoded?.sub) {
          const session = await LoginLog.findOne({ sessionId: decoded.sid, userId: decoded.sub, success: true, logoutAt: null }).sort({ timestamp: -1 });
          if (session) {
            const now = new Date();
            session.logoutAt = now;
            session.durationSeconds = Math.max(0, Math.floor((now.getTime() - new Date(session.timestamp).getTime()) / 1000));
            await session.save();
          }
        }
      } catch (_) { /* Always clear the cookie even if the token is expired. */ }
    }
    res.clearCookie(environment.sessionCookieName, {
      httpOnly: true, sameSite: environment.cookieSameSite,
      secure: environment.isProduction || environment.cookieSameSite === 'none', path: '/'
    });
    return res.json({ success: true, ok: true, message: 'Logged out successfully.' });
  } catch (err) {
    return res.json({ success: true, ok: true, message: 'Logged out successfully.' });
  }
}

function getMe(req, res) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      message: 'Not authenticated.'
    });
  }

  return res.json({
    success: true,
    authenticated: true,
    user: req.user.toSafeObject()
  });
}

module.exports = {
  register,
  login,
  logout,
  getMe
};
