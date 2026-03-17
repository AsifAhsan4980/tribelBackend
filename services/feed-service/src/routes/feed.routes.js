const router = require('express').Router();
const { authenticate } = require('shared');
const feedController = require('../controllers/feed.controller');

router.get('/following', authenticate, feedController.getFollowingFeed);
router.get('/friends', authenticate, feedController.getFriendsFeed);
router.get('/trending', authenticate, feedController.getTrendingFeed);
router.get('/breaking', authenticate, feedController.getBreakingFeed);
router.get('/discover', authenticate, feedController.getDiscoverFeed);
router.get('/group/:groupId', authenticate, feedController.getGroupFeed);

module.exports = router;
