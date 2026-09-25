const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, default: '' },
  profileImageFilename: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'employee', 'client', 'user'], default: 'user', index: true },
  employeeType: { type: String, enum: ['employee', 'intern', 'wfh'], default: 'employee', index: true },
  isActive: { type: Boolean, default: true, index: true },
  employeeId: { type: String, trim: true, default: '' },
  department: { type: String, trim: true, default: '' },
  designation: { type: String, trim: true, default: '' },
  attendanceScheduleEnabled: { type: Boolean, default: true },
  checkInTime: { type: String, default: '09:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  graceMinutes: { type: Number, default: 10, min: 0, max: 120 },
  checkOutTime: { type: String, default: '18:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  clientCompany: { type: String, trim: true, default: '' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
  assignedClients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
  lastLogin: { type: Date, default: null },
  allowMultipleCheckIns: { type: Boolean, default: false },
  maxCheckInsPerDay: { type: Number, default: 1, min: 1, max: 50 },
  // Legacy names kept so existing MongoDB documents remain readable.
  allowMultipleLogins: { type: Boolean, default: false },
  maxLoginsPerDay: { type: Number, default: 1, min: 1, max: 50 }
}, { timestamps: true });

userSchema.methods.comparePassword = function(candidatePassword) {
  if (!this.passwordHash || !candidatePassword) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};
userSchema.methods.toSafeObject = function() {
  return {
    id: this._id.toString(), name: this.name, fullName: this.name, email: this.email,
    username: this.username, phone: this.phone || '', profileImageUrl: this.profileImageFilename ? `/api/workspace/profile-image/${this._id}` : '', role: this.role, isActive: this.isActive,
    employeeId: this.employeeId || '', employeeType: this.employeeType || 'employee', department: this.department || '', designation: this.designation || '',
    attendanceScheduleEnabled: this.attendanceScheduleEnabled !== false, checkInTime: this.checkInTime || '09:00',
    graceMinutes: Number.isFinite(this.graceMinutes) ? this.graceMinutes : 10, checkOutTime: this.checkOutTime || '18:00',
    clientCompany: this.clientCompany || '', clientId: this.clientId ? this.clientId.toString() : null,
    assignedClients: (this.assignedClients || []).map(id => id.toString()),
    lastLogin: this.lastLogin,
    allowMultipleCheckIns: this.allowMultipleCheckIns === true || this.allowMultipleLogins === true,
    maxCheckInsPerDay: Number.isFinite(this.maxCheckInsPerDay) ? this.maxCheckInsPerDay : (Number.isFinite(this.maxLoginsPerDay) ? this.maxLoginsPerDay : 1),
    createdAt: this.createdAt, updatedAt: this.updatedAt
  };
};
userSchema.statics.hashPassword = password => bcrypt.hash(password, 12);
module.exports = mongoose.model('User', userSchema);
