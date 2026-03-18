const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/engagement.controller');

// ─── Likes ─────────────────────────────────────────────
router.post('/likes', authenticate, ctrl.addLike);
router.delete('/likes/:targetType/:targetId', authenticate, ctrl.removeLike);
router.get('/likes/:targetType/:targetId', authenticate, ctrl.getLikeUsers);

// ─── Views ─────────────────────────────────────────────
router.post('/views', authenticate, ctrl.addView);
router.post('/views/guest', ctrl.addGuestView);

// ─── Trending (admin/cron only) ────────────────────────
router.post('/trending/calculate', authenticate, requireRole('Admin'), ctrl.calculateTrending);
router.delete('/trending/cleanup', authenticate, requireRole('Admin'), ctrl.cleanupTrending);

// ─── Star Contributors / Rankings ──────────────────────
router.post('/rankings/calculate', authenticate, requireRole('Admin'), ctrl.calculateRankings);
router.get('/rankings/me', authenticate, ctrl.getMyRankings);
router.get('/rankings/category/:categoryId', authenticate, ctrl.getRankingsByCategory);
router.get('/rankings/top', authenticate, ctrl.getTopContributors);
router.get('/rankings/suggested', authenticate, ctrl.getStarContributorsToFollow);
router.get('/rankings/commenters', authenticate, ctrl.getTopCommenters);

module.exports = router;
