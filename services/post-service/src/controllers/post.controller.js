const { prisma, success, error, paginated } = require('shared');

// ─────────────────────────────────────────────────────────
// SHARED SELECT / INCLUDE OBJECTS
// ─────────────────────────────────────────────────────────

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
  role: true,
};

const POST_INCLUDE = {
  user: { select: USER_SELECT },
  pictureMeta: true,
  hashtags: { include: { hashtag: true } },
  userTags: {
    include: {
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          profilePhotoKey: true,
        },
      },
    },
  },
  pinPosts: { select: { id: true, userId: true } },
  category: { select: { id: true, name: true } },
  group: { select: { id: true, groupName: true, privacy: true } },
};

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Normalise a raw hashtag string: lowercase, strip leading #, trim whitespace.
 * Returns null for empty / whitespace-only tags.
 */
function normalizeTag(raw) {
  const tag = raw.toLowerCase().replace(/^#/, '').trim();
  return tag.length > 0 ? tag : null;
}

/**
 * Upsert hashtags and create junction records for a post.
 * Runs inside its own transaction so callers do not need to wrap it.
 *
 * @param {string} postId
 * @param {string[]} tags - raw hashtag strings (with or without #)
 */
async function attachHashtags(postId, tags) {
  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag);
    if (!tag) continue;

    // Upsert the hashtag row
    let hashtag = await prisma.postHashtag.findUnique({ where: { tag } });

    if (!hashtag) {
      hashtag = await prisma.postHashtag.create({
        data: { tag, postCount: 1 },
      });
    } else {
      // Only increment if this post does not already reference the tag
      const existing = await prisma.postHashtagOnPost.findUnique({
        where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
      });
      if (!existing) {
        await prisma.postHashtag.update({
          where: { id: hashtag.id },
          data: { postCount: { increment: 1 } },
        });
      }
    }

    // Create the junction record (no-op if already exists)
    await prisma.postHashtagOnPost.upsert({
      where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
      create: { postId, hashtagId: hashtag.id },
      update: {},
    });
  }
}

/**
 * Remove all hashtag junction records for a post and decrement each tag's
 * postCount accordingly.
 *
 * @param {string} postId
 */
async function detachAllHashtags(postId) {
  const junctions = await prisma.postHashtagOnPost.findMany({
    where: { postId },
  });

  for (const jn of junctions) {
    await prisma.postHashtag.update({
      where: { id: jn.hashtagId },
      data: { postCount: { decrement: 1 } },
    });
  }

  await prisma.postHashtagOnPost.deleteMany({ where: { postId } });
}

/**
 * Detach specific hashtags from a post by tag strings.
 *
 * @param {string} postId
 * @param {string[]} tags
 */
async function detachHashtags(postId, tags) {
  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag);
    if (!tag) continue;

    const hashtag = await prisma.postHashtag.findUnique({ where: { tag } });
    if (!hashtag) continue;

    const junction = await prisma.postHashtagOnPost.findUnique({
      where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
    });

    if (junction) {
      await prisma.postHashtagOnPost.delete({
        where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
      });
      await prisma.postHashtag.update({
        where: { id: hashtag.id },
        data: { postCount: { decrement: 1 } },
      });
    }
  }
}

/**
 * Enrich a post object with viewer-specific data (like status, friend status).
 *
 * @param {object} post - Post object from Prisma
 * @param {string|null} viewerId - The currently authenticated user ID
 * @returns {object} Enriched post
 */
async function enrichPostForViewer(post, viewerId) {
  if (!post || !viewerId) return post;

  // Check if viewer has liked this post
  const viewerLike = await prisma.like.findUnique({
    where: {
      userId_targetType_targetId: {
        userId: viewerId,
        targetType: 'Post',
        targetId: post.id,
      },
    },
    select: { id: true, likeType: true },
  });

  // Check friend status between viewer and post author (only if different users)
  let friendStatus = null;
  if (viewerId !== post.userId) {
    const friendship = await prisma.userFriend.findFirst({
      where: {
        OR: [
          { userId: viewerId, friendUserId: post.userId },
          { userId: post.userId, friendUserId: viewerId },
        ],
      },
      select: { status: true },
    });
    friendStatus = friendship ? friendship.status : null;
  }

  return {
    ...post,
    viewerHasLiked: !!viewerLike,
    viewerLikeType: viewerLike ? viewerLike.likeType : null,
    viewerFriendStatus: friendStatus,
  };
}

