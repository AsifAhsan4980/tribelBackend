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
};

const VALID_COMMENT_TYPES = ['TextOnly', 'LinkOnly', 'ImageOnly', 'ImageAndText'];

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

/**
 * Validate comment type and required fields per type.
 * Returns { valid: true } or { error: 'message' }.
 */
function validateCommentFields(body) {
  const { commentType, content, imageKey, linkTitle, linkUrl } = body;

  if (!commentType || !VALID_COMMENT_TYPES.includes(commentType)) {
    return { error: `Invalid commentType. Must be one of: ${VALID_COMMENT_TYPES.join(', ')}` };
  }

  switch (commentType) {
    case 'TextOnly':
      if (!content) return { error: 'content is required for TextOnly comment' };
      break;
    case 'LinkOnly':
      if (!linkTitle || !linkUrl) return { error: 'linkTitle and linkUrl are required for LinkOnly comment' };
      break;
    case 'ImageOnly':
      if (!imageKey) return { error: 'imageKey is required for ImageOnly comment' };
      break;
    case 'ImageAndText':
      if (!content || !imageKey) return { error: 'content and imageKey are required for ImageAndText comment' };
      break;
  }

  return { valid: true };
}

/**
 * Parse mention user IDs from body.
 * Accepts both array and comma-separated string formats.
 */
function parseMentionUserIds(mentionUserIds) {
  if (!mentionUserIds) return [];
  if (Array.isArray(mentionUserIds)) return mentionUserIds.filter(Boolean);
  return String(mentionUserIds).replace(/\s/g, '').split(',').filter(Boolean);
}

/**
 * Create a notification record (fire-and-forget, non-blocking).
 * Skips if actionCreatorId === ownerId (no self-notification).
 */
async function createNotification({ ownerId, actionCreatorId, notificationType, postId, commentId, replyId }) {
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
        notificationDate: new Date(),
      },
    });
  } catch (err) {
    // Notification failure should not break the main flow
    console.error('Notification creation failed:', err.message);
  }
}

// ─────────────────────────────────────────────────
// CREATE COMMENT
// From: likerslaCreateComment (Comment mode)
// ─────────────────────────────────────────────────

