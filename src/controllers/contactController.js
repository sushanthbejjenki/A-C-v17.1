const ContactEnquiry = require('../models/ContactEnquiry');
const { isValidEmail, isValidPhone, sanitizeString } = require('../utils/validators');

async function submitContact(req, res, next) {
  try {
    const name = sanitizeString(req.body.name, 100);
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = sanitizeString(req.body.phone, 30);
    const subject = sanitizeString(req.body.subject || 'General Enquiry', 150);
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

    if (!message || message.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Message must be at least 5 characters long.'
      });
    }

    const contact = await ContactEnquiry.create({
      name,
      email,
      phone,
      subject,
      message,
      status: 'New'
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your enquiry has been received. Our team will get back to you shortly.',
      enquiryId: contact._id.toString()
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitContact
};
