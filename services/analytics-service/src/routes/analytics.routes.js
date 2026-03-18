const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/analytics.controller');

// All routes require authentication
router.use(authenticate);

// ── Write endpoints (any authenticated user) ──
router.post('/login', ctrl.recordLogin);
router.post('/activity', ctrl.recordActivity);

// ── Read endpoints (Admin only) ──
router.get('/daily', requireRole('Admin'), ctrl.getDailyHistory);
router.get('/monthly', requireRole('Admin'), ctrl.getMonthlyHistory);
router.get('/active-users', requireRole('Admin'), ctrl.getActiveUsers);
router.get('/retention', requireRole('Admin'), ctrl.getRetention);

// ── Cron / admin calculation endpoint ──
router.post('/daily/calculate', requireRole('Admin'), ctrl.calculateDailyHistory);

module.exports = router;
