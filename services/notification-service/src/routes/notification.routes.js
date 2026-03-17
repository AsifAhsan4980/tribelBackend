const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/notification.controller');

router.use(authenticate);

router.post('/', ctrl.createNotification);
router.get('/', ctrl.listNotifications);
router.get('/unseen-count', ctrl.unseenCount);
router.put('/mark-all-seen', ctrl.markAllSeen);
router.put('/:notificationId/seen', ctrl.markSeen);
router.post('/push', ctrl.sendPushNotification);
router.post('/device-token', ctrl.registerDeviceToken);
router.delete('/device-token/:deviceId', ctrl.unregisterDeviceToken);

module.exports = router;
