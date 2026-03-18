const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/group.controller');

// Public routes (no auth required)
router.get('/', ctrl.discoverGroups);

// Protected routes (auth required)
router.use(authenticate);

router.post('/', ctrl.createGroup);
router.get('/me', ctrl.myGroups); // Must be before /:groupId to avoid conflict
router.get('/:groupId', ctrl.getGroup);
router.put('/:groupId', ctrl.updateGroup);
router.delete('/:groupId', ctrl.deleteGroup);

// Group membership
router.post('/:groupId/join', ctrl.joinGroup);
router.post('/:groupId/leave', ctrl.leaveGroup);

// Group member management
router.get('/:groupId/members', ctrl.listMembers);
router.put('/:groupId/members/:userId', ctrl.updateMember);

// Group events (from LikerslaManageEvent)
router.post('/:groupId/events', ctrl.createEvent);
router.get('/:groupId/events', ctrl.listEvents);

// Founding member invite (from likerslaFoundingMember)
router.post('/:groupId/invite', ctrl.inviteFoundingMember);

module.exports = router;
