const { prisma, success, error, paginated } = require('shared');

// POST /api/moderation/reports — create report
const createReport = async (req, res, next) => {
  try {
    const reporterId = req.user.sub;
    const { contentType, contentId, reason, description } = req.body;

    if (!contentType || !contentId) {
      return error(res, 'contentType and contentId are required', 400);
    }

    // Check for duplicate report from same user on same content
    const existing = await prisma.report.findFirst({
      where: { reporterId, contentType, contentId },
    });
    if (existing) {
      return error(res, 'You have already reported this content', 409);
    }

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

    return success(res, report, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/moderation/reports — list reports (Admin only), paginated, filterable
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

// PUT /api/moderation/reports/:reportId — update report status (Admin only)
const updateReport = async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { reportId } = req.params;
    const { status } = req.body;

    if (!status) {
      return error(res, 'status is required', 400);
    }

    const validStatuses = ['pending', 'reviewed', 'actioned', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return error(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
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
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// POST /api/moderation/users/:userId/block — admin block user
const blockUser = async (req, res, next) => {
  try {
    const adminId = req.user.sub;
    const { userId } = req.params;
    const { reason } = req.body;

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return error(res, 'User not found', 404);
    }

    // Check if already blocked
    const existing = await prisma.adminBlockedUser.findUnique({
      where: { userId },
    });
    if (existing && !existing.unblockedAt) {
      return error(res, 'User is already blocked', 409);
    }

    // Create or update admin block record
    const block = existing
      ? await prisma.adminBlockedUser.update({
          where: { userId },
          data: {
            blockedBy: adminId,
            reason: reason || null,
            blockedAt: new Date(),
            unblockedAt: null,
          },
        })
      : await prisma.adminBlockedUser.create({
          data: {
            userId,
            blockedBy: adminId,
            reason: reason || null,
          },
        });

    // Update user account status
    await prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'blocked' },
    });

    return success(res, block, 201);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/moderation/users/:userId/block — admin unblock user
const unblockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const block = await prisma.adminBlockedUser.findUnique({
      where: { userId },
    });

    if (!block || block.unblockedAt) {
      return error(res, 'User is not blocked', 404);
    }

    await prisma.adminBlockedUser.update({
      where: { userId },
      data: { unblockedAt: new Date() },
    });

    // Restore user account status
    await prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'active' },
    });

    return success(res, { message: 'User unblocked' });
  } catch (err) {
    next(err);
  }
};

// GET /api/moderation/blocked-users — list admin-blocked users
const listBlockedUsers = async (req, res, next) => {
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

module.exports = {
  createReport,
  listReports,
  updateReport,
  blockUser,
  unblockUser,
  listBlockedUsers,
};
