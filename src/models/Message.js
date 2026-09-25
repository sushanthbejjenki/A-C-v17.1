const mongoose = require('mongoose');
const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel: { type: String, enum: ['public', 'private'], required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  body: { type: String, required: true, trim: true, maxlength: 3000 },
  createdAt: { type: Date, default: Date.now, index: true }
});
messageSchema.index({ channel: 1, createdAt: -1 });
messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
module.exports = mongoose.model('Message', messageSchema);
