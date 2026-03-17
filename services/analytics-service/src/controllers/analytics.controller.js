const { prisma, success, error } = require('shared');

// GET /api/analytics/daily — get DailyHistory records, date range query params
const getDailyHistory = async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const where = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const records = await prisma.dailyHistory.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    return success(res, records);
  } catch (err) {
    next(err);
  }
};

// GET /api/analytics/monthly — get MonthlyHistory records
const getMonthlyHistory = async (req, res, next) => {
  try {
    const { year } = req.query;

    const where = {};
    if (year) where.year = Number(year);

    const records = await prisma.monthlyHistory.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return success(res, records);
  } catch (err) {
    next(err);
  }
};

// GET /api/analytics/active-users — count distinct users active today
const getActiveUsers = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const activeUsers = await prisma.userLoginInfo.findMany({
      where: {
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    return success(res, {
      date: today.toISOString().split('T')[0],
      activeUserCount: activeUsers.length,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/analytics/retention — get retention data (example data)
const getRetention = async (req, res, next) => {
  try {
    // Return retention data structure with example calculation
    // In production, this would be computed from UserDailyActivity and UserLoginInfo
    const today = new Date();
    const retentionData = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const dailyActiveCount = await prisma.userLoginInfo.findMany({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
        select: { userId: true },
        distinct: ['userId'],
      });

      retentionData.push({
        date: dateStr,
        activeUsers: dailyActiveCount.length,
      });
    }

    // Calculate total users for retention rate
    const totalUsers = await prisma.user.count({
      where: { accountStatus: 'active', deletedAt: null },
    });

    return success(res, {
      totalUsers,
      period: '7d',
      data: retentionData,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/analytics/login — record login event
const recordLogin = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { ipAddress, deviceId, deviceType, platform, appVersion } = req.body;

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

    // Update user's lastActiveAt
    await prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    });

    return success(res, loginInfo, 201);
  } catch (err) {
    next(err);
  }
};

// POST /api/analytics/activity — record user activity (upsert UserDailyActivity)
const recordActivity = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { postCount, likeCount, commentCount, shareCount, loginCount } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activity = await prisma.userDailyActivity.upsert({
      where: { userId_date: { userId, date: today } },
      update: {
        postCount: postCount !== undefined ? { increment: postCount } : undefined,
        likeCount: likeCount !== undefined ? { increment: likeCount } : undefined,
        commentCount: commentCount !== undefined ? { increment: commentCount } : undefined,
        shareCount: shareCount !== undefined ? { increment: shareCount } : undefined,
        loginCount: loginCount !== undefined ? { increment: loginCount } : undefined,
      },
      create: {
        userId,
        date: today,
        postCount: postCount || 0,
        likeCount: likeCount || 0,
        commentCount: commentCount || 0,
        shareCount: shareCount || 0,
        loginCount: loginCount || 0,
      },
    });

    return success(res, activity);
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
};
