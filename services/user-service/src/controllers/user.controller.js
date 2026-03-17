const { prisma, success, error, getUploadUrl } = require('shared');

// Fields to select when returning user data (excludes passwordHash)
const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  fullName: true,
  bio: true,
  headline: true,
  profilePhotoKey: true,
  coverPhotoKey: true,
  totalFollowers: true,
  totalFollowing: true,
  totalFriends: true,
  totalLikes: true,
  totalGoldStars: true,
  totalSilverStars: true,
  country: true,
  state: true,
  homeState: true,
  isAccountVerified: true,
  accountStatus: true,
  role: true,
  isLikerUser: true,
  isInfluencer: true,
  signupDate: true,
  lastActiveAt: true,
  createdAt: true,
  updatedAt: true,
};

// Extended select for own profile (includes private fields)
const USER_OWN_SELECT = {
  ...USER_PUBLIC_SELECT,
  primaryPhoneNo: true,
  primaryPhoneCc: true,
  isPrimaryPhoneVerified: true,
  secondaryEmail: true,
  emailVerified: true,
  forceTfa: true,
  locationLat: true,
  locationLon: true,
  tourProfile: true,
  tourPost: true,
  tourGroup: true,
  tourStory: true,
  tourArticle: true,
  tourMessage: true,
  tourNotification: true,
  tourFollowing: true,
  tourFriend: true,
  tourFeed: true,
  tourExplore: true,
  tourSettings: true,
};

// ─── Get Me ────────────────────────────────────────────────

exports.getMe = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_OWN_SELECT,
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

// ─── Get User By ID ────────────────────────────────────────

exports.getUserById = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_PUBLIC_SELECT,
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    if (user.accountStatus !== 'active') {
      return error(res, 'User account is not active', 404);
    }

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

// ─── Update Me ─────────────────────────────────────────────

exports.updateMe = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const updates = req.body;

    // Prevent updating sensitive fields directly
    delete updates.passwordHash;
    delete updates.email;
    delete updates.role;
    delete updates.accountStatus;
    delete updates.id;
    delete updates.createdAt;
    delete updates.deletedAt;

    // Rebuild fullName if firstName or lastName provided
    if (updates.firstName !== undefined || updates.lastName !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const fName = updates.firstName !== undefined ? updates.firstName : currentUser.firstName;
      const lName = updates.lastName !== undefined ? updates.lastName : currentUser.lastName;
      updates.fullName = [fName, lName].filter(Boolean).join(' ') || null;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updates,
      select: USER_OWN_SELECT,
    });

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

// ─── Delete Me (Soft Delete) ───────────────────────────────

exports.deleteMe = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'deleted',
        deletedAt: new Date(),
      },
    });

    return success(res, { message: 'Account deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Upload URL ────────────────────────────────────────────

exports.uploadUrl = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { contentType, folder = 'profile-photos' } = req.body;

    if (!contentType) {
      return error(res, 'contentType is required', 400);
    }

    const extension = contentType.split('/')[1] || 'jpg';
    const key = `${folder}/${userId}/${Date.now()}.${extension}`;
    const url = await getUploadUrl(key, contentType);

    return success(res, { url, key });
  } catch (err) {
    next(err);
  }
};

// ─── Education ─────────────────────────────────────────────

exports.listEducation = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const education = await prisma.userEducation.findMany({
      where: { userId },
      orderBy: { startYear: 'desc' },
    });

    return success(res, education);
  } catch (err) {
    next(err);
  }
};

exports.addEducation = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { institution, degree, field, startYear, endYear, isCurrent } = req.body;

    const education = await prisma.userEducation.create({
      data: {
        userId,
        institution: institution || null,
        degree: degree || null,
        field: field || null,
        startYear: startYear || null,
        endYear: endYear || null,
        isCurrent: isCurrent || false,
      },
    });

    return success(res, education, 201);
  } catch (err) {
    next(err);
  }
};

exports.updateEducation = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;
    const { institution, degree, field, startYear, endYear, isCurrent } = req.body;

    // Verify ownership
    const existing = await prisma.userEducation.findUnique({ where: { id } });
    if (!existing) {
      return error(res, 'Education record not found', 404);
    }
    if (existing.userId !== userId) {
      return error(res, 'Not authorized to update this record', 403);
    }

    const updated = await prisma.userEducation.update({
      where: { id },
      data: {
        ...(institution !== undefined && { institution }),
        ...(degree !== undefined && { degree }),
        ...(field !== undefined && { field }),
        ...(startYear !== undefined && { startYear }),
        ...(endYear !== undefined && { endYear }),
        ...(isCurrent !== undefined && { isCurrent }),
      },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

exports.deleteEducation = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.userEducation.findUnique({ where: { id } });
    if (!existing) {
      return error(res, 'Education record not found', 404);
    }
    if (existing.userId !== userId) {
      return error(res, 'Not authorized to delete this record', 403);
    }

    await prisma.userEducation.delete({ where: { id } });

    return success(res, { message: 'Education record deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── Experience ────────────────────────────────────────────

exports.listExperience = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const experience = await prisma.userProfessionalExperience.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });

    return success(res, experience);
  } catch (err) {
    next(err);
  }
};

exports.addExperience = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { company, title, location, startDate, endDate, isCurrent, description } = req.body;

    const experience = await prisma.userProfessionalExperience.create({
      data: {
        userId,
        company: company || null,
        title: title || null,
        location: location || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isCurrent: isCurrent || false,
        description: description || null,
      },
    });

    return success(res, experience, 201);
  } catch (err) {
    next(err);
  }
};

// ─── Search Users ──────────────────────────────────────────

exports.searchUsers = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return error(res, 'Search query "q" is required', 400);
    }

    const searchTerm = q.trim();

    const users = await prisma.user.findMany({
      where: {
        accountStatus: 'active',
        OR: [
          { username: { contains: searchTerm, mode: 'insensitive' } },
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
          { fullName: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        fullName: true,
        profilePhotoKey: true,
        isAccountVerified: true,
        isInfluencer: true,
      },
      take: 20,
      orderBy: { totalFollowers: 'desc' },
    });

    return success(res, users);
  } catch (err) {
    next(err);
  }
};
