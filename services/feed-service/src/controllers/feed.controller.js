const { prisma, success, error, paginated } = require('shared');

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePhotoKey: true,
};

const POST_INCLUDE = {
  user: { select: USER_SELECT },
  pictureMeta: true,
};

const POST_WHERE_BASE = {
  isDeleted: false,
};

// ─────────────────────────────────────────────────
// FOLLOWING FEED
// ─────────────────────────────────────────────────

exports.getFollowingFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get list of user IDs that the current user follows
    const followRecords = await prisma.userFollower.findMany({
      where: { followerId: userId },
      select: { userId: true },
    });

    const followedIds = followRecords.map((f) => f.userId);

    if (followedIds.length === 0) {
      return paginated(res, [], 0, page, limit);
    }

    const where = {
      ...POST_WHERE_BASE,
      userId: { in: followedIds },
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { postDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// FRIENDS FEED
// ─────────────────────────────────────────────────

exports.getFriendsFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get accepted friend IDs from both directions
    const friendRecords = await prisma.userFriend.findMany({
      where: {
        OR: [
          { userId, status: 'accepted' },
          { friendUserId: userId, status: 'accepted' },
        ],
      },
      select: { userId: true, friendUserId: true },
    });

    const friendIds = friendRecords.map((f) =>
      f.userId === userId ? f.friendUserId : f.userId
    );

    if (friendIds.length === 0) {
      return paginated(res, [], 0, page, limit);
    }

    const where = {
      ...POST_WHERE_BASE,
      userId: { in: friendIds },
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { postDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// TRENDING FEED
// ─────────────────────────────────────────────────

exports.getTrendingFeed = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get trending posts from the TrendingPost table, joined with Post
    const where = {
      post: { isDeleted: false },
    };

    const [trendingPosts, total] = await Promise.all([
      prisma.trendingPost.findMany({
        where,
        include: {
          post: {
            include: POST_INCLUDE,
          },
        },
        orderBy: { score: 'desc' },
        skip,
        take: limit,
      }),
      prisma.trendingPost.count({ where }),
    ]);

    // Flatten so client gets post data with trending score
    const data = trendingPosts.map((tp) => ({
      ...tp.post,
      trendingScore: tp.score,
      trendingDate: tp.trendingDate,
      boostType: tp.boostType,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// BREAKING FEED
// ─────────────────────────────────────────────────

exports.getBreakingFeed = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const where = {
      ...POST_WHERE_BASE,
      isBreaking: true,
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { postDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DISCOVER FEED
// ─────────────────────────────────────────────────

exports.getDiscoverFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get IDs of users the current user follows
    const followRecords = await prisma.userFollower.findMany({
      where: { followerId: userId },
      select: { userId: true },
    });
    const followedIds = followRecords.map((f) => f.userId);

    // Get IDs of friends
    const friendRecords = await prisma.userFriend.findMany({
      where: {
        OR: [
          { userId, status: 'accepted' },
          { friendUserId: userId, status: 'accepted' },
        ],
      },
      select: { userId: true, friendUserId: true },
    });
    const friendIds = friendRecords.map((f) =>
      f.userId === userId ? f.friendUserId : f.userId
    );

    // Combine all IDs to exclude (following + friends + self)
    const excludeIds = [...new Set([userId, ...followedIds, ...friendIds])];

    const where = {
      ...POST_WHERE_BASE,
      userId: { notIn: excludeIds },
      visibility: 'Public',
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { postDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GROUP FEED
// ─────────────────────────────────────────────────

exports.getGroupFeed = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Verify the group exists
    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      return error(res, 'Group not found', 404);
    }

    const where = {
      ...POST_WHERE_BASE,
      groupId,
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { postDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
};
