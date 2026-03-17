const { prisma, success, error, paginated } = require('shared');

// POST /api/stories
const createStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { mediaKey, contentType, content, visibility, thumbnailKey } = req.body;

    if (!mediaKey && !content) {
      return error(res, 'mediaKey or content is required', 400);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find or create DailyStory for today
    let dailyStory = await prisma.dailyStory.findUnique({
      where: { userId_postDate: { userId, postDate: today } },
    });

    if (!dailyStory) {
      dailyStory = await prisma.dailyStory.create({
        data: { userId, postDate: today, storyCount: 0 },
      });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const story = await prisma.story.create({
      data: {
        userId,
        dailyStoryId: dailyStory.id,
        mediaKey: mediaKey || null,
        contentType: contentType || null,
        content: content || null,
        thumbnailKey: thumbnailKey || null,
        visibility: visibility || 'Public',
        expiresAt,
      },
    });

    // Increment story count
    await prisma.dailyStory.update({
      where: { id: dailyStory.id },
      data: { storyCount: { increment: 1 } },
    });

    return success(res, story, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/stories/feed
const getStoryFeed = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Get IDs of users this user follows
    const following = await prisma.userFollower.findMany({
      where: { followerId: userId },
      select: { userId: true },
    });

    const followedIds = following.map((f) => f.userId);
    // Include the user's own stories
    followedIds.push(userId);

    const now = new Date();

    // Fetch DailyStories with active (non-expired) stories
    const dailyStories = await prisma.dailyStory.findMany({
      where: {
        userId: { in: followedIds },
        stories: { some: { expiresAt: { gt: now } } },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePhotoKey: true,
          },
        },
        stories: {
          where: { expiresAt: { gt: now } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    });

    const total = await prisma.dailyStory.count({
      where: {
        userId: { in: followedIds },
        stories: { some: { expiresAt: { gt: now } } },
      },
    });

    return paginated(res, dailyStories, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /api/stories/:storyId
const getStory = async (req, res, next) => {
  try {
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePhotoKey: true,
          },
        },
        views: { select: { id: true, userId: true, viewedAt: true } },
        likes: { select: { id: true, userId: true, createdAt: true } },
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

// DELETE /api/stories/:storyId
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

    await prisma.story.delete({ where: { id: storyId } });

    // Decrement the DailyStory count
    await prisma.dailyStory.update({
      where: { id: story.dailyStoryId },
      data: { storyCount: { decrement: 1 } },
    });

    return success(res, { message: 'Story deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/stories/:storyId/view
const viewStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return error(res, 'Story not found', 404);
    }

    const view = await prisma.storyView.create({
      data: { storyId, userId },
    });

    await prisma.story.update({
      where: { id: storyId },
      data: { totalViews: { increment: 1 } },
    });

    return success(res, view, 201);
  } catch (err) {
    next(err);
  }
};

// POST /api/stories/:storyId/like
const likeStory = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return error(res, 'Story not found', 404);
    }

    // Check for existing like
    const existing = await prisma.storyLike.findUnique({
      where: { storyId_userId: { storyId, userId } },
    });
    if (existing) {
      return error(res, 'Already liked', 409);
    }

    const like = await prisma.storyLike.create({
      data: { storyId, userId },
    });

    await prisma.story.update({
      where: { id: storyId },
      data: { totalLikes: { increment: 1 } },
    });

    return success(res, like, 201);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/stories/:storyId/like
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

    await prisma.storyLike.delete({
      where: { storyId_userId: { storyId, userId } },
    });

    await prisma.story.update({
      where: { id: storyId },
      data: { totalLikes: { decrement: 1 } },
    });

    return success(res, { message: 'Like removed' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStory,
  getStoryFeed,
  getStory,
  deleteStory,
  viewStory,
  likeStory,
  unlikeStory,
};
