const { prisma, success, error, paginated } = require('shared');

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePhotoKey: true,
};

// Valid target types that map to Prisma models for totalLikes updates
const TARGET_TYPE_MAP = {
  Post: 'post',
  Comment: 'postComment',
  Reply: 'postCommentReply',
  Article: 'article',
  Story: 'story',
};

// Valid LikeTargetType enum values from schema
const VALID_TARGET_TYPES = ['Post', 'Comment', 'Reply', 'Article', 'Story', 'Collaboration'];

/**
 * Increment or decrement totalLikes on the target entity.
 * Returns the prisma update operation for use in a transaction.
 */
function getTargetLikeUpdate(targetType, targetId, increment) {
  const modelName = TARGET_TYPE_MAP[targetType];
  if (!modelName) return null;

  return prisma[modelName].update({
    where: { id: targetId },
    data: {
      totalLikes: increment ? { increment: 1 } : { decrement: 1 },
    },
  });
}

// ─────────────────────────────────────────────────
// LIKES
// ─────────────────────────────────────────────────

exports.createLike = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { targetType, targetId, likeType } = req.body;

    if (!targetType || !targetId) {
      return error(res, 'targetType and targetId are required', 400);
    }

    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return error(res, `Invalid targetType. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`, 400);
    }

    // Check if already liked
    const existing = await prisma.like.findUnique({
      where: {
        userId_targetType_targetId: { userId, targetType, targetId },
      },
    });
    if (existing) {
      return error(res, 'Already liked this content', 409);
    }

    // Build transaction operations
    const operations = [
      prisma.like.create({
        data: {
          userId,
          targetType,
          targetId,
          likeType: likeType || 'Like',
        },
      }),
    ];

    const targetUpdate = getTargetLikeUpdate(targetType, targetId, true);
    if (targetUpdate) {
      operations.push(targetUpdate);
    }

    const [like] = await prisma.$transaction(operations);

    return success(res, like, 201);
  } catch (err) {
    next(err);
  }
};

exports.removeLike = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { targetType, targetId } = req.params;

    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return error(res, `Invalid targetType. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`, 400);
    }

    const existing = await prisma.like.findUnique({
      where: {
        userId_targetType_targetId: { userId, targetType, targetId },
      },
    });
    if (!existing) {
      return error(res, 'Like not found', 404);
    }

    // Build transaction operations
    const operations = [
      prisma.like.delete({
        where: {
          userId_targetType_targetId: { userId, targetType, targetId },
        },
      }),
    ];

    const targetUpdate = getTargetLikeUpdate(targetType, targetId, false);
    if (targetUpdate) {
      operations.push(targetUpdate);
    }

    await prisma.$transaction(operations);

    return success(res, { message: 'Like removed successfully' });
  } catch (err) {
    next(err);
  }
};

exports.getLikes = async (req, res, next) => {
  try {
    const { targetType, targetId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return error(res, `Invalid targetType. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`, 400);
    }

    const where = { targetType, targetId };

    const [likes, total] = await Promise.all([
      prisma.like.findMany({
        where,
        include: { user: { select: USER_SELECT } },
        orderBy: { likeDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.like.count({ where }),
    ]);

    const data = likes.map((l) => ({
      id: l.id,
      likeType: l.likeType,
      likeDate: l.likeDate,
      user: l.user,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// RANKINGS
// ─────────────────────────────────────────────────

exports.getMyRankings = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const rankings = await prisma.userRank.findMany({
      where: { userId },
      orderBy: { rank: 'asc' },
    });

    return success(res, rankings);
  } catch (err) {
    next(err);
  }
};

exports.getRankingsByCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const where = {
      categoryId,
      status: 'active',
    };

    const [rankings, total] = await Promise.all([
      prisma.userRank.findMany({
        where,
        include: { user: { select: USER_SELECT } },
        orderBy: { rank: 'asc' },
        skip,
        take: limit,
      }),
      prisma.userRank.count({ where }),
    ]);

    const data = rankings.map((r) => ({
      id: r.id,
      rank: r.rank,
      rankPercent: r.rankPercent,
      totalLikes: r.totalLikes,
      badge: r.badge,
      user: r.user,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.getTopContributors = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const where = {
      status: 'active',
      wholeNetwork: true,
    };

    const [rankings, total] = await Promise.all([
      prisma.userRank.findMany({
        where,
        include: { user: { select: USER_SELECT } },
        orderBy: { totalLikes: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userRank.count({ where }),
    ]);

    // If no wholeNetwork ranks exist, fall back to top users by totalLikes
    if (total === 0) {
      const [users, userTotal] = await Promise.all([
        prisma.user.findMany({
          where: { accountStatus: 'active', deletedAt: null },
          select: {
            ...USER_SELECT,
            totalLikes: true,
          },
          orderBy: { totalLikes: 'desc' },
          skip,
          take: limit,
        }),
        prisma.user.count({
          where: { accountStatus: 'active', deletedAt: null, totalLikes: { gt: 0 } },
        }),
      ]);

      return paginated(res, users, userTotal, page, limit);
    }

    const data = rankings.map((r) => ({
      id: r.id,
      rank: r.rank,
      rankPercent: r.rankPercent,
      totalLikes: r.totalLikes,
      badge: r.badge,
      user: r.user,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};
