const { prisma, success, error, paginated } = require('shared');

// ─── Shared user select fields ───────────────────────────────────────────────
const userSelect = {
  id: true,
  username: true,
  fullName: true,
  profilePhotoKey: true,
  isActive: true,
  isVerified: true,
  isBlockedByAdmin: true,
};

// Valid comment types from original Lambda (ArticleCommentMutation enums.js)
const COMMENT_TYPES = ['TextOnly', 'LinkOnly', 'ImageOnly', 'ImageAndText'];

// ─── POST /api/articles ─────────────────────────────────────────────────────
// Creates an article. Sets status='published', initializes counters to 0.
// Original Lambda also auto-creates a LinkPost cross-post (invokes post mutation Lambda).
// Original: likerslaArticleMutation -> mode=CREATE
const createArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      title,
      content,
      coverImageKey,
      categoryId,
      visibility,
      shortDescription,
      metaTitle,
      metaDescription,
      contentUrl,
      caption,
      contentAltText,
      groupId,
      isVideo,
      pictureMetaId,
      postUsingDevice,
    } = req.body;

    if (!title || !content) {
      return error(res, 'Title and content are required', 400);
    }

    // Create article with all fields from original Lambda
    const article = await prisma.article.create({
      data: {
        userId,
        title,
        content,
        coverImageKey: coverImageKey || null,
        categoryId: categoryId || null,
        visibility: visibility || 'Public',
        status: 'published',
        publishedAt: new Date(),
        shortDescription: shortDescription || null,
        metaTitle: metaTitle || title, // Original Lambda: fallback to articleTitle
        metaDescription: metaDescription || shortDescription || null, // Original Lambda: fallback to shortDescription
        contentUrl: contentUrl || null,
        caption: caption || null,
        contentAltText: contentAltText || caption || null, // Original Lambda: fallback to caption
        groupId: groupId || null,
        isVideo: isVideo || false,
        pictureMetaId: pictureMetaId || null,
        postUsingDevice: postUsingDevice || null,
        isBlocked: false,
        isUploading: false,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalViews: 0,
        turnOffNotification: false,
      },
      include: {
        user: { select: userSelect },
      },
    });

    // Auto cross-post as LinkPost (non-blocking, mirrors original Lambda invoking post mutation)
    // In the microservice architecture, this would be an internal service call or event
    if (article.contentUrl) {
      prisma.post
        .create({
          data: {
            userId,
            postContentType: 'LinkPost',
            postContent: `I have published a new article, please check it out`,
            visibility: visibility || 'Public',
            linkpostTitle: article.metaTitle,
            linkpostDescription: article.metaDescription,
            linkpostUrl: article.contentUrl,
            articleId: article.id,
            totalLikes: 0,
            totalComments: 0,
            totalShares: 0,
            totalViews: 0,
            isBlocked: false,
            isUploading: false,
          },
        })
        .catch((err) => console.error('Cross-post creation error:', err));
    }

    return success(res, article, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/articles ──────────────────────────────────────────────────────
// Lists published, non-deleted, public articles. Paginated.
const listArticles = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, categoryId, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      status: 'published',
      deletedAt: null,
      visibility: 'Public',
      isBlocked: { not: true },
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { shortDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: {
          user: { select: userSelect },
          category: { select: { id: true, name: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.article.count({ where }),
    ]);

    return paginated(res, articles, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/articles/:articleId ───────────────────────────────────────────
// Gets single article with comments (including replies) and likes.
const getArticle = async (req, res, next) => {
  try {
    const { articleId } = req.params;

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      include: {
        user: { select: userSelect },
        category: { select: { id: true, name: true } },
        comments: {
          where: { isDeleted: false },
          include: {
            user: { select: userSelect },
            pictureMeta: true,
            replies: {
              where: { isDeleted: false },
              include: {
                user: { select: userSelect },
                pictureMeta: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        likes: {
          select: {
            id: true,
            userId: true,
            likeType: true,
            createdAt: true,
          },
          take: 20,
        },
        _count: {
          select: {
            comments: true,
            likes: true,
          },
        },
      },
    });

    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    // Increment view count (non-blocking)
    prisma.article
      .update({
        where: { id: articleId },
        data: { totalViews: { increment: 1 } },
      })
      .catch((err) => console.error('View increment error:', err));

    return success(res, article);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/articles/:articleId ───────────────────────────────────────────
// Updates an article. Owner only (or admin).
// Original: likerslaArticleMutation -> mode=UPDATE (uses dynamic updatedStates builder)
const updateArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;
    const {
      title,
      content,
      coverImageKey,
      categoryId,
      visibility,
      status,
      shortDescription,
      metaTitle,
      metaDescription,
      caption,
      contentAltText,
      turnOffNotification,
    } = req.body;

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    if (article.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    // Build update data dynamically (mirrors original Lambda updatedStates function)
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (coverImageKey !== undefined) updateData.coverImageKey = coverImageKey;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (visibility !== undefined) updateData.visibility = visibility;
    if (shortDescription !== undefined) updateData.shortDescription = shortDescription;
    if (metaTitle !== undefined) updateData.metaTitle = metaTitle;
    if (metaDescription !== undefined) updateData.metaDescription = metaDescription;
    if (caption !== undefined) updateData.caption = caption;
    if (contentAltText !== undefined) updateData.contentAltText = contentAltText;
    if (turnOffNotification !== undefined) updateData.turnOffNotification = turnOffNotification;
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'published' && !article.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    const updated = await prisma.article.update({
      where: { id: articleId },
      data: updateData,
      include: {
        user: { select: userSelect },
      },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/articles/:articleId ────────────────────────────────────────
// Soft delete. Owner only (or admin).
// Original: likerslaArticleMutation -> mode=DELETE_BY_USER / DELETE_BY_ADMIN
const deleteArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    if (article.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    await prisma.article.update({
      where: { id: articleId },
      data: { deletedAt: new Date(), status: 'deleted' },
    });

    return success(res, { message: 'Article deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/articles/:articleId/block ───────────────────────────────────
// Admin only. Sets isBlocked=true.
// Original: likerslaArticleMutation -> mode=BOX_ARTICLE (boxArticle.js)
const boxArticle = async (req, res, next) => {
  try {
    const { articleId } = req.params;

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    await prisma.article.update({
      where: { id: articleId },
      data: { isBlocked: true },
    });

    return success(res, { message: 'Article blocked' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/articles/:articleId/unblock ─────────────────────────────────
// Admin only. Sets isBlocked=false.
// Original: likerslaArticleMutation -> mode=UNBOX_ARTICLE (boxArticle.js with false)
const unboxArticle = async (req, res, next) => {
  try {
    const { articleId } = req.params;

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    await prisma.article.update({
      where: { id: articleId },
      data: { isBlocked: false },
    });

    return success(res, { message: 'Article unblocked' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/articles/:articleId/comments ─────────────────────────────────
// Adds a comment to an article. Supports 4 comment types: TextOnly, LinkOnly, ImageOnly, ImageAndText.
// Creates PictureMeta if imageKey provided.
// Original: likerslaArticleCommentMutation -> mode=Create, mutateOn=Comment (addComment.js)
const addComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;
    const {
      content,
      commentType,
      imageKey,
      linkTitle,
      linkUrl,
      linkDescription,
    } = req.body;

    // Validate commentType (original Lambda: PostCommentType enum validation)
    if (!commentType || !COMMENT_TYPES.includes(commentType)) {
      return error(
        res,
        `Invalid commentType. Must be one of: ${COMMENT_TYPES.join(', ')}`,
        400
      );
    }

    // Validate required fields per commentType (mirrors original Lambda switch validation)
    if (commentType === 'TextOnly' && !content) {
      return error(res, 'Content is required for TextOnly comments', 400);
    }
    if (commentType === 'LinkOnly' && (!linkTitle || !linkUrl)) {
      return error(res, 'linkTitle and linkUrl are required for LinkOnly comments', 400);
    }
    if (commentType === 'ImageOnly' && !imageKey) {
      return error(res, 'imageKey is required for ImageOnly comments', 400);
    }
    if (commentType === 'ImageAndText' && (!content || !imageKey)) {
      return error(res, 'content and imageKey are required for ImageAndText comments', 400);
    }

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }
    if (!article.userId) {
      return error(res, 'Article does not belong to any user', 400);
    }

    // Transaction: create comment + optional PictureMeta + increment totalComments
    const result = await prisma.$transaction(async (tx) => {
      // Create the comment
      const comment = await tx.articleComment.create({
        data: {
          articleId,
          userId,
          content: content || '',
          commentType,
          linkUrl: linkUrl || '',
          linkTitle: linkTitle || '',
          linkDescription: linkDescription || '',
          totalLikes: 0,
          totalReplies: 0,
          isDeleted: false,
        },
        include: {
          user: { select: userSelect },
        },
      });

      // Create PictureMeta if imageKey provided (original Lambda: adds PictureMeta in transactWrite)
      if (imageKey) {
        await tx.pictureMeta.create({
          data: {
            album: 'commentPhoto',
            height: 300,
            width: 300,
            imageSize: 'Small',
            imageKey,
            postCommentId: comment.id,
            userId,
          },
        });
      }

      // Increment article totalComments
      await tx.article.update({
        where: { id: articleId },
        data: { totalComments: { increment: 1 } },
      });

      return comment;
    });

    // Notify article owner: CommentOnArticle (non-blocking)
    // Original Lambda: createNotificationGraphQL with notificationType 'CommentOnArticle'
    if (article.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: article.userId,
            actionCreatorId: userId,
            notificationType: 'CommentOnArticle',
            articleId,
            articleCommentId: result.id,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Article comment notification error:', err));
    }

    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/articles/:articleId/comments ──────────────────────────────────
// Lists article comments with replies. Paginated.
const listComments = async (req, res, next) => {
  try {
    const { articleId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { articleId, isDeleted: false };

    const [comments, total] = await Promise.all([
      prisma.articleComment.findMany({
        where,
        include: {
          user: { select: userSelect },
          pictureMeta: true,
          replies: {
            where: { isDeleted: false },
            include: {
              user: { select: userSelect },
              pictureMeta: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.articleComment.count({ where }),
    ]);

    return paginated(res, comments, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/articles/comments/:commentId/replies ─────────────────────────
// Adds a reply to an article comment. Supports same 4 comment types.
// Increments both comment.totalReplies and article.totalComments.
// Original: likerslaArticleCommentMutation -> mode=Create, mutateOn=Reply (addReply.js)
const addReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const {
      content,
      commentType,
      imageKey,
      linkTitle,
      linkUrl,
      linkDescription,
    } = req.body;

    // Validate commentType
    if (!commentType || !COMMENT_TYPES.includes(commentType)) {
      return error(
        res,
        `Invalid commentType. Must be one of: ${COMMENT_TYPES.join(', ')}`,
        400
      );
    }

    // Validate per type
    if (commentType === 'TextOnly' && !content) {
      return error(res, 'Content is required for TextOnly replies', 400);
    }
    if (commentType === 'LinkOnly' && (!linkTitle || !linkUrl)) {
      return error(res, 'linkTitle and linkUrl are required for LinkOnly replies', 400);
    }
    if (commentType === 'ImageOnly' && !imageKey) {
      return error(res, 'imageKey is required for ImageOnly replies', 400);
    }
    if (commentType === 'ImageAndText' && (!content || !imageKey)) {
      return error(res, 'content and imageKey are required for ImageAndText replies', 400);
    }

    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      include: { article: { select: { id: true, userId: true } } },
    });
    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    // Verify article exists
    if (!comment.article) {
      return error(res, 'Article not found', 404);
    }

    // Transaction: create reply + optional PictureMeta + increment comment.totalReplies + increment article.totalComments
    // Original Lambda: 3-4 item transactWrite (reply + comment update + article update + optional pictureMeta)
    const result = await prisma.$transaction(async (tx) => {
      const reply = await tx.articleCommentReply.create({
        data: {
          articleCommentId: commentId,
          articleId: comment.articleId,
          userId,
          content: content || '',
          commentType,
          linkUrl: linkUrl || '',
          linkTitle: linkTitle || '',
          linkDescription: linkDescription || '',
          totalLikes: 0,
          isDeleted: false,
        },
        include: {
          user: { select: userSelect },
        },
      });

      // Create PictureMeta if imageKey provided
      if (imageKey) {
        await tx.pictureMeta.create({
          data: {
            album: 'commentPhoto',
            height: 300,
            width: 300,
            imageSize: 'Small',
            imageKey,
            postCommentId: reply.id,
            userId,
          },
        });
      }

      // Increment comment totalReplies
      await tx.articleComment.update({
        where: { id: commentId },
        data: { totalReplies: { increment: 1 } },
      });

      // Increment article totalComments
      await tx.article.update({
        where: { id: comment.articleId },
        data: { totalComments: { increment: 1 } },
      });

      return reply;
    });

    // Notifications (mirrors original Lambda notification logic)
    // If article owner !== comment owner, notify article owner: ReplyArticleComment
    if (comment.article.userId !== comment.userId && comment.article.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: comment.article.userId,
            actionCreatorId: userId,
            notificationType: 'ReplyArticleComment',
            articleId: comment.articleId,
            articleCommentId: commentId,
            articleReplyId: result.id,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Reply article owner notification error:', err));
    }

    // Always notify comment owner: ReplyOnArticleComment
    if (comment.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: comment.userId,
            actionCreatorId: userId,
            notificationType: 'ReplyOnArticleComment',
            articleId: comment.articleId,
            articleCommentId: commentId,
            articleReplyId: result.id,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Reply comment owner notification error:', err));
    }

    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/articles/:articleId/like ─────────────────────────────────────
// Prevents self-like and duplicate. Increments article.totalLikes AND user.totalLikes.
// Original: likerslaArticleLikeMutation -> mode=LIKE, likeOn=Article (addArticleLike.js)
const likeArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;
    const { likeType } = req.body;

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      include: { user: { select: { id: true, totalLikes: true } } },
    });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    // Prevent self-like (original Lambda: likeByUserID === owner.id check)
    if (article.userId === userId) {
      return error(res, 'Cannot like your own article', 403);
    }

    // Prevent duplicate
    const existing = await prisma.articleLike.findUnique({
      where: { articleId_userId: { articleId, userId } },
    });
    if (existing) {
      return error(res, 'Already liked', 409);
    }

    // Transaction: create like + increment article.totalLikes + increment article owner's totalLikes
    // (Original Lambda does 3-item transactWrite: ArticleLike Put + Article Update + User Update)
    const [like] = await prisma.$transaction([
      prisma.articleLike.create({
        data: {
          articleId,
          userId,
          likeType: likeType || 'Like',
          likeOn: 'Article',
        },
      }),
      prisma.article.update({
        where: { id: articleId },
        data: { totalLikes: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: article.userId },
        data: { totalLikes: { increment: 1 } },
      }),
    ]);

    // Notify article owner: LikeOnArticle
    if (article.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: article.userId,
            actionCreatorId: userId,
            notificationType: 'LikeOnArticle',
            articleId,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Article like notification error:', err));
    }

    return success(res, like, 201);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/articles/:articleId/like ────────────────────────────────────
// Decrements article.totalLikes AND article owner's user.totalLikes.
// Original: likerslaArticleLikeMutation -> mode=UNLIKE, likeOn=Article (removeArticleLike.js)
const unlikeArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;

    const existing = await prisma.articleLike.findUnique({
      where: { articleId_userId: { articleId, userId } },
    });
    if (!existing) {
      return error(res, 'Like not found', 404);
    }

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { userId: true },
    });

    // Transaction: delete like + decrement article.totalLikes + decrement owner user.totalLikes
    await prisma.$transaction([
      prisma.articleLike.delete({
        where: { articleId_userId: { articleId, userId } },
      }),
      prisma.article.update({
        where: { id: articleId },
        data: { totalLikes: { decrement: 1 } },
      }),
      ...(article
        ? [
            prisma.user.update({
              where: { id: article.userId },
              data: { totalLikes: { decrement: 1 } },
            }),
          ]
        : []),
    ]);

    return success(res, { message: 'Like removed' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/articles/comments/:commentId/like ───────────────────────────
// Prevents self-like and duplicate. Increments comment.totalLikes AND comment owner's totalCommentLikes.
// Original: likerslaArticleLikeMutation -> mode=LIKE, likeOn=Comment (addCommentLike.js)
const likeArticleComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const { likeType } = req.body;

    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      include: { user: { select: { id: true, totalCommentLikes: true } } },
    });
    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    // Prevent self-like
    if (comment.userId === userId) {
      return error(res, 'Cannot like your own comment', 403);
    }

    // Prevent duplicate
    const existing = await prisma.articleCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    if (existing) {
      return error(res, 'Already liked', 409);
    }

    // Transaction: create like + increment comment.totalLikes + increment user.totalCommentLikes
    const [like] = await prisma.$transaction([
      prisma.articleCommentLike.create({
        data: {
          articleId: comment.articleId,
          commentId,
          userId,
          likeType: likeType || 'Like',
          likeOn: 'Comment',
        },
      }),
      prisma.articleComment.update({
        where: { id: commentId },
        data: { totalLikes: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: comment.userId },
        data: { totalCommentLikes: { increment: 1 } },
      }),
    ]);

    // Notify comment owner: LikeOnArticleComments
    if (comment.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: comment.userId,
            actionCreatorId: userId,
            notificationType: 'LikeOnArticleComments',
            articleId: comment.articleId,
            articleCommentId: commentId,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Comment like notification error:', err));
    }

    return success(res, like, 201);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/articles/comments/:commentId/like ──────────────────────────
// Original: likerslaArticleLikeMutation -> mode=UNLIKE, likeOn=Comment (removeCommentLike.js)
const unlikeArticleComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;

    const existing = await prisma.articleCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    if (!existing) {
      return error(res, 'Like not found', 404);
    }

    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { userId: true },
    });

    // Transaction: delete like + decrement comment.totalLikes + decrement user.totalCommentLikes
    await prisma.$transaction([
      prisma.articleCommentLike.delete({
        where: { commentId_userId: { commentId, userId } },
      }),
      prisma.articleComment.update({
        where: { id: commentId },
        data: { totalLikes: { decrement: 1 } },
      }),
      ...(comment
        ? [
            prisma.user.update({
              where: { id: comment.userId },
              data: { totalCommentLikes: { decrement: 1 } },
            }),
          ]
        : []),
    ]);

    return success(res, { message: 'Comment like removed' });
  } catch (err) {
    next(err);
  }
};

// ═════════════════════════════════════════════════
// COLLABORATION (from likerslaCollaborationMutation + Comment + Like)
// 8 modes: CREATE, UPDATE, DELETE, BOX/UNBOX, APPROVE, NOTIFICATION ON/OFF
// 1 comment per user per topic, likes on topic/comment/reply
// ═════════════════════════════════════════════════

const createCollaboration = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { title, content, categoryId, groupId, shortDescription, contentUrl } = req.body;

    const collab = await prisma.collaborationTopic.create({
      data: {
        userId,
        title,
        content: contentUrl || content,
        categoryId,
        totalLikes: 0,
        totalComments: 0,
        totalViews: 0,
        status: 'active',
      },
    });

    return success(res, collab, 201);
  } catch (err) {
    next(err);
  }
};

const listCollaborations = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const where = { status: 'active' };
    const [items, total] = await Promise.all([
      prisma.collaborationTopic.findMany({
        where,
        include: { user: { select: { id: true, username: true, firstName: true, lastName: true, profilePhotoKey: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.collaborationTopic.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  } catch (err) {
    next(err);
  }
};

const getCollaboration = async (req, res, next) => {
  try {
    const { collabId } = req.params;
    const collab = await prisma.collaborationTopic.findUnique({
      where: { id: collabId },
      include: {
        user: { select: { id: true, username: true, firstName: true, lastName: true, profilePhotoKey: true } },
        comments: {
          where: { isDeleted: false },
          include: {
            replies: { where: { isDeleted: false }, orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!collab) return error(res, 'Collaboration not found', 404);
    return success(res, collab);
  } catch (err) {
    next(err);
  }
};

const updateCollaboration = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { collabId } = req.params;
    const collab = await prisma.collaborationTopic.findUnique({ where: { id: collabId } });
    if (!collab) return error(res, 'Not found', 404);
    if (collab.userId !== userId && req.user.role !== 'Admin') return error(res, 'Forbidden', 403);

    const { title, content, categoryId, status } = req.body;
    const updated = await prisma.collaborationTopic.update({
      where: { id: collabId },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(categoryId !== undefined && { categoryId }),
        ...(status !== undefined && { status }),
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deleteCollaboration = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { collabId } = req.params;
    const collab = await prisma.collaborationTopic.findUnique({ where: { id: collabId } });
    if (!collab) return error(res, 'Not found', 404);
    if (collab.userId !== userId && req.user.role !== 'Admin') return error(res, 'Forbidden', 403);

    await prisma.collaborationTopic.update({
      where: { id: collabId },
      data: { status: 'deleted' },
    });
    return success(res, { message: 'Collaboration deleted' });
  } catch (err) {
    next(err);
  }
};

// Collaboration comment — 1 COMMENT PER USER PER TOPIC
const addCollaborationComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { collabId } = req.params;
    const { content } = req.body;

    // Enforce 1 comment per user per topic
    const existing = await prisma.collaborationComment.findFirst({
      where: { collaborationId: collabId, userId, isDeleted: false },
    });
    if (existing) return error(res, 'You have already commented on this collaboration. Only 1 comment per user allowed.', 409);

    const [comment] = await prisma.$transaction([
      prisma.collaborationComment.create({
        data: { collaborationId: collabId, userId, content, totalLikes: 0, totalImpressions: 0 },
      }),
      prisma.collaborationTopic.update({
        where: { id: collabId },
        data: { totalComments: { increment: 1 } },
      }),
    ]);
    return success(res, comment, 201);
  } catch (err) {
    next(err);
  }
};

const addCollaborationReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const { content } = req.body;

    const comment = await prisma.collaborationComment.findUnique({ where: { id: commentId } });
    if (!comment) return error(res, 'Comment not found', 404);

    const reply = await prisma.collaborationCommentReply.create({
      data: { commentId, collaborationId: comment.collaborationId, userId, content },
    });
    return success(res, reply, 201);
  } catch (err) {
    next(err);
  }
};

// Collaboration like — on topic, comment, or reply
const likeCollaboration = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { targetType, targetId } = req.body; // targetType: topic|comment|reply

    if (targetType === 'topic') {
      const topic = await prisma.collaborationTopic.findUnique({ where: { id: targetId } });
      if (!topic) return error(res, 'Topic not found', 404);
      if (topic.userId === userId) return error(res, 'Cannot like your own topic', 400);

      await prisma.$transaction([
        prisma.like.create({
          data: { userId, targetType: 'Collaboration', targetId, likeType: 'Like' },
        }),
        prisma.collaborationTopic.update({
          where: { id: targetId },
          data: { totalLikes: { increment: 1 }, totalViews: { increment: 1 } },
        }),
      ]);
    } else if (targetType === 'comment') {
      await prisma.$transaction([
        prisma.like.create({
          data: { userId, targetType: 'Collaboration', targetId, likeType: 'Like' },
        }),
        prisma.collaborationComment.update({
          where: { id: targetId },
          data: { totalLikes: { increment: 1 }, totalImpressions: { increment: 1 } },
        }),
      ]);
    } else if (targetType === 'reply') {
      await prisma.like.create({
        data: { userId, targetType: 'Collaboration', targetId, likeType: 'Like' },
      });
    }

    return success(res, { message: 'Liked' });
  } catch (err) {
    if (err.code === 'P2002') return error(res, 'Already liked', 409);
    next(err);
  }
};

const unlikeCollaboration = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { targetType, targetId } = req.params;

    const like = await prisma.like.findUnique({
      where: { userId_targetType_targetId: { userId, targetType: 'Collaboration', targetId } },
    });
    if (!like) return error(res, 'Like not found', 404);

    await prisma.like.delete({ where: { id: like.id } });

    if (targetType === 'topic') {
      await prisma.collaborationTopic.update({ where: { id: targetId }, data: { totalLikes: { decrement: 1 } } });
    } else if (targetType === 'comment') {
      await prisma.collaborationComment.update({ where: { id: targetId }, data: { totalLikes: { decrement: 1 } } });
    }

    return success(res, { message: 'Unliked' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createArticle,
  listArticles,
  getArticle,
  updateArticle,
  deleteArticle,
  boxArticle,
  unboxArticle,
  addComment,
  listComments,
  addReply,
  likeArticle,
  unlikeArticle,
  likeArticleComment,
  unlikeArticleComment,
  // Collaboration
  createCollaboration,
  listCollaborations,
  getCollaboration,
  updateCollaboration,
  deleteCollaboration,
  addCollaborationComment,
  addCollaborationReply,
  likeCollaboration,
  unlikeCollaboration,
};
