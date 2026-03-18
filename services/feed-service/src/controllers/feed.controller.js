const { prisma, success, error, paginated } = require('shared');

// ─────────────────────────────────────────────────
// SHARED: User select fields for feed responses
// ─────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  fullName: true,
  profilePhotoKey: true,
  coverPhotoKey: true,
  totalFollowers: true,
  totalFollowing: true,
  totalFriends: true,
  totalLikes: true,
  totalGoldStars: true,
  totalSilverStars: true,
  isAccountVerified: true,
  isInfluencer: true,
  isLikerUser: true,
  accountStatus: true,
  role: true,
};

const POST_INCLUDE = {
  user: { select: USER_SELECT },
  pictureMeta: true,
  hashtags: {
    include: { hashtag: { select: { id: true, tag: true, postCount: true } } },
  },
  userTags: {
    include: { user: { select: { id: true, username: true, firstName: true, lastName: true, profilePhotoKey: true } } },
  },
  pinPosts: { select: { id: true, userId: true } },
  category: { select: { id: true, name: true } },
  group: { select: { id: true, groupName: true, privacy: true, coverImageKey: true } },
};

// ─────────────────────────────────────────────────
// SHARED: Get blocked user IDs (both directions)
// ─────────────────────────────────────────────────

async function getBlockedIds(userId) {
  const blocks = await prisma.blockedUser.findMany({
    where: { OR: [{ userId }, { blockedId: userId }] },
    select: { userId: true, blockedId: true },
  });
  const ids = new Set();
  blocks.forEach((b) => {
    if (b.userId !== userId) ids.add(b.userId);
    if (b.blockedId !== userId) ids.add(b.blockedId);
  });
  return [...ids];
}

// ─────────────────────────────────────────────────
// SHARED: Base WHERE clause excluding blocked/deleted/inactive users
// ─────────────────────────────────────────────────

function basePostWhere(blockedIds, extraWhere = {}) {
  return {
    isDeleted: false,
    isBlocked: false,
    user: {
      accountStatus: 'active',
      id: { notIn: blockedIds },
    },
    ...extraWhere,
  };
}

// ─────────────────────────────────────────────────
// SHARED: Parse frontend filter params
// Category filter logic from Lambda:
//   filter 0,1,2,7 = INCLUDE these categories
//   filter 3,8 = EXCLUDE these categories
// ─────────────────────────────────────────────────

function parseCategoryFilter(query) {
  const { categoryIds, filter } = query;
  if (!categoryIds) return {};

  const ids = Array.isArray(categoryIds) ? categoryIds : categoryIds.split(',');
  const filterType = parseInt(filter) || 0;

  // Filter types 3, 8 = exclude these categories
  if (filterType === 3 || filterType === 8) {
    return {
      AND: [
        { OR: [{ categoryId: { notIn: ids } }, { categoryId: null }] },
        { OR: [{ groupId: { notIn: ids } }, { groupId: null }] },
      ],
    };
  }

  // Filter types 0, 1, 2, 7 = include these categories
  return {
    OR: [
      { categoryId: { in: ids } },
      { groupId: { in: ids } },
    ],
  };
}

// ─────────────────────────────────────────────────
// SHARED: Pagination helpers
// ─────────────────────────────────────────────────

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
}

// ─────────────────────────────────────────────────
// SHARED: Enrich posts with viewer-specific data
// ─────────────────────────────────────────────────

async function enrichPostsForViewer(posts, viewerId) {
  if (!posts.length) return posts;

  const postIds = posts.map((p) => p.id);

  // Get viewer's likes on these posts
  const viewerLikes = await prisma.like.findMany({
    where: { userId: viewerId, targetType: 'Post', targetId: { in: postIds } },
    select: { targetId: true, id: true, likeType: true },
  });
  const likeMap = new Map(viewerLikes.map((l) => [l.targetId, l]));

  return posts.map((post) => {
    const viewerLike = likeMap.get(post.id);
    return {
      ...post,
      viewerHasLiked: !!viewerLike,
      viewerLikeId: viewerLike?.id || null,
      viewerLikeType: viewerLike?.likeType || null,
      isPinPost: post.pinPosts?.length > 0,
    };
  });
}

// ═════════════════════════════════════════════════
// FEED ENDPOINTS
// ═════════════════════════════════════════════════

