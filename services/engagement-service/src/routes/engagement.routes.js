const router = require('express').Router();
const { authenticate } = require('shared');
const engagementController = require('../controllers/engagement.controller');

// Like routes
router.post('/likes', authenticate, engagementController.createLike);
router.delete('/likes/:targetType/:targetId', authenticate, engagementController.removeLike);
router.get('/likes/:targetType/:targetId', authenticate, engagementController.getLikes);

// Ranking routes
router.get('/rankings/me', authenticate, engagementController.getMyRankings);
router.get('/rankings/category/:categoryId', authenticate, engagementController.getRankingsByCategory);
router.get('/rankings/top-contributors', authenticate, engagementController.getTopContributors);

module.exports = router;