exports.createComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      postId,
      content,
      commentType,
      imageKey,
      linkTitle,
      linkUrl,
      linkDescription,
      hasMention,
      mentionUserIds,
    } = req.body;

    // -- Validate required fields --
    if (!postId) {
      return error(res, 'postId is required', 400);
    }

    const validation = validateCommentFields(req.body);
    if (validation.error) {
      return error(res, validation.error, 400);
    }

    if (hasMention && (!mentionUserIds || parseMentionUserIds(mentionUserIds).length === 0)) {
      return error(res, 'mentionUserIds is required when hasMention is true', 400);
    }

    // -- Verify post exists --
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, isDeleted: true },
    });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    // -- Build transaction operations --
    const now = new Date();
    const transactionOps = [];

    // 1. Create PostComment
    transactionOps.push(
      prisma.postComment.create({
        data: {
          postId,
          userId,
          content: content || '',
          totalLikes: 0,
          totalReplies: 0,
          commentDate: now,
        },
      })
    );

    // 2. Increment post.totalComments
    transactionOps.push(
      prisma.post.update({
        where: { id: postId },
        data: { totalComments: { increment: 1 } },
      })
    );

    // 3. If imageKey: create PictureMeta
    if (imageKey) {
      transactionOps.push(
        prisma.pictureMeta.create({
          data: {
            userId,
            album: 'commentPhoto',
            imageKey: imageKey,
            width: 300,
            height: 300,
          },
        })
      );
    }

    // Execute transaction
    const results = await prisma.$transaction(transactionOps);
    const comment = results[0];

    // 4. If imageKey was created, link the PictureMeta to the comment
    if (imageKey && results[2]) {
      await prisma.pictureMeta.update({
        where: { id: results[2].id },
        data: { commentId: comment.id },
      });
    }

    // 5. Handle mentions: create PostUserTag records
    const mentionIds = parseMentionUserIds(mentionUserIds);
    if (hasMention && mentionIds.length > 0) {
      const tagData = mentionIds.map((mentionUserId) => ({
        postId,
        userId: mentionUserId,
      }));

      await prisma.postUserTag.createMany({
        data: tagData,
        skipDuplicates: true,
      });

      // Send mention notifications (fire-and-forget)
      for (const mentionUserId of mentionIds) {
        createNotification({
          ownerId: mentionUserId,
          actionCreatorId: userId,
          notificationType: 'mention',
          postId,
          commentId: comment.id,
        });
      }
    }

    // 6. Send comment notification to post owner
    createNotification({
      ownerId: post.userId,
      actionCreatorId: userId,
      notificationType: 'post_comment',
      postId,
      commentId: comment.id,
    });

    // -- Fetch the created comment with relations --
    const fullComment = await prisma.postComment.findUnique({
      where: { id: comment.id },
      include: {
        user: { select: USER_SELECT },
        likes: {
          where: { userId },
          take: 1,
        },
      },
    });

    // Attach extra fields for response
    const responseData = {
      ...fullComment,
      commentType: commentType || 'TextOnly',
      linkTitle: linkTitle || null,
      linkUrl: linkUrl || null,
      linkDescription: linkDescription || null,
      hasMention: !!hasMention,
      likeStatus: fullComment.likes.length > 0,
      likeId: fullComment.likes[0]?.id || null,
    };
    delete responseData.likes;

    return success(res, responseData, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// CREATE REPLY
// From: likerslaCreateComment (Reply mode)
// ─────────────────────────────────────────────────

exports.createReply = async (req, res, next) => {
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
      hasMention,
      mentionUserIds,
    } = req.body;

    // -- Validate --
    if (!content && !imageKey) {
      return error(res, 'content or imageKey is required', 400);
    }

    if (hasMention && (!mentionUserIds || parseMentionUserIds(mentionUserIds).length === 0)) {
      return error(res, 'mentionUserIds is required when hasMention is true', 400);
    }

    // -- Verify parent comment exists --
    const parentComment = await prisma.postComment.findUnique({
      where: { id: commentId },
      select: { id: true, postId: true, userId: true, isDeleted: true },
    });

    if (!parentComment || parentComment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    // -- Get post info for notification --
    const post = await prisma.post.findUnique({
      where: { id: parentComment.postId },
      select: { id: true, userId: true },
    });

    // -- Build transaction --
    const now = new Date();
    const transactionOps = [];

    // 1. Create PostCommentReply
    transactionOps.push(
      prisma.postCommentReply.create({
        data: {
          commentId,
          postId: parentComment.postId,
          userId,
          content: content || '',
          totalLikes: 0,
          replyDate: now,
        },
      })
    );

    // 2. Increment PostComment.totalReplies
    transactionOps.push(
      prisma.postComment.update({
        where: { id: commentId },
        data: { totalReplies: { increment: 1 } },
      })
    );

    // 3. Increment Post.totalComments
    transactionOps.push(
      prisma.post.update({
        where: { id: parentComment.postId },
        data: { totalComments: { increment: 1 } },
      })
    );

    // 4. If imageKey: create PictureMeta
    if (imageKey) {
      transactionOps.push(
        prisma.pictureMeta.create({
          data: {
            userId,
            album: 'commentPhoto',
            imageKey: imageKey,
            width: 300,
            height: 300,
          },
        })
      );
    }

    const results = await prisma.$transaction(transactionOps);
    const reply = results[0];

    // Link PictureMeta to reply if created
    if (imageKey && results[3]) {
      await prisma.pictureMeta.update({
        where: { id: results[3].id },
        data: { commentId: reply.id },
      });
    }

    // 5. Handle mentions
    const mentionIds = parseMentionUserIds(mentionUserIds);
    if (hasMention && mentionIds.length > 0) {
      const tagData = mentionIds.map((mentionUserId) => ({
        postId: parentComment.postId,
        userId: mentionUserId,
      }));

      await prisma.postUserTag.createMany({
        data: tagData,
        skipDuplicates: true,
      });

      // Mention notifications
      for (const mentionUserId of mentionIds) {
        createNotification({
          ownerId: mentionUserId,
          actionCreatorId: userId,
          notificationType: 'mention',
          postId: parentComment.postId,
          commentId,
          replyId: reply.id,
        });
      }
    }

    // 6. Notifications:
    //    a) Notify comment author about the reply (if replier != comment author)
    createNotification({
      ownerId: parentComment.userId,
      actionCreatorId: userId,
      notificationType: 'comment_reply',
      postId: parentComment.postId,
      commentId,
      replyId: reply.id,
    });

    //    b) If comment author != post author, also notify post author
    if (post && post.userId !== parentComment.userId) {
      createNotification({
        ownerId: post.userId,
        actionCreatorId: userId,
        notificationType: 'comment_reply',
        postId: parentComment.postId,
        commentId,
        replyId: reply.id,
      });
    }

    // -- Fetch the reply with user info --
    const fullReply = await prisma.postCommentReply.findUnique({
      where: { id: reply.id },
      include: {
        user: { select: USER_SELECT },
      },
    });

    const responseData = {
      ...fullReply,
      commentType: commentType || 'TextOnly',
      linkTitle: linkTitle || null,
      linkUrl: linkUrl || null,
      linkDescription: linkDescription || null,
      hasMention: !!hasMention,
    };

    return success(res, responseData, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// UPDATE COMMENT
// From: likerslaUpdateComment (Comment mode)
// ─────────────────────────────────────────────────

exports.updateComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const {
      content,
      commentType,
      linkTitle,
      linkUrl,
      linkDescription,
      imageKey,
      hasMention,
      mentionUserIds,
    } = req.body;

    // -- Verify comment exists and ownership --
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        postId: true,
        userId: true,
        content: true,
        isDeleted: true,
      },
    });

    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    if (comment.userId !== userId) {
      return error(res, 'Not authorized to update this comment', 403);
    }

    // -- Build update data --
    const updateData = {};
    if (content !== undefined) updateData.content = content;

    // -- Handle image type changes --
    // If old comment had an image and we're switching to TextOnly or providing a new imageKey,
    // delete old PictureMeta records
    if (imageKey || commentType === 'TextOnly') {
      // Delete existing PictureMeta for this comment
      await prisma.pictureMeta.deleteMany({
        where: { commentId: comment.id },
      });
    }

    // If new imageKey provided, create new PictureMeta
    if (imageKey) {
      await prisma.pictureMeta.create({
        data: {
          userId,
          commentId: comment.id,
          album: 'commentPhoto',
          imageKey: imageKey,
          width: 300,
          height: 300,
        },
      });
    }

    // -- Handle mention diff --
    const newMentionIds = parseMentionUserIds(mentionUserIds);

    // Get old mentions for this comment
    const oldTags = await prisma.postUserTag.findMany({
      where: { postId: comment.postId },
      select: { id: true, userId: true },
    });
    const oldMentionIds = oldTags.map((t) => t.userId);

    if (hasMention && newMentionIds.length > 0) {
      // Find IDs to add (in new but not old)
      const toAdd = newMentionIds.filter((id) => !oldMentionIds.includes(id));
      // Find IDs to remove (in old but not new)
      const toRemove = oldMentionIds.filter((id) => !newMentionIds.includes(id));

      // Remove old mention tags
      if (toRemove.length > 0) {
        await prisma.postUserTag.deleteMany({
          where: {
            postId: comment.postId,
            userId: { in: toRemove },
          },
        });
      }

      // Add new mention tags
      if (toAdd.length > 0) {
        await prisma.postUserTag.createMany({
          data: toAdd.map((mentionUserId) => ({
            postId: comment.postId,
            userId: mentionUserId,
          })),
          skipDuplicates: true,
        });

        // Send mention notifications for new mentions
        for (const mentionUserId of toAdd) {
          createNotification({
            ownerId: mentionUserId,
            actionCreatorId: userId,
            notificationType: 'mention',
            postId: comment.postId,
            commentId: comment.id,
          });
        }
      }
    } else if (!hasMention && oldMentionIds.length > 0) {
      // hasMention is false/removed: delete all existing mentions
      await prisma.postUserTag.deleteMany({
        where: {
          postId: comment.postId,
          userId: { in: oldMentionIds },
        },
      });
    }

    // -- Update the comment --
    if (Object.keys(updateData).length === 0) {
      // Force updatedAt touch even if no fields changed
      updateData.updatedAt = new Date();
    }

    const updated = await prisma.postComment.update({
      where: { id: commentId },
      data: updateData,
      include: {
        user: { select: USER_SELECT },
      },
    });

    const responseData = {
      ...updated,
      commentType: commentType || 'TextOnly',
      linkTitle: linkTitle || null,
      linkUrl: linkUrl || null,
      linkDescription: linkDescription || null,
      hasMention: !!hasMention,
    };

    return success(res, responseData);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE COMMENT (soft delete + cascade replies)
