const { prisma, success, error, paginated } = require('shared');

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePhotoKey: true,
};

// ─────────────────────────────────────────────────
// FOLLOW
// ─────────────────────────────────────────────────

exports.followUser = async (req, res, next) => {
  try {
    const followerId = req.user.sub;
    const { userId } = req.body;

    if (!userId) {
      return error(res, 'userId is required', 400);
    }

    if (followerId === userId) {
      return error(res, 'You cannot follow yourself', 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return error(res, 'User not found', 404);
    }

    const existing = await prisma.userFollower.findUnique({
      where: { userId_followerId: { userId, followerId } },
    });
    if (existing) {
      return error(res, 'Already following this user', 409);
    }

    const [followerRecord] = await prisma.$transaction([
      prisma.userFollower.create({
        data: { userId, followerId },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { totalFollowers: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: followerId },
        data: { totalFollowing: { increment: 1 } },
      }),
    ]);

    return success(res, followerRecord, 201);
  } catch (err) {
    next(err);
  }
};

exports.unfollowUser = async (req, res, next) => {
  try {
    const followerId = req.user.sub;
    const { userId } = req.params;

    const existing = await prisma.userFollower.findUnique({
      where: { userId_followerId: { userId, followerId } },
    });
    if (!existing) {
      return error(res, 'You are not following this user', 404);
    }

    await prisma.$transaction([
      prisma.userFollower.delete({
        where: { userId_followerId: { userId, followerId } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { totalFollowers: { decrement: 1 } },
      }),
      prisma.user.update({
        where: { id: followerId },
        data: { totalFollowing: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Unfollowed successfully' });
  } catch (err) {
    next(err);
  }
};

exports.getFollowers = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [followers, total] = await Promise.all([
      prisma.userFollower.findMany({
        where: { userId },
        include: { follower: { select: USER_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFollower.count({ where: { userId } }),
    ]);

    const data = followers.map((f) => ({
      id: f.id,
      followerId: f.followerId,
      seeFirst: f.seeFirst,
      createdAt: f.createdAt,
      user: f.follower,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.getFollowing = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [following, total] = await Promise.all([
      prisma.userFollower.findMany({
        where: { followerId: userId },
        include: { user: { select: USER_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFollower.count({ where: { followerId: userId } }),
    ]);

    const data = following.map((f) => ({
      id: f.id,
      userId: f.userId,
      seeFirst: f.seeFirst,
      createdAt: f.createdAt,
      user: f.user,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// FRIENDS
// ─────────────────────────────────────────────────

exports.sendFriendRequest = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { userId: friendUserId } = req.body;

    if (!friendUserId) {
      return error(res, 'userId is required', 400);
    }

    if (userId === friendUserId) {
      return error(res, 'You cannot send a friend request to yourself', 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: friendUserId } });
    if (!targetUser) {
      return error(res, 'User not found', 404);
    }

    const existing = await prisma.userFriend.findFirst({
      where: {
        OR: [
          { userId, friendUserId },
          { userId: friendUserId, friendUserId: userId },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'accepted') {
        return error(res, 'Already friends with this user', 409);
      }
      if (existing.status === 'pending') {
        return error(res, 'Friend request already pending', 409);
      }
    }

    const friendRequest = await prisma.userFriend.create({
      data: { userId, friendUserId, status: 'pending' },
    });

    return success(res, friendRequest, 201);
  } catch (err) {
    next(err);
  }
};

exports.acceptFriendRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params; // the user who sent the request

    const friendRequest = await prisma.userFriend.findFirst({
      where: {
        userId: userId,
        friendUserId: currentUserId,
        status: 'pending',
      },
    });

    if (!friendRequest) {
      return error(res, 'No pending friend request found from this user', 404);
    }

    await prisma.$transaction([
      // Update original request to accepted
      prisma.userFriend.update({
        where: { id: friendRequest.id },
        data: { status: 'accepted' },
      }),
      // Create reverse friend record
      prisma.userFriend.upsert({
        where: {
          userId_friendUserId: {
            userId: currentUserId,
            friendUserId: userId,
          },
        },
        create: {
          userId: currentUserId,
          friendUserId: userId,
          status: 'accepted',
        },
        update: {
          status: 'accepted',
        },
      }),
      // Increment both users' friend counts
      prisma.user.update({
        where: { id: currentUserId },
        data: { totalFriends: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { totalFriends: { increment: 1 } },
      }),
    ]);

    return success(res, { message: 'Friend request accepted' });
  } catch (err) {
    next(err);
  }
};

exports.rejectFriendRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params;

    const friendRequest = await prisma.userFriend.findFirst({
      where: {
        userId: userId,
        friendUserId: currentUserId,
        status: 'pending',
      },
    });

    if (!friendRequest) {
      return error(res, 'No pending friend request found from this user', 404);
    }

    await prisma.userFriend.update({
      where: { id: friendRequest.id },
      data: { status: 'rejected' },
    });

    return success(res, { message: 'Friend request rejected' });
  } catch (err) {
    next(err);
  }
};

exports.removeFriend = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params;

    // Check that they are actually friends (at least one accepted record exists)
    const friendRecord = await prisma.userFriend.findFirst({
      where: {
        OR: [
          { userId: currentUserId, friendUserId: userId, status: 'accepted' },
          { userId: userId, friendUserId: currentUserId, status: 'accepted' },
        ],
      },
    });

    if (!friendRecord) {
      return error(res, 'You are not friends with this user', 404);
    }

    await prisma.$transaction([
      // Delete both directions of the friendship
      prisma.userFriend.deleteMany({
        where: {
          OR: [
            { userId: currentUserId, friendUserId: userId },
            { userId: userId, friendUserId: currentUserId },
          ],
        },
      }),
      // Decrement both users' friend counts
      prisma.user.update({
        where: { id: currentUserId },
        data: { totalFriends: { decrement: 1 } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { totalFriends: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Friend removed successfully' });
  } catch (err) {
    next(err);
  }
};

exports.getFriends = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [friends, total] = await Promise.all([
      prisma.userFriend.findMany({
        where: { userId, status: 'accepted' },
        include: { friend: { select: USER_SELECT } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFriend.count({ where: { userId, status: 'accepted' } }),
    ]);

    const data = friends.map((f) => ({
      id: f.id,
      friendUserId: f.friendUserId,
      createdAt: f.createdAt,
      user: f.friend,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.getPendingRequests = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [pending, total] = await Promise.all([
      prisma.userFriend.findMany({
        where: { friendUserId: userId, status: 'pending' },
        include: { user: { select: USER_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFriend.count({ where: { friendUserId: userId, status: 'pending' } }),
    ]);

    const data = pending.map((f) => ({
      id: f.id,
      userId: f.userId,
      createdAt: f.createdAt,
      user: f.user,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.getFriendSuggestions = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Get IDs of users already in a friend relationship with current user
    const existingFriends = await prisma.userFriend.findMany({
      where: {
        OR: [{ userId }, { friendUserId: userId }],
      },
      select: { userId: true, friendUserId: true },
    });

    const excludeIds = new Set([userId]);
    existingFriends.forEach((f) => {
      excludeIds.add(f.userId);
      excludeIds.add(f.friendUserId);
    });

    // Also exclude blocked users
    const blockedUsers = await prisma.blockedUser.findMany({
      where: {
        OR: [{ userId }, { blockedId: userId }],
      },
      select: { userId: true, blockedId: true },
    });

    blockedUsers.forEach((b) => {
      excludeIds.add(b.userId);
      excludeIds.add(b.blockedId);
    });

    const suggestions = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        accountStatus: 'active',
        deletedAt: null,
      },
      select: {
        ...USER_SELECT,
        bio: true,
        totalFollowers: true,
      },
      take: 20,
      orderBy: { totalFollowers: 'desc' },
    });

    return success(res, suggestions);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// BLOCK
// ─────────────────────────────────────────────────

exports.blockUser = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { userId: blockedId, blockType } = req.body;

    if (!blockedId) {
      return error(res, 'userId is required', 400);
    }

    if (userId === blockedId) {
      return error(res, 'You cannot block yourself', 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: blockedId } });
    if (!targetUser) {
      return error(res, 'User not found', 404);
    }

    const existing = await prisma.blockedUser.findUnique({
      where: { userId_blockedId: { userId, blockedId } },
    });
    if (existing) {
      return error(res, 'User is already blocked', 409);
    }

    const blocked = await prisma.blockedUser.create({
      data: {
        userId,
        blockedId,
        blockType: blockType || 'Profile',
      },
    });

    return success(res, blocked, 201);
  } catch (err) {
    next(err);
  }
};

exports.unblockUser = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { userId: blockedId } = req.params;

    const existing = await prisma.blockedUser.findUnique({
      where: { userId_blockedId: { userId, blockedId } },
    });
    if (!existing) {
      return error(res, 'User is not blocked', 404);
    }

    await prisma.blockedUser.delete({
      where: { userId_blockedId: { userId, blockedId } },
    });

    return success(res, { message: 'User unblocked successfully' });
  } catch (err) {
    next(err);
  }
};

exports.getBlockedUsers = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [blockedUsers, total] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { userId },
        include: { blocked: { select: USER_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.blockedUser.count({ where: { userId } }),
    ]);

    const data = blockedUsers.map((b) => ({
      id: b.id,
      blockedId: b.blockedId,
      blockType: b.blockType,
      createdAt: b.createdAt,
      user: b.blocked,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};
