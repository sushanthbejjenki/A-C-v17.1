const mongoose = require('mongoose');

const loginLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  email: {
    type: String,
    trim: true,
    default: ''
  },
  username: {
    type: String,
    trim: true,
    default: ''
  },
  success: {
    type: Boolean,
    required: true,
    index: true
  },
  role: {
    type: String,
    default: null
  },
  ip: {
    type: String,
    default: '—'
  },
  userAgent: {
    type: String,
    default: '—'
  },
  failureReason: {
    type: String,
    default: ''
  },
  sessionId: { type: String, default: '', index: true },
  logoutAt: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0, min: 0 },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

const LoginLog = mongoose.model('LoginLog', loginLogSchema);
module.exports = LoginLog;
