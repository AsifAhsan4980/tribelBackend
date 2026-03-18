const { prisma, success, error, paginated } = require('shared');
const { getMessaging } = require('../config/firebase');

// ─── Notification message templates ───────────────────────────────────────────
// Maps notificationType to a function that builds { title, body } for FCM push.
// Parameters: actionCreatorName, extra data (groupName, etc.)
const PUSH_TEMPLATES = {
  post_like: (name) => ({
    title: 'Post Liked',
    body: `${name} liked your post`,
  }),
  post_comment: (name) => ({
    title: 'New Comment',
    body: `${name} commented on your post`,
  }),
  comment_reply: (name) => ({
    title: 'New Reply',
    body: `${name} replied to your comment`,
  }),
  comment_like: (name) => ({
    title: 'Comment Liked',
    body: `${name} liked your comment`,
  }),
  friend_request: (name) => ({
    title: 'Friend Request',
    body: `${name} sent you a friend request`,
  }),
  friend_accepted: (name) => ({
    title: 'Friend Accepted',
    body: `${name} accepted your friend request`,
  }),
  follow: (name) => ({
    title: 'New Follower',
    body: `${name} started following you`,
  }),
  group_join_request: (name, data) => ({
    title: 'Group Join Request',
    body: `${name} wants to join ${data.groupName || 'your group'}`,
  }),
  group_accepted: (name, data) => ({
    title: 'Group Accepted',
    body: `${name} has joined the group ${data.groupName || ''}`.trim(),
  }),
  group_post: (name, data) => ({
    title: 'New Group Post',
    body: `${name} posted in ${data.groupName || 'your group'}`,
  }),
  message: (name) => ({
    title: 'New Message',
    body: `${name} sent you a message`,
  }),
  story_like: (name) => ({
    title: 'Story Liked',
    body: `${name} loved your story`,
  }),
  story_comment: (name) => ({
    title: 'Story Comment',
    body: `${name} commented on your story`,
  }),
  article_like: (name) => ({
    title: 'Article Liked',
    body: `${name} liked your article`,
  }),
  article_comment: (name) => ({
    title: 'Article Comment',
    body: `${name} commented on your article`,
  }),
  mention: (name) => ({
    title: 'Mentioned',
    body: `${name} mentioned you in a comment`,
  }),
  admin_block: () => ({
    title: 'Account Restricted',
    body: 'Your account has been restricted',
  }),
  campaign: (name) => ({
    title: 'Campaign',
    body: `${name} has a new campaign update`,
  }),
  system: () => ({
    title: 'System Notification',
    body: 'You have a new system notification',
  }),
};

// ─── POST /api/notifications ──────────────────────────────────────────────────
// Create in-app notification and trigger push
const createNotification = async (req, res, next) => {
  try {
    const actionCreatorId = req.user.sub;
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

    // Do not create a notification for yourself
    if (ownerId === actionCreatorId) {
      return success(res, { message: 'Self-notification skipped' });
    }

    // Check if the owner has turned off notifications from this target
    const turnedOff = await prisma.turnOffNotification.findFirst({
      where: {
        userId: ownerId,
        targetId: actionCreatorId,
      },
    });

    if (turnedOff) {
      return success(res, { message: 'Notifications turned off by user' });
    }

    // Check if the owner exists and is active
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, accountStatus: true },
    });

    if (!owner || owner.accountStatus !== 'active') {
      return error(res, 'Target user not found or inactive', 404);
    }

    // Create the in-app notification
    const notification = await prisma.notification.create({
      data: {
        ownerId,
        actionCreatorId,
        notificationType,
        postId: postId || null,
        commentId: commentId || null,
        replyId: replyId || null,
        groupId: groupId || null,
        categoryId: categoryId || null,
        subCategoryId: subCategoryId || null,
        storyId: storyId || null,
        articleId: articleId || null,
        isSeen: false,
        notificationDate: new Date(),
      },
      include: {
        actionCreator: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
      },
    });

    // Fire-and-forget: trigger push notification to owner
    sendPushToUser(ownerId, notificationType, actionCreatorId, {
      postId,
      commentId,
      replyId,
      groupId,
      storyId,
      articleId,
      notificationId: notification.id,
    }).catch((err) => {
      console.error('Push notification failed:', err.message);
    });

    return success(res, notification, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/notifications ──────────────────────────────────────────────────
// List user's notifications, paginated, newest first
const listNotifications = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20, type } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { ownerId: userId };

    // Optional: filter by notification type
    if (type) {
      where.notificationType = type;
    }

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

