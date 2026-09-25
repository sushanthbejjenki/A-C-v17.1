const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, default: null },
  durationSeconds: { type: Number, default: 0, min: 0 }
}, { _id: true });

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true, index: true },
  status: { type: String, enum: ['present', 'absent', 'late', 'leave', 'holiday'], default: 'present' },
  // One attendance record per employee per day, with any number of work sessions.
  sessions: { type: [sessionSchema], default: [] },
  // Legacy fields retained for compatibility: first check-in and final check-out.
  checkIn: { type: Date, default: null },
  checkOut: { type: Date, default: null },
  note: { type: String, default: '' },
  emailSummarySentAt: { type: Date, default: null }
}, { timestamps: true });
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: -1, status: 1 });
module.exports = mongoose.model('Attendance', attendanceSchema);
