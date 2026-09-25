const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const { publicFormLimiter } = require('../middleware/rateLimiter');

router.post('/', publicFormLimiter, contactController.submitContact);

module.exports = router;
