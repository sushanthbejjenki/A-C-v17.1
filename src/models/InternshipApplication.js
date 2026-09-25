const mongoose = require('mongoose');

const internshipApplicationSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters'],
    maxlength: [100, 'Full name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email address is required'],
    lowercase: true,
    trim: true,
    index: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  college: {
    type: String,
    required: [true, 'College / University is required'],
    trim: true
  },
  course: {
    type: String,
    trim: true,
    default: ''
  },
  branch: {
    type: String,
    trim: true,
    default: ''
  },
  yearOfStudy: {
    type: String,
    trim: true,
    default: ''
  },
  domain: {
    type: String,
    required: [true, 'Internship domain is required'],
    trim: true,
    index: true,
    default: 'IT & Technology'
  },
  skills: {
    type: String,
    trim: true,
    default: ''
  },
  resumeUrl: {
    type: String,
    trim: true,
    default: ''
  },
  resumePath: {
    type: String,
    trim: true,
    default: ''
  },
  resumeOriginalName: {
    type: String,
    trim: true,
    default: ''
  },
  message: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['Pending', 'Reviewing', 'Shortlisted', 'Rejected', 'Accepted'],
    default: 'Pending',
    index: true
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

internshipApplicationSchema.index({ createdAt: -1 });

const InternshipApplication = mongoose.model('InternshipApplication', internshipApplicationSchema);
module.exports = InternshipApplication;
