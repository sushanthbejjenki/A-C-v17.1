const mongoose = require('mongoose');
const holidaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  appliesTo: { type: String, enum: ['all','employee','intern','wfh'], default: 'all', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
module.exports = mongoose.model('Holiday', holidaySchema);
