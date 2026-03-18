const { prisma, success, error, paginated } = require('shared');

// ─── POST /api/messages/rooms ─────────────────────────────────────────────────
// Create or get existing chat room between two users (either direction)
const createOrGetRoom = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { receiverId } = req.body;

    if (!receiverId) {
      return error(res, 'receiverId is required', 400);
    }

    if (receiverId === userId) {
      return error(res, 'Cannot create chat room with yourself', 400);
    }

    // Verify receiver exists and is active
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, accountStatus: true },
    });

    if (!receiver) {
      return error(res, 'User not found', 404);
    }

    if (receiver.accountStatus !== 'active') {
      return error(res, 'Cannot start a conversation with this user', 400);
    }

    // Check if either user has blocked the other
    const block = await prisma.blockedUser.findFirst({
      where: {
        OR: [
          { userId, blockedId: receiverId },
          { userId: receiverId, blockedId: userId },
        ],
      },
    });

    if (block) {
      return error(res, 'Cannot start a conversation with this user', 403);
    }

    // Check if room already exists between these two users (in either direction)
    const existingRoom = await prisma.userChatRoom.findFirst({
      where: {
        OR: [
          { ownerId: userId, receiverId },
          { ownerId: receiverId, receiverId: userId },
        ],
      },
      include: {
        owner: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
        },
        receiver: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            contentType: true,
            sentAt: true,
            senderId: true,
            isRead: true,
          },
        },
      },
    });

    if (existingRoom) {
      // If room was soft-deleted, reactivate it
      if (existingRoom.status === 'Deleted') {
        const reactivated = await prisma.userChatRoom.update({
          where: { id: existingRoom.id },
          data: { status: 'Active' },
          include: {
            owner: {
              select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
            },
            receiver: {
              select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
            },
          },
        });
        return success(res, { ...reactivated, lastMessage: null });
      }

      return success(res, {
        ...existingRoom,
        lastMessage: existingRoom.messages[0] || null,
        messages: undefined,
      });
    }

    // Create new room
    const room = await prisma.userChatRoom.create({
      data: {
        ownerId: userId,
        receiverId,
        roomType: 'direct',
        status: 'Active',
      },
      include: {
        owner: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
        },
        receiver: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
        },
      },
    });

    return success(res, { ...room, lastMessage: null }, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/messages/rooms ──────────────────────────────────────────────────
// List user's chat rooms ordered by last message, with last message preview
const listRooms = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      OR: [{ ownerId: userId }, { receiverId: userId }],
      status: { not: 'Deleted' },
    };

    const [rooms, total] = await Promise.all([
      prisma.userChatRoom.findMany({
        where,
        include: {
          owner: {
            select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
          },
          receiver: {
            select: { id: true, username: true, fullName: true, profilePhotoKey: true, accountStatus: true },
          },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: {
              id: true,
              content: true,
              contentType: true,
              sentAt: true,
              senderId: true,
              isRead: true,
            },
          },
        },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        skip,
        take: Number(limit),
      }),
      prisma.userChatRoom.count({ where }),
    ]);

    // Flatten: pull out the last message, compute unread count per room
    const roomIds = rooms.map((r) => r.id);

    // Batch-count unread messages per room for the current user
    const unreadCounts = await prisma.message.groupBy({
      by: ['roomId'],
      where: {
        roomId: { in: roomIds },
        receiverId: userId,
        isRead: false,
        isDeleted: false,
      },
      _count: { id: true },
    });

    const unreadMap = {};
    for (const entry of unreadCounts) {
      unreadMap[entry.roomId] = entry._count.id;
    }

    const roomsWithLastMessage = rooms.map((room) => {
      // Determine the "other" user for the caller
      const otherUser = room.ownerId === userId ? room.receiver : room.owner;

      return {
        id: room.id,
        roomType: room.roomType,
        status: room.status,
        lastMessageAt: room.lastMessageAt,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        otherUser,
        lastMessage: room.messages[0] || null,
        unreadCount: unreadMap[room.id] || 0,
      };
    });

    return paginated(res, roomsWithLastMessage, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/messages/rooms/:roomId/status ───────────────────────────────────
// Update room status (Active / Mute / Block / Deleted / Secret)
const updateRoomStatus = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { roomId } = req.params;
    const { status } = req.body;

    const validStatuses = ['Active', 'Mute', 'Block', 'Deleted', 'Pending', 'Secret'];
    if (!status || !validStatuses.includes(status)) {
      return error(res, `status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const room = await prisma.userChatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      return error(res, 'Chat room not found', 404);
    }

    if (room.ownerId !== userId && room.receiverId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    const updated = await prisma.userChatRoom.update({
      where: { id: roomId },
      data: { status },
      include: {
        owner: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
        receiver: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
      },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/messages/rooms/:roomId ───────────────────────────────────────
// Soft delete a room (set status = Deleted)
const deleteRoom = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { roomId } = req.params;

    const room = await prisma.userChatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      return error(res, 'Chat room not found', 404);
    }

    if (room.ownerId !== userId && room.receiverId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    if (room.status === 'Deleted') {
      return error(res, 'Chat room already deleted', 400);
    }

    await prisma.userChatRoom.update({
      where: { id: roomId },
      data: { status: 'Deleted' },
    });

    return success(res, { message: 'Chat room deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/messages ──────────────────────────────────────────────────────
// Send a message in a chat room
const sendMessage = async (req, res, next) => {
  try {
    const senderId = req.user.sub;
    const { roomId, content, contentType, mediaKey } = req.body;

    if (!roomId) {
      return error(res, 'roomId is required', 400);
    }
    if (!content && !mediaKey) {
      return error(res, 'content or mediaKey is required', 400);
    }

    const validContentTypes = ['Text', 'Image', 'Video', 'Link', 'Attachment'];
    if (contentType && !validContentTypes.includes(contentType)) {
      return error(res, `contentType must be one of: ${validContentTypes.join(', ')}`, 400);
    }

    const room = await prisma.userChatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      return error(res, 'Chat room not found', 404);
    }

    if (room.ownerId !== senderId && room.receiverId !== senderId) {
      return error(res, 'Not authorized to send messages in this room', 403);
    }

    // Check room status - cannot send if blocked or deleted
    if (room.status === 'Deleted') {
      return error(res, 'Cannot send message to a deleted room', 400);
    }
    if (room.status === 'Block') {
      return error(res, 'Cannot send message — this conversation is blocked', 403);
    }

    // Determine receiver
    const receiverId = room.ownerId === senderId ? room.receiverId : room.ownerId;

    // Check if receiver has blocked the sender at the user level
    if (receiverId) {
      const blocked = await prisma.blockedUser.findFirst({
        where: {
          OR: [
            { userId: receiverId, blockedId: senderId },
            { userId: senderId, blockedId: receiverId },
          ],
        },
      });
      if (blocked) {
        return error(res, 'Cannot send message to this user', 403);
      }
    }

    const now = new Date();

    // Create message and update room lastMessageAt in a transaction
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          roomId,
          senderId,
          receiverId: receiverId || null,
          content: content || null,
          contentType: contentType || 'Text',
          mediaKey: mediaKey || null,
          sentAt: now,
        },
        include: {
          sender: {
            select: { id: true, username: true, fullName: true, profilePhotoKey: true },
          },
        },
      }),
      prisma.userChatRoom.update({
        where: { id: roomId },
        data: {
          lastMessageAt: now,
          // Reactivate room if it was muted, for the other participant's view
          // (keep status as-is; mute just suppresses push notifications)
        },
      }),
    ]);

    return success(res, message, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/messages/room/:roomId ──────────────────────────────────────────
// Get messages in a room, paginated, newest first
const getMessages = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { roomId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const room = await prisma.userChatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      return error(res, 'Chat room not found', 404);
    }

    if (room.ownerId !== userId && room.receiverId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    const where = {
      roomId,
      isDeleted: false,
    };

    // Cursor-based pagination: fetch messages before a given timestamp
    if (before) {
      where.sentAt = { lt: new Date(before) };
    }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: {
            select: { id: true, username: true, fullName: true, profilePhotoKey: true },
          },
        },
        orderBy: { sentAt: 'desc' },
        skip: before ? 0 : skip,
        take: Number(limit),
      }),
      prisma.message.count({ where: { roomId, isDeleted: false } }),
    ]);

    return paginated(res, messages, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/messages/:messageId/read ───────────────────────────────────────
// Mark a single message as read. Also bulk-marks all earlier unread messages
// in the same room from the same sender.
const markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { messageId } = req.params;

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      return error(res, 'Message not found', 404);
    }

    // Only the receiver can mark as read
    if (message.receiverId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    if (message.isRead) {
      return success(res, { message: 'Already read' });
    }

    // Mark this message AND all older unread messages from the same sender in this room
    const result = await prisma.message.updateMany({
      where: {
        roomId: message.roomId,
        receiverId: userId,
        isRead: false,
        sentAt: { lte: message.sentAt },
      },
      data: { isRead: true },
    });

    return success(res, { markedCount: result.count });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/messages/rooms/mark-all-seen ───────────────────────────────────
// Mark all rooms as "seen" — marks all unread messages across all rooms as read
// This is the notification-badge clearing endpoint (from LikerSLAUpdateChatRoomStatus)
const markAllRoomsSeen = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Find all rooms the user participates in
    const rooms = await prisma.userChatRoom.findMany({
      where: {
        OR: [{ ownerId: userId }, { receiverId: userId }],
        status: { not: 'Deleted' },
      },
      select: { id: true },
    });

    const roomIds = rooms.map((r) => r.id);

    if (roomIds.length === 0) {
      return success(res, { markedCount: 0 });
    }

    // Mark all unread messages where user is receiver across all rooms
    const result = await prisma.message.updateMany({
      where: {
        roomId: { in: roomIds },
        receiverId: userId,
        isRead: false,
      },
      data: { isRead: true },
    });

    return success(res, { markedCount: result.count });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/messages/contacts ──────────────────────────────────────────────
// Get chat contacts: accepted friends enriched with chatRoomId (from likerslaGetChatUserList)
const getChatContacts = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 50, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Get accepted friends (both directions)
    const friendWhere = {
      OR: [
        { userId, status: 'accepted' },
        { friendUserId: userId, status: 'accepted' },
      ],
    };

    const [friends, totalFriends] = await Promise.all([
      prisma.userFriend.findMany({
        where: friendWhere,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
              accountStatus: true,
              lastActiveAt: true,
            },
          },
          friend: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
              accountStatus: true,
              lastActiveAt: true,
            },
          },
        },
        skip,
        take: Number(limit),
      }),
      prisma.userFriend.count({ where: friendWhere }),
    ]);

    // Extract the "other" user from each friendship
    let contacts = friends.map((f) => {
      return f.userId === userId ? f.friend : f.user;
    });

    // Filter out blocked, deactivated, or deleted users
    contacts = contacts.filter(
      (c) => c.accountStatus === 'active'
    );

    // Apply search filter on fullName or username if provided
    if (search) {
      const q = search.toLowerCase();
      contacts = contacts.filter(
        (c) =>
          (c.fullName && c.fullName.toLowerCase().includes(q)) ||
          (c.username && c.username.toLowerCase().includes(q))
      );
    }

    // Get blocked user ids to exclude them
    const blockedRelations = await prisma.blockedUser.findMany({
      where: {
        OR: [{ userId }, { blockedId: userId }],
      },
      select: { userId: true, blockedId: true },
    });

    const blockedIds = new Set();
    for (const b of blockedRelations) {
      if (b.userId === userId) blockedIds.add(b.blockedId);
      else blockedIds.add(b.userId);
    }

    contacts = contacts.filter((c) => !blockedIds.has(c.id));

    // For each contact, look up if a chat room exists
    const contactIds = contacts.map((c) => c.id);

    const existingRooms = contactIds.length > 0
      ? await prisma.userChatRoom.findMany({
          where: {
            OR: [
              { ownerId: userId, receiverId: { in: contactIds } },
              { ownerId: { in: contactIds }, receiverId: userId },
            ],
          },
          select: { id: true, ownerId: true, receiverId: true, status: true },
        })
      : [];

    // Build a map: contactId -> chatRoomId
    const roomMap = {};
    for (const room of existingRooms) {
      const contactId = room.ownerId === userId ? room.receiverId : room.ownerId;
      // Only map active (non-deleted) rooms
      if (room.status !== 'Deleted') {
        roomMap[contactId] = room.id;
      }
    }

    const enrichedContacts = contacts.map((c) => ({
      ...c,
      chatRoomId: roomMap[c.id] || null,
    }));

    return paginated(res, enrichedContacts, totalFriends, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// CHECK CHAT SPAM LIMIT (from likerslaCheckUserChatRommLimit)
// Anti-spam: count non-friend message recipients in time window
// If exceeds MAX_MESSAGE_COUNT → auto-block user
// ─────────────────────────────────────────────────

const checkChatSpamLimit = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const MAX_MESSAGE_COUNT = parseInt(process.env.MAX_MESSAGE_COUNT) || 10;
    const TIME_LIMIT_MINUTES = parseInt(process.env.CHAT_TIME_LIMIT_MINUTES) || 60;

    const timeThreshold = new Date(Date.now() - TIME_LIMIT_MINUTES * 60 * 1000);

    // Get all friend IDs for this user
    const friendRecords = await prisma.userFriend.findMany({
      where: {
        OR: [
          { userId, status: 'accepted' },
          { friendUserId: userId, status: 'accepted' },
        ],
      },
      select: { userId: true, friendUserId: true },
    });
    const friendIds = new Set(friendRecords.map((f) =>
      f.userId === userId ? f.friendUserId : f.userId
    ));

    // Get chat rooms created by this user in the time window
    const recentRooms = await prisma.userChatRoom.findMany({
      where: {
        ownerId: userId,
        createdAt: { gte: timeThreshold },
      },
      select: { receiverId: true },
    });

    // Count receivers who are NOT friends
    const nonFriendReceivers = recentRooms.filter(
      (r) => r.receiverId && !friendIds.has(r.receiverId)
    );

    if (nonFriendReceivers.length >= MAX_MESSAGE_COUNT) {
      // Auto-block the user (same as Lambda invoking BlockOrDeactivate)
      await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'blocked' },
      });

      await prisma.adminBlockedUser.upsert({
        where: { userId },
        update: { reason: 'Auto-blocked: chat spam limit exceeded', blockedAt: new Date() },
        create: { userId, blockedBy: userId, reason: 'Auto-blocked: chat spam limit exceeded' },
      });

      return success(res, { status: 'userIsRed', count: nonFriendReceivers.length });
    }

    return success(res, { status: 'userIsGreen', count: nonFriendReceivers.length });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrGetRoom,
  listRooms,
  updateRoomStatus,
  deleteRoom,
  sendMessage,
  getMessages,
  markAsRead,
  markAllRoomsSeen,
  getChatContacts,
  checkChatSpamLimit,
};
