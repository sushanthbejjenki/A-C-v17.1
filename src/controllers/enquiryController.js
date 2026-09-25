const ServiceEnquiry = require('../models/ServiceEnquiry');
const { isValidEmail, isValidPhone, sanitizeString } = require('../utils/validators');

const VALID_DOMAINS = [
  'CCTV Monitoring',
  'Real Estate Promotions',
  'Digital Marketing',
  'Content Creation',
  'Content Moderation',
  'IT & Technology',
  'IT & Technology Solutions'
];

async function submitEnquiry(req, res, next) {
  try {
    const name = sanitizeString(req.body.name, 100);
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = sanitizeString(req.body.phone, 30);
    const domain = sanitizeString(req.body.domain, 100);
    const message = sanitizeString(req.body.message, 3000);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required.'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.'
      });
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number.'
      });
    }

    if (!domain) {
      return res.status(400).json({
        success: false,
        message: 'A domain/service category is required.'
      });
    }

    if (!message || message.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Message must be at least 5 characters long.'
      });
    }

    const enquiry = await ServiceEnquiry.create({
      name,
      email,
      phone,
      domain,
      message,
      status: 'New'
    });

    return res.status(201).json({
      success: true,
      message: 'Your service enquiry has been received. Our solutions team will reach out soon.',
      enquiryId: enquiry._id.toString()
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitEnquiry,
  VALID_DOMAINS
};
