const { prisma, success, error, paginated } = require('shared');

const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePhotoKey: true,
};

// ─────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────

exports.createComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId, content } = req.body;

    if (!postId || !content) {
      return error(res, 'postId and content are required', 400);
    }

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    const [comment] = await prisma.$transaction([
      prisma.postComment.create({
        data: {
          postId,
          userId,
          content,
        },
        include: { user: { select: USER_SELECT } },
      }),
      prisma.post.update({
        where: { id: postId },
        data: { totalComments: { increment: 1 } },
      }),
    ]);

    return success(res, comment, 201);
  } catch (err) {
    next(err);
  }
};

exports.getCommentsByPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const where = {
      postId,
      isDeleted: false,
    };

    const [comments, total] = await Promise.all([
      prisma.postComment.findMany({
        where,
        include: { user: { select: USER_SELECT } },
        orderBy: { commentDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.postComment.count({ where }),
    ]);

    return paginated(res, comments, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.updateComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return error(res, 'content is required', 400);
    }

    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    if (comment.userId !== userId) {
      return error(res, 'Not authorized to update this comment', 403);
    }

    const updated = await prisma.postComment.update({
      where: { id: commentId },
      data: { content },
      include: { user: { select: USER_SELECT } },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

exports.deleteComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;

    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    if (comment.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to delete this comment', 403);
    }

    await prisma.$transaction([
      prisma.postComment.update({
        where: { id: commentId },
        data: { isDeleted: true, deletedAt: new Date() },
      }),
      prisma.post.update({
        where: { id: comment.postId },
        data: { totalComments: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Comment deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// REPLIES
// ─────────────────────────────────────────────────

exports.createReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return error(res, 'content is required', 400);
    }

    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    const [reply] = await prisma.$transaction([
      prisma.postCommentReply.create({
        data: {
          commentId,
          postId: comment.postId,
          userId,
          content,
        },
        include: { user: { select: USER_SELECT } },
      }),
      prisma.postComment.update({
        where: { id: commentId },
        data: { totalReplies: { increment: 1 } },
      }),
    ]);

    return success(res, reply, 201);
  } catch (err) {
    next(err);
  }
};

exports.getRepliesByComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const where = {
      commentId,
      isDeleted: false,
    };

    const [replies, total] = await Promise.all([
      prisma.postCommentReply.findMany({
        where,
        include: { user: { select: USER_SELECT } },
        orderBy: { replyDate: 'asc' },
        skip,
        take: limit,
      }),
      prisma.postCommentReply.count({ where }),
    ]);

    return paginated(res, replies, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.deleteReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { replyId } = req.params;

    const reply = await prisma.postCommentReply.findUnique({
      where: { id: replyId },
    });

    if (!reply || reply.isDeleted) {
      return error(res, 'Reply not found', 404);
    }

    if (reply.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to delete this reply', 403);
    }

    await prisma.$transaction([
      prisma.postCommentReply.update({
        where: { id: replyId },
        data: { isDeleted: true, deletedAt: new Date() },
      }),
      prisma.postComment.update({
        where: { id: reply.commentId },
        data: { totalReplies: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Reply deleted successfully' });
  } catch (err) {
    next(err);
  }
};
