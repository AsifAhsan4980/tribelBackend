const { prisma, success, error, paginated } = require('shared');

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

/**
 * Lazy-create an AdUser record for the given userId.
 * Returns the AdUser record (existing or newly created).
 */
const getOrCreateAdUser = async (userId) => {
  let adUser = await prisma.adUser.findUnique({ where: { userId } });
  if (!adUser) {
    adUser = await prisma.adUser.create({ data: { userId } });
  }
  return adUser;
};

// ─────────────────────────────────────────────────
// POST /api/ads/static — create a static (image) ad
// ─────────────────────────────────────────────────

const createStaticAd = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      title, description, imageKey, linkUrl,
      fromAge, toAge, gender, location, radius,
      startDate, expireDate,
    } = req.body;

    if (!title) {
      return error(res, 'title is required', 400);
    }
    if (!imageKey) {
      return error(res, 'imageKey is required for a static ad', 400);
    }

    const adUser = await getOrCreateAdUser(userId);

    const ad = await prisma.staticAd.create({
      data: {
        adUserId: adUser.id,
        title,
        description: description || null,
        imageKey,
        linkUrl: linkUrl || null,
        fromAge: fromAge ? Number(fromAge) : null,
        toAge: toAge ? Number(toAge) : null,
        gender: gender || null,
        location: location || null,
        radius: radius ? Number(radius) : null,
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

// ─────────────────────────────────────────────────
// GET /api/ads/static — list static ads (paginated)
// ─────────────────────────────────────────────────

const listStaticAds = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status) {
      where.status = status;
    }

    const [ads, total] = await Promise.all([
      prisma.staticAd.findMany({
        where,
        include: {
          adUser: {
            include: {
              user: { select: { id: true, username: true, fullName: true, profilePhotoKey: true } },
            },
          },
        },
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

// ─────────────────────────────────────────────────
// POST /api/ads/video — create a video ad
// ─────────────────────────────────────────────────

const createVideoAd = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      title, description, videoKey, thumbnailKey,
      fromAge, toAge, gender, location, radius,
      startDate, expireDate,
    } = req.body;

    if (!title) {
      return error(res, 'title is required', 400);
    }
    if (!videoKey) {
      return error(res, 'videoKey is required for a video ad', 400);
    }

    const adUser = await getOrCreateAdUser(userId);

    const ad = await prisma.videoAd.create({
      data: {
        adUserId: adUser.id,
        title,
        description: description || null,
        videoKey,
        thumbnailKey: thumbnailKey || null,
        fromAge: fromAge ? Number(fromAge) : null,
        toAge: toAge ? Number(toAge) : null,
        gender: gender || null,
        location: location || null,
        radius: radius ? Number(radius) : null,
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

// ─────────────────────────────────────────────────
// GET /api/ads/video — list video ads (paginated)
// ─────────────────────────────────────────────────

const listVideoAds = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status) {
      where.status = status;
    }

    const [ads, total] = await Promise.all([
      prisma.videoAd.findMany({
        where,
        include: {
          adUser: {
            include: {
              user: { select: { id: true, username: true, fullName: true, profilePhotoKey: true } },
            },
          },
        },
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

// ─────────────────────────────────────────────────
// GET /api/ads/active — non-expired ads for frontend
// ─────────────────────────────────────────────────

const getActiveAdsForFrontend = async (req, res, next) => {
  try {
    const now = new Date();
    const { limit = 10 } = req.query;

    const activeWhere = {
      status: 'active',
      OR: [
        { expireDate: null },
        { expireDate: { gte: now } },
      ],
    };

    const [staticAds, videoAds] = await Promise.all([
      prisma.staticAd.findMany({
        where: activeWhere,
        include: {
          adUser: {
            include: {
              user: { select: { id: true, username: true, fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
      }),
      prisma.videoAd.findMany({
        where: activeWhere,
        include: {
          adUser: {
            include: {
              user: { select: { id: true, username: true, fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
      }),
    ]);

    // Tag each ad with its type for the frontend
    const allAds = [
      ...staticAds.map((a) => ({ ...a, adType: 'static' })),
      ...videoAds.map((a) => ({ ...a, adType: 'video' })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return success(res, allAds);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/ads/:adType/:adId/view — record ad view
// ─────────────────────────────────────────────────

const recordAdView = async (req, res, next) => {
  try {
    const { adType, adId } = req.params;

    if (adType === 'video') {
      const ad = await prisma.videoAd.findUnique({ where: { id: adId } });
      if (!ad) {
        return error(res, 'Video ad not found', 404);
      }
      await prisma.videoAd.update({
        where: { id: adId },
        data: { totalViews: { increment: 1 } },
      });
    } else if (adType === 'static') {
      const ad = await prisma.staticAd.findUnique({ where: { id: adId } });
      if (!ad) {
        return error(res, 'Static ad not found', 404);
      }
      await prisma.staticAd.update({
        where: { id: adId },
        data: { totalViews: { increment: 1 } },
      });
    } else {
      return error(res, 'adType must be "static" or "video"', 400);
    }

    return success(res, { message: 'Ad view recorded' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/ads/campaigns — create campaign
// ─────────────────────────────────────────────────

const createCampaign = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { name, description, type, targetData, scheduledAt } = req.body;

    if (!name) {
      return error(res, 'name is required', 400);
    }

    const adUser = await getOrCreateAdUser(userId);

    const campaign = await prisma.campaign.create({
      data: {
        adUserId: adUser.id,
        name,
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

// ─────────────────────────────────────────────────
// GET /api/ads/campaigns — list campaigns
// ─────────────────────────────────────────────────

const listCampaigns = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const isAdmin = req.user.role === 'Admin';

    // Non-admins only see their own campaigns
    let where = {};
    if (!isAdmin) {
      const adUser = await prisma.adUser.findUnique({ where: { userId } });
      if (!adUser) {
        return paginated(res, [], 0, page, limit);
      }
      where.adUserId = adUser.id;
    }
    if (status) {
      where.status = status;
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          adUser: {
            include: {
              user: { select: { id: true, username: true, fullName: true } },
            },
          },
          _count: { select: { logs: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.campaign.count({ where }),
    ]);

    return paginated(res, campaigns, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/ads/influencer/apply — apply for influencer (Professional_Account)
// ─────────────────────────────────────────────────

const applyForInfluencer = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { referrerUsername } = req.body;

    if (!referrerUsername) {
      return error(res, 'referrerUsername is required', 400);
    }

    // Look up the referrer
    const referrer = await prisma.user.findUnique({
      where: { username: referrerUsername },
      select: { id: true, username: true, isInfluencer: true, accountStatus: true },
    });

    if (!referrer) {
      return error(res, 'Referrer user not found', 404);
    }
    if (referrer.accountStatus !== 'active') {
      return error(res, 'Referrer account is not active', 400);
    }
    if (!referrer.isInfluencer) {
      return error(res, 'Referrer must be an approved influencer', 400);
    }
    if (referrer.id === userId) {
      return error(res, 'You cannot refer yourself', 400);
    }

    // Check if user already applied or is already an influencer
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { isInfluencer: true },
    });
    if (currentUser.isInfluencer) {
      return error(res, 'You are already an influencer', 409);
    }

    // Store the application as a notification to admins
    // (since we don't have a dedicated UserInfluencer model, we use notifications)
    await prisma.notification.create({
      data: {
        ownerId: userId, // the applicant
        actionCreatorId: referrer.id,
        notificationType: 'campaign',
        isSeen: false,
        isActionCompleted: false,
      },
    });

    return success(res, {
      message: 'Influencer application submitted successfully',
      referredBy: referrer.username,
    }, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/ads/influencer/:userId/approve — admin approve influencer
// ─────────────────────────────────────────────────

const approveInfluencer = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isInfluencer: true, accountStatus: true },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }
    if (user.accountStatus !== 'active') {
      return error(res, 'User account is not active', 400);
    }
    if (user.isInfluencer) {
      return error(res, 'User is already an influencer', 409);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isInfluencer: true },
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

    return success(res, { message: 'User approved as influencer', userId });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/ads/influencer/:userId/remove — admin remove influencer
// ─────────────────────────────────────────────────

const removeInfluencer = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isInfluencer: true },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }
    if (!user.isInfluencer) {
      return error(res, 'User is not an influencer', 400);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isInfluencer: false },
    });

    return success(res, { message: 'Influencer status removed', userId });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/ads/highlighted-users — create highlighted user
// ─────────────────────────────────────────────────

const createHighlightedUser = async (req, res, next) => {
  try {
    const { userId, reason } = req.body;

    if (!userId) {
      return error(res, 'userId is required', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true, isAccountVerified: true },
    });
    if (!user) {
      return error(res, 'User not found', 404);
    }
    if (user.accountStatus !== 'active') {
      return error(res, 'User account is not active', 400);
    }

    // Use isAccountVerified as the "highlighted" flag + notify
    await prisma.user.update({
      where: { id: userId },
      data: { isAccountVerified: true },
    });

    // Create notification for the highlighted user
    await prisma.notification.create({
      data: {
        ownerId: userId,
        actionCreatorId: req.user.sub,
        notificationType: 'system',
        isSeen: false,
        isActionCompleted: true,
      },
    });

    return success(res, { message: 'User highlighted successfully', userId }, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE /api/ads/highlighted-users/:id — remove highlighted user
// ─────────────────────────────────────────────────

const deleteHighlightedUser = async (req, res, next) => {
  try {
    const { id: userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAccountVerified: true },
    });
    if (!user) {
      return error(res, 'User not found', 404);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isAccountVerified: false },
    });

    return success(res, { message: 'Highlighted status removed', userId });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStaticAd,
  listStaticAds,
  createVideoAd,
  listVideoAds,
  getActiveAdsForFrontend,
  recordAdView,
  createCampaign,
  listCampaigns,
  applyForInfluencer,
  approveInfluencer,
  removeInfluencer,
  createHighlightedUser,
  deleteHighlightedUser,
};
