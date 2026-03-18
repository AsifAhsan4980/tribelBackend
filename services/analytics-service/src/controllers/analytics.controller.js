const { prisma, success, error } = require('shared');

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

/** Returns { start, end } Date objects for the start/end of a given date. */
const dayBounds = (date) => {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
};

/** Returns a Date at midnight today. */
const todayDate = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// ─────────────────────────────────────────────────
// GET /api/analytics/daily — DailyHistory records (Admin)
// ─────────────────────────────────────────────────

const getDailyHistory = async (req, res, next) => {
  try {
    const { from, to, limit = 30 } = req.query;

    const where = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const records = await prisma.dailyHistory.findMany({
      where,
      orderBy: { date: 'desc' },
      take: Math.min(Number(limit), 365),
    });

    return success(res, records);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/analytics/monthly — MonthlyHistory records (Admin)
// ─────────────────────────────────────────────────

const getMonthlyHistory = async (req, res, next) => {
  try {
    const { year, limit = 24 } = req.query;

    const where = {};
    if (year) where.year = Number(year);

    const records = await prisma.monthlyHistory.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: Math.min(Number(limit), 120),
    });

    return success(res, records);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/analytics/active-users — today's DAU (Admin)
// ─────────────────────────────────────────────────

const getActiveUsers = async (req, res, next) => {
  try {
    const today = todayDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const activeUsers = await prisma.userLoginInfo.findMany({
      where: {
        createdAt: { gte: today, lt: tomorrow },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    // Also get total registered users for context
    const totalRegistered = await prisma.user.count({
      where: { accountStatus: 'active', deletedAt: null },
    });

    return success(res, {
      date: today.toISOString().split('T')[0],
      activeUserCount: activeUsers.length,
      totalRegisteredUsers: totalRegistered,
      dauPercent: totalRegistered > 0
        ? Number(((activeUsers.length / totalRegistered) * 100).toFixed(2))
        : 0,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/analytics/retention — 7-day cohort retention (Admin)
// ─────────────────────────────────────────────────

const getRetention = async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const periodDays = Math.min(Number(days), 30);
    const today = todayDate();
    const retentionData = [];

    for (let i = periodDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const { start, end } = dayBounds(date);

      const dailyActiveCount = await prisma.userLoginInfo.findMany({
        where: {
          createdAt: { gte: start, lte: end },
        },
        select: { userId: true },
        distinct: ['userId'],
      });

      // Count new signups on that day
      const newSignups = await prisma.user.count({
        where: {
          signupDate: { gte: start, lte: end },
        },
      });

      retentionData.push({
        date: start.toISOString().split('T')[0],
        activeUsers: dailyActiveCount.length,
        newSignups,
      });
    }

    const totalUsers = await prisma.user.count({
      where: { accountStatus: 'active', deletedAt: null },
    });

    // Calculate average DAU over the period
    const totalActive = retentionData.reduce((sum, d) => sum + d.activeUsers, 0);
    const avgDau = periodDays > 0 ? Math.round(totalActive / periodDays) : 0;

    return success(res, {
      totalUsers,
      period: `${periodDays}d`,
      avgDailyActiveUsers: avgDau,
      retentionRate: totalUsers > 0
        ? Number(((avgDau / totalUsers) * 100).toFixed(2))
        : 0,
      data: retentionData,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/analytics/login — record login event
// ─────────────────────────────────────────────────

const recordLogin = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { deviceId, deviceType, platform, appVersion, ipAddress } = req.body;

    // Create login record
    const loginInfo = await prisma.userLoginInfo.create({
      data: {
        userId,
        loginStatus: 'success',
        ipAddress: ipAddress || null,
        deviceId: deviceId || null,
        deviceType: deviceType || null,
        platform: platform || null,
        appVersion: appVersion || null,
      },
    });

    // Upsert daily activity — increment loginCount
    const today = todayDate();
    await prisma.userDailyActivity.upsert({
      where: { userId_date: { userId, date: today } },
      update: { loginCount: { increment: 1 } },
      create: {
        userId,
        date: today,
        loginCount: 1,
        postCount: 0,
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
      },
    });

    // Update user lastActiveAt
    await prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    });

    return success(res, loginInfo, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/analytics/activity — record user activity
// ─────────────────────────────────────────────────

const recordActivity = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { type } = req.body;

    const validTypes = ['post', 'like', 'comment', 'share'];
    if (!type || !validTypes.includes(type)) {
      return error(res, `type must be one of: ${validTypes.join(', ')}`, 400);
    }

    const today = todayDate();

    // Build the increment field
    const incrementField = `${type}Count`;

    const activity = await prisma.userDailyActivity.upsert({
      where: { userId_date: { userId, date: today } },
      update: {
        [incrementField]: { increment: 1 },
      },
      create: {
        userId,
        date: today,
        postCount: type === 'post' ? 1 : 0,
        likeCount: type === 'like' ? 1 : 0,
        commentCount: type === 'comment' ? 1 : 0,
        shareCount: type === 'share' ? 1 : 0,
        loginCount: 0,
      },
    });

    // Update user lastActiveAt (fire-and-forget)
    prisma.user
      .update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
      .catch(() => {});

    return success(res, activity);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/analytics/daily/calculate — admin/cron: compute DailyHistory
// ─────────────────────────────────────────────────

const calculateDailyHistory = async (req, res, next) => {
  try {
    const { date } = req.body;

    // Default to yesterday if no date provided
    const targetDate = date ? new Date(date) : (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    })();

    const { start, end } = dayBounds(targetDate);
    const dateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());

    // Run all aggregation queries in parallel
    const [
      newUsers,
      totalPosts,
      totalComments,
      totalLikes,
      activeUserRows,
      totalShares,
      totalViews,
      totalUsers,
    ] = await Promise.all([
      // New users who signed up on that date
      prisma.user.count({
        where: { signupDate: { gte: start, lte: end } },
      }),
      // Posts created on that date
      prisma.post.count({
        where: { postDate: { gte: start, lte: end }, isDeleted: false },
      }),
      // Comments created on that date
      prisma.postComment.count({
        where: { commentDate: { gte: start, lte: end }, isDeleted: false },
      }),
      // Likes on that date
      prisma.like.count({
        where: { likeDate: { gte: start, lte: end } },
      }),
      // Active users (distinct logins on that date)
      prisma.userLoginInfo.findMany({
        where: { createdAt: { gte: start, lte: end } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      // Shares — approximate from post totalShares that changed
      // We use UserDailyActivity shareCount sum as a proxy
      prisma.userDailyActivity.aggregate({
        where: { date: dateOnly },
        _sum: { shareCount: true },
      }),
      // Post views on that date
      prisma.postView.count({
        where: { viewedAt: { gte: start, lte: end } },
      }),
      // Total registered users as of that date
      prisma.user.count({
        where: { createdAt: { lte: end }, deletedAt: null },
      }),
    ]);

    const activeUsers = activeUserRows.length;
    const sharesSum = totalShares._sum.shareCount || 0;

    // Upsert the DailyHistory record
    const record = await prisma.dailyHistory.upsert({
      where: { date: dateOnly },
      update: {
        newUsers,
        totalPosts,
        totalComments,
        totalLikes,
        activeUsers,
        totalShares: sharesSum,
        totalViews,
        totalUsers,
      },
      create: {
        date: dateOnly,
        newUsers,
        totalPosts,
        totalComments,
        totalLikes,
        activeUsers,
        totalShares: sharesSum,
        totalViews,
        totalUsers,
      },
    });

    return success(res, record, 201);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDailyHistory,
  getMonthlyHistory,
  getActiveUsers,
  getRetention,
  recordLogin,
  recordActivity,
  calculateDailyHistory,
};
