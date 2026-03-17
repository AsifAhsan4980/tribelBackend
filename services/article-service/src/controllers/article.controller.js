const { prisma, success, error, paginated } = require('shared');

// POST /api/articles
const createArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { title, content, coverImageKey, categoryId, visibility } = req.body;

    if (!title || !content) {
      return error(res, 'Title and content are required', 400);
    }

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
      },
    });

    return success(res, article, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/articles
const listArticles = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { status: 'published', deletedAt: null, visibility: 'Public' };

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
            },
          },
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

// GET /api/articles/:articleId
const getArticle = async (req, res, next) => {
  try {
    const { articleId } = req.params;

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePhotoKey: true,
          },
        },
        comments: {
          where: { isDeleted: false },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                profilePhotoKey: true,
              },
            },
            replies: {
              where: { isDeleted: false },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    return success(res, article);
  } catch (err) {
    next(err);
  }
};

// PUT /api/articles/:articleId
const updateArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;
    const { title, content, coverImageKey, categoryId, visibility, status } = req.body;

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    if (article.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (coverImageKey !== undefined) updateData.coverImageKey = coverImageKey;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (visibility !== undefined) updateData.visibility = visibility;
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'published' && !article.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    const updated = await prisma.article.update({
      where: { id: articleId },
      data: updateData,
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/articles/:articleId (soft delete)
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

// POST /api/articles/:articleId/comments
const addComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;
    const { content } = req.body;

    if (!content) {
      return error(res, 'Content is required', 400);
    }

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    const comment = await prisma.articleComment.create({
      data: { articleId, userId, content },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePhotoKey: true,
          },
        },
      },
    });

    await prisma.article.update({
      where: { id: articleId },
      data: { totalComments: { increment: 1 } },
    });

    return success(res, comment, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/articles/:articleId/comments
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
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
            },
          },
          replies: {
            where: { isDeleted: false },
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

// POST /api/articles/:articleId/like
const likeArticle = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { articleId } = req.params;

    const article = await prisma.article.findUnique({ where: { id: articleId } });
    if (!article || article.deletedAt) {
      return error(res, 'Article not found', 404);
    }

    const existing = await prisma.articleLike.findUnique({
      where: { articleId_userId: { articleId, userId } },
    });
    if (existing) {
      return error(res, 'Already liked', 409);
    }

    const like = await prisma.articleLike.create({
      data: { articleId, userId },
    });

    await prisma.article.update({
      where: { id: articleId },
      data: { totalLikes: { increment: 1 } },
    });

    return success(res, like, 201);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/articles/:articleId/like
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

    await prisma.articleLike.delete({
      where: { articleId_userId: { articleId, userId } },
    });

    await prisma.article.update({
      where: { id: articleId },
      data: { totalLikes: { decrement: 1 } },
    });

    return success(res, { message: 'Like removed' });
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
  addComment,
  listComments,
  likeArticle,
  unlikeArticle,
};
