const mongoose = require('mongoose');
const leaveSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['advance', 'emergency'], required: true },
  fromDate: { type: Date, required: true }, toDate: { type: Date, required: true },
  reason: { type: String, required: true, maxlength: 1000 },
  proofPath: { type: String, default: '' }, proofOriginalName: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  adminNote: { type: String, default: '' }, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });
leaveSchema.index({ status: 1, createdAt: -1 });
leaveSchema.index({ employee: 1, createdAt: -1 });
module.exports = mongoose.model('LeaveRequest', leaveSchema);
