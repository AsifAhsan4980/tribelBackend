const { prisma, success, error, paginated } = require('shared');

// ─────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePhotoKey: true,
  totalGoldStars: true,
  totalSilverStars: true,
  isAccountVerified: true,
  accountStatus: true,
  totalLikes: true,
  totalFollowers: true,
  totalFollowing: true,
};

// Valid target types that map to Prisma models for totalLikes updates
const TARGET_TYPE_MAP = {
  Post: 'post',
  Comment: 'postComment',
  Reply: 'postCommentReply',
  Article: 'article',
  Story: 'story',
};

const VALID_TARGET_TYPES = ['Post', 'Comment', 'Reply', 'Article', 'Story', 'Collaboration'];
const VALID_LIKE_TYPES = ['Like', 'Love'];

// Notification type mapping based on target type
const LIKE_NOTIFICATION_MAP = {
  Post: 'post_like',
  Comment: 'comment_like',
  Reply: 'comment_like',
  Article: 'article_like',
  Story: 'story_like',
};

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

/**
 * Get the owner of a target entity (post, comment, reply, etc.)
 * Returns the userId of the owner, or null if not found.
 */
async function getTargetOwner(targetType, targetId) {
  try {
    switch (targetType) {
      case 'Post': {
        const post = await prisma.post.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        return post?.userId || null;
      }
      case 'Comment': {
        const comment = await prisma.postComment.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        return comment?.userId || null;
      }
      case 'Reply': {
        const reply = await prisma.postCommentReply.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        return reply?.userId || null;
      }
      case 'Article': {
        const article = await prisma.article.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        return article?.userId || null;
      }
      case 'Story': {
        const story = await prisma.story.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        return story?.userId || null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Get the postId associated with a target (for notification context).
 */
async function getTargetPostId(targetType, targetId) {
  try {
    switch (targetType) {
      case 'Post':
        return targetId;
      case 'Comment': {
        const c = await prisma.postComment.findUnique({
          where: { id: targetId },
          select: { postId: true },
        });
        return c?.postId || null;
      }
      case 'Reply': {
        const r = await prisma.postCommentReply.findUnique({
          where: { id: targetId },
          select: { postId: true, commentId: true },
        });
        return r?.postId || null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Create a notification (fire-and-forget).
 */
async function createNotification({ ownerId, actionCreatorId, notificationType, postId, commentId, replyId, articleId, storyId }) {
  if (actionCreatorId === ownerId) return;

  try {
    await prisma.notification.create({
      data: {
        ownerId,
        actionCreatorId,
        notificationType,
        postId: postId || null,
        commentId: commentId || null,
        replyId: replyId || null,
        articleId: articleId || null,
        storyId: storyId || null,
        notificationDate: new Date(),
      },
    });
  } catch (err) {
    console.error('Notification creation failed:', err.message);
  }
}

// ─────────────────────────────────────────────────
// ADD LIKE
// From: likerslaAddLikes (LIKE mode, ~1490 lines)
// ─────────────────────────────────────────────────

exports.addLike = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { targetType, targetId, likeType } = req.body;

    // -- Validate inputs --
    if (!targetType || !targetId) {
      return error(res, 'targetType and targetId are required', 400);
    }

    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return error(res, `Invalid targetType. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`, 400);
    }

    const resolvedLikeType = VALID_LIKE_TYPES.includes(likeType) ? likeType : 'Like';

    // -- Prevent self-likes --
    const targetOwnerId = await getTargetOwner(targetType, targetId);
    if (!targetOwnerId) {
      return error(res, 'Target not found', 404);
    }

    if (targetOwnerId === userId) {
      return error(res, 'Cannot like your own content', 400);
    }

    // -- Check for duplicate likes --
    const existing = await prisma.like.findUnique({
      where: {
        userId_targetType_targetId: { userId, targetType, targetId },
      },
    });

    if (existing) {
      return error(res, 'Already liked this content', 409);
    }

    // -- Build transaction operations --
    const operations = [];

    // 1. Create Like record
    operations.push(
      prisma.like.create({
        data: {
          userId,
          targetType,
          targetId,
          likeType: resolvedLikeType,
          likeDate: new Date(),
        },
      })
    );

    // 2. Increment totalLikes on the target entity
    const modelName = TARGET_TYPE_MAP[targetType];
    if (modelName) {
      operations.push(
        prisma[modelName].update({
          where: { id: targetId },
          data: { totalLikes: { increment: 1 } },
        })
      );
    }

    // 3. If targetType=Post: also increment the post author's user.totalLikes
    if (targetType === 'Post') {
      operations.push(
        prisma.user.update({
          where: { id: targetOwnerId },
          data: { totalLikes: { increment: 1 } },
        })
      );
    }

    // 4. If targetType=Comment or Reply: increment target author's user.totalLikes
    if (targetType === 'Comment' || targetType === 'Reply') {
      operations.push(
        prisma.user.update({
          where: { id: targetOwnerId },
          data: { totalLikes: { increment: 1 } },
        })
      );
    }

    // Execute transaction
    const results = await prisma.$transaction(operations);
    const like = results[0];

    // 5. Update engagement score: increment likeEng on UserFollower if liker follows the target owner
    // (fire-and-forget, non-blocking)
    prisma.userFollower
      .updateMany({
        where: {
          userId: targetOwnerId,
          followerId: userId,
        },
        data: { likeEng: { increment: 1 } },
      })
      .catch((err) => console.error('likeEng update failed:', err.message));

    // 6. Create notification based on targetType
    const notificationType = LIKE_NOTIFICATION_MAP[targetType];
    if (notificationType) {
      const postId = await getTargetPostId(targetType, targetId);

      createNotification({
        ownerId: targetOwnerId,
        actionCreatorId: userId,
        notificationType,
        postId: targetType === 'Post' ? targetId : postId,
        commentId: targetType === 'Comment' ? targetId : null,
        replyId: targetType === 'Reply' ? targetId : null,
        articleId: targetType === 'Article' ? targetId : null,
        storyId: targetType === 'Story' ? targetId : null,
      });
    }

    // -- Fetch user info to return in response --
    const likeUser = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });

    return success(
      res,
      {
        id: like.id,
        userId: like.userId,
        targetType: like.targetType,
        targetId: like.targetId,
        likeType: like.likeType,
        likeDate: like.likeDate,
        likeUser,
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// REMOVE LIKE (UNLIKE)
// From: likerslaAddLikes (UNLIKE mode)
// ─────────────────────────────────────────────────

exports.removeLike = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { targetType, targetId } = req.params;

    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return error(res, `Invalid targetType. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`, 400);
    }

    // -- Find existing like --
    const existing = await prisma.like.findUnique({
      where: {
        userId_targetType_targetId: { userId, targetType, targetId },
      },
    });

    if (!existing) {
      return error(res, 'Like not found', 404);
    }

    // -- Get target owner for counter decrements --
    const targetOwnerId = await getTargetOwner(targetType, targetId);

    // -- Build transaction operations --
    const operations = [];

    // 1. Delete the Like record
    operations.push(
      prisma.like.delete({
        where: {
          userId_targetType_targetId: { userId, targetType, targetId },
        },
      })
    );

    // 2. Decrement totalLikes on the target entity
    const modelName = TARGET_TYPE_MAP[targetType];
    if (modelName) {
      operations.push(
        prisma[modelName].update({
          where: { id: targetId },
          data: { totalLikes: { decrement: 1 } },
        })
      );
    }

    // 3. If Post: decrement post author's user.totalLikes
    if (targetType === 'Post' && targetOwnerId) {
      operations.push(
        prisma.user.update({
          where: { id: targetOwnerId },
          data: { totalLikes: { decrement: 1 } },
        })
      );
    }

    // 4. If Comment or Reply: decrement target author's user.totalLikes
    if ((targetType === 'Comment' || targetType === 'Reply') && targetOwnerId) {
      operations.push(
        prisma.user.update({
          where: { id: targetOwnerId },
          data: { totalLikes: { decrement: 1 } },
        })
      );
    }

    await prisma.$transaction(operations);

    // 5. Decrement likeEng (fire-and-forget)
    if (targetOwnerId) {
      prisma.userFollower
        .updateMany({
          where: {
            userId: targetOwnerId,
            followerId: userId,
          },
          data: { likeEng: { decrement: 1 } },
        })
        .catch((err) => console.error('likeEng decrement failed:', err.message));
    }

    // No notification on unlike

    return success(res, { message: 'Like removed successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET LIKE USERS (paginated)
// ─────────────────────────────────────────────────

exports.getLikeUsers = async (req, res, next) => {
  try {
    const userId = req.user.sub;
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
        include: {
          user: { select: USER_SELECT },
        },
        orderBy: { likeDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.like.count({ where }),
    ]);

    // -- Get blocked IDs to filter --
    const [blockedByMe, blockedMe] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { userId },
        select: { blockedId: true },
      }),
      prisma.blockedUser.findMany({
        where: { blockedId: userId },
        select: { userId: true },
      }),
    ]);
    const blockedIds = new Set([
      ...blockedByMe.map((b) => b.blockedId),
      ...blockedMe.map((b) => b.userId),
    ]);

    // -- Check if viewer follows each like user --
    const likeUserIds = likes.map((l) => l.userId).filter((id) => !blockedIds.has(id));
    const myFollowing =
      likeUserIds.length > 0
        ? await prisma.userFollower.findMany({
            where: {
              followerId: userId,
              userId: { in: likeUserIds },
            },
            select: { userId: true },
          })
        : [];
    const followingSet = new Set(myFollowing.map((f) => f.userId));

    // Filter out blocked/inactive users and enrich
    const data = likes
      .filter((l) => !blockedIds.has(l.userId))
      .filter((l) => l.user && l.user.accountStatus === 'active')
      .map((l) => ({
        id: l.id,
        likeType: l.likeType,
        likeDate: l.likeDate,
        user: l.user,
        isFollowing: followingSet.has(l.userId),
      }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// ADD VIEW (authenticated user)
// From: likerslaAddViewCount (VIEW mode)
// ─────────────────────────────────────────────────

exports.addView = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.body;

    if (!postId) {
      return error(res, 'postId is required', 400);
    }

    // -- Verify post exists --
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      return error(res, 'Post not found', 404);
    }

    // -- Check if user already viewed this post (ever) --
    const existingView = await prisma.postView.findFirst({
      where: {
        postId,
        userId,
      },
    });

    if (existingView) {
      // Already viewed - idempotent success, still increment view count
      await prisma.post.update({
        where: { id: postId },
        data: { totalViews: { increment: 1 } },
      });
      return success(res, { message: 'View count incremented', alreadyViewed: true });
    }

    // -- First view: create PostView record + increment counter --
    await prisma.$transaction([
      prisma.postView.create({
        data: {
          postId,
          userId,
        },
      }),
      prisma.post.update({
        where: { id: postId },
        data: { totalViews: { increment: 1 } },
      }),
    ]);

    return success(res, { message: 'View recorded', alreadyViewed: false });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// ADD GUEST VIEW (no auth required for this logic, but route is public)
// From: likerslaAddViewCount (VIEW_BEFORE_LOGIN mode)
// ─────────────────────────────────────────────────

exports.addGuestView = async (req, res, next) => {
  try {
    const { postId } = req.body;

    if (!postId) {
      return error(res, 'postId is required', 400);
    }

    // -- Verify post exists --
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      return error(res, 'Post not found', 404);
    }

    // -- Just increment view count, no PostView record --
    await prisma.post.update({
      where: { id: postId },
      data: { totalViews: { increment: 1 } },
    });

    return success(res, { message: 'Guest view count incremented' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// CALCULATE TRENDING (CRON/ADMIN)
// From: LikerSlaInsertTrending
// ─────────────────────────────────────────────────

exports.calculateTrending = async (req, res, next) => {
  try {
    const hoursWindow = parseInt(req.body.hoursWindow) || 24;
    const minLikes = parseInt(req.body.minLikes) || 1;
    const fromDate = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // -- Get boost configurations --
    // BoostCategory and BoostPostType are from the original DynamoDB.
    // In PostgreSQL these could be config tables; for now we use hardcoded defaults
    // that match the original Lambda logic.
    const POST_TYPE_BOOSTS = {
      VideoPost: 0.50,   // 50% boost for video posts
      LinkPost: 0.20,    // 20% boost for link posts
      MemePost: 0.20,    // 20% boost for meme posts
    };

    // -- Query qualifying posts --
    const posts = await prisma.post.findMany({
      where: {
        createdAt: { gte: fromDate },
        visibility: 'Public',
        isDeleted: false,
        totalLikes: { gte: minLikes },
        // Exclude: share posts (no sharePostMetaId equivalent), wall posts, pin posts
        // In our schema these are handled by postType and flags
        isReported: false,
      },
      select: {
        id: true,
        userId: true,
        postType: true,
        categoryId: true,
        groupId: true,
        totalLikes: true,
        createdAt: true,
      },
    });

    // -- Calculate trending score for each post --
    const trendingData = [];

    for (const post of posts) {
      let baseLikes = post.totalLikes;

      // Apply post type boost
      const typeBoost = POST_TYPE_BOOSTS[post.postType];
      if (typeBoost) {
        baseLikes = baseLikes + baseLikes * typeBoost;
      }

      // Time decay: divide by minutes since creation
      // Original formula: score = baseLikes / ((createdAt - now) / 1000 / 60)
      // Note: createdAt is in the past, so (now - createdAt) gives positive minutes
      const minutesSinceCreation = (Date.now() - new Date(post.createdAt).getTime()) / 1000 / 60;

      // Avoid division by zero
      const score = minutesSinceCreation > 0 ? baseLikes / minutesSinceCreation : baseLikes;

      trendingData.push({
        postId: post.id,
        categoryId: post.categoryId || null,
        score,
        boostType: post.postType,
        trendingDate: today,
      });
    }

    // -- Sort by score descending --
    trendingData.sort((a, b) => b.score - a.score);

    // -- Delete old trending entries outside the time window --
    await prisma.trendingPost.deleteMany({
      where: {
        createdAt: { lt: fromDate },
      },
    });

    // -- Upsert trending posts --
    let upsertCount = 0;
    for (const item of trendingData) {
      await prisma.trendingPost.upsert({
        where: {
          postId_trendingDate: {
            postId: item.postId,
            trendingDate: item.trendingDate,
          },
        },
        update: {
          score: item.score,
          boostType: item.boostType,
          categoryId: item.categoryId,
        },
        create: {
          postId: item.postId,
          categoryId: item.categoryId,
          score: item.score,
          boostType: item.boostType,
          trendingDate: item.trendingDate,
        },
      });
      upsertCount++;
    }

    return success(res, {
      message: 'Trending calculation complete',
      postsEvaluated: posts.length,
      trendingUpserted: upsertCount,
      windowHours: hoursWindow,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// CLEANUP TRENDING (CRON/ADMIN)
// ─────────────────────────────────────────────────

exports.cleanupTrending = async (req, res, next) => {
  try {
    const hoursWindow = parseInt(req.body.hoursWindow) || 48;
    const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);

    const result = await prisma.trendingPost.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });

    return success(res, {
      message: 'Trending cleanup complete',
      deletedCount: result.count,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// CALCULATE RANKINGS (CRON/ADMIN)
// From: likerslaStarContributorDynamo (whole_network mode)
// ─────────────────────────────────────────────────

exports.calculateRankings = async (req, res, next) => {
  try {
    // -- Step 1: Get all active users ordered by totalLikes DESC --
    const users = await prisma.user.findMany({
      where: {
        accountStatus: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        totalLikes: true,
      },
      orderBy: { totalLikes: 'desc' },
    });

    if (users.length === 0) {
      return success(res, { message: 'No active users found', processed: 0 });
    }

    // -- Step 2: Assign ranks (same likes = same rank, otherwise increment) --
    let previousLikes = null;
    let rank = 0;
    const rankedUsers = [];

    for (let i = 0; i < users.length; i++) {
      const currentLikes = users[i].totalLikes;

      if (previousLikes === null) {
        rank = 1;
      } else if (previousLikes !== currentLikes) {
        rank = rank + 1;
      }
      // If same likes, rank stays the same

      previousLikes = currentLikes;
      rankedUsers.push({
        userId: users[i].id,
        totalLikes: currentLikes,
        rank,
      });
    }

    // -- Step 3: Calculate rankPercent and badge --
    const totalUsers = Math.max(users.length, 100); // Min denominator of 100 (as per original)

    const goldUsers = [];
    const silverUsers = [];

    for (const user of rankedUsers) {
      const rankPercent = Math.ceil((user.rank / totalUsers) * 100);
      let badge = '0'; // No badge
      let badgeValue = 0;

      if (rankPercent >= 1 && rankPercent <= 5) {
        badge = '1'; // Gold
        badgeValue = 1;
      } else if (rankPercent > 5 && rankPercent <= 10) {
        badge = '5'; // Silver
        badgeValue = 5;
      }

      user.rankPercent = rankPercent;
      user.badge = badge;
      user.badgeValue = badgeValue;

      if (badgeValue === 1) goldUsers.push(user.userId);
      if (badgeValue === 5) silverUsers.push(user.userId);
    }

    // -- Step 4: Upsert UserRank records (whole network) --
    let upsertCount = 0;

    // Process in batches to avoid overwhelming the DB
    const BATCH_SIZE = 50;
    for (let i = 0; i < rankedUsers.length; i += BATCH_SIZE) {
      const batch = rankedUsers.slice(i, i + BATCH_SIZE);

      const operations = batch.map((user) => {
        return prisma.userRank.upsert({
          where: {
            // We need a unique identifier. Search for existing wholeNetwork rank for this user.
            id: `wn_${user.userId}`,
          },
          update: {
            totalLikes: user.totalLikes,
            rank: user.rank,
            rankPercent: user.rankPercent,
            badge: user.badge,
            status: 'active',
          },
          create: {
            id: `wn_${user.userId}`,
            userId: user.userId,
            totalLikes: user.totalLikes,
            rank: user.rank,
            rankPercent: user.rankPercent,
            badge: user.badge,
            wholeNetwork: true,
            status: 'active',
          },
        });
      });

      await prisma.$transaction(operations);
      upsertCount += batch.length;
    }

    // -- Step 5: Count gold/silver badges per user and update user table --
    // Count how many gold stars each user has across all categories + whole network
    const goldCounts = await prisma.userRank.groupBy({
      by: ['userId'],
      where: { badge: '1', status: 'active' },
      _count: { id: true },
    });

    const silverCounts = await prisma.userRank.groupBy({
      by: ['userId'],
      where: { badge: '5', status: 'active' },
      _count: { id: true },
    });

    // Update gold star counts
    for (const gc of goldCounts) {
      await prisma.user.update({
        where: { id: gc.userId },
        data: { totalGoldStars: gc._count.id },
      }).catch(() => {});
    }

    // Update silver star counts
    for (const sc of silverCounts) {
      await prisma.user.update({
        where: { id: sc.userId },
        data: { totalSilverStars: sc._count.id },
      }).catch(() => {});
    }

    // Reset stars for users with no badges
    const usersWithBadges = new Set([
      ...goldCounts.map((g) => g.userId),
      ...silverCounts.map((s) => s.userId),
    ]);

    // Only reset users who had badges before but no longer do
    // This is done selectively to avoid updating all users
    const usersToReset = rankedUsers
      .filter((u) => !usersWithBadges.has(u.userId) && u.badgeValue === 0)
      .map((u) => u.userId);

    if (usersToReset.length > 0) {
      await prisma.user.updateMany({
        where: {
          id: { in: usersToReset },
          OR: [
            { totalGoldStars: { gt: 0 } },
            { totalSilverStars: { gt: 0 } },
          ],
        },
        data: {
          totalGoldStars: 0,
          totalSilverStars: 0,
        },
      });
    }

    return success(res, {
      message: 'Rankings calculation complete',
      totalUsersRanked: upsertCount,
      goldBadges: goldUsers.length,
      silverBadges: silverUsers.length,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET MY RANKINGS
// From: likerSlaGetStarCategory
// ─────────────────────────────────────────────────

exports.getMyRankings = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Get all UserRank records for the current user where rankPercent <= 10 (top 10%)
    const rankings = await prisma.userRank.findMany({
      where: {
        userId,
        rankPercent: { lte: 10 },
        status: 'active',
      },
      orderBy: { rank: 'asc' },
    });

    // Enrich with category/group names
    const enriched = await Promise.all(
      rankings.map(async (r) => {
        let categoryName = null;
        let groupName = null;

        if (r.categoryId) {
          const cat = await prisma.postCategory.findUnique({
            where: { id: r.categoryId },
            select: { name: true },
          });
          categoryName = cat?.name || null;
        }

        if (r.groupId) {
          const group = await prisma.userGroup.findUnique({
            where: { id: r.groupId },
            select: { groupName: true },
          });
          groupName = group?.groupName || null;
        }

        return {
          id: r.id,
          rank: r.rank,
          rankPercent: r.rankPercent,
          totalLikes: r.totalLikes,
          badge: r.badge,
          wholeNetwork: r.wholeNetwork,
          categoryId: r.categoryId,
          categoryName,
          groupId: r.groupId,
          groupName,
        };
      })
    );

    return success(res, enriched);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET RANKINGS BY CATEGORY
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// GET TOP CONTRIBUTORS (top 30% globally)
// From: likerSlaGetPopularStarContributorList
// ─────────────────────────────────────────────────

exports.getTopContributors = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // -- Get blocked IDs --
    const [blockedByMe, blockedMe] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { userId },
        select: { blockedId: true },
      }),
      prisma.blockedUser.findMany({
        where: { blockedId: userId },
        select: { userId: true },
      }),
    ]);
    const blockedIds = [
      ...blockedByMe.map((b) => b.blockedId),
      ...blockedMe.map((b) => b.userId),
    ];

    const where = {
      wholeNetwork: true,
      rankPercent: { lte: 30 },
      status: 'active',
      userId: blockedIds.length > 0 ? { notIn: blockedIds } : undefined,
    };

    const [rankings, total] = await Promise.all([
      prisma.userRank.findMany({
        where,
        include: {
          user: { select: USER_SELECT },
        },
        orderBy: { rank: 'asc' },
        skip,
        take: limit,
      }),
      prisma.userRank.count({ where }),
    ]);

    // If no wholeNetwork ranks exist, fall back to top users by totalLikes
    if (total === 0) {
      const fallbackWhere = {
        accountStatus: 'active',
        deletedAt: null,
        totalLikes: { gt: 0 },
        id: blockedIds.length > 0 ? { notIn: blockedIds } : undefined,
      };

      const [users, userTotal] = await Promise.all([
        prisma.user.findMany({
          where: fallbackWhere,
          select: {
            ...USER_SELECT,
          },
          orderBy: { totalLikes: 'desc' },
          skip,
          take: limit,
        }),
        prisma.user.count({ where: fallbackWhere }),
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

// ─────────────────────────────────────────────────
// GET STAR CONTRIBUTORS TO FOLLOW (max 4 suggestions)
// From: likerSlaGetStarContributorToFollow
// ─────────────────────────────────────────────────

exports.getStarContributorsToFollow = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // -- Get users I already follow --
    const myFollowing = await prisma.userFollower.findMany({
      where: { followerId: userId },
      select: { userId: true },
    });
    const followingIds = myFollowing.map((f) => f.userId);

    // -- Get blocked IDs --
    const [blockedByMe, blockedMe] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { userId },
        select: { blockedId: true },
      }),
      prisma.blockedUser.findMany({
        where: { blockedId: userId },
        select: { userId: true },
      }),
    ]);
    const blockedIds = [
      ...blockedByMe.map((b) => b.blockedId),
      ...blockedMe.map((b) => b.userId),
    ];

    // IDs to exclude: self + already following + blocked
    const excludeIds = [userId, ...followingIds, ...blockedIds];

    // -- Get top contributors with badge > 0 that I don't follow --
    const suggestions = await prisma.userRank.findMany({
      where: {
        wholeNetwork: true,
        badge: { in: ['1', '5'] }, // Gold or Silver
        status: 'active',
        userId: { notIn: excludeIds },
        user: {
          accountStatus: 'active',
          deletedAt: null,
        },
      },
      include: {
        user: { select: USER_SELECT },
      },
      orderBy: { rank: 'asc' },
      take: 4,
    });

    const data = suggestions.map((s) => ({
      id: s.id,
      rank: s.rank,
      rankPercent: s.rankPercent,
      totalLikes: s.totalLikes,
      badge: s.badge,
      user: s.user,
    }));

    return success(res, data);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET TOP COMMENTERS
// ─────────────────────────────────────────────────

exports.getTopCommenters = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // -- Get blocked IDs --
    const [blockedByMe, blockedMe] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { userId },
        select: { blockedId: true },
      }),
      prisma.blockedUser.findMany({
        where: { blockedId: userId },
        select: { userId: true },
      }),
    ]);
    const blockedIds = [
      ...blockedByMe.map((b) => b.blockedId),
      ...blockedMe.map((b) => b.userId),
    ];

    // Count comments per user (non-deleted), ordered by count DESC
    const commentCounts = await prisma.postComment.groupBy({
      by: ['userId'],
      where: {
        isDeleted: false,
        userId: blockedIds.length > 0 ? { notIn: blockedIds } : undefined,
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      skip,
      take: limit,
    });

    // Get total distinct commenters for pagination
    const totalResult = await prisma.postComment.groupBy({
      by: ['userId'],
      where: {
        isDeleted: false,
        userId: blockedIds.length > 0 ? { notIn: blockedIds } : undefined,
      },
    });
    const total = totalResult.length;

    // Fetch user info for each commenter
    const userIds = commentCounts.map((c) => c.userId);
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: {
              id: { in: userIds },
              accountStatus: 'active',
            },
            select: USER_SELECT,
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = commentCounts
      .filter((c) => userMap.has(c.userId))
      .map((c) => ({
        userId: c.userId,
        commentCount: c._count.id,
        user: userMap.get(c.userId),
      }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};
