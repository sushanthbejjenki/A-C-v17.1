const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const InternshipApplication = require('../models/InternshipApplication');
const ContactEnquiry = require('../models/ContactEnquiry');
const ServiceEnquiry = require('../models/ServiceEnquiry');

// 1. Dashboard Overview Stats
async function getDashboardStats(req, res, next) {
  try {
    const [
      totalUsers,
      totalApplications,
      totalContactEnquiries,
      totalServiceEnquiries,
      totalLogins,
      successfulLogins,
      failedLogins,
      recentUsers,
      recentLogins,
      recentApplications
    ] = await Promise.all([
      User.countDocuments(),
      InternshipApplication.countDocuments(),
      ContactEnquiry.countDocuments(),
      ServiceEnquiry.countDocuments(),
      LoginLog.countDocuments(),
      LoginLog.countDocuments({ success: true }),
      LoginLog.countDocuments({ success: false }),
      User.find().sort({ createdAt: -1 }).limit(5).select('-passwordHash'),
      LoginLog.find().sort({ timestamp: -1 }).limit(5),
      InternshipApplication.find().sort({ createdAt: -1 }).limit(5)
    ]);

    return res.json({
      success: true,
      stats: {
        totalUsers,
        totalApplications,
        totalContactEnquiries,
        totalServiceEnquiries,
        totalEnquiries: totalContactEnquiries + totalServiceEnquiries,
        totalLogins,
        successfulLogins,
        failedLogins
      },
      recent: {
        users: recentUsers,
        logins: recentLogins,
        applications: recentApplications
      }
    });
  } catch (err) {
    next(err);
  }
}

// 2. User Management
async function getUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.q || req.query.search || '').trim();
    const role = req.query.role;
    const active = req.query.active;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) filter.role = role;
    if (active !== undefined && active !== '') {
      filter.isActive = active === 'true';
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      users
    });
  } catch (err) {
    next(err);
  }
}

async function getUserById(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const { isActive, role } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Protect primary admin from deactivation
    if (user.username === 'admin' || user.username === 'sushanth') {
      if (isActive === false) {
        return res.status(400).json({
          success: false,
          message: 'The primary administrator account cannot be deactivated.'
        });
      }
    }

    if (typeof isActive === 'boolean') {
      user.isActive = isActive;
    }
    if (role && ['user', 'admin'].includes(role)) {
      user.role = role;
    }

    await user.save();

    return res.json({
      success: true,
      message: 'User updated successfully.',
      user: user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
}

// 3. Internship Applications Management
async function getInternships(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.q || req.query.search || '').trim();
    const domain = req.query.domain;
    const status = req.query.status;

    const filter = {};
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { college: { $regex: search, $options: 'i' } }
      ];
    }
    if (domain) filter.domain = domain;
    if (status) filter.status = status;

    const total = await InternshipApplication.countDocuments(filter);
    const applications = await InternshipApplication.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      applications
    });
  } catch (err) {
    next(err);
  }
}

async function getInternshipById(req, res, next) {
  try {
    const application = await InternshipApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }
    return res.json({ success: true, application });
  } catch (err) {
    next(err);
  }
}

async function updateInternship(req, res, next) {
  try {
    const { status, notes } = req.body;
    const application = await InternshipApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    if (status) {
      const validStatuses = ['Pending', 'Reviewing', 'Shortlisted', 'Rejected', 'Accepted'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }
      application.status = status;
    }

    if (notes !== undefined) {
      application.notes = String(notes).trim();
    }

    await application.save();

    return res.json({
      success: true,
      message: 'Application updated successfully.',
      application
    });
  } catch (err) {
    next(err);
  }
}

async function deleteInternship(req, res, next) {
  try {
    const deleted = await InternshipApplication.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }
    if (deleted.resumePath) {
      try { await require('fs').promises.unlink(require('path').resolve(deleted.resumePath)); } catch (err) { if (err.code !== 'ENOENT') console.warn('Could not remove resume:', err.message); }
    }
    return res.json({ success: true, message: 'Application deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

// 4. Contact Enquiries Management
async function getContacts(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.q || req.query.search || '').trim();
    const status = req.query.status;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) filter.status = status;

    const total = await ContactEnquiry.countDocuments(filter);
    const contacts = await ContactEnquiry.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      contacts
    });
  } catch (err) {
    next(err);
  }
}

async function updateContact(req, res, next) {
  try {
    const { status } = req.body;
    const contact = await ContactEnquiry.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact enquiry not found.' });
    }

    if (status) {
      const validStatuses = ['New', 'Read', 'Responded', 'Closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }
      contact.status = status;
    }

    await contact.save();

    return res.json({
      success: true,
      message: 'Contact enquiry updated successfully.',
      contact
    });
  } catch (err) {
    next(err);
  }
}

async function deleteContact(req, res, next) {
  try {
    const deleted = await ContactEnquiry.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Contact enquiry not found.' });
    }
    return res.json({ success: true, message: 'Contact enquiry deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

// 5. Service Enquiries Management
async function getEnquiries(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.q || req.query.search || '').trim();
    const domain = req.query.domain;
    const status = req.query.status;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { domain: { $regex: search, $options: 'i' } }
      ];
    }
    if (domain) filter.domain = domain;
    if (status) filter.status = status;

    const total = await ServiceEnquiry.countDocuments(filter);
    const enquiries = await ServiceEnquiry.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      enquiries
    });
  } catch (err) {
    next(err);
  }
}

async function updateEnquiry(req, res, next) {
  try {
    const { status } = req.body;
    const enquiry = await ServiceEnquiry.findById(req.params.id);

    if (!enquiry) {
      return res.status(404).json({ success: false, message: 'Service enquiry not found.' });
    }

    if (status) {
      const validStatuses = ['New', 'Read', 'Responded', 'Closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }
      enquiry.status = status;
    }

    await enquiry.save();

    return res.json({
      success: true,
      message: 'Service enquiry updated successfully.',
      enquiry
    });
  } catch (err) {
    next(err);
  }
}

async function deleteEnquiry(req, res, next) {
  try {
    const deleted = await ServiceEnquiry.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Service enquiry not found.' });
    }
    return res.json({ success: true, message: 'Service enquiry deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

// 6. Login Logs Management
async function getLoginLogs(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
    const search = (req.query.q || req.query.search || '').trim();
    const success = req.query.success;

    const filter = {};
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { ip: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } }
      ];
    }
    if (success !== undefined && success !== '') {
      filter.success = success === 'true';
    }

    const total = await LoginLog.countDocuments(filter);
    const logs = await LoginLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      logs
    });
  } catch (err) {
    next(err);
  }
}


async function getInternshipResume(req, res, next) {
  try {
    const application = await InternshipApplication.findById(req.params.id);
    if (!application || !application.resumePath) return res.status(404).json({success:false,message:'Resume not found.'});
    return res.sendFile(require('path').resolve(application.resumePath), { headers: { 'Content-Disposition': `inline; filename=\"${require('path').basename(application.resumeOriginalName || 'resume')}\"` } }, err => { if (err) next(err); });
  } catch (err) { next(err); }
}

module.exports = {
  getDashboardStats,
  getUsers,
  getUserById,
  updateUser,
  getInternships,
    getInternshipResume,
  getInternshipById,
  updateInternship,
  deleteInternship,
  getContacts,
  updateContact,
  deleteContact,
  getEnquiries,
  updateEnquiry,
  deleteEnquiry,
  getLoginLogs
};
