const User = require('../models/User');
const InternshipApplication = require('../models/InternshipApplication');
const { isValidPhone } = require('../utils/validators');

async function getProfile(req, res, next) {
  try {
    return res.json({
      success: true,
      user: req.user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, phone } = req.body;
    const user = req.user;

    if (name) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Name must be between 2 and 100 characters.'
        });
      }
      user.name = trimmed;
    }

    if (phone !== undefined) {
      const cleanPhone = String(phone).trim();
      if (cleanPhone && !isValidPhone(cleanPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid phone number.'
        });
      }
      user.phone = cleanPhone;
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
}

async function getMyApplications(req, res, next) {
  try {
    const applications = await InternshipApplication.find({
      email: req.user.email.toLowerCase()
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



async function uploadProfilePhoto(req, res, next) {
  try {
    const file = req.files?.photo;
    if (!file) return res.status(400).json({ success:false, message:'Please choose a JPG, PNG or WebP image.' });
    const user = req.user;
    if (user.profileImageFilename) {
      return res.status(403).json({ success:false, message:'Your profile picture is already set. Only an administrator can update it.' });
    }
    user.profileImageFilename = file.filename;
    await user.save();
    return res.json({ success:true, message:'Profile picture added successfully.', user:user.toSafeObject() });
  } catch (err) { next(err); }
}

module.exports = {
  getProfile,
  updateProfile,
  uploadProfilePhoto,
  getMyApplications
};
