const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/message.controller');

// All message routes require authentication
router.use(authenticate);

// Chat room routes
router.post('/rooms', ctrl.createOrGetRoom);
router.get('/rooms', ctrl.listRooms);
router.put('/rooms/mark-all-seen', ctrl.markAllRoomsSeen);
router.put('/rooms/:roomId/status', ctrl.updateRoomStatus);
router.delete('/rooms/:roomId', ctrl.deleteRoom);

// Contacts (friends with chatRoomId lookup)
router.get('/contacts', ctrl.getChatContacts);

// Message routes
router.post('/', ctrl.sendMessage);
router.get('/room/:roomId', ctrl.getMessages);
router.put('/:messageId/read', ctrl.markAsRead);

// Spam check (from likerslaCheckUserChatRommLimit)
router.get('/spam-check', ctrl.checkChatSpamLimit);

module.exports = router;
