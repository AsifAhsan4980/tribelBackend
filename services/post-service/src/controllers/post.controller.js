const { prisma, success, error, paginated } = require('shared');

// Standard include for post queries
const POST_INCLUDE = {
  user: {
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      profilePhotoKey: true,
    },
  },
  pictureMeta: true,
  hashtags: {
    include: {
      hashtag: true,
    },
  },
};

// ─── Create Post ───────────────────────────────────────────

exports.createPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      postType = 'TextPost',
      postContent,
      visibility = 'Public',
      categoryId,
      groupId,
      linkUrl,
      youtubeUrl,
      youtubeId,
      hashtags = [],
    } = req.body;

    // Create the post
    const post = await prisma.post.create({
      data: {
        userId,
        postType,
        postContent: postContent || null,
        visibility,
        categoryId: categoryId || null,
        groupId: groupId || null,
        linkUrl: linkUrl || null,
        youtubeUrl: youtubeUrl || null,
        youtubeId: youtubeId || null,
        postDate: new Date(),
      },
      include: POST_INCLUDE,
    });

    // Process hashtags if provided
    if (hashtags.length > 0) {
      await attachHashtags(post.id, hashtags);
    }

    // Re-fetch with hashtags included
    const result = await prisma.post.findUnique({
      where: { id: post.id },
      include: POST_INCLUDE,
    });

    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ─── Get Post ──────────────────────────────────────────────

exports.getPost = async (req, res, next) => {
  try {
    const { postId } = req.params;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─── Update Post ───────────────────────────────────────────

exports.updatePost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const { postContent, visibility, postType, linkUrl, youtubeUrl, youtubeId, categoryId } = req.body;

    // Verify the post exists and user owns it
    const existing = await prisma.post.findUnique({ where: { id: postId } });

    if (!existing || existing.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    if (existing.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to update this post', 403);
    }

    const post = await prisma.post.update({
      where: { id: postId },
      data: {
        ...(postContent !== undefined && { postContent }),
        ...(visibility !== undefined && { visibility }),
        ...(postType !== undefined && { postType }),
        ...(linkUrl !== undefined && { linkUrl }),
        ...(youtubeUrl !== undefined && { youtubeUrl }),
        ...(youtubeId !== undefined && { youtubeId }),
        ...(categoryId !== undefined && { categoryId }),
      },
      include: POST_INCLUDE,
    });

    return success(res, post);
  } catch (err) {
    next(err);
  }
};

// ─── Delete Post (Soft Delete) ─────────────────────────────

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

    await prisma.post.update({
      where: { id: postId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return success(res, { message: 'Post deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Get User Posts (Wall) ─────────────────────────────────

exports.getUserPosts = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const where = {
      userId,
      isDeleted: false,
    };

    // If viewing another user's posts, only show public ones
    // (unless the viewer is the owner)
    if (req.user.sub !== userId) {
      where.visibility = 'Public';
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

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── Add Hashtags to Post ──────────────────────────────────

exports.addHashtags = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const { hashtags = [] } = req.body;

    if (!Array.isArray(hashtags) || hashtags.length === 0) {
      return error(res, 'hashtags array is required', 400);
    }

    // Verify post exists and user owns it
    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    if (post.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to modify this post', 403);
    }

    await attachHashtags(postId, hashtags);

    // Return updated post
    const updated = await prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─── Pin Post ──────────────────────────────────────────────

exports.pinPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;

    // Verify post exists
    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    if (post.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to pin this post', 403);
    }

    // Check if already pinned
    const existingPin = await prisma.pinPost.findUnique({
      where: {
        userId_postId: { userId, postId },
      },
    });

    if (existingPin) {
      return error(res, 'Post is already pinned', 409);
    }

    const pin = await prisma.pinPost.create({
      data: { userId, postId },
    });

    return success(res, pin, 201);
  } catch (err) {
    next(err);
  }
};

// ─── Unpin Post ────────────────────────────────────────────

exports.unpinPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;

    const existingPin = await prisma.pinPost.findUnique({
      where: {
        userId_postId: { userId, postId },
      },
    });

    if (!existingPin) {
      return error(res, 'Post is not pinned', 404);
    }

    if (existingPin.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to unpin this post', 403);
    }

    await prisma.pinPost.delete({
      where: {
        userId_postId: { userId, postId },
      },
    });

    return success(res, { message: 'Post unpinned successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Get Posts By Hashtag ──────────────────────────────────

exports.getPostsByHashtag = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    // Normalize tag (lowercase, strip #)
    const normalizedTag = tag.toLowerCase().replace(/^#/, '');

    // Find the hashtag
    const hashtag = await prisma.postHashtag.findUnique({
      where: { tag: normalizedTag },
    });

    if (!hashtag) {
      return paginated(res, [], 0, page, limit);
    }

    const where = {
      hashtags: {
        some: { hashtagId: hashtag.id },
      },
      isDeleted: false,
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

// ─── Helper: Attach Hashtags ───────────────────────────────

/**
 * Upsert hashtags and create junction records for a post.
 * @param {string} postId
 * @param {string[]} tags - Array of hashtag strings (with or without #)
 */
async function attachHashtags(postId, tags) {
  for (const rawTag of tags) {
    const tag = rawTag.toLowerCase().replace(/^#/, '').trim();
    if (!tag) continue;

    // Upsert the hashtag record
    let hashtag = await prisma.postHashtag.findUnique({ where: { tag } });

    if (!hashtag) {
      hashtag = await prisma.postHashtag.create({
        data: { tag, postCount: 1 },
      });
    } else {
      await prisma.postHashtag.update({
        where: { id: hashtag.id },
        data: { postCount: { increment: 1 } },
      });
    }

    // Create the junction record (ignore if already exists)
    await prisma.postHashtagOnPost.upsert({
      where: {
        postId_hashtagId: { postId, hashtagId: hashtag.id },
      },
      create: { postId, hashtagId: hashtag.id },
      update: {}, // no-op if already exists
    });
  }
}
