const InternshipApplication = require('../models/InternshipApplication');
const { isValidEmail, isValidPhone, sanitizeString } = require('../utils/validators');

async function apply(req, res, next) {
  try {
    const fullName = sanitizeString(req.body.fullName || req.body.name, 100);
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = sanitizeString(req.body.phone, 30);
    const college = sanitizeString(req.body.college, 150);
    const course = sanitizeString(req.body.course, 100);
    const branch = sanitizeString(req.body.branch, 100);
    const yearOfStudy = sanitizeString(req.body.yearOfStudy, 50);
    const domain = sanitizeString(req.body.domain || 'IT & Technology', 100);
    const skills = sanitizeString(req.body.skills, 300);
    const resumeUrl = sanitizeString(req.body.resumeUrl || req.body.resume, 500);
    const resumeFile = req.files?.resume || null;

    if (!resumeFile) {
      return res.status(400).json({
        success: false,
        message: 'Please upload your resume (PDF, DOC or DOCX, up to 5 MB).'
      });
    }
    const message = sanitizeString(req.body.message, 2000);

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message: 'Full Name is required.'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.'
      });
    }

    if (!phone || !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'A valid phone number is required.'
      });
    }

    if (!college) {
      return res.status(400).json({
        success: false,
        message: 'College/University name is required.'
      });
    }

    const application = await InternshipApplication.create({
      fullName,
      email,
      phone,
      college,
      course,
      branch,
      yearOfStudy,
      domain,
      skills,
      resumeUrl,
      resumePath: resumeFile.path,
      resumeOriginalName: resumeFile.originalname,
      message,
      status: 'Pending'
    });

    return res.status(201).json({
      success: true,
      message: 'Internship application submitted successfully.',
      applicationId: application._id.toString()
    });
  } catch (err) {
    if (resumeFile?.path) { try { await require('fs').promises.unlink(resumeFile.path); } catch (_) {} }
    next(err);
  }
}

async function getMyApplications(req, res, next) {
  try {
    const userEmail = req.user ? req.user.email : '';
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    const applications = await InternshipApplication.find({
      email: userEmail.toLowerCase()
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      total: applications.length,
      applications
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  apply,
  getMyApplications
};
