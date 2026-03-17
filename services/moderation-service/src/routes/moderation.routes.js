const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/moderation.controller');

router.use(authenticate);

// Any authenticated user can create a report
router.post('/reports', ctrl.createReport);

// Admin-only routes
router.get('/reports', requireRole('Admin'), ctrl.listReports);
router.put('/reports/:reportId', requireRole('Admin'), ctrl.updateReport);
router.post('/users/:userId/block', requireRole('Admin'), ctrl.blockUser);
router.delete('/users/:userId/block', requireRole('Admin'), ctrl.unblockUser);
router.get('/blocked-users', requireRole('Admin'), ctrl.listBlockedUsers);

module.exports = router;
