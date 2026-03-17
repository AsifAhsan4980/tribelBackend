const { prisma, success, error, paginated } = require('shared');
const { getMessaging } = require('../config/firebase');

// POST /api/notifications — create in-app notification
const createNotification = async (req, res, next) => {
  try {
    const {
      ownerId,
      notificationType,
      postId,
      commentId,
      replyId,
      groupId,
      categoryId,
      subCategoryId,
      storyId,
      articleId,
    } = req.body;

    if (!ownerId || !notificationType) {
      return error(res, 'ownerId and notificationType are required', 400);
    }

    const notification = await prisma.notification.create({
      data: {
        ownerId,
        actionCreatorId: req.user.sub,
        notificationType,
        postId: postId || null,
        commentId: commentId || null,
        replyId: replyId || null,
        groupId: groupId || null,
        categoryId: categoryId || null,
        subCategoryId: subCategoryId || null,
        storyId: storyId || null,
        articleId: articleId || null,
      },
    });

    return success(res, notification, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications — list user's notifications, paginated
const listNotifications = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { ownerId: userId };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          actionCreator: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
            },
          },
        },
        orderBy: { notificationDate: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.notification.count({ where }),
    ]);

    return paginated(res, notifications, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// PUT /api/notifications/:notificationId/seen — mark notification as seen
const markSeen = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { notificationId } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return error(res, 'Notification not found', 404);
    }

    if (notification.ownerId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isSeen: true },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// PUT /api/notifications/mark-all-seen — mark all as seen
const markAllSeen = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const result = await prisma.notification.updateMany({
      where: { ownerId: userId, isSeen: false },
      data: { isSeen: true },
    });

    return success(res, { message: 'All notifications marked as seen', count: result.count });
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications/unseen-count — count unseen notifications
const unseenCount = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const count = await prisma.notification.count({
      where: { ownerId: userId, isSeen: false },
    });

    return success(res, { count });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/push — send push notification via Firebase FCM
const sendPushNotification = async (req, res, next) => {
  try {
    const { userId, title, body, data } = req.body;

    if (!userId || !title || !body) {
      return error(res, 'userId, title, and body are required', 400);
    }

    const messaging = getMessaging();
    if (!messaging) {
      return error(res, 'Push notification service not configured', 503);
    }

    // Lookup device tokens for the target user
    const subscribers = await prisma.pushNotificationSubscriber.findMany({
      where: { userId, isActive: true },
      select: { deviceToken: true },
    });

    if (subscribers.length === 0) {
      return error(res, 'No active device tokens found for user', 404);
    }

    const tokens = subscribers.map((s) => s.deviceToken);

    // Send to each token
    const results = [];
    for (const token of tokens) {
      try {
        const messageId = await messaging.send({
          token,
          notification: { title, body },
          data: data || {},
        });
        results.push({ token, success: true, messageId });
      } catch (fcmError) {
        results.push({ token, success: false, error: fcmError.message });

        // Deactivate invalid tokens
        if (
          fcmError.code === 'messaging/registration-token-not-registered' ||
          fcmError.code === 'messaging/invalid-registration-token'
        ) {
          await prisma.pushNotificationSubscriber.updateMany({
            where: { userId, deviceToken: token },
            data: { isActive: false },
          });
        }
      }
    }

    return success(res, { sent: results.length, results });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications/device-token — register device token
const registerDeviceToken = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { deviceToken, deviceId, deviceType, platform } = req.body;

    if (!deviceToken) {
      return error(res, 'deviceToken is required', 400);
    }

    // Upsert: create or update
    const subscriber = await prisma.pushNotificationSubscriber.upsert({
      where: { userId_deviceToken: { userId, deviceToken } },
      update: {
        deviceId: deviceId || null,
        deviceType: deviceType || null,
        platform: platform || null,
        isActive: true,
      },
      create: {
        userId,
        deviceToken,
        deviceId: deviceId || null,
        deviceType: deviceType || null,
        platform: platform || null,
        isActive: true,
      },
    });

    return success(res, subscriber, 201);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications/device-token/:deviceId — unregister device token
const unregisterDeviceToken = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { deviceId } = req.params;

    const result = await prisma.pushNotificationSubscriber.updateMany({
      where: { userId, deviceId },
      data: { isActive: false },
    });

    if (result.count === 0) {
      return error(res, 'Device token not found', 404);
    }

    return success(res, { message: 'Device token unregistered' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createNotification,
  listNotifications,
  markSeen,
  markAllSeen,
  unseenCount,
  sendPushNotification,
  registerDeviceToken,
  unregisterDeviceToken,
};
