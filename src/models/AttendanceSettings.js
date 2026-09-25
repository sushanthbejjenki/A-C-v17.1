const mongoose = require('mongoose');

const attendanceSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'company' },
  enabled: { type: Boolean, default: false },
  checkInTime: { type: String, default: '09:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  graceMinutes: { type: Number, default: 10, min: 0, max: 120 },
  checkOutTime: { type: String, default: '18:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ }
}, { timestamps: true });

module.exports = mongoose.model('AttendanceSettings', attendanceSettingsSchema);
