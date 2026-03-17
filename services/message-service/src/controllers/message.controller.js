const { prisma, success, error, paginated } = require('shared');

// POST /api/messages/rooms — create or get existing chat room between two users
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
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
        receiver: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
      },
    });

    if (existingRoom) {
      return success(res, existingRoom);
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
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
        receiver: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
      },
    });

    return success(res, room, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/messages/rooms — list user's chat rooms with last message
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
            select: { id: true, username: true, fullName: true, profilePhotoKey: true },
          },
          receiver: {
            select: { id: true, username: true, fullName: true, profilePhotoKey: true },
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

    // Flatten last message
    const roomsWithLastMessage = rooms.map((room) => ({
      ...room,
      lastMessage: room.messages[0] || null,
      messages: undefined,
    }));

    return paginated(res, roomsWithLastMessage, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// PUT /api/messages/rooms/:roomId/status — update room status (Mute, Block, etc.)
const updateRoomStatus = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { roomId } = req.params;
    const { status } = req.body;

    if (!status) {
      return error(res, 'status is required', 400);
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
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/messages/rooms/:roomId — soft delete room
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

    await prisma.userChatRoom.update({
      where: { id: roomId },
      data: { status: 'Deleted' },
    });

    return success(res, { message: 'Chat room deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/messages — send message
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

    const room = await prisma.userChatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      return error(res, 'Chat room not found', 404);
    }

    if (room.ownerId !== senderId && room.receiverId !== senderId) {
      return error(res, 'Not authorized to send messages in this room', 403);
    }

    // Determine receiver
    const receiverId = room.ownerId === senderId ? room.receiverId : room.ownerId;

    const message = await prisma.message.create({
      data: {
        roomId,
        senderId,
        receiverId,
        content: content || null,
        contentType: contentType || 'Text',
        mediaKey: mediaKey || null,
      },
      include: {
        sender: {
          select: { id: true, username: true, fullName: true, profilePhotoKey: true },
        },
      },
    });

    // Update room's lastMessageAt
    await prisma.userChatRoom.update({
      where: { id: roomId },
      data: { lastMessageAt: new Date() },
    });

    return success(res, message, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/messages/room/:roomId — get messages in room, paginated
const getMessages = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const room = await prisma.userChatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      return error(res, 'Chat room not found', 404);
    }

    if (room.ownerId !== userId && room.receiverId !== userId) {
      return error(res, 'Not authorized', 403);
    }

    const where = { roomId, isDeleted: false };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: {
            select: { id: true, username: true, fullName: true, profilePhotoKey: true },
          },
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.message.count({ where }),
    ]);

    return paginated(res, messages, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// PUT /api/messages/:messageId/read — mark message as read
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

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isRead: true },
    });

    return success(res, updated);
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
};
