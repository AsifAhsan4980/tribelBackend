const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/user.controller');

// All routes require authentication
router.use(authenticate);

// ── Search (must be before :userId to avoid route conflict) ──
router.get('/search', ctrl.searchUsers);

// ── Search history ──
router.delete('/search-history', ctrl.clearSearchHistory);

// ── Current user profile ──
router.get('/me', ctrl.getMyProfile);
router.put('/me', ctrl.updateProfile);
router.delete('/me', ctrl.softDeleteAccount);

// ── Secondary email ──
router.put('/me/secondary-email', ctrl.updateSecondaryEmail);

// ── Phone number (from likerslaUserPhoneNumber) ──
router.put('/me/phone', ctrl.updatePhoneNumber);

// ── S3 upload URL for profile/cover photo ──
router.post('/upload-url', ctrl.getProfileUploadUrl);

// ── Filters ──
router.get('/me/filters', ctrl.getFilters);
router.post('/me/filters', ctrl.setFilters);

// ── Contact Support ──
router.get('/support', ctrl.listMyTickets);
router.post('/support', ctrl.createSupportTicket);
router.get('/support/:ticketId', ctrl.getTicketDetail);
router.post('/support/:ticketId/message', ctrl.addSupportMessage);

// ── Education ──
router.get('/:userId/education', ctrl.listEducation);
router.post('/education', ctrl.addEducation);
router.put('/education/:id', ctrl.updateEducation);
router.delete('/education/:id', ctrl.deleteEducation);

// ── Experience ──
router.get('/:userId/experience', ctrl.listExperience);
router.post('/experience', ctrl.addExperience);
router.put('/experience/:id', ctrl.updateExperience);
router.delete('/experience/:id', ctrl.deleteExperience);

// ── Awards / Certificates ──
router.get('/:userId/awards', ctrl.listAwards);
router.post('/awards', ctrl.addAward);

// ── Public user profile (must be last — catches :userId) ──
router.get('/:userId', ctrl.getProfile);

module.exports = router;
