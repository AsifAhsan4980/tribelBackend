const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/group.controller');

// Public routes
router.get('/', ctrl.discoverGroups);

// Protected routes
router.use(authenticate);

router.post('/', ctrl.createGroup);
router.get('/me', ctrl.myGroups);
router.get('/:groupId', ctrl.getGroup);
router.put('/:groupId', ctrl.updateGroup);
router.delete('/:groupId', ctrl.deleteGroup);
router.post('/:groupId/join', ctrl.joinGroup);
router.post('/:groupId/leave', ctrl.leaveGroup);
router.get('/:groupId/members', ctrl.listMembers);
router.put('/:groupId/members/:userId', ctrl.updateMember);

module.exports = router;