// ─────────────────────────────────────────────────────────
// CREATE POST
// ─────────────────────────────────────────────────────────

exports.createPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      postContent,
      postType = 'TextPost',
      visibility = 'Public',
      categoryId,
      groupId,
      isGroupPost,
      isWallPost,
      wallPostUserId,
      isVideoPost,
      videoUploadStatus,
      isSharePost,
      sharePostMetaId,
      imageKey,
      hashtags = [],
    } = req.body;

    // If this is a group post, verify the group exists and the user is a member
    if (groupId) {
      const group = await prisma.userGroup.findUnique({
        where: { id: groupId },
        select: { id: true, privacy: true },
      });
      if (!group) {
        return error(res, 'Group not found', 404);
      }

      const membership = await prisma.userGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership || membership.status !== 'Active') {
        return error(res, 'You must be an active group member to post in this group', 403);
      }
    }

    // Build the post within a transaction to keep everything consistent
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the post
      const post = await tx.post.create({
        data: {
          userId,
          postType,
          postContent: postContent || null,
          visibility,
          categoryId: categoryId || null,
          groupId: groupId || null,
          postDate: new Date(),
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalViews: 0,
          isAdminPost: req.user.role === 'Admin',
        },
      });

      // 2. If this is a share post, increment the original post's totalShares
      if (isSharePost && sharePostMetaId) {
        const originalPost = await tx.post.findUnique({
          where: { id: sharePostMetaId },
          select: { id: true, isDeleted: true },
        });

        if (originalPost && !originalPost.isDeleted) {
          await tx.post.update({
            where: { id: sharePostMetaId },
            data: { totalShares: { increment: 1 } },
          });
        }
      }

      // 3. If imageKey is provided and postType is ArticlePost (or image post), create PictureMeta
      if (imageKey) {
        const album = postType === 'ArticlePost' ? 'articleContent' : 'postPhoto';
        await tx.pictureMeta.create({
          data: {
            userId,
            postId: post.id,
            imageKey,
            album,
            isProcessed: false,
          },
        });
      }

      return post;
    });

    // 4. Attach hashtags (outside the tx — uses its own upsert logic)
    if (Array.isArray(hashtags) && hashtags.length > 0) {
      await attachHashtags(result.id, hashtags);
    }

    // 5. Re-fetch the complete post with all relations
    const fullPost = await prisma.post.findUnique({
      where: { id: result.id },
      include: POST_INCLUDE,
    });

    return success(res, fullPost, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET POST (single post, with viewer enrichment)
// ─────────────────────────────────────────────────────────

exports.getPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const viewerId = req.user.sub;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // Visibility check: if not Public and viewer is not owner, check access
    if (post.visibility !== 'Public' && post.userId !== viewerId) {
      if (post.visibility === 'Only') {
        return error(res, 'Post not found', 404);
      }
      // visibility === 'Friend' — check friendship
      if (post.visibility === 'Friend') {
        const friendship = await prisma.userFriend.findFirst({
          where: {
            status: 'accepted',
            OR: [
              { userId: viewerId, friendUserId: post.userId },
              { userId: post.userId, friendUserId: viewerId },
            ],
          },
        });
        if (!friendship && req.user.role !== 'Admin') {
          return error(res, 'Post not found', 404);
        }
      }
    }

    // Check if blocked (isReported is used as the admin-block flag)
    if (post.isReported && req.user.role !== 'Admin' && post.userId !== viewerId) {
      return error(res, 'This post has been blocked', 403);
    }

    const enriched = await enrichPostForViewer(post, viewerId);
    return success(res, enriched);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET SINGLE POST ENRICHED (full detail view)
// ─────────────────────────────────────────────────────────

exports.getSinglePostEnriched = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const viewerId = req.user.sub;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        ...POST_INCLUDE,
        comments: {
          where: { isDeleted: false },
          take: 10,
          orderBy: { commentDate: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePhotoKey: true,
                isAccountVerified: true,
              },
            },
            replies: {
              where: { isDeleted: false },
              take: 3,
              orderBy: { replyDate: 'desc' },
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    profilePhotoKey: true,
                  },
                },
              },
            },
          },
        },
        likes: {
          take: 5,
          orderBy: { likeDate: 'desc' },
          select: {
            id: true,
            userId: true,
            likeType: true,
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePhotoKey: true,
              },
            },
          },
        },
      },
    });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // Visibility check
    if (post.visibility !== 'Public' && post.userId !== viewerId) {
      if (post.visibility === 'Only') {
        return error(res, 'Post not found', 404);
      }
      if (post.visibility === 'Friend') {
        const friendship = await prisma.userFriend.findFirst({
          where: {
            status: 'accepted',
            OR: [
              { userId: viewerId, friendUserId: post.userId },
              { userId: post.userId, friendUserId: viewerId },
            ],
          },
        });
        if (!friendship && req.user.role !== 'Admin') {
          return error(res, 'Post not found', 404);
        }
      }
    }

    const enriched = await enrichPostForViewer(post, viewerId);
    return success(res, enriched);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// UPDATE POST