// From: likerslaDeleteComment (Comment mode)
// ─────────────────────────────────────────────────

exports.deleteComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;

    // -- Verify comment exists --
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        postId: true,
        userId: true,
        totalReplies: true,
        isDeleted: true,
      },
    });

    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    // Only owner or Admin can delete
    if (comment.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to delete this comment', 403);
    }

    const totalReplies = comment.totalReplies || 0;
    const totalToDecrement = 1 + totalReplies; // comment itself + all its replies

    // -- Transaction: soft delete comment, cascade soft delete replies, decrement counters --
    await prisma.$transaction([
      // 1. Soft delete all replies for this comment
      prisma.postCommentReply.updateMany({
        where: { commentId: comment.id, isDeleted: false },
        data: { isDeleted: true, deletedAt: new Date() },
      }),

      // 2. Soft delete the comment itself
      prisma.postComment.update({
        where: { id: commentId },
        data: { isDeleted: true, deletedAt: new Date() },
      }),

      // 3. Decrement post.totalComments by (1 + totalReplies)
      prisma.post.update({
        where: { id: comment.postId },
        data: { totalComments: { decrement: totalToDecrement } },
      }),
    ]);

    return success(res, {
      message: 'Comment deleted successfully',
      totalRepliesDeleted: totalReplies,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE REPLY (soft delete)
// From: likerslaDeleteComment (Reply mode)
// ─────────────────────────────────────────────────

exports.deleteReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { replyId } = req.params;

    // -- Verify reply exists --
    const reply = await prisma.postCommentReply.findUnique({
      where: { id: replyId },
      select: {
        id: true,
        commentId: true,
        postId: true,
        userId: true,
        isDeleted: true,
      },
    });

    if (!reply || reply.isDeleted) {
      return error(res, 'Reply not found', 404);
    }

    // Only owner or Admin can delete
    if (reply.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to delete this reply', 403);
    }

    // -- Transaction: soft delete reply, decrement counters --
    await prisma.$transaction([
      // 1. Soft delete the reply
      prisma.postCommentReply.update({
        where: { id: replyId },
        data: { isDeleted: true, deletedAt: new Date() },
      }),

      // 2. Decrement PostComment.totalReplies
      prisma.postComment.update({
        where: { id: reply.commentId },
        data: { totalReplies: { decrement: 1 } },
      }),

      // 3. Decrement Post.totalComments
      prisma.post.update({
        where: { id: reply.postId },
        data: { totalComments: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Reply deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET COMMENTS BY POST (paginated, with 2 sample replies)
// From: likerSlaGetComments (Comment mode)
// ─────────────────────────────────────────────────

exports.getCommentsByPost = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // -- Verify post exists --
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, isDeleted: true },
    });

    if (!post || post.isDeleted) {
      return error(res, 'Post not found', 404);
    }

    const where = {
      postId,
      isDeleted: false,
    };

    const [comments, total] = await Promise.all([
      prisma.postComment.findMany({
        where,
        include: {
          // User info for the commenter
          user: { select: USER_SELECT },
          // PictureMeta for comment images
          post: {
            select: {
              id: true,
              userId: true,
              groupId: true,
            },
          },
          // 2 most recent replies per comment (as per original: commentReplys(limit: 2, sortDirection: ASC))
          replies: {
            where: { isDeleted: false },
            take: 2,
            orderBy: { replyDate: 'asc' },
            include: {
              user: { select: USER_SELECT },
            },
          },
          // Viewer's like status on this comment
          likes: {
            where: { userId, targetType: 'Comment' },
            take: 1,
            select: { id: true, likeType: true },
          },
        },
        orderBy: { commentDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.postComment.count({ where }),
    ]);

    // -- Get blocked user IDs for the viewer --
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

    // -- Transform comments with block/like status --
    const enrichedComments = comments.map((comment) => {
      const isBlocked = blockedIds.has(comment.userId);

      // Enrich replies with block/like status
      const enrichedReplies = (comment.replies || []).map((reply) => ({
        ...reply,
        isBlocked: blockedIds.has(reply.userId),
      }));

      return {
        id: comment.id,
        postId: comment.postId,
        userId: comment.userId,
        content: comment.content,
        totalLikes: comment.totalLikes,
        totalReplies: comment.totalReplies,
        commentDate: comment.commentDate,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        user: comment.user,
        isBlocked,
        likeStatus: comment.likes.length > 0,
        likeId: comment.likes[0]?.id || null,
        likeType: comment.likes[0]?.likeType || null,
        replies: enrichedReplies,
      };
    });

    return paginated(res, enrichedComments, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET REPLIES BY COMMENT (paginated)
// From: likerSlaGetComments (CommentReply mode)
// ─────────────────────────────────────────────────

exports.getRepliesByComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // -- Verify comment exists --
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      select: { id: true, isDeleted: true },
    });

    if (!comment || comment.isDeleted) {
      return error(res, 'Comment not found', 404);
    }

    const where = {
      commentId,
      isDeleted: false,
    };

    const [replies, total] = await Promise.all([
      prisma.postCommentReply.findMany({
        where,
        include: {
          user: { select: USER_SELECT },
        },
        orderBy: { replyDate: 'asc' },
        skip,
        take: limit,
      }),
      prisma.postCommentReply.count({ where }),
    ]);

    // -- Get blocked user IDs for the viewer --
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

    // -- Also get viewer's like status per reply --
    const replyIds = replies.map((r) => r.id);
    const myLikes = replyIds.length > 0
      ? await prisma.like.findMany({
          where: {
            userId,
            targetType: 'Reply',
            targetId: { in: replyIds },
          },
          select: { targetId: true, id: true, likeType: true },
        })
      : [];
    const likeMap = new Map(myLikes.map((l) => [l.targetId, l]));

    const enrichedReplies = replies.map((reply) => {
      const myLike = likeMap.get(reply.id);
      return {
        ...reply,
        isBlocked: blockedIds.has(reply.userId),
        likeStatus: !!myLike,
        likeId: myLike?.id || null,
        likeType: myLike?.likeType || null,
      };
    });

    return paginated(res, enrichedReplies, total, page, limit);
  } catch (err) {
    next(err);
  }
};
