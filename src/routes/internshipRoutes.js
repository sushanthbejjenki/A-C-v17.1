const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const internshipController = require('../controllers/internshipController');
const { optionalAuth, requireAuth } = require('../middleware/authMiddleware');
const { publicFormLimiter } = require('../middleware/rateLimiter');
const { createMultipartParser } = require('../utils/multipart');

const resumeDir = path.join(__dirname, '..', '..', 'private_uploads', 'resumes');
const parseResume = createMultipartParser({
  uploadDir: resumeDir,
  maxFileSize: 5 * 1024 * 1024,
  allowedExtensions: ['.pdf', '.doc', '.docx']
});

router.post('/apply', publicFormLimiter, express.raw({ type: 'multipart/form-data', limit: '6mb' }), parseResume, optionalAuth, internshipController.apply);
router.get('/my-applications', requireAuth, internshipController.getMyApplications);

module.exports = router;