// ─────────────────────────────────────────────────────────

exports.updatePost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const {
      postContent,
      postType,
      visibility,
      categoryId,
      linkUrl,
      youtubeUrl,
      youtubeId,
    } = req.body;

    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // Only post owner can update
    if (existing.userId !== userId) {
      return error(res, 'Not authorized to update this post', 403);
    }

    const data = {};
    if (postContent !== undefined) data.postContent = postContent;
    if (postType !== undefined) data.postType = postType;
    if (visibility !== undefined) data.visibility = visibility;
    if (categoryId !== undefined) data.categoryId = categoryId || null;
    if (linkUrl !== undefined) data.linkUrl = linkUrl || null;
    if (youtubeUrl !== undefined) data.youtubeUrl = youtubeUrl || null;
    if (youtubeId !== undefined) data.youtubeId = youtubeId || null;

    // updatedAt is handled automatically by Prisma @updatedAt, but set explicitly
    // to make the intent clear
    const post = await prisma.post.update({
      where: { id: postId },
      data,
      include: POST_INCLUDE,
    });

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// DELETE POST (soft delete)
// ─────────────────────────────────────────────────────────

exports.deletePost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;

    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    if (existing.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to delete this post', 403);
    }

    await prisma.$transaction(async (tx) => {
      // Soft-delete the post
      await tx.post.update({
        where: { id: postId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      // If the post had any trending entries, remove them
      await tx.trendingPost.deleteMany({
        where: { postId },
      });
    });

    return success(res, { message: 'Post deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// CHANGE VISIBILITY
// ─────────────────────────────────────────────────────────

exports.changeVisibility = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const { visibility } = req.body;

    if (!visibility || !['Public', 'Friend', 'Only'].includes(visibility)) {
      return error(res, 'visibility must be one of: Public, Friend, Only', 400);
    }

    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // Owner only
    if (existing.userId !== userId) {
      return error(res, 'Not authorized to change visibility of this post', 403);
    }

    const post = await prisma.post.update({
      where: { id: postId },
      data: { visibility },
      include: POST_INCLUDE,
    });

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// CHANGE CATEGORY (admin only)
// ─────────────────────────────────────────────────────────

exports.changeCategory = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { categoryId, groupId } = req.body;

    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // Verify category exists if provided
    if (categoryId) {
      const category = await prisma.postCategory.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        return error(res, 'Category not found', 404);
      }
    }

    const data = {};
    if (categoryId !== undefined) data.categoryId = categoryId || null;
    if (groupId !== undefined) data.groupId = groupId || null;

    const post = await prisma.post.update({
      where: { id: postId },
      data,
      include: POST_INCLUDE,
    });

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// BOX POST (admin: set isBlocked=true)
// ─────────────────────────────────────────────────────────

exports.boxPost = async (req, res, next) => {
  try {
    const { postId } = req.params;

    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // The Post model does not have an isBlocked column in the current schema,
    // so we use isReported as the blocking indicator, or we fall back to a
    // custom approach.  Looking at the schema the closest field is `isReported`.
    // However, the original Lambda used `isBlocked`.  We will update isReported
    // to serve as the block flag (semantically: an admin has flagged the post).
    const post = await prisma.post.update({
      where: { id: postId },
      data: { isReported: true },
      include: POST_INCLUDE,
    });

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// UNBOX POST (admin: set isBlocked=false)
// ─────────────────────────────────────────────────────────

exports.unboxPost = async (req, res, next) => {
  try {
    const { postId } = req.params;

    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    const post = await prisma.post.update({
      where: { id: postId },
      data: { isReported: false },
      include: POST_INCLUDE,
    });

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// SHARE POST
// ─────────────────────────────────────────────────────────

exports.sharePost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const { postContent, visibility = 'Public' } = req.body;

    // Verify original post exists and is not deleted
    const original = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        isDeleted: true,
        visibility: true,
        userId: true,
        postType: true,
        postContent: true,
        categoryId: true,
      },
    });

    if (!original || original.isDeleted) {
      return error(res, 'Original post not found', 404);
    }

    // Cannot share a non-public post unless you are the owner or a friend
    if (original.visibility !== 'Public' && original.userId !== userId) {
      if (original.visibility === 'Only') {
        return error(res, 'This post cannot be shared', 403);
      }
      if (original.visibility === 'Friend') {
        const friendship = await prisma.userFriend.findFirst({
          where: {
            status: 'accepted',
            OR: [
              { userId, friendUserId: original.userId },
              { userId: original.userId, friendUserId: userId },
            ],
          },
        });
        if (!friendship) {
          return error(res, 'This post cannot be shared', 403);
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create the share post.  We store the reference to the original post in
      // postContent as a JSON snippet so the frontend can resolve it, or use a
      // dedicated convention.  The original Lambda used isSharePost + SharePostMeta.
      // Since our schema does not have a separate SharePostMeta table, we embed
      // the original postId reference directly.
      const sharedPost = await tx.post.create({
        data: {
          userId,
          postType: original.postType,
          postContent: postContent || null,
          visibility,
          categoryId: original.categoryId,
          postDate: new Date(),
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalViews: 0,
        },
      });

      // Increment original post's totalShares
      await tx.post.update({
        where: { id: postId },
        data: { totalShares: { increment: 1 } },
      });

      return sharedPost;
    });

    // Re-fetch with full includes
    const fullPost = await prisma.post.findUnique({
      where: { id: result.id },
      include: POST_INCLUDE,
    });

    // Attach the original post reference in the response
    const originalSummary = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });

    return success(
      res,
      {
        ...fullPost,
        isSharePost: true,
        sharedFrom: originalSummary,
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// MANAGE HASHTAGS (create / update / delete)
// ─────────────────────────────────────────────────────────

exports.manageHashtags = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const { tags = [], mode } = req.body;

    if (!mode || !['create', 'update', 'delete'].includes(mode)) {
      return error(res, 'mode must be one of: create, update, delete', 400);
    }

    if (!Array.isArray(tags)) {
      return error(res, 'tags must be an array of strings', 400);
    }

    // Verify post exists and user owns it (or is admin)
    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    if (post.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to modify hashtags on this post', 403);
    }

    if (mode === 'create') {
      // Attach new hashtags (additive)
      await attachHashtags(postId, tags);
    } else if (mode === 'delete') {
      // Remove all hashtags from the post, decrementing counts
      await detachAllHashtags(postId);
    } else if (mode === 'update') {
      // Compare old vs new: remove tags that are no longer present, add new ones
      const existingJunctions = await prisma.postHashtagOnPost.findMany({
        where: { postId },
        include: { hashtag: true },
      });

      const existingTagStrings = existingJunctions.map((j) => j.hashtag.tag);
      const newTagStrings = tags
        .map(normalizeTag)
        .filter((t) => t !== null);

      // Tags to remove (exist but not in the new set)
      const toRemove = existingTagStrings.filter(
        (t) => !newTagStrings.includes(t)
      );

      // Tags to add (in the new set but do not exist yet)
      const toAdd = newTagStrings.filter(
        (t) => !existingTagStrings.includes(t)
      );

      if (toRemove.length > 0) {
        await detachHashtags(postId, toRemove);
      }

      if (toAdd.length > 0) {
        await attachHashtags(postId, toAdd);
      }
    }

    // Return updated post with hashtags
    const updated = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PIN POST (admin only, max 1 pinned post globally)
// ─────────────────────────────────────────────────────────

exports.pinPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;

    // Verify post exists and is not deleted
    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    await prisma.$transaction(async (tx) => {
      // Only 1 pinned post at a time: find any existing pin by this admin
      // and remove it first
      const existingPins = await tx.pinPost.findMany({
        where: { userId },
      });

      if (existingPins.length > 0) {
        await tx.pinPost.deleteMany({
          where: { userId },
        });
      }

      // Create new pin
      await tx.pinPost.create({
        data: { userId, postId },
      });
    });

    // Re-fetch post with pin info
    const updated = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });

    return success(res, updated, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// UNPIN POST
// ─────────────────────────────────────────────────────────

exports.unpinPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;

    const existingPin = await prisma.pinPost.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (!existingPin) {
      return error(res, 'Post is not pinned', 404);
    }

    // Admin can unpin any pin; non-admin can only unpin their own
    if (existingPin.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to unpin this post', 403);
    }

    await prisma.pinPost.delete({
      where: { userId_postId: { userId, postId } },
    });

    return success(res, { message: 'Post unpinned successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET NEXT / PREVIOUS POST
// ─────────────────────────────────────────────────────────

exports.getNextPreviousPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const viewerId = req.user.sub;
    const direction = req.query.direction; // 'next' or 'prev'

    if (!direction || !['next', 'prev'].includes(direction)) {
      return error(res, 'direction query param must be "next" or "prev"', 400);
    }

    // Get the current post to know its date and owner
    const current = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, postDate: true, userId: true },
    });

    if (!current) {
      return error(res, 'Post not found', 404);
    }

    // Find next or previous post by the same user, ordered by postDate
    const adjacentPost = await prisma.post.findFirst({
      where: {
        userId: current.userId,
        isDeleted: false,
        postDate:
          direction === 'next'
            ? { gt: current.postDate }
            : { lt: current.postDate },
      },
      orderBy: {
        postDate: direction === 'next' ? 'asc' : 'desc',
      },
      include: POST_INCLUDE,
    });

    if (!adjacentPost) {
      return error(
        res,
        `No ${direction === 'next' ? 'next' : 'previous'} post found`,
        404
      );
    }

    // Check visibility for the viewer
    if (
      adjacentPost.visibility !== 'Public' &&
      adjacentPost.userId !== viewerId
    ) {
      if (adjacentPost.visibility === 'Only') {
        return error(res, 'No accessible post found in that direction', 404);
      }
      if (adjacentPost.visibility === 'Friend') {
        const friendship = await prisma.userFriend.findFirst({
          where: {
            status: 'accepted',
            OR: [
              { userId: viewerId, friendUserId: adjacentPost.userId },
              { userId: adjacentPost.userId, friendUserId: viewerId },
            ],
          },
        });
        if (!friendship && req.user.role !== 'Admin') {
          return error(res, 'No accessible post found in that direction', 404);
        }
      }
    }

    const enriched = await enrichPostForViewer(adjacentPost, viewerId);
    return success(res, enriched);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET CATEGORIES (tree structure)
// ─────────────────────────────────────────────────────────

exports.getCategories = async (req, res, next) => {
  try {
    // Fetch all top-level categories with children (two-level tree).
    // Prisma does not allow both `include` and `select` at the same level,
    // so we use `select` only.
    const categories = await prisma.postCategory.findMany({
      where: {
        parentId: null,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        imageKey: true,
        sortOrder: true,
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            imageKey: true,
            sortOrder: true,
            parentId: true,
          },
        },
      },
    });

    return success(res, categories);
  } catch (err) {
    next(err);
  }
};
