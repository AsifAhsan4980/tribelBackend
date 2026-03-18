const { prisma, success, error, paginated } = require('shared');

// ─────────────────────────────────────────────────
// Shared user fields for includes/selects
// ─────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePhotoKey: true,
  isAccountVerified: true,
  accountStatus: true,
};

const USER_SELECT_EXTENDED = {
  ...USER_SELECT,
  bio: true,
  totalFollowers: true,
  totalFollowing: true,
  totalFriends: true,
  totalGoldStars: true,
  totalSilverStars: true,
};

const MAX_FRIENDS = parseInt(process.env.MAX_FRIENDS) || 5000;
const MAX_BLOCKS = 5000;

// ─────────────────────────────────────────────────
// FOLLOW
// ─────────────────────────────────────────────────

/**
 * POST /api/social/follow
 * Follow a user (FOLLOW mode from likerslaFollowUnfollow).
 *
 * Original Lambda: likerslaFollowUnfollow mode=FOLLOW
 * - Creates a UserFollower record (userId = followed user, followerId = me)
 * - Atomically increments followed user's totalFollowers +1
 * - Atomically increments my totalFollowing +1
 * - Creates a follow notification for the followed user
 * - Checks if the target user is already following me (isFollower flag for notification)
 */
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

    // Verify target user exists and is active
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true, deletedAt: true },
    });
    if (!targetUser) {
      return error(res, 'User not found', 404);
    }
    if (targetUser.accountStatus !== 'active' || targetUser.deletedAt) {
      return error(res, 'Cannot follow an inactive or deleted user', 400);
    }

    // Check if blocked in either direction
    const blockExists = await prisma.blockedUser.findFirst({
      where: {
        OR: [
          { userId: followerId, blockedId: userId },
          { userId, blockedId: followerId },
        ],
      },
    });
    if (blockExists) {
      return error(res, 'Cannot follow this user', 403);
    }

    // Check if already following
    const existing = await prisma.userFollower.findUnique({
      where: { userId_followerId: { userId, followerId } },
    });
    if (existing) {
      return error(res, 'Already following this user', 409);
    }

    // Check if target is already following me (for isFollower flag on notification)
    const isFollowedBack = await prisma.userFollower.findUnique({
      where: { userId_followerId: { userId: followerId, followerId: userId } },
    });

    // Atomic transaction: create follower + increment counters
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

    // Create follow notification (non-blocking, don't fail the request if this errors)
    try {
      await prisma.notification.create({
        data: {
          ownerId: userId,
          actionCreatorId: followerId,
          notificationType: 'follow',
          isSeen: false,
          isDetailsSeen: false,
        },
      });
    } catch (_notifErr) {
      // Notification creation failed but the follow itself succeeded — log and continue
      console.error('Failed to create follow notification:', _notifErr.message);
    }

    return success(res, {
      id: followerRecord.id,
      userId: followerRecord.userId,
      followerId: followerRecord.followerId,
      seeFirst: followerRecord.seeFirst,
      createdAt: followerRecord.createdAt,
      isFollowedBack: !!isFollowedBack,
    }, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/social/follow/:userId
 * Unfollow a user (UNFOLLOW mode from likerslaFollowUnfollow).
 *
 * Original Lambda: likerslaFollowUnfollow mode=UNFOLLOW
 * - Validates the follow record exists
 * - Atomically deletes UserFollower + decrements totalFollowers on target + decrements totalFollowing on me
 * - Also deletes the associated follow notification
 */
exports.unfollowUser = async (req, res, next) => {
  try {
    const followerId = req.user.sub;
    const { userId } = req.params;

    // Verify the follow record exists
    const existing = await prisma.userFollower.findUnique({
      where: { userId_followerId: { userId, followerId } },
    });
    if (!existing) {
      return error(res, 'You are not following this user', 404);
    }

    // Atomic transaction: delete follower + decrement counters + delete notification
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
      // Delete associated follow notification (the one where I followed them)
      prisma.notification.deleteMany({
        where: {
          ownerId: userId,
          actionCreatorId: followerId,
          notificationType: 'follow',
        },
      }),
    ]);

    return success(res, { message: 'Unfollowed successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/social/follow/:userId/see-first
 * Toggle seeFirst flag on a follow (turnOffNotification / turnONNotification modes).
 *
 * Original Lambda: likerslaFollowUnfollow mode=turnOffNotification/turnONNotification
 * - Updates UserFollower.seeFirst to 0 or 1
 * - Used by feed algorithm to prioritize posts from this user
 */
exports.toggleSeeFirst = async (req, res, next) => {
  try {
    const followerId = req.user.sub;
    const { userId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return error(res, 'enabled (boolean) is required in body', 400);
    }

    // Verify the follow record exists
    const existing = await prisma.userFollower.findUnique({
      where: { userId_followerId: { userId, followerId } },
    });
    if (!existing) {
      return error(res, 'You are not following this user', 404);
    }

    const updated = await prisma.userFollower.update({
      where: { userId_followerId: { userId, followerId } },
      data: { seeFirst: enabled },
    });

    return success(res, {
      id: updated.id,
      userId: updated.userId,
      followerId: updated.followerId,
      seeFirst: updated.seeFirst,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/social/followers/:userId
 * Paginated list of followers of a user.
 *
 * Original Lambda: likerslaGetFollowingList
 * - Returns followers with user details
 * - Filters out blocked, admin-blocked, and inactive users
 * - Includes isFollowing flag (whether the viewer is following that follower)
 */
exports.getFollowers = async (req, res, next) => {
  try {
    const viewerId = req.user.sub;
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Get IDs of users blocked by/blocking the viewer to exclude them
    const blockedRelations = await prisma.blockedUser.findMany({
      where: {
        OR: [{ userId: viewerId }, { blockedId: viewerId }],
      },
      select: { userId: true, blockedId: true },
    });
    const blockedIds = new Set();
    blockedRelations.forEach((b) => {
      blockedIds.add(b.userId);
      blockedIds.add(b.blockedId);
    });
    blockedIds.delete(viewerId);

    // Build where clause: followers of userId, excluding blocked/inactive
    const whereClause = {
      userId,
      follower: {
        accountStatus: 'active',
        deletedAt: null,
        id: { notIn: Array.from(blockedIds) },
      },
    };

    const [followers, total] = await Promise.all([
      prisma.userFollower.findMany({
        where: whereClause,
        include: {
          follower: { select: USER_SELECT_EXTENDED },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFollower.count({ where: whereClause }),
    ]);

    // Batch check: which of these followers is the viewer following?
    const followerIds = followers.map((f) => f.followerId);
    let viewerFollowingSet = new Set();
    if (followerIds.length > 0) {
      const viewerFollowing = await prisma.userFollower.findMany({
        where: {
          followerId: viewerId,
          userId: { in: followerIds },
        },
        select: { userId: true },
      });
      viewerFollowingSet = new Set(viewerFollowing.map((f) => f.userId));
    }

    const data = followers.map((f) => ({
      id: f.id,
      followerId: f.followerId,
      seeFirst: f.seeFirst,
      createdAt: f.createdAt,
      user: f.follower,
      isFollowing: viewerFollowingSet.has(f.followerId),
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/social/following/:userId
 * Paginated list of users that userId is following.
 *
 * Same pattern as getFollowers but reversed direction.
 * Filters out blocked, admin-blocked, and inactive users.
 * Includes isFollowing flag (whether the viewer is following that user).
 */
exports.getFollowing = async (req, res, next) => {
  try {
    const viewerId = req.user.sub;
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Get IDs of users blocked by/blocking the viewer
    const blockedRelations = await prisma.blockedUser.findMany({
      where: {
        OR: [{ userId: viewerId }, { blockedId: viewerId }],
      },
      select: { userId: true, blockedId: true },
    });
    const blockedIds = new Set();
    blockedRelations.forEach((b) => {
      blockedIds.add(b.userId);
      blockedIds.add(b.blockedId);
    });
    blockedIds.delete(viewerId);

    const whereClause = {
      followerId: userId,
      user: {
        accountStatus: 'active',
        deletedAt: null,
        id: { notIn: Array.from(blockedIds) },
      },
    };

    const [following, total] = await Promise.all([
      prisma.userFollower.findMany({
        where: whereClause,
        include: {
          user: { select: USER_SELECT_EXTENDED },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFollower.count({ where: whereClause }),
    ]);

    // Batch check: which of these users is the viewer following?
    const followedIds = following.map((f) => f.userId);
    let viewerFollowingSet = new Set();
    if (followedIds.length > 0) {
      const viewerFollowing = await prisma.userFollower.findMany({
        where: {
          followerId: viewerId,
          userId: { in: followedIds },
        },
        select: { userId: true },
      });
      viewerFollowingSet = new Set(viewerFollowing.map((f) => f.userId));
    }

    const data = following.map((f) => ({
      id: f.id,
      userId: f.userId,
      seeFirst: f.seeFirst,
      createdAt: f.createdAt,
      user: f.user,
      isFollowing: viewerFollowingSet.has(f.userId),
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// FRIENDS
// ─────────────────────────────────────────────────

/**
 * POST /api/social/friend
 * Send a friend request (SEND mode from likerslaFriendUnfriend).
 *
 * Original Lambda: likerslaFriendUnfriend mode=SEND
 * - Checks target user exists and is active
 * - Checks no block in either direction
 * - Checks no existing accepted friendship (via UserAcceptedFriend table) or pending request
 * - Creates UserFriend with status='pending', isFollower=true
 * - Creates friend_request notification
 */
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

    // Verify target user exists and is active
    const targetUser = await prisma.user.findUnique({
      where: { id: friendUserId },
      select: { id: true, accountStatus: true, deletedAt: true },
    });
    if (!targetUser) {
      return error(res, 'User not found', 404);
    }
    if (targetUser.accountStatus !== 'active' || targetUser.deletedAt) {
      return error(res, 'Cannot send friend request to an inactive or deleted user', 400);
    }

    // Check if blocked in either direction
    const blockExists = await prisma.blockedUser.findFirst({
      where: {
        OR: [
          { userId, blockedId: friendUserId },
          { userId: friendUserId, blockedId: userId },
        ],
      },
    });
    if (blockExists) {
      return error(res, 'Cannot send friend request to this user', 403);
    }

    // Check for existing friend records in either direction
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
      // If previously rejected, allow re-sending by deleting old record first
      if (existing.status === 'rejected') {
        await prisma.userFriend.delete({ where: { id: existing.id } });
      }
    }

    const friendRequest = await prisma.userFriend.create({
      data: {
        userId,
        friendUserId,
        status: 'pending',
        isFollower: true,
      },
    });

    // Create friend_request notification
    try {
      await prisma.notification.create({
        data: {
          ownerId: friendUserId,
          actionCreatorId: userId,
          notificationType: 'friend_request',
          isSeen: false,
          isDetailsSeen: false,
        },
      });
    } catch (_notifErr) {
      console.error('Failed to create friend request notification:', _notifErr.message);
    }

    return success(res, {
      id: friendRequest.id,
      userId: friendRequest.userId,
      friendUserId: friendRequest.friendUserId,
      status: friendRequest.status,
      createdAt: friendRequest.createdAt,
    }, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/social/friend/:userId/accept
 * Accept a friend request (ACCEPT mode from likerslaFriendUnfriend).
 *
 * Original Lambda: likerslaFriendUnfriend mode=ACCEPT
 * - Validates a pending request from :userId to me exists
 * - Checks both users haven't exceeded MAX_FRIENDS
 * - Atomic transaction:
 *   1. Update the incoming UserFriend to status='accepted'
 *   2. Upsert the reverse UserFriend record (me -> them) with status='accepted'
 *   3. Increment totalFriends +1 on BOTH users
 * - Creates 2 notifications:
 *   - friend_accepted for the original sender (ownerId=sender, actionCreator=me)
 *   - friend_accepted for me (ownerId=me, actionCreator=sender) — "OwnAcceptFriendRequest"
 */
exports.acceptFriendRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params; // the user who sent the request

    // Find the pending request FROM userId TO currentUserId
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

    // Check MAX_FRIENDS limit for both users
    const [myUser, theirUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: currentUserId }, select: { totalFriends: true, firstName: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { totalFriends: true, firstName: true } }),
    ]);

    if (myUser.totalFriends >= MAX_FRIENDS) {
      return error(res, `You have reached the maximum friend limit of ${MAX_FRIENDS}`, 400);
    }
    if (theirUser.totalFriends >= MAX_FRIENDS) {
      return error(res, `${theirUser.firstName || 'This user'} has reached the maximum friend limit of ${MAX_FRIENDS}`, 400);
    }

    // Atomic transaction
    await prisma.$transaction([
      // Update original request to accepted
      prisma.userFriend.update({
        where: { id: friendRequest.id },
        data: { status: 'accepted' },
      }),
      // Create/update reverse friend record (bidirectional)
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
          isFollower: true,
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

    // Create notifications for both users (non-blocking)
    try {
      await prisma.notification.createMany({
        data: [
          // Notify the sender that their request was accepted
          {
            ownerId: userId,
            actionCreatorId: currentUserId,
            notificationType: 'friend_accepted',
            isSeen: false,
            isDetailsSeen: false,
          },
          // Notify me (the acceptor) — "OwnAcceptFriendRequest" in original
          {
            ownerId: currentUserId,
            actionCreatorId: userId,
            notificationType: 'friend_accepted',
            isSeen: false,
            isDetailsSeen: false,
          },
        ],
      });
    } catch (_notifErr) {
      console.error('Failed to create friend accepted notifications:', _notifErr.message);
    }

    return success(res, { message: 'Friend request accepted' });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/social/friend/:userId/reject
 * Reject/cancel a friend request (CANCEL mode from likerslaFriendUnfriend).
 *
 * Original Lambda: likerslaFriendUnfriend mode=CANCEL
 * - Finds the pending request and deletes it (original used GraphQL deleteUserFriend)
 * - Works for both: me rejecting an incoming request, or me cancelling my outgoing request
 */
exports.rejectFriendRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params;

    // Look for a pending request in either direction involving me and the target
    const friendRequest = await prisma.userFriend.findFirst({
      where: {
        OR: [
          { userId: userId, friendUserId: currentUserId, status: 'pending' },
          { userId: currentUserId, friendUserId: userId, status: 'pending' },
        ],
      },
    });

    if (!friendRequest) {
      return error(res, 'No pending friend request found with this user', 404);
    }

    // Delete the request entirely (original Lambda used deleteUserFriend)
    await prisma.userFriend.delete({
      where: { id: friendRequest.id },
    });

    // Clean up the friend_request notification
    try {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { ownerId: currentUserId, actionCreatorId: userId, notificationType: 'friend_request' },
            { ownerId: userId, actionCreatorId: currentUserId, notificationType: 'friend_request' },
          ],
        },
      });
    } catch (_notifErr) {
      console.error('Failed to delete friend request notification:', _notifErr.message);
    }

    return success(res, { message: 'Friend request rejected' });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/social/friend/:userId
 * Remove a friend (UNFRIEND mode from likerslaFriendUnfriend).
 *
 * Original Lambda: likerslaFriendUnfriend mode=UNFRIEND
 * - Verifies the friendship exists (checks UserAcceptedFriend bidirectionally)
 * - Atomic transaction:
 *   1. Delete BOTH UserFriend records (userId->friendUserId AND friendUserId->userId)
 *   2. Decrement totalFriends -1 on BOTH users
 */
exports.removeFriend = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params;

    // Check that an accepted friend relationship exists in at least one direction
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

/**
 * GET /api/social/friends
 * Get accepted friends list (paginated).
 *
 * Bidirectional query: WHERE (userId=me AND status=accepted) OR (friendUserId=me AND status=accepted)
 * Filters out blocked/inactive users.
 */
exports.getFriends = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Get blocked user IDs to exclude
    const blockedRelations = await prisma.blockedUser.findMany({
      where: {
        OR: [{ userId }, { blockedId: userId }],
      },
      select: { userId: true, blockedId: true },
    });
    const blockedIds = new Set();
    blockedRelations.forEach((b) => {
      blockedIds.add(b.userId);
      blockedIds.add(b.blockedId);
    });
    blockedIds.delete(userId);
    const blockedIdsArray = Array.from(blockedIds);

    // Query friends where I am the initiator (userId = me)
    const whereAsInitiator = {
      userId,
      status: 'accepted',
      friend: {
        accountStatus: 'active',
        deletedAt: null,
        ...(blockedIdsArray.length > 0 ? { id: { notIn: blockedIdsArray } } : {}),
      },
    };

    // Query friends where I am the receiver (friendUserId = me)
    const whereAsReceiver = {
      friendUserId: userId,
      status: 'accepted',
      user: {
        accountStatus: 'active',
        deletedAt: null,
        ...(blockedIdsArray.length > 0 ? { id: { notIn: blockedIdsArray } } : {}),
      },
    };

    // Get both directions and merge
    const [friendsAsInitiator, friendsAsReceiver] = await Promise.all([
      prisma.userFriend.findMany({
        where: whereAsInitiator,
        include: { friend: { select: USER_SELECT_EXTENDED } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.userFriend.findMany({
        where: whereAsReceiver,
        include: { user: { select: USER_SELECT_EXTENDED } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    // Deduplicate: since friendship is bidirectional, each pair may appear in both queries.
    // Use a Set of friend user IDs to avoid duplicates.
    const seenFriendIds = new Set();
    const allFriends = [];

    for (const f of friendsAsInitiator) {
      if (!seenFriendIds.has(f.friendUserId)) {
        seenFriendIds.add(f.friendUserId);
        allFriends.push({
          id: f.id,
          friendUserId: f.friendUserId,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          user: f.friend,
        });
      }
    }

    for (const f of friendsAsReceiver) {
      if (!seenFriendIds.has(f.userId)) {
        seenFriendIds.add(f.userId);
        allFriends.push({
          id: f.id,
          friendUserId: f.userId,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          user: f.user,
        });
      }
    }

    // Sort by most recently updated
    allFriends.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const total = allFriends.length;
    const paginatedData = allFriends.slice(skip, skip + limit);

    return paginated(res, paginatedData, total, page, limit);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/social/friends/pending
 * Get pending incoming friend requests (paginated).
 *
 * Returns requests WHERE friendUserId=me AND status=pending
 * (These are requests sent TO me by other users)
 */
exports.getPendingRequests = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const whereClause = {
      friendUserId: userId,
      status: 'pending',
      user: {
        accountStatus: 'active',
        deletedAt: null,
      },
    };

    const [pending, total] = await Promise.all([
      prisma.userFriend.findMany({
        where: whereClause,
        include: { user: { select: USER_SELECT_EXTENDED } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userFriend.count({ where: whereClause }),
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

/**
 * GET /api/social/friends/ids
 * Get a flat array of all accepted friend IDs.
 *
 * Original Lambda: likerslaGetAllFriendsIds
 * - Recursively paginated through UserAcceptedFriend table
 * - Returns just the friendUserID array
 * - Used by feed lambdas to determine whose posts to show
 */
exports.getAllFriendIds = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Get all accepted friend records where I am initiator
    const friendsAsInitiator = await prisma.userFriend.findMany({
      where: { userId, status: 'accepted' },
      select: { friendUserId: true },
    });

    // Get all accepted friend records where I am receiver
    const friendsAsReceiver = await prisma.userFriend.findMany({
      where: { friendUserId: userId, status: 'accepted' },
      select: { userId: true },
    });

    const friendIds = new Set();
    friendsAsInitiator.forEach((f) => friendIds.add(f.friendUserId));
    friendsAsReceiver.forEach((f) => friendIds.add(f.userId));

    return success(res, Array.from(friendIds));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/social/friends/suggestions
 * Friend/follow suggestions.
 *
 * Original Lambda: likerslaFriendSuggetion mode=GET, type=FOLLOW
 * - Searches for users with totalGoldStars > 0 OR totalSilverStars > 0
 * - Excludes: blocked users (both directions), already following, already friends, admin-blocked, inactive/deleted
 * - Orders by totalFollowers DESC
 * - Limits to 20 results (configurable via FOLLOW_SUGGESTIONS_LIMIT env var)
 */
exports.getFriendSuggestions = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const suggestionsLimit = parseInt(process.env.FOLLOW_SUGGESTIONS_LIMIT) || 20;

    // Collect all user IDs to exclude
    const excludeIds = new Set([userId]);

    // Exclude users in any friend relationship (pending, accepted, rejected)
    const existingFriends = await prisma.userFriend.findMany({
      where: {
        OR: [{ userId }, { friendUserId: userId }],
      },
      select: { userId: true, friendUserId: true },
    });
    existingFriends.forEach((f) => {
      excludeIds.add(f.userId);
      excludeIds.add(f.friendUserId);
    });

    // Exclude users I am already following
    const existingFollowing = await prisma.userFollower.findMany({
      where: { followerId: userId },
      select: { userId: true },
    });
    existingFollowing.forEach((f) => excludeIds.add(f.userId));

    // Exclude blocked users (both directions)
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

    // Exclude admin-blocked users
    const adminBlocked = await prisma.adminBlockedUser.findMany({
      where: { unblockedAt: null },
      select: { userId: true },
    });
    adminBlocked.forEach((a) => excludeIds.add(a.userId));

    const suggestions = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        accountStatus: 'active',
        deletedAt: null,
        OR: [
          { totalGoldStars: { gt: 0 } },
          { totalSilverStars: { gt: 0 } },
        ],
      },
      select: {
        ...USER_SELECT_EXTENDED,
        totalLikes: true,
      },
      take: suggestionsLimit,
      orderBy: { totalFollowers: 'desc' },
    });

    return success(res, suggestions);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/social/friends/bulk-follow
 * Bulk follow multiple users from suggestions.
 *
 * Original Lambda: likerslaFriendSuggetion mode=CREATE, type=FOLLOW
 * - Takes a comma-separated list of followIDs (or an array)
 * - For each userId: calls the follow mutation (create UserFollower + increment counters)
 * - Returns overall success
 */
exports.bulkFollowSuggested = async (req, res, next) => {
  try {
    const followerId = req.user.sub;
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return error(res, 'userIds (array) is required', 400);
    }

    // Filter out self and validate all targets exist
    const validIds = [...new Set(userIds.filter((id) => id !== followerId))];

    if (validIds.length === 0) {
      return error(res, 'No valid user IDs to follow', 400);
    }

    // Get existing follows to avoid duplicates
    const existingFollows = await prisma.userFollower.findMany({
      where: {
        followerId,
        userId: { in: validIds },
      },
      select: { userId: true },
    });
    const alreadyFollowing = new Set(existingFollows.map((f) => f.userId));

    // Get blocked relationships to skip
    const blockedRelations = await prisma.blockedUser.findMany({
      where: {
        OR: [
          { userId: followerId, blockedId: { in: validIds } },
          { userId: { in: validIds }, blockedId: followerId },
        ],
      },
      select: { userId: true, blockedId: true },
    });
    const blockedIds = new Set();
    blockedRelations.forEach((b) => {
      blockedIds.add(b.userId === followerId ? b.blockedId : b.userId);
    });

    // Verify target users exist and are active
    const targetUsers = await prisma.user.findMany({
      where: {
        id: { in: validIds },
        accountStatus: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    const validTargetIds = targetUsers.map((u) => u.id);

    // Filter to only new, valid, unblocked follows
    const toFollow = validTargetIds.filter(
      (id) => !alreadyFollowing.has(id) && !blockedIds.has(id)
    );

    if (toFollow.length === 0) {
      return success(res, { followed: 0, message: 'No new users to follow' });
    }

    // Build transaction operations for all follows
    const transactionOps = [];
    for (const targetId of toFollow) {
      transactionOps.push(
        prisma.userFollower.create({
          data: { userId: targetId, followerId },
        })
      );
      transactionOps.push(
        prisma.user.update({
          where: { id: targetId },
          data: { totalFollowers: { increment: 1 } },
        })
      );
    }
    // Increment my totalFollowing by the total count
    transactionOps.push(
      prisma.user.update({
        where: { id: followerId },
        data: { totalFollowing: { increment: toFollow.length } },
      })
    );

    await prisma.$transaction(transactionOps);

    // Create follow notifications in bulk (non-blocking)
    try {
      await prisma.notification.createMany({
        data: toFollow.map((targetId) => ({
          ownerId: targetId,
          actionCreatorId: followerId,
          notificationType: 'follow',
          isSeen: false,
          isDetailsSeen: false,
        })),
      });
    } catch (_notifErr) {
      console.error('Failed to create bulk follow notifications:', _notifErr.message);
    }

    return success(res, {
      followed: toFollow.length,
      skipped: validIds.length - toFollow.length,
      message: `Successfully followed ${toFollow.length} user(s)`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/social/friends/search?q=
 * Search among accepted friends by firstName, lastName, or username.
 */
exports.searchFriends = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const query = req.query.q;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    if (!query || query.trim().length === 0) {
      return error(res, 'Search query (q) is required', 400);
    }

    const searchTerm = `%${query.trim()}%`;

    // Get all my friend IDs first
    const friendsAsInitiator = await prisma.userFriend.findMany({
      where: { userId, status: 'accepted' },
      select: { friendUserId: true },
    });
    const friendsAsReceiver = await prisma.userFriend.findMany({
      where: { friendUserId: userId, status: 'accepted' },
      select: { userId: true },
    });

    const friendIds = new Set();
    friendsAsInitiator.forEach((f) => friendIds.add(f.friendUserId));
    friendsAsReceiver.forEach((f) => friendIds.add(f.userId));

    const friendIdsArray = Array.from(friendIds);

    if (friendIdsArray.length === 0) {
      return paginated(res, [], 0, page, limit);
    }

    // Search friends by name/username using ILIKE
    const whereClause = {
      id: { in: friendIdsArray },
      accountStatus: 'active',
      deletedAt: null,
      OR: [
        { firstName: { contains: query.trim(), mode: 'insensitive' } },
        { lastName: { contains: query.trim(), mode: 'insensitive' } },
        { username: { contains: query.trim(), mode: 'insensitive' } },
      ],
    };

    const [friends, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: USER_SELECT_EXTENDED,
        skip,
        take: limit,
        orderBy: { firstName: 'asc' },
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    return paginated(res, friends, total, page, limit);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/social/status/:userId
 * Check combined relationship status between me and another user.
 *
 * Returns: { isFollowing, isFollowedBy, isFriend, isPendingSent, isPendingReceived, isBlocked, isBlockedBy }
 */
exports.checkRelationshipStatus = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { userId } = req.params;

    if (currentUserId === userId) {
      return success(res, {
        isFollowing: false,
        isFollowedBy: false,
        isFriend: false,
        isPendingSent: false,
        isPendingReceived: false,
        isBlocked: false,
        isBlockedBy: false,
      });
    }

    // Run all checks in parallel
    const [
      followingRecord,
      followedByRecord,
      friendRecordSent,
      friendRecordReceived,
      blockByMe,
      blockByThem,
    ] = await Promise.all([
      // Am I following them?
      prisma.userFollower.findUnique({
        where: { userId_followerId: { userId, followerId: currentUserId } },
      }),
      // Are they following me?
      prisma.userFollower.findUnique({
        where: { userId_followerId: { userId: currentUserId, followerId: userId } },
      }),
      // Friend record where I sent request
      prisma.userFriend.findUnique({
        where: { userId_friendUserId: { userId: currentUserId, friendUserId: userId } },
      }),
      // Friend record where they sent request
      prisma.userFriend.findUnique({
        where: { userId_friendUserId: { userId, friendUserId: currentUserId } },
      }),
      // Did I block them?
      prisma.blockedUser.findUnique({
        where: { userId_blockedId: { userId: currentUserId, blockedId: userId } },
      }),
      // Did they block me?
      prisma.blockedUser.findUnique({
        where: { userId_blockedId: { userId, blockedId: currentUserId } },
      }),
    ]);

    // Determine friendship status
    const isFriend =
      (friendRecordSent && friendRecordSent.status === 'accepted') ||
      (friendRecordReceived && friendRecordReceived.status === 'accepted');

    const isPendingSent =
      (friendRecordSent && friendRecordSent.status === 'pending') || false;

    const isPendingReceived =
      (friendRecordReceived && friendRecordReceived.status === 'pending') || false;

    return success(res, {
      isFollowing: !!followingRecord,
      isFollowedBy: !!followedByRecord,
      isFriend: !!isFriend,
      isPendingSent: !!isPendingSent,
      isPendingReceived: !!isPendingReceived,
      isBlocked: !!blockByMe,
      isBlockedBy: !!blockByThem,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// BLOCK
// ─────────────────────────────────────────────────

/**
 * POST /api/social/block
 * Block a user with CASCADE cleanup of all relationships.
 *
 * Original Lambda: likerslaBlockUnBlock mode=Block
 * THIS IS THE MOST COMPLEX OPERATION.
 *
 * Steps (all in one atomic transaction):
 * 1. Check target user exists
 * 2. Check not already blocked
 * 3. Check block limit (5000)
 * 4. Gather existing relationships:
 *    - Pending friend requests (UserFriend) in either direction
 *    - Accepted friend records (both directions)
 *    - Follower records in both directions (me->them, them->me)
 * 5. Build a single transaction that atomically:
 *    a. Creates the BlockedUser record
 *    b. Deletes any UserFriend records in both directions
 *    c. Deletes any UserFollower records in both directions
 *    d. Decrements totalFriends on BOTH users (for each accepted friend pair)
 *    e. Decrements totalFollowers/totalFollowing for each deleted follower record
 */
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

    // Validate blockType if provided
    const validBlockTypes = ['Message', 'Profile', 'Post', 'Article', 'Collaboration', 'Reply', 'Comment'];
    const resolvedBlockType = blockType && validBlockTypes.includes(blockType) ? blockType : 'Profile';

    // Check target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!targetUser) {
      return error(res, 'User not found', 404);
    }

    // Check if already blocked
    const existingBlock = await prisma.blockedUser.findUnique({
      where: { userId_blockedId: { userId, blockedId } },
    });
    if (existingBlock) {
      return error(res, 'User is already blocked', 409);
    }

    // Check block limit
    const blockCount = await prisma.blockedUser.count({ where: { userId } });
    if (blockCount >= MAX_BLOCKS) {
      return error(res, 'Block limit exceeded', 400);
    }

    // Gather all existing relationships to delete
    const [
      friendRecords,
      iFollowThem,
      theyFollowMe,
    ] = await Promise.all([
      // All friend records in both directions (pending, accepted, rejected)
      prisma.userFriend.findMany({
        where: {
          OR: [
            { userId, friendUserId: blockedId },
            { userId: blockedId, friendUserId: userId },
          ],
        },
      }),
      // Me following them
      prisma.userFollower.findUnique({
        where: { userId_followerId: { userId: blockedId, followerId: userId } },
      }),
      // Them following me
      prisma.userFollower.findUnique({
        where: { userId_followerId: { userId, followerId: blockedId } },
      }),
    ]);

    // Determine if there was an accepted friendship
    const hadAcceptedFriendship = friendRecords.some((f) => f.status === 'accepted');

    // Build the transaction operations
    const transactionOps = [];

    // 1. Create the block record
    transactionOps.push(
      prisma.blockedUser.create({
        data: {
          userId,
          blockedId,
          blockType: resolvedBlockType,
        },
      })
    );

    // 2. Delete ALL friend records in both directions (if any exist)
    if (friendRecords.length > 0) {
      transactionOps.push(
        prisma.userFriend.deleteMany({
          where: {
            OR: [
              { userId, friendUserId: blockedId },
              { userId: blockedId, friendUserId: userId },
            ],
          },
        })
      );
    }

    // 3. Decrement totalFriends on BOTH users if they were accepted friends
    if (hadAcceptedFriendship) {
      transactionOps.push(
        prisma.user.update({
          where: { id: userId },
          data: { totalFriends: { decrement: 1 } },
        })
      );
      transactionOps.push(
        prisma.user.update({
          where: { id: blockedId },
          data: { totalFriends: { decrement: 1 } },
        })
      );
    }

    // 4. Delete follower record: me following them
    if (iFollowThem) {
      transactionOps.push(
        prisma.userFollower.delete({
          where: { userId_followerId: { userId: blockedId, followerId: userId } },
        })
      );
      // Decrement their totalFollowers and my totalFollowing
      transactionOps.push(
        prisma.user.update({
          where: { id: blockedId },
          data: { totalFollowers: { decrement: 1 } },
        })
      );
      transactionOps.push(
        prisma.user.update({
          where: { id: userId },
          data: { totalFollowing: { decrement: 1 } },
        })
      );
    }

    // 5. Delete follower record: them following me
    if (theyFollowMe) {
      transactionOps.push(
        prisma.userFollower.delete({
          where: { userId_followerId: { userId, followerId: blockedId } },
        })
      );
      // Decrement my totalFollowers and their totalFollowing
      transactionOps.push(
        prisma.user.update({
          where: { id: userId },
          data: { totalFollowers: { decrement: 1 } },
        })
      );
      transactionOps.push(
        prisma.user.update({
          where: { id: blockedId },
          data: { totalFollowing: { decrement: 1 } },
        })
      );
    }

    // 6. Delete any notifications between the two users
    transactionOps.push(
      prisma.notification.deleteMany({
        where: {
          OR: [
            { ownerId: userId, actionCreatorId: blockedId },
            { ownerId: blockedId, actionCreatorId: userId },
          ],
        },
      })
    );

    // Execute everything atomically
    const results = await prisma.$transaction(transactionOps);
    const blockRecord = results[0]; // First operation is the block creation

    return success(res, {
      id: blockRecord.id,
      userId: blockRecord.userId,
      blockedId: blockRecord.blockedId,
      blockType: blockRecord.blockType,
      createdAt: blockRecord.createdAt,
      cascadeResults: {
        friendshipsRemoved: friendRecords.length > 0,
        wasAcceptedFriend: hadAcceptedFriendship,
        unfollowedThem: !!iFollowThem,
        theyUnfollowedMe: !!theyFollowMe,
      },
    }, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/social/block/:userId
 * Unblock a user.
 *
 * Original Lambda: likerslaBlockUnBlock mode=UnBlock
 * - Checks the block record exists
 * - Deletes it
 * - Does NOT restore previous relationships
 */
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

/**
 * GET /api/social/blocked
 * Get list of blocked users (paginated).
 *
 * Original Lambda: likerslaGetBlockList
 * - Returns users blocked by me with block info
 * - Includes user details for display
 */
exports.getBlockedUsers = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
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
