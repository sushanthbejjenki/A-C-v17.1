const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');
const path = require('path');
const { createMultipartParser } = require('../utils/multipart');
const photoDir = path.join(__dirname, '..', '..', 'private_uploads', 'profiles');
const parsePhoto = createMultipartParser({ uploadDir: photoDir, maxFileSize: 3 * 1024 * 1024, allowedExtensions: ['.jpg','.jpeg','.png','.webp'] });

router.get('/me', requireAuth, userController.getProfile);
router.patch('/me', requireAuth, userController.updateProfile);
router.post('/me/photo', requireAuth, express.raw({type:'multipart/form-data', limit:'4mb'}), parsePhoto, userController.uploadProfilePhoto);
router.get('/my-applications', requireAuth, userController.getMyApplications);

module.exports = router;
