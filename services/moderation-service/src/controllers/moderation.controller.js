const { prisma, success, error, paginated } = require('shared');

// ─────────────────────────────────────────────────
// POST /api/moderation/reports — create report (3-table lifecycle)
// ─────────────────────────────────────────────────

const createReport = async (req, res, next) => {
  try {
    const reporterId = req.user.sub;
    const { contentType, contentId, reason, description } = req.body;

    if (!contentType || !contentId) {
      return error(res, 'contentType and contentId are required', 400);
    }

    const validContentTypes = ['Post', 'Comment', 'Reply', 'Article', 'Story', 'User', 'Message', 'Group'];
    if (!validContentTypes.includes(contentType)) {
      return error(res, `contentType must be one of: ${validContentTypes.join(', ')}`, 400);
    }

    // Prevent duplicate reports from the same user on the same content
    const existing = await prisma.report.findFirst({
      where: { reporterId, contentType, contentId },
    });
    if (existing) {
      return error(res, 'You have already reported this content', 409);
    }

    // Verify the reported content actually exists
    let contentExists = false;
    switch (contentType) {
      case 'Post':
        contentExists = !!(await prisma.post.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      case 'Comment':
        contentExists = !!(await prisma.postComment.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      case 'Reply':
        contentExists = !!(await prisma.postCommentReply.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      case 'Article':
        contentExists = !!(await prisma.article.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      case 'Story':
        contentExists = !!(await prisma.story.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      case 'User':
        contentExists = !!(await prisma.user.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      case 'Group':
        contentExists = !!(await prisma.userGroup.findUnique({ where: { id: contentId }, select: { id: true } }));
        break;
      default:
        contentExists = true; // for Message and other types, skip check
    }

    if (!contentExists) {
      return error(res, `${contentType} with id ${contentId} not found`, 404);
    }

    // Create report
    const report = await prisma.report.create({
      data: {
        reporterId,
        contentType,
        contentId,
        reason: reason || null,
        description: description || null,
        status: 'pending',
      },
    });

    // If content is a Post, flag it as reported for moderation queue
    if (contentType === 'Post') {
      // Count total reports for this post
      const reportCount = await prisma.report.count({
        where: { contentType: 'Post', contentId },
      });

      // Auto-flag post if it reaches threshold (3+ reports)
      if (reportCount >= 3) {
        await prisma.post.update({
          where: { id: contentId },
          data: { isReported: true },
        });
      }
    }

    return success(res, report, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/moderation/reports — list reports (Admin, filterable)
// ─────────────────────────────────────────────────

const listReports = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, contentType } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status) where.status = status;
    if (contentType) where.contentType = contentType;

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              username: true,
              fullName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.report.count({ where }),
    ]);

    return paginated(res, reports, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/moderation/reports/:reportId — resolve report (Admin)
// ─────────────────────────────────────────────────

const resolveReport = async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { reportId } = req.params;
    const { status } = req.body;

    if (!status) {
      return error(res, 'status is required', 400);
    }

    const validStatuses = ['reviewed', 'actioned', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return error(res, `status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      return error(res, 'Report not found', 404);
    }

    const updated = await prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      include: {
        reporter: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    // If actioned and content is a Post, optionally mark it deleted
    if (status === 'actioned' && report.contentType === 'Post') {
      await prisma.post.update({
        where: { id: report.contentId },
        data: { isDeleted: true, deletedAt: new Date() },
      }).catch(() => {}); // ignore if post already deleted
    }

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/moderation/users/:userId/block — admin block user (8 admin modes)
// ─────────────────────────────────────────────────

const adminBlockUser = async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { userId } = req.params;
    const { reason } = req.body;

    if (userId === adminId) {
      return error(res, 'You cannot block yourself', 400);
    }

    // Check user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true, role: true },
    });
    if (!user) {
      return error(res, 'User not found', 404);
    }

    // Prevent blocking other admins
    if (user.role === 'Admin') {
      return error(res, 'Cannot block an admin user', 403);
    }

    // Check if already blocked
    const existing = await prisma.adminBlockedUser.findUnique({
      where: { userId },
    });
    if (existing && !existing.unblockedAt) {
      return error(res, 'User is already blocked', 409);
    }

    // Transaction: create/update block record + update user status + create notification
    const block = await prisma.$transaction(async (tx) => {
      // Upsert admin blocked user record
      const blockRecord = existing
        ? await tx.adminBlockedUser.update({
            where: { userId },
            data: {
              blockedBy: adminId,
              reason: reason || null,
              blockedAt: new Date(),
              unblockedAt: null,
            },
          })
        : await tx.adminBlockedUser.create({
            data: {
              userId,
              blockedBy: adminId,
              reason: reason || null,
            },
          });

      // Update user account status
      await tx.user.update({
        where: { id: userId },
        data: { accountStatus: 'blocked' },
      });

      // Revoke all refresh tokens for the blocked user
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Create admin_block notification
      await tx.notification.create({
        data: {
          ownerId: userId,
          actionCreatorId: adminId,
          notificationType: 'admin_block',
          isSeen: false,
          isActionCompleted: true,
        },
      });

      return blockRecord;
    });

    return success(res, block, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE /api/moderation/users/:userId/block — admin unblock user
// ─────────────────────────────────────────────────

const adminUnblockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const block = await prisma.adminBlockedUser.findUnique({
      where: { userId },
    });

    if (!block || block.unblockedAt) {
      return error(res, 'User is not currently blocked', 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.adminBlockedUser.update({
        where: { userId },
        data: { unblockedAt: new Date() },
      });

      await tx.user.update({
        where: { id: userId },
        data: { accountStatus: 'active' },
      });

      // Notify user they've been unblocked
      await tx.notification.create({
        data: {
          ownerId: userId,
          actionCreatorId: req.user.sub,
          notificationType: 'system',
          isSeen: false,
          isActionCompleted: true,
        },
      });
    });

    return success(res, { message: 'User unblocked successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/moderation/users/:userId/role — update user role (Admin: 6 modes)
// ─────────────────────────────────────────────────

const updateUserRole = async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { userId } = req.params;
    const { action } = req.body;

    const validActions = [
      'makeMaster', 'deleteMaster',
      'makeVerified', 'deleteVerified',
      'makeLiker', 'deleteLiker',
    ];

    if (!action || !validActions.includes(action)) {
      return error(res, `action must be one of: ${validActions.join(', ')}`, 400);
    }

    if (userId === adminId && (action === 'deleteMaster')) {
      return error(res, 'You cannot remove your own admin role', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true, role: true, isAccountVerified: true, isLikerUser: true },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    let updateData = {};
    let resultMessage = '';

    switch (action) {
      case 'makeMaster':
        updateData = { role: 'Admin' };
        resultMessage = 'User promoted to Admin';
        break;
      case 'deleteMaster':
        if (user.role !== 'Admin') {
          return error(res, 'User is not an Admin', 400);
        }
        updateData = { role: 'User' };
        resultMessage = 'Admin role removed, user set to User';
        break;
      case 'makeVerified':
        if (user.isAccountVerified) {
          return error(res, 'User is already verified', 409);
        }
        updateData = { isAccountVerified: true };
        resultMessage = 'User verified';
        break;
      case 'deleteVerified':
        if (!user.isAccountVerified) {
          return error(res, 'User is not verified', 400);
        }
        updateData = { isAccountVerified: false };
        resultMessage = 'Verified status removed';
        break;
      case 'makeLiker':
        if (user.isLikerUser) {
          return error(res, 'User is already a Liker user', 409);
        }
        updateData = { isLikerUser: true };
        resultMessage = 'User set as Liker user';
        break;
      case 'deleteLiker':
        if (!user.isLikerUser) {
          return error(res, 'User is not a Liker user', 400);
        }
        updateData = { isLikerUser: false };
        resultMessage = 'Liker user status removed';
        break;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isAccountVerified: true,
        isLikerUser: true,
      },
    });

    return success(res, { message: resultMessage, user: updatedUser });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/moderation/users/:userId/verify — admin verify user
// ─────────────────────────────────────────────────

const adminVerifyUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAccountVerified: true, accountStatus: true },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }
    if (user.accountStatus !== 'active') {
      return error(res, 'User account is not active', 400);
    }
    if (user.isAccountVerified) {
      return error(res, 'User is already verified', 409);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isAccountVerified: true },
      select: {
        id: true,
        username: true,
        fullName: true,
        isAccountVerified: true,
      },
    });

    // Notify the user
    await prisma.notification.create({
      data: {
        ownerId: userId,
        actionCreatorId: req.user.sub,
        notificationType: 'system',
        isSeen: false,
        isActionCompleted: true,
      },
    });

    return success(res, { message: 'User verified successfully', user: updated });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/moderation/blocked-users — list admin-blocked users
// ─────────────────────────────────────────────────

const listAdminBlockedUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { unblockedAt: null };

    const [blockedUsers, total] = await Promise.all([
      prisma.adminBlockedUser.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              email: true,
              profilePhotoKey: true,
              accountStatus: true,
              role: true,
              signupDate: true,
            },
          },
          blocker: {
            select: {
              id: true,
              username: true,
              fullName: true,
            },
          },
        },
        orderBy: { blockedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.adminBlockedUser.count({ where }),
    ]);

    return paginated(res, blockedUsers, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/moderation/posts/:postId/block — box (hide) post (Admin)
// ─────────────────────────────────────────────────

const boxPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { reason } = req.body;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, isDeleted: true, userId: true },
    });
    if (!post) {
      return error(res, 'Post not found', 404);
    }
    if (post.isDeleted) {
      return error(res, 'Post is already deleted', 409);
    }

    await prisma.post.update({
      where: { id: postId },
      data: {
        isDeleted: true,
        isReported: true,
        deletedAt: new Date(),
      },
    });

    // Notify the post owner
    await prisma.notification.create({
      data: {
        ownerId: post.userId,
        actionCreatorId: req.user.sub,
        notificationType: 'admin_block',
        postId,
        isSeen: false,
        isActionCompleted: true,
      },
    });

    return success(res, { message: 'Post boxed (hidden) by admin', postId });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE /api/moderation/posts/:postId/block — unbox (restore) post (Admin)
// ─────────────────────────────────────────────────

const unboxPost = async (req, res, next) => {
  try {
    const { postId } = req.params;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, isDeleted: true },
    });
    if (!post) {
      return error(res, 'Post not found', 404);
    }
    if (!post.isDeleted) {
      return error(res, 'Post is not boxed', 400);
    }

    await prisma.post.update({
      where: { id: postId },
      data: {
        isDeleted: false,
        isReported: false,
        deletedAt: null,
      },
    });

    return success(res, { message: 'Post unboxed (restored) by admin', postId });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// FORCE LOGOUT USER (from likerSlaLogoutByAdmin)
// Revokes all refresh tokens → forces re-login
// ─────────────────────────────────────────────────

const forceLogoutUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Revoke all refresh tokens for the user
    const result = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Deactivate all push notification tokens
    await prisma.pushNotificationSubscriber.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    return success(res, {
      message: `User ${userId} logged out. ${result.count} tokens revoked.`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createReport,
  listReports,
  resolveReport,
  adminBlockUser,
  adminUnblockUser,
  updateUserRole,
  adminVerifyUser,
  listAdminBlockedUsers,
  boxPost,
  unboxPost,
  forceLogoutUser,
};
