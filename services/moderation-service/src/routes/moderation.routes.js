const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/moderation.controller');

// All moderation routes require authentication
router.use(authenticate);

// ── Any authenticated user can create a report ──
router.post('/reports', ctrl.createReport);

// ── Admin-only: reports management ──
router.get('/reports', requireRole('Admin'), ctrl.listReports);
router.put('/reports/:reportId', requireRole('Admin'), ctrl.resolveReport);

// ── Admin-only: user blocking ──
router.post('/users/:userId/block', requireRole('Admin'), ctrl.adminBlockUser);
router.delete('/users/:userId/block', requireRole('Admin'), ctrl.adminUnblockUser);

// ── Admin-only: role management ──
router.put('/users/:userId/role', requireRole('Admin'), ctrl.updateUserRole);
router.put('/users/:userId/verify', requireRole('Admin'), ctrl.adminVerifyUser);

// ── Admin-only: blocked users list ──
router.get('/blocked-users', requireRole('Admin'), ctrl.listAdminBlockedUsers);

// ── Admin-only: post boxing ──
router.post('/posts/:postId/block', requireRole('Admin'), ctrl.boxPost);
router.delete('/posts/:postId/block', requireRole('Admin'), ctrl.unboxPost);

// ── Admin-only: force logout (from likerSlaLogoutByAdmin) ──
router.post('/users/:userId/logout', requireRole('Admin'), ctrl.forceLogoutUser);

module.exports = router;
