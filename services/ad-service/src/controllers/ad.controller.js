const { prisma, success, error, paginated } = require('shared');

// Helper: get or create AdUser record for the current user
const getAdUser = async (userId) => {
  let adUser = await prisma.adUser.findUnique({ where: { userId } });
  if (!adUser) {
    adUser = await prisma.adUser.create({ data: { userId } });
  }
  return adUser;
};

// POST /api/ads/static — create static ad
const createStaticAd = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      title,
      description,
      imageKey,
      linkUrl,
      fromAge,
      toAge,
      gender,
      location,
      radius,
      startDate,
      expireDate,
    } = req.body;

    const adUser = await getAdUser(userId);

    const ad = await prisma.staticAd.create({
      data: {
        adUserId: adUser.id,
        title: title || null,
        description: description || null,
        imageKey: imageKey || null,
        linkUrl: linkUrl || null,
        fromAge: fromAge || null,
        toAge: toAge || null,
        gender: gender || null,
        location: location || null,
        radius: radius || null,
        startDate: startDate ? new Date(startDate) : null,
        expireDate: expireDate ? new Date(expireDate) : null,
        status: 'active',
      },
    });

    return success(res, ad, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/ads/static — list active static ads
const listStaticAds = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const now = new Date();
    const where = {
      status: 'active',
      OR: [
        { expireDate: null },
        { expireDate: { gte: now } },
      ],
    };

    const [ads, total] = await Promise.all([
      prisma.staticAd.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.staticAd.count({ where }),
    ]);

    return paginated(res, ads, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// POST /api/ads/video — create video ad
const createVideoAd = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      title,
      description,
      videoKey,
      thumbnailKey,
      fromAge,
      toAge,
      gender,
      location,
      radius,
      startDate,
      expireDate,
    } = req.body;

    const adUser = await getAdUser(userId);

    const ad = await prisma.videoAd.create({
      data: {
        adUserId: adUser.id,
        title: title || null,
        description: description || null,
        videoKey: videoKey || null,
        thumbnailKey: thumbnailKey || null,
        fromAge: fromAge || null,
        toAge: toAge || null,
        gender: gender || null,
        location: location || null,
        radius: radius || null,
        startDate: startDate ? new Date(startDate) : null,
        expireDate: expireDate ? new Date(expireDate) : null,
        status: 'active',
      },
    });

    return success(res, ad, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/ads/video — list active video ads
const listVideoAds = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const now = new Date();
    const where = {
      status: 'active',
      OR: [
        { expireDate: null },
        { expireDate: { gte: now } },
      ],
    };

    const [ads, total] = await Promise.all([
      prisma.videoAd.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.videoAd.count({ where }),
    ]);

    return paginated(res, ads, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// POST /api/ads/campaigns — create campaign
const createCampaign = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { name, description, type, targetData, scheduledAt } = req.body;

    const adUser = await getAdUser(userId);

    const campaign = await prisma.campaign.create({
      data: {
        adUserId: adUser.id,
        name: name || null,
        description: description || null,
        type: type || null,
        targetData: targetData || null,
        status: 'draft',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
    });

    return success(res, campaign, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/ads/campaigns — list campaigns for ad user
const listCampaigns = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const adUser = await prisma.adUser.findUnique({ where: { userId } });
    if (!adUser) {
      return paginated(res, [], 0, page, limit);
    }

    const where = { adUserId: adUser.id };

    // Admins can see all campaigns
    const isAdmin = req.user.role === 'Admin';
    const adminWhere = isAdmin ? {} : where;

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where: adminWhere,
        include: {
          adUser: {
            include: {
              user: {
                select: { id: true, username: true, fullName: true },
              },
            },
          },
          _count: { select: { logs: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.campaign.count({ where: adminWhere }),
    ]);

    return paginated(res, campaigns, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// POST /api/ads/:adId/view — record ad view
const recordAdView = async (req, res, next) => {
  try {
    const { adId } = req.params;
    const { adType } = req.body; // 'static' or 'video'

    if (adType === 'video') {
      const ad = await prisma.videoAd.findUnique({ where: { id: adId } });
      if (!ad) {
        return error(res, 'Video ad not found', 404);
      }
      await prisma.videoAd.update({
        where: { id: adId },
        data: { totalViews: { increment: 1 } },
      });
    } else {
      const ad = await prisma.staticAd.findUnique({ where: { id: adId } });
      if (!ad) {
        return error(res, 'Static ad not found', 404);
      }
      await prisma.staticAd.update({
        where: { id: adId },
        data: { totalViews: { increment: 1 } },
      });
    }

    return success(res, { message: 'Ad view recorded' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStaticAd,
  listStaticAds,
  createVideoAd,
  listVideoAds,
  createCampaign,
  listCampaigns,
  recordAdView,
};
