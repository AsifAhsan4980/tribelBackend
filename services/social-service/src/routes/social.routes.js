const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/social.controller');

// ─────────────────────────────────────────────────
// FOLLOW ROUTES (from likerslaFollowUnfollow — 4 modes)
// ─────────────────────────────────────────────────
router.post('/follow', authenticate, ctrl.followUser);
router.delete('/follow/:userId', authenticate, ctrl.unfollowUser);
router.put('/follow/:userId/see-first', authenticate, ctrl.toggleSeeFirst);
router.get('/followers/:userId', authenticate, ctrl.getFollowers);
router.get('/following/:userId', authenticate, ctrl.getFollowing);

// ─────────────────────────────────────────────────
// FRIEND ROUTES (from likerslaFriendUnfriend — 4 modes)
// ─────────────────────────────────────────────────
router.post('/friend', authenticate, ctrl.sendFriendRequest);
router.put('/friend/:userId/accept', authenticate, ctrl.acceptFriendRequest);
router.put('/friend/:userId/reject', authenticate, ctrl.rejectFriendRequest);
router.delete('/friend/:userId', authenticate, ctrl.removeFriend);
router.get('/friends', authenticate, ctrl.getFriends);
router.get('/friends/pending', authenticate, ctrl.getPendingRequests);
router.get('/friends/ids', authenticate, ctrl.getAllFriendIds);
router.get('/friends/suggestions', authenticate, ctrl.getFriendSuggestions);
router.post('/friends/bulk-follow', authenticate, ctrl.bulkFollowSuggested);
router.get('/friends/search', authenticate, ctrl.searchFriends);

// ─────────────────────────────────────────────────
// RELATIONSHIP STATUS
// ─────────────────────────────────────────────────
router.get('/status/:userId', authenticate, ctrl.checkRelationshipStatus);

// ─────────────────────────────────────────────────
// BLOCK ROUTES (from likerslaBlockUnBlock — Block/UnBlock)
// ─────────────────────────────────────────────────
router.post('/block', authenticate, ctrl.blockUser);
router.delete('/block/:userId', authenticate, ctrl.unblockUser);
router.get('/blocked', authenticate, ctrl.getBlockedUsers);

module.exports = router;
