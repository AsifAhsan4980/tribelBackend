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

// ─── POST /api/stories ───────────────────────────────────────────────────────
// Creates a story with 24h expiry. Max 20 stories per user per day.
// Original: likerslaStoryMutation -> isFor=STORY, mode=CREATE (createStory.js)
const createStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      contentType,
      content,
      mediaKey,
      thumbnailKey,
      visibility,
      storyLength,
      memeId,
      memeListClassName,
      memeInputAddClassName,
      memePreviewClassName,
      postUsingDevice,
    } = req.body;

    if (!mediaKey && !content) {
      return error(res, 'mediaKey or content is required', 400);
    }

    if (!contentType) {
      return error(res, 'contentType is required', 400);
    }

    // Determine today's date boundary (start of day UTC)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Find or create DailyStory for today
    let dailyStory = await prisma.dailyStory.findUnique({
      where: { userId_postDate: { userId, postDate: today } },
      include: {
        stories: {
          where: {
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        },
      },
    });

    // DAILY LIMIT: 20 stories per user per day (matches original Lambda check)
    if (dailyStory && dailyStory.stories.length >= 20) {
      return error(
        res,
        'You have reached your limit of 20 stories per day',
        403
      );
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Use transaction to atomically create story + upsert dailyStory
    const result = await prisma.$transaction(async (tx) => {
      // Upsert DailyStory
      const ds = await tx.dailyStory.upsert({
        where: { userId_postDate: { userId, postDate: today } },
        create: {
          userId,
          postDate: today,
          storyCount: 1,
          lastPostDate: new Date(),
        },
        update: {
          storyCount: { increment: 1 },
          lastPostDate: new Date(),
        },
      });

      // Create Story
      const story = await tx.story.create({
        data: {
          userId,
          dailyStoryId: ds.id,
          mediaKey: mediaKey || null,
          contentType: contentType || null,
          content: content || null,
          thumbnailKey: thumbnailKey || null,
          visibility: visibility || 'Public',
          expiresAt,
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalViews: 0,
          storyLength: storyLength || null,
          memeId: memeId || null,
          memeListClassName: memeListClassName || null,
          memeInputAddClassName: memeInputAddClassName || null,
          memePreviewClassName: memePreviewClassName || null,
          postUsingDevice: postUsingDevice || null,
          isBlocked: false,
          isUploading: false,
        },
        include: {
          user: { select: userSelect },
        },
      });

      return story;
    });

    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/stories/:storyId ────────────────────────────────────────────
// Owner-only deletion. Decrements DailyStory.storyCount.
// Original: likerslaStoryMutation -> isFor=STORY, mode=DELETE (deleteStory.js)
const deleteStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      return error(res, 'Story not found', 404);
    }

    if (story.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    // Transaction: delete story + decrement daily count (mirrors original DynamoDB transactWrite)
    await prisma.$transaction([
      prisma.story.delete({ where: { id: storyId } }),
      prisma.dailyStory.update({
        where: { id: story.dailyStoryId },
        data: { storyCount: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Story deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/stories/:storyId/like ────────────────────────────────────────
// Prevents self-like (story owner !== liker) and duplicate likes.
// Creates notification: LikeOnStory to story owner.
// Original: likerslaStoryMutation -> isFor=STORY, mode=LIKE (likeStory.js likeOnStory)
const likeStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return error(res, 'Story not found', 404);
    }

    // Prevent self-like (original Lambda: isLiked.data.details.userID === args.userID check)
    if (story.userId === userId) {
      return error(res, 'Cannot like your own story', 403);
    }

    // Prevent duplicate like
    const existing = await prisma.storyLike.findUnique({
      where: { storyId_userId: { storyId, userId } },
    });
    if (existing) {
      return error(res, 'Already liked', 409);
    }

    // Transaction: create like + increment totalLikes
    const [like] = await prisma.$transaction([
      prisma.storyLike.create({
        data: { storyId, userId },
      }),
      prisma.story.update({
        where: { id: storyId },
        data: { totalLikes: { increment: 1 } },
      }),
    ]);

    // Create notification for story owner (non-blocking, mirrors original Lambda senNotification)
    if (story.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: story.userId,
            actionCreatorId: userId,
            notificationType: 'LikeOnStory',
            storyId: storyId,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Notification error:', err));
    }

    return success(res, like, 201);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/stories/:storyId/like ──────────────────────────────────────
// Original: likerslaStoryMutation -> isFor=STORY, mode=UNLIKE (likeStory.js likeOffStory)
const unlikeStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;

    const existing = await prisma.storyLike.findUnique({
      where: { storyId_userId: { storyId, userId } },
    });
    if (!existing) {
      return error(res, 'Like not found', 404);
    }

    await prisma.$transaction([
      prisma.storyLike.delete({
        where: { storyId_userId: { storyId, userId } },
      }),
      prisma.story.update({
        where: { id: storyId },
        data: { totalLikes: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Like removed' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/stories/:storyId/view ────────────────────────────────────────
// Prevents duplicate views (unique storyId + userId). Increments totalViews.
// Original: likerslaStoryMutation -> isFor=STORY, mode=VIEW (view.js addView)
const viewStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return error(res, 'Story not found', 404);
    }

    // Prevent duplicate view (original Lambda checks myViewStatus items length)
    const existingView = await prisma.storyView.findUnique({
      where: { storyId_userId: { storyId, userId } },
    });
    if (existingView) {
      return error(res, 'Already viewed', 409);
    }

    // Transaction: create view + increment totalViews
    const [view] = await prisma.$transaction([
      prisma.storyView.create({
        data: {
          storyId,
          userId,
          storyUserId: story.userId,
        },
      }),
      prisma.story.update({
        where: { id: storyId },
        data: { totalViews: { increment: 1 } },
      }),
    ]);

    return success(res, view, 201);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/stories/:storyId/comments ────────────────────────────────────
// Creates a comment on a story. Supports mentions. Increments totalComments.
// Original: likerslaStoryMutation -> isFor=COMMENT, mode=CREATE (comments.js createComments)
const createStoryComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;
    const { content, hasMention, mentionUserIds } = req.body;

    if (!content) {
      return error(res, 'Content is required', 400);
    }

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return error(res, 'Story not found', 404);
    }

    // Transaction: create comment + increment story totalComments
    const [comment] = await prisma.$transaction([
      prisma.storyComment.create({
        data: {
          storyId,
          userId,
          content,
          hasMention: hasMention || false,
          totalLikes: 0,
          totalReplies: 0,
        },
        include: {
          user: { select: userSelect },
        },
      }),
      prisma.story.update({
        where: { id: storyId },
        data: { totalComments: { increment: 1 } },
      }),
    ]);

    // Handle mentions (original Lambda: mentionAddDB + senNotification for each mention)
    if (hasMention && Array.isArray(mentionUserIds) && mentionUserIds.length > 0) {
      // Create PostUserTag records for mentions
      const mentionRecords = mentionUserIds.map((mentionUserId) => ({
        postId: storyId,
        userId: mentionUserId,
        postCommentId: comment.id,
      }));

      await prisma.postUserTag.createMany({
        data: mentionRecords,
        skipDuplicates: true,
      });

      // Send mention notifications (non-blocking)
      for (const mentionUserId of mentionUserIds) {
        if (mentionUserId !== userId) {
          prisma.notification
            .create({
              data: {
                ownerId: mentionUserId,
                actionCreatorId: userId,
                notificationType: 'MentionOnStoryComment',
                storyId,
                storyCommentId: comment.id,
                isSeen: false,
                isDetailsSeen: false,
              },
            })
            .catch((err) => console.error('Mention notification error:', err));
        }
      }

      // Also notify story owner about the comment if not already mentioned
      if (story.userId !== userId && !mentionUserIds.includes(story.userId)) {
        prisma.notification
          .create({
            data: {
              ownerId: story.userId,
              actionCreatorId: userId,
              notificationType: 'CommentOnStory',
              storyId,
              storyCommentId: comment.id,
              isSeen: false,
              isDetailsSeen: false,
            },
          })
          .catch((err) => console.error('Comment notification error:', err));
      }
    } else {
      // No mentions: just notify story owner
      if (story.userId !== userId) {
        prisma.notification
          .create({
            data: {
              ownerId: story.userId,
              actionCreatorId: userId,
              notificationType: 'CommentOnStory',
              storyId,
              storyCommentId: comment.id,
              isSeen: false,
              isDetailsSeen: false,
            },
          })
          .catch((err) => console.error('Comment notification error:', err));
      }
    }

    return success(res, comment, 201);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/stories/comments/:commentId ───────────────────────────────────
// Updates a story comment text and mention status. Owner only.
// Original: likerslaStoryMutation -> isFor=COMMENT, mode=UPDATE (comments.js updateComments)
const updateStoryComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const { content, hasMention } = req.body;

    const comment = await prisma.storyComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return error(res, 'Comment not found', 404);
    }

    if (comment.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    const updateData = {};
    if (content !== undefined) updateData.content = content;
    if (hasMention !== undefined) updateData.hasMention = hasMention;

    const updated = await prisma.storyComment.update({
      where: { id: commentId },
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

// ─── DELETE /api/stories/comments/:commentId ────────────────────────────────
// Deletes a story comment. Decrements story totalComments.
// Original: likerslaStoryMutation -> isFor=COMMENT, mode=DELETE (comments.js deleteComments)
const deleteStoryComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;

    const comment = await prisma.storyComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return error(res, 'Comment not found', 404);
    }

    if (comment.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    // Transaction: delete comment + decrement story totalComments
    await prisma.$transaction([
      prisma.storyComment.delete({ where: { id: commentId } }),
      prisma.story.update({
        where: { id: comment.storyId },
        data: { totalComments: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/stories/comments/:commentId/like ────────────────────────────
// Prevents self-like on comment and duplicate likes.
// Original: likerslaStoryMutation -> isFor=COMMENT, mode=LIKE (comment-like.js commentLikeOn)
const likeStoryComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;

    const comment = await prisma.storyComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return error(res, 'Comment not found', 404);
    }

    // Prevent self-like (original Lambda: commentUserID === args.userID)
    if (comment.userId === userId) {
      return error(res, 'Cannot like your own comment', 403);
    }

    // Prevent duplicate
    const existing = await prisma.storyCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    if (existing) {
      return error(res, 'Already liked', 409);
    }

    // Transaction: create like + increment comment totalLikes
    const [like] = await prisma.$transaction([
      prisma.storyCommentLike.create({
        data: { commentId, userId },
      }),
      prisma.storyComment.update({
        where: { id: commentId },
        data: { totalLikes: { increment: 1 } },
      }),
    ]);

    // Notify comment owner (original Lambda: senNotification LikeOnStoryComments)
    if (comment.userId !== userId) {
      prisma.notification
        .create({
          data: {
            ownerId: comment.userId,
            actionCreatorId: userId,
            notificationType: 'LikeOnStoryComments',
            storyId: comment.storyId,
            storyCommentId: commentId,
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

// ─── DELETE /api/stories/comments/:commentId/like ───────────────────────────
// Original: likerslaStoryMutation -> isFor=COMMENT, mode=UNLIKE (comment-like.js commentLikeOff)
const unlikeStoryComment = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;

    const existing = await prisma.storyCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    if (!existing) {
      return error(res, 'Like not found', 404);
    }

    await prisma.$transaction([
      prisma.storyCommentLike.delete({
        where: { commentId_userId: { commentId, userId } },
      }),
      prisma.storyComment.update({
        where: { id: commentId },
        data: { totalLikes: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Comment like removed' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/stories/comments/:commentId/replies ──────────────────────────
// Creates a reply on a story comment. Increments comment totalReplies AND story totalComments.
// Original: likerslaStoryMutation -> isFor=REPLY, mode=CREATE (reply.js createReply)
const createStoryReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { commentId } = req.params;
    const { content, hasMention, mentionUserIds } = req.body;

    if (!content) {
      return error(res, 'Content is required', 400);
    }

    const comment = await prisma.storyComment.findUnique({
      where: { id: commentId },
      include: { story: { select: { id: true, userId: true } } },
    });

    if (!comment) {
      return error(res, 'Comment not found', 404);
    }

    // Transaction: create reply + increment comment totalReplies + increment story totalComments
    // (Original Lambda does a 3-item transactWrite: Put reply, Update story totalComments, Update comment totalReply)
    const [reply] = await prisma.$transaction([
      prisma.storyCommentReply.create({
        data: {
          storyCommentId: commentId,
          storyId: comment.storyId,
          userId,
          content,
          hasMention: hasMention || false,
          totalLikes: 0,
        },
        include: {
          user: { select: userSelect },
        },
      }),
      prisma.storyComment.update({
        where: { id: commentId },
        data: { totalReplies: { increment: 1 } },
      }),
      prisma.story.update({
        where: { id: comment.storyId },
        data: { totalComments: { increment: 1 } },
      }),
    ]);

    // Handle mention notifications (mirrors original reply.js logic)
    if (hasMention && Array.isArray(mentionUserIds) && mentionUserIds.length > 0) {
      const mentionRecords = mentionUserIds.map((mentionUserId) => ({
        postId: comment.storyId,
        userId: mentionUserId,
        postCommentReplyId: reply.id,
      }));

      await prisma.postUserTag.createMany({
        data: mentionRecords,
        skipDuplicates: true,
      });

      for (const mentionUserId of mentionUserIds) {
        if (mentionUserId !== userId) {
          prisma.notification
            .create({
              data: {
                ownerId: mentionUserId,
                actionCreatorId: userId,
                notificationType: 'MentionOnStoryReply',
                storyId: comment.storyId,
                storyCommentId: commentId,
                storyReplyId: reply.id,
                isSeen: false,
                isDetailsSeen: false,
              },
            })
            .catch((err) => console.error('Reply mention notification error:', err));
        }
      }

      // Notify comment owner about the reply (if not mentioned and not self)
      if (comment.userId !== userId && !mentionUserIds.includes(comment.userId)) {
        prisma.notification
          .create({
            data: {
              ownerId: comment.userId,
              actionCreatorId: userId,
              notificationType: 'ReplyOnStoryComment',
              storyId: comment.storyId,
              storyCommentId: commentId,
              storyReplyId: reply.id,
              isSeen: false,
              isDetailsSeen: false,
            },
          })
          .catch((err) => console.error('Reply notification error:', err));
      }
    } else {
      // No mentions: notify story owner and comment owner
      // Original Lambda: notifies story owner (ReplyStoryComment) and comment owner (ReplyOnStoryComment)
      const storyOwnerId = comment.story.userId;

      if (comment.userId !== storyOwnerId && storyOwnerId !== userId) {
        prisma.notification
          .create({
            data: {
              ownerId: storyOwnerId,
              actionCreatorId: userId,
              notificationType: 'ReplyStoryComment',
              storyId: comment.storyId,
              storyCommentId: commentId,
              storyReplyId: reply.id,
              isSeen: false,
              isDetailsSeen: false,
            },
          })
          .catch((err) => console.error('Story owner reply notification error:', err));
      }

      if (comment.userId !== userId) {
        prisma.notification
          .create({
            data: {
              ownerId: comment.userId,
              actionCreatorId: userId,
              notificationType: 'ReplyOnStoryComment',
              storyId: comment.storyId,
              storyCommentId: commentId,
              storyReplyId: reply.id,
              isSeen: false,
              isDetailsSeen: false,
            },
          })
          .catch((err) => console.error('Comment owner reply notification error:', err));
      }
    }

    return success(res, reply, 201);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/stories/replies/:replyId ───────────────────────────────────
// Deletes a reply. Decrements comment totalReplies AND story totalComments.
// Original: likerslaStoryMutation -> isFor=REPLY, mode=DELETE (reply.js deleteReply)
const deleteStoryReply = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { replyId } = req.params;

    const reply = await prisma.storyCommentReply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      return error(res, 'Reply not found', 404);
    }

    if (reply.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    // Transaction: delete reply + decrement comment totalReplies + decrement story totalComments
    // (mirrors original 3-item transactWrite)
    await prisma.$transaction([
      prisma.storyCommentReply.delete({ where: { id: replyId } }),
      prisma.storyComment.update({
        where: { id: reply.storyCommentId },
        data: { totalReplies: { decrement: 1 } },
      }),
      prisma.story.update({
        where: { id: reply.storyId },
        data: { totalComments: { decrement: 1 } },
      }),
    ]);

    return success(res, { message: 'Reply deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/stories/feed ──────────────────────────────────────────────────
// Gets story feed: friends + following users, grouped by user via DailyStory.
// Includes own stories at top. Filters blocked/inactive users.
// Original: likerslaGetStories (index.js main handler + friends.js + followings.js + root.js)
const getStoryFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const now = new Date();

    // Get blocked user IDs (both directions) to filter them out
    // Original Lambda does blockByMe + blockMe checks per user
    const [blockedByMe, blockedMe] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { ownerId: userId },
        select: { userId: true },
      }),
      prisma.blockedUser.findMany({
        where: { userId },
        select: { ownerId: true },
      }),
    ]);

    const blockedIds = [
      ...new Set([
        ...blockedByMe.map((b) => b.userId),
        ...blockedMe.map((b) => b.ownerId),
      ]),
    ];

    // Get followed user IDs (original Lambda: getCommentEng, getLikeEng, getRecentFollowers)
    const following = await prisma.userFollower.findMany({
      where: { followerId: userId },
      select: { userId: true },
    });

    // Get friend IDs (original Lambda: getFriendIdsOfThoseWhoHaveNewStories)
    const friendRecords = await prisma.userFriend.findMany({
      where: {
        OR: [
          { userId, status: 'accepted' },
          { friendUserId: userId, status: 'accepted' },
        ],
      },
      select: { userId: true, friendUserId: true },
    });
    const friends = friendRecords.map((f) => ({
      userId: f.userId === userId ? f.friendUserId : f.userId,
    }));

    // Combine all source user IDs, deduplicate, exclude blocked
    const sourceIds = [
      ...new Set([
        userId, // Own stories at top (original Lambda: unshift ownStoryIds)
        ...following.map((f) => f.userId),
        ...friends.map((f) => f.userId),
      ]),
    ].filter((id) => !blockedIds.includes(id));

    // Fetch DailyStories with active (non-expired) stories grouped by user
    // Original Lambda: getStoryData fetches DailyStory by IDs, filters stories >= 24h ago,
    // filters visibility != "Only", filters isUploading != true, isBlocked != true
    const dailyStories = await prisma.dailyStory.findMany({
      where: {
        userId: { in: sourceIds },
        stories: { some: { expiresAt: { gt: now } } },
      },
      include: {
        user: {
          select: {
            ...userSelect,
          },
        },
        stories: {
          where: {
            expiresAt: { gt: now },
            isBlocked: { not: true },
            isUploading: { not: true },
            visibility: { not: 'Only' },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: { views: true, likes: true, comments: true },
            },
          },
        },
      },
      orderBy: { lastPostDate: 'desc' },
      skip,
      take: Number(limit),
    });

    // Filter out inactive/admin-blocked users (original Lambda: finalCheck)
    const filtered = dailyStories.filter((ds) => {
      if (!ds.user) return false;
      if (ds.user.isActive === false) return false;
      if (ds.user.isBlockedByAdmin === true) return false;
      if (ds.stories.length === 0) return false;
      return true;
    });

    // Sort: own stories first, then by most recent story
    filtered.sort((a, b) => {
      if (a.userId === userId) return -1;
      if (b.userId === userId) return 1;
      return 0; // already sorted by lastPostDate desc
    });

    const total = await prisma.dailyStory.count({
      where: {
        userId: { in: sourceIds },
        stories: { some: { expiresAt: { gt: now } } },
      },
    });

    return paginated(res, filtered, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/stories/me ────────────────────────────────────────────────────
// Gets current user's own DailyStory with stories.
// Original: likerslaGetStories -> mode=GET_MY_STORIES (getMystories.js)
const getMyStories = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { userId };

    const [dailyStories, total] = await Promise.all([
      prisma.dailyStory.findMany({
        where,
        include: {
          user: { select: userSelect },
          stories: {
            orderBy: { createdAt: 'desc' },
            include: {
              _count: {
                select: { views: true, likes: true, comments: true },
              },
            },
          },
        },
        orderBy: { postDate: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.dailyStory.count({ where }),
    ]);

    return paginated(res, dailyStories, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/stories/:storyId ──────────────────────────────────────────────
// Gets a single story with views, likes, comments.
const getStory = async (req, res, next) => {
  try {
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        user: { select: userSelect },
        views: {
          select: { id: true, userId: true, createdAt: true },
        },
        likes: {
          select: { id: true, userId: true, createdAt: true },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          take: 20,
          include: {
            user: { select: userSelect },
            replies: {
              orderBy: { createdAt: 'asc' },
              include: {
                user: { select: userSelect },
              },
            },
          },
        },
      },
    });

    if (!story) {
      return error(res, 'Story not found', 404);
    }

    return success(res, story);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStory,
  deleteStory,
  likeStory,
  unlikeStory,
  viewStory,
  createStoryComment,
  updateStoryComment,
  deleteStoryComment,
  likeStoryComment,
  unlikeStoryComment,
  createStoryReply,
  deleteStoryReply,
  getStoryFeed,
  getMyStories,
  getStory,
};