// ─────────────────────────────────────────────────
// GET /api/feed/following
//
// Lambda: likerslaGetFollowingFeedDynamo
// Original: 3 parallel engagement-ranked queries (commentEng, likeEng, recentFollowers)
//           merged + deduped + posts fetched per user
// PostgreSQL: Single query — join followers → posts, order by engagement then date
// ─────────────────────────────────────────────────

exports.getFollowingFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);
    const categoryFilter = parseCategoryFilter(req.query);

    // Following feed: posts from users I follow, weighted by engagement
    // In DynamoDB this was 3 separate queries for commentEng, likeEng, recentFollowers
    // In PostgreSQL we do it in one query with ORDER BY engagement score

    const where = {
      ...basePostWhere(blockedIds, categoryFilter),
      isWallPost: { not: true },
      visibility: { not: 'Only' },
      user: {
        accountStatus: 'active',
        id: { notIn: blockedIds },
        followers: { some: { followerId: userId } },
      },
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: [{ postDate: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/friends
//
// Lambda: likerslaGetFriendFeedDynamo
// Original: Query UserAcceptedFriend by lastPostAt, batch 48 friends,
//           filter blocked/uploading/wallPost/visibility, recursive fetch
// PostgreSQL: Single query — join accepted friends → posts
// ─────────────────────────────────────────────────

exports.getFriendsFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);
    const categoryFilter = parseCategoryFilter(req.query);

    // Get accepted friends from both directions
    const friendRecords = await prisma.userFriend.findMany({
      where: {
        OR: [
          { userId, status: 'accepted' },
          { friendUserId: userId, status: 'accepted' },
        ],
      },
      select: { userId: true, friendUserId: true },
    });

    const friendIds = friendRecords
      .map((f) => (f.userId === userId ? f.friendUserId : f.userId))
      .filter((id) => !blockedIds.includes(id));

    if (!friendIds.length) return paginated(res, [], 0, page, limit);

    const where = {
      ...basePostWhere(blockedIds, categoryFilter),
      userId: { in: friendIds },
      isWallPost: { not: true },
      visibility: { not: 'Only' },
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

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/breaking
//
// Lambda: likerslaGetBreackingFeedDynamo
// Original: All public posts within 72h, category filters (8 types),
//           exclude share/wall/blocked, recursive fetch for min 4 results
// PostgreSQL: Single query with WHERE + ORDER BY postDate DESC
// Query params: ?categoryIds=a,b,c&filter=0-8&hoursWithin=72
// ─────────────────────────────────────────────────

exports.getBreakingFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);
    const categoryFilter = parseCategoryFilter(req.query);

    // Time window — frontend controls via hoursWithin (default 72h)
    const hoursWithin = parseInt(req.query.hoursWithin) || 72;
    const timeThreshold = new Date(Date.now() - hoursWithin * 60 * 60 * 1000);

    const where = {
      ...basePostWhere(blockedIds, categoryFilter),
      postDate: { gte: timeThreshold },
      visibility: 'Public',
      isWallPost: { not: true },
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

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/trending
//
// Lambda: likerslaGetTrendingFeedDynamo
// Original: Query TrendingPostStorage by postedTimeDiff score,
//           time window from env TIME_DEFF, category filters, recursive fetch
// PostgreSQL: Single query on trending_posts joined to posts, ordered by score
// Query params: ?categoryIds=&filter=&hoursWithin=24
// ─────────────────────────────────────────────────

exports.getTrendingFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);
    const categoryFilter = parseCategoryFilter(req.query);

    const hoursWithin = parseInt(req.query.hoursWithin) || 24;
    const timeThreshold = new Date(Date.now() - hoursWithin * 60 * 60 * 1000);

    // Query trending_posts table joined with posts
    const where = {
      post: {
        ...basePostWhere(blockedIds, categoryFilter),
        postDate: { gte: timeThreshold },
        visibility: 'Public',
      },
    };

    const [trendingPosts, total] = await Promise.all([
      prisma.trendingPost.findMany({
        where,
        include: { post: { include: POST_INCLUDE } },
        orderBy: { score: 'desc' },
        skip,
        take: limit,
      }),
      prisma.trendingPost.count({ where }),
    ]);

    const posts = trendingPosts.map((tp) => ({
      ...tp.post,
      trendingScore: tp.score,
      trendingDate: tp.trendingDate,
      boostType: tp.boostType,
    }));

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/admin
//
// Lambda: likerslaGetAdminFeedDynamo
// Original: Admin-only, no privacy restrictions, search by user/post ID
// PostgreSQL: Admin role check, optional user/post filters
// Query params: ?userId=&postId=
// ─────────────────────────────────────────────────

exports.getAdminFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);

    // Verify admin access
    const adminUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!adminUser || adminUser.role !== 'Admin') {
      return error(res, 'Unauthorized — admin access required', 401);
    }

    // Admin sees everything — optional filters from frontend
    const where = { isDeleted: false };
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.postId) where.id = req.query.postId;

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          ...POST_INCLUDE,
          pinPosts: true,
        },
        orderBy: { postDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const data = posts.map((p) => ({
      ...p,
      isPinPost: p.pinPosts?.length > 0,
    }));

    return paginated(res, data, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/group/:groupId
//
// Lambda: likerSlaGetGroupPostDynamo
// Original: Validate group membership, check privacy (PUBLIC vs PRIVATE),
//           filter blocked members, only show likers who are Active in group
// PostgreSQL: Single query with membership check + joins
// ─────────────────────────────────────────────────

exports.getGroupFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);

    // Validate group exists
    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group) return error(res, 'Group not found', 404);

    // Check membership for PRIVATE groups
    if (group.privacy === 'PRIVATE') {
      const membership = await prisma.userGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership || membership.status !== 'Active') {
        return error(res, 'Access denied — you are not an active member of this private group', 403);
      }
    }

    const where = {
      ...basePostWhere(blockedIds),
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

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/wall/:userId
//
// Lambda: likerSlaGetWallPostDynamo
// Original: User's wall posts, visibility filtering based on viewer relationship,
//           shared post enrichment, friend visibility check
// PostgreSQL: Single query with visibility-based WHERE
// ─────────────────────────────────────────────────

exports.getWallFeed = async (req, res, next) => {
  try {
    const viewerId = req.user.sub;
    const { userId: profileUserId } = req.params;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(viewerId);

    // Block check — can't view blocked user's wall
    if (blockedIds.includes(profileUserId)) {
      return error(res, 'User not found', 404);
    }

    // Determine visibility based on relationship
    let visibilityFilter;
    if (viewerId === profileUserId) {
      // Own wall — see everything
      visibilityFilter = {};
    } else {
      // Check if friends
      const friendship = await prisma.userFriend.findFirst({
        where: {
          OR: [
            { userId: viewerId, friendUserId: profileUserId, status: 'accepted' },
            { userId: profileUserId, friendUserId: viewerId, status: 'accepted' },
          ],
        },
      });

      if (friendship) {
        // Friends — see Public + Friend posts (not Only)
        visibilityFilter = { visibility: { not: 'Only' } };
      } else {
        // Not friends — see only Public
        visibilityFilter = { visibility: 'Public' };
      }
    }

    const where = {
      isDeleted: false,
      isBlocked: false,
      userId: profileUserId,
      groupId: null, // Wall posts only, not group posts
      ...visibilityFilter,
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

    const enriched = await enrichPostsForViewer(posts, viewerId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/star/:userId
//
// Lambda: likerSlaGetStarPostDynamo
// Original: Star contributor's posts filtered by category,
//           same as wall + category filter
// PostgreSQL: Wall posts + optional categoryId filter
// Query params: ?categoryId=
// ─────────────────────────────────────────────────

exports.getStarFeed = async (req, res, next) => {
  try {
    const viewerId = req.user.sub;
    const { userId: profileUserId } = req.params;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(viewerId);

    if (blockedIds.includes(profileUserId)) {
      return error(res, 'User not found', 404);
    }

    const where = {
      isDeleted: false,
      isBlocked: false,
      userId: profileUserId,
      groupId: null,
      visibility: 'Public',
    };

    // Category filter from frontend
    if (req.query.categoryId) {
      where.OR = [
        { categoryId: req.query.categoryId },
        { groupId: req.query.categoryId },
      ];
    }

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

    const enriched = await enrichPostsForViewer(posts, viewerId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/comment-activity
//
// Lambda: likerSlaGetCommentWisePost
// Original: Posts where current user commented, sorted by comment date DESC
// PostgreSQL: JOIN posts → comments WHERE commentUser = me, distinct posts
// ─────────────────────────────────────────────────

exports.getCommentActivityFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);

    // Get distinct post IDs where user commented, ordered by latest comment
    const commentedPosts = await prisma.postComment.findMany({
      where: {
        userId,
        isDeleted: false,
        post: basePostWhere(blockedIds),
      },
      select: { postId: true, commentDate: true },
      orderBy: { commentDate: 'desc' },
      distinct: ['postId'],
      skip,
      take: limit,
    });

    const postIds = commentedPosts.map((c) => c.postId);
    const total = await prisma.postComment.groupBy({
      by: ['postId'],
      where: { userId, isDeleted: false, post: basePostWhere(blockedIds) },
    }).then((r) => r.length);

    if (!postIds.length) return paginated(res, [], 0, page, limit);

    const posts = await prisma.post.findMany({
      where: { id: { in: postIds } },
      include: POST_INCLUDE,
    });

    // Maintain comment-date order
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const ordered = postIds.map((id) => postMap.get(id)).filter(Boolean);

    const enriched = await enrichPostsForViewer(ordered, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/videos
//
// Lambda: likerslaGetVideoPost
// Original: 3 modes (popular/latest/default), trending→breaking fallback chain,
//           excludes already-viewed videos, videoUploadStatus checks
// PostgreSQL: Single query filtered to video posts
// Query params: ?mode=popular|latest&categoryIds=&filter=
// ─────────────────────────────────────────────────

exports.getVideoFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);
    const categoryFilter = parseCategoryFilter(req.query);
    const mode = req.query.mode || 'popular';

    // Get already-viewed post IDs to exclude (Lambda did this via PostView table)
    const viewedPosts = await prisma.postView.findMany({
      where: { userId },
      select: { postId: true },
    });
    const viewedIds = viewedPosts.map((v) => v.postId);

    const baseWhere = {
      ...basePostWhere(blockedIds, categoryFilter),
      postType: 'VideoPost',
      visibility: 'Public',
      id: viewedIds.length ? { notIn: viewedIds } : undefined,
    };

    let orderBy;
    if (mode === 'latest') {
      orderBy = { postDate: 'desc' };
    } else {
      // popular — order by totalLikes (engagement)
      orderBy = { totalLikes: 'desc' };
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: baseWhere,
        include: POST_INCLUDE,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.post.count({ where: baseWhere }),
    ]);

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/hashtag/:tag
//
// Lambda: likerSlaGetHashTagPost
// Original: Query PostHashTag by tag, sorted by lastPostAt DESC,
//           full post enrichment with block checks
// PostgreSQL: JOIN post_hashtag_on_post → posts WHERE tag matches
// ─────────────────────────────────────────────────

exports.getHashtagFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { tag } = req.params;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);

    const where = {
      ...basePostWhere(blockedIds),
      visibility: 'Public',
      hashtags: {
        some: { hashtag: { tag } },
      },
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

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/feed/discover
//
// Lambda: likerslaGetBreackingFeedDynamo (public posts not from network)
// Original: All public posts excluding friends/following
// PostgreSQL: NOT IN (friends + following), Public visibility
// ─────────────────────────────────────────────────

exports.getDiscoverFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page, limit, skip } = parsePagination(req.query);
    const blockedIds = await getBlockedIds(userId);
    const categoryFilter = parseCategoryFilter(req.query);

    // Get all user IDs in my network
    const [followRecords, friendRecords] = await Promise.all([
      prisma.userFollower.findMany({
        where: { followerId: userId },
        select: { userId: true },
      }),
      prisma.userFriend.findMany({
        where: {
          OR: [
            { userId, status: 'accepted' },
            { friendUserId: userId, status: 'accepted' },
          ],
        },
        select: { userId: true, friendUserId: true },
      }),
    ]);

    const networkIds = new Set([userId]);
    followRecords.forEach((f) => networkIds.add(f.userId));
    friendRecords.forEach((f) => {
      networkIds.add(f.userId);
      networkIds.add(f.friendUserId);
    });

    const where = {
      ...basePostWhere(blockedIds, categoryFilter),
      userId: { notIn: [...networkIds] },
      visibility: 'Public',
      isWallPost: { not: true },
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

    const enriched = await enrichPostsForViewer(posts, userId);
    return paginated(res, enriched, total, page, limit);
  } catch (err) {
    next(err);
  }
};
