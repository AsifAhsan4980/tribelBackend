const router = require('express').Router();
const { authenticate } = require('shared');
const {
  getMe,
  getUserById,
  updateMe,
  deleteMe,
  uploadUrl,
  listEducation,
  addEducation,
  updateEducation,
  deleteEducation,
  listExperience,
  addExperience,
  searchUsers,
} = require('../controllers/user.controller');

// Search must be defined before :userId to avoid conflict
router.get('/search', authenticate, searchUsers);

// Current user profile
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);
router.delete('/me', authenticate, deleteMe);

// S3 upload URL
router.post('/upload-url', authenticate, uploadUrl);

// Education
router.get('/:userId/education', authenticate, listEducation);
router.post('/education', authenticate, addEducation);
router.put('/education/:id', authenticate, updateEducation);
router.delete('/education/:id', authenticate, deleteEducation);

// Experience
router.get('/:userId/experience', authenticate, listExperience);
router.post('/experience', authenticate, addExperience);

// Public user profile (by userId)
router.get('/:userId', authenticate, getUserById);

module.exports = router;
