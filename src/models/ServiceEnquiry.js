const mongoose = require('mongoose');

const serviceEnquirySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address']
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  domain: {
    type: String,
    required: [true, 'Service domain is required'],
    trim: true,
    index: true
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    minlength: [5, 'Message must be at least 5 characters']
  },
  status: {
    type: String,
    enum: ['New', 'Read', 'Responded', 'Closed'],
    default: 'New',
    index: true
  }
}, {
  timestamps: true
});

serviceEnquirySchema.index({ createdAt: -1 });

const ServiceEnquiry = mongoose.model('ServiceEnquiry', serviceEnquirySchema);
module.exports = ServiceEnquiry;
