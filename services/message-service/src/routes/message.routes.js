const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/message.controller');

router.use(authenticate);

// Chat room routes
router.post('/rooms', ctrl.createOrGetRoom);
router.get('/rooms', ctrl.listRooms);
router.put('/rooms/:roomId/status', ctrl.updateRoomStatus);
router.delete('/rooms/:roomId', ctrl.deleteRoom);

// Message routes
router.post('/', ctrl.sendMessage);
router.get('/room/:roomId', ctrl.getMessages);
router.put('/:messageId/read', ctrl.markAsRead);

module.exports = router;
