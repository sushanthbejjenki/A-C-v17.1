const express = require('express');
const router = express.Router();
const enquiryController = require('../controllers/enquiryController');
const { publicFormLimiter } = require('../middleware/rateLimiter');

router.post('/', publicFormLimiter, enquiryController.submitEnquiry);

module.exports = router;
