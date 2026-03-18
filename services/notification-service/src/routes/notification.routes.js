const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/notification.controller');

// All notification routes require authentication
router.use(authenticate);

// Notification CRUD
router.post('/', ctrl.createNotification);
router.get('/', ctrl.listNotifications);
router.get('/unseen-count', ctrl.getUnseenCount);
router.put('/mark-all-seen', ctrl.markAllSeen);
router.put('/:id/seen', ctrl.markSeen);

// Push notification (internal/service-to-service)
router.post('/push', ctrl.sendPush);

// Device token management
router.post('/device-token', ctrl.registerDeviceToken);
router.delete('/device-token/:deviceId', ctrl.unregisterDeviceToken);

module.exports = router;
