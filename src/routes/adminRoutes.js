const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminMiddleware');

// Enforce both auth and admin role for all admin routes
router.use(requireAuth, requireAdmin);

// 1. Dashboard Stats
router.get('/dashboard', adminController.getDashboardStats);
router.get('/stats', adminController.getDashboardStats);

// 2. User Management
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserById);
router.patch('/users/:id', adminController.updateUser);

// 3. Internship Applications
router.get('/internships', adminController.getInternships);
router.get('/internships/:id', adminController.getInternshipById);
router.get('/internships/:id/resume', adminController.getInternshipResume);
router.patch('/internships/:id', adminController.updateInternship);
router.delete('/internships/:id', adminController.deleteInternship);

// 4. Contact Enquiries
router.get('/contacts', adminController.getContacts);
router.patch('/contacts/:id', adminController.updateContact);
router.delete('/contacts/:id', adminController.deleteContact);

// 5. Service Enquiries
router.get('/enquiries', adminController.getEnquiries);
router.patch('/enquiries/:id', adminController.updateEnquiry);
router.delete('/enquiries/:id', adminController.deleteEnquiry);

// 6. Security & Login Logs
router.get('/logins', adminController.getLoginLogs);

module.exports = router;
