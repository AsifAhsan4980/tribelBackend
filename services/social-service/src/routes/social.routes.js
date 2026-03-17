const router = require('express').Router();
const { authenticate } = require('shared');
const socialController = require('../controllers/social.controller');

// Follow routes
router.post('/follow', authenticate, socialController.followUser);
router.delete('/follow/:userId', authenticate, socialController.unfollowUser);
router.get('/followers/:userId', authenticate, socialController.getFollowers);
router.get('/following/:userId', authenticate, socialController.getFollowing);

// Friend routes
router.post('/friend', authenticate, socialController.sendFriendRequest);
router.put('/friend/:userId/accept', authenticate, socialController.acceptFriendRequest);
router.put('/friend/:userId/reject', authenticate, socialController.rejectFriendRequest);
router.delete('/friend/:userId', authenticate, socialController.removeFriend);
router.get('/friends', authenticate, socialController.getFriends);
router.get('/friends/pending', authenticate, socialController.getPendingRequests);
router.get('/friends/suggestions', authenticate, socialController.getFriendSuggestions);

// Block routes
router.post('/block', authenticate, socialController.blockUser);
router.delete('/block/:userId', authenticate, socialController.unblockUser);
router.get('/blocked', authenticate, socialController.getBlockedUsers);

module.exports = router;
