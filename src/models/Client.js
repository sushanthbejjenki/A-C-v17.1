const mongoose = require('mongoose');
const clientSchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true, index: true },
  contactPerson: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  service: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  assignedEmployees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });
module.exports = mongoose.model('Client', clientSchema);
