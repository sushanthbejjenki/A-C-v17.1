const mongoose = require('mongoose');
const performanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  overallScore: { type: Number, min: 0, max: 100, required: true },
  attendanceScore: { type: Number, min: 0, max: 100, default: 0 },
  workQuality: { type: Number, min: 0, max: 100, default: 0 },
  punctuality: { type: Number, min: 0, max: 100, default: 0 },
  clientHandling: { type: Number, min: 0, max: 100, default: 0 },
  remarks: { type: String, maxlength: 1000, default: '' },
  reviewDate: { type: Date, default: Date.now },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
performanceSchema.index({ employee: 1, reviewDate: -1 });
module.exports = mongoose.model('Performance', performanceSchema);