// ─── PUT /api/notifications/:id/seen ──────────────────────────────────────────
// Mark single notification as seen
const markSeen = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return error(res, 'Notification not found', 404);
    }

    if (notification.ownerId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    if (notification.isSeen) {
      return success(res, notification);
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isSeen: true, isDetailsSeen: true },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/notifications/mark-all-seen ────────────────────────────────────
// Mark all unseen notifications as seen for the current user
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

// ─── GET /api/notifications/unseen-count ─────────────────────────────────────
// Count unseen notifications for the current user
const getUnseenCount = async (req, res, next) => {
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

// ─── Internal helper: send push to a user (non-route) ─────────────────────────
async function sendPushToUser(recipientId, notificationType, actionCreatorId, data = {}) {
  const messaging = getMessaging();
  if (!messaging) return;

  // Get action creator's name
  const actionCreator = await prisma.user.findUnique({
    where: { id: actionCreatorId },
    select: { fullName: true, username: true },
  });

  const actionCreatorName = actionCreator
    ? actionCreator.fullName || actionCreator.username || 'Someone'
    : 'Someone';

  // Look up recipient's active push tokens
  const subscribers = await prisma.pushNotificationSubscriber.findMany({
    where: { userId: recipientId, isActive: true },
    select: { id: true, deviceToken: true },
  });

  if (subscribers.length === 0) return;

  // Build notification content from template
  const templateFn = PUSH_TEMPLATES[notificationType];
  if (!templateFn) {
    console.warn(`No push template for notificationType: ${notificationType}`);
    return;
  }

  const { title, body } = templateFn(actionCreatorName, data);

  // Convert all data values to strings (FCM requirement)
  const fcmData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value != null) {
      fcmData[key] = String(value);
    }
  }
  fcmData.notificationType = notificationType;

  // Send to each token
  for (const subscriber of subscribers) {
    try {
      await messaging.send({
        token: subscriber.deviceToken,
        notification: { title, body },
        data: fcmData,
        android: {
          priority: 'high',
          notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
        },
        apns: {
          payload: {
            aps: { sound: 'default', badge: 1 },
          },
        },
      });
    } catch (fcmError) {
      console.error(`FCM send error for token ${subscriber.id}:`, fcmError.code || fcmError.message);

      // Deactivate invalid tokens
      if (
        fcmError.code === 'messaging/registration-token-not-registered' ||
        fcmError.code === 'messaging/invalid-registration-token'
      ) {
        await prisma.pushNotificationSubscriber.update({
          where: { id: subscriber.id },
          data: { isActive: false },
        }).catch(() => {});
      }
    }
  }
}

// ─── POST /api/notifications/push ────────────────────────────────────────────
// Send push notification via FCM (internal/service-to-service endpoint)
const sendPush = async (req, res, next) => {
  try {
    const { userId, notificationType, data, actionCreatorName } = req.body;

    if (!userId || !notificationType) {
      return error(res, 'userId and notificationType are required', 400);
    }

    const messaging = getMessaging();
    if (!messaging) {
      return error(res, 'Push notification service not configured', 503);
    }

    // Look up recipient's active push tokens
    const subscribers = await prisma.pushNotificationSubscriber.findMany({
      where: { userId, isActive: true },
      select: { id: true, deviceToken: true },
    });

    if (subscribers.length === 0) {
      return success(res, { sent: 0, message: 'No active device tokens found' });
    }

    // Build FCM payload from template
    const templateFn = PUSH_TEMPLATES[notificationType];
    if (!templateFn) {
      return error(res, `Unknown notification type: ${notificationType}`, 400);
    }

    const name = actionCreatorName || 'Someone';
    const { title, body } = templateFn(name, data || {});

    // Convert data values to strings for FCM
    const fcmData = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (value != null) {
          fcmData[key] = String(value);
        }
      }
    }
    fcmData.notificationType = notificationType;

    // Send to each token and collect results
    const results = [];
    for (const subscriber of subscribers) {
      try {
        const messageId = await messaging.send({
          token: subscriber.deviceToken,
          notification: { title, body },
          data: fcmData,
          android: {
            priority: 'high',
            notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        });
        results.push({ tokenId: subscriber.id, success: true, messageId });
      } catch (fcmError) {
        results.push({ tokenId: subscriber.id, success: false, error: fcmError.code || fcmError.message });

        // Deactivate invalid tokens
        if (
          fcmError.code === 'messaging/registration-token-not-registered' ||
          fcmError.code === 'messaging/invalid-registration-token'
        ) {
          await prisma.pushNotificationSubscriber.update({
            where: { id: subscriber.id },
            data: { isActive: false },
          }).catch(() => {});
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return success(res, { sent: successCount, total: results.length, results });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/notifications/device-token ────────────────────────────────────
// Register a device token for push notifications
// Deduplicates: if token exists for user+device, update it.
// If multiple tokens for same deviceType, removes old ones.
const registerDeviceToken = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { deviceToken, deviceId, deviceType, platform } = req.body;

    if (!deviceToken) {
      return error(res, 'deviceToken is required', 400);
    }

    // If this exact token already exists for another user, deactivate it
    // (a device can only be registered to one user at a time)
    await prisma.pushNotificationSubscriber.updateMany({
      where: {
        deviceToken,
        userId: { not: userId },
      },
      data: { isActive: false },
    });

    // Upsert: create or reactivate token for this user
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

    // If deviceType is specified, deactivate older tokens for the same device type
    // (keep only the newest one per device type per user)
    if (deviceType) {
      const allTokensForType = await prisma.pushNotificationSubscriber.findMany({
        where: {
          userId,
          deviceType,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Keep the newest, deactivate the rest
      if (allTokensForType.length > 1) {
        const idsToDeactivate = allTokensForType
          .slice(1)
          .map((t) => t.id)
          .filter((id) => id !== subscriber.id);

        if (idsToDeactivate.length > 0) {
          await prisma.pushNotificationSubscriber.updateMany({
            where: { id: { in: idsToDeactivate } },
            data: { isActive: false },
          });
        }
      }
    }

    return success(res, subscriber, 201);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/notifications/device-token/:deviceId ─────────────────────────
// Unregister a device token (deactivate, not hard delete)
const unregisterDeviceToken = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { deviceId } = req.params;

    const result = await prisma.pushNotificationSubscriber.updateMany({
      where: { userId, deviceId, isActive: true },
      data: { isActive: false },
    });

    if (result.count === 0) {
      return error(res, 'No active device token found for this device', 404);
    }

    return success(res, { message: 'Device token unregistered', count: result.count });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createNotification,
  listNotifications,
  markSeen,
  markAllSeen,
  getUnseenCount,
  sendPush,
  registerDeviceToken,
  unregisterDeviceToken,
};
