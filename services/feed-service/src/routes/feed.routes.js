const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const c = require('../controllers/feed.controller');

// ── Main feeds ───────────────────────────────────
router.get('/following',        authenticate, c.getFollowingFeed);
router.get('/friends',          authenticate, c.getFriendsFeed);
router.get('/breaking',         authenticate, c.getBreakingFeed);
router.get('/trending',         authenticate, c.getTrendingFeed);
router.get('/discover',         authenticate, c.getDiscoverFeed);
router.get('/videos',           authenticate, c.getVideoFeed);
router.get('/comment-activity', authenticate, c.getCommentActivityFeed);
router.get('/hashtag/:tag',     authenticate, c.getHashtagFeed);

// ── Scoped feeds ─────────────────────────────────
router.get('/admin',            authenticate, requireRole('Admin'), c.getAdminFeed);
router.get('/group/:groupId',   authenticate, c.getGroupFeed);
router.get('/wall/:userId',     authenticate, c.getWallFeed);
router.get('/star/:userId',     authenticate, c.getStarFeed);

module.exports = router;
