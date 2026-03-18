const { prisma, success, error, paginated, getUploadUrl } = require('shared');

// ─────────────────────────────────────────────────
// SELECT SHAPES
// ─────────────────────────────────────────────────

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

// Fields the user is allowed to update via PUT /me
const ALLOWED_UPDATE_FIELDS = new Set([
  'firstName', 'lastName', 'fullName', 'bio', 'headline',
  'country', 'state', 'homeState', 'locationLat', 'locationLon',
  'primaryPhoneNo', 'primaryPhoneCc', 'profilePhotoKey', 'coverPhotoKey',
  'tourProfile', 'tourPost', 'tourGroup', 'tourStory', 'tourArticle',
  'tourMessage', 'tourNotification', 'tourFollowing', 'tourFriend',
  'tourFeed', 'tourExplore', 'tourSettings',
]);

// ─────────────────────────────────────────────────
// GET /api/users/me — own profile
// ─────────────────────────────────────────────────

exports.getMyProfile = async (req, res, next) => {
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

// ─────────────────────────────────────────────────
// GET /api/users/search — search by name/username
// ─────────────────────────────────────────────────

exports.searchUsers = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const userId = req.user.sub;

    if (!q || q.trim().length === 0) {
      return error(res, 'Search query "q" is required', 400);
    }

    const searchTerm = q.trim();
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Get IDs of users the current user has blocked or been blocked by
    const blocks = await prisma.blockedUser.findMany({
      where: {
        OR: [{ userId }, { blockedId: userId }],
      },
      select: { userId: true, blockedId: true },
    });
    const blockedIds = new Set();
    for (const b of blocks) {
      blockedIds.add(b.userId);
      blockedIds.add(b.blockedId);
    }
    blockedIds.delete(userId); // don't exclude self

    const where = {
      accountStatus: 'active',
      deletedAt: null,
      id: { notIn: Array.from(blockedIds) },
      OR: [
        { username: { contains: searchTerm, mode: 'insensitive' } },
        { firstName: { contains: searchTerm, mode: 'insensitive' } },
        { lastName: { contains: searchTerm, mode: 'insensitive' } },
        { fullName: { contains: searchTerm, mode: 'insensitive' } },
      ],
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          fullName: true,
          profilePhotoKey: true,
          headline: true,
          isAccountVerified: true,
          isInfluencer: true,
          totalFollowers: true,
        },
        skip,
        take,
        orderBy: { totalFollowers: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    // Save search to history (fire-and-forget)
    prisma.userSearchHistory
      .create({ data: { userId, query: searchTerm, searchType: 'user' } })
      .catch(() => {});

    return paginated(res, users, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// GET /api/users/:userId — public profile
// ─────────────────────────────────────────────────

exports.getProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...USER_PUBLIC_SELECT,
        _count: {
          select: {
            education: true,
            experience: true,
            followers: true,
            following: true,
            friendsInitiated: { where: { status: 'accepted' } },
            friendsReceived: { where: { status: 'accepted' } },
          },
        },
      },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    if (user.accountStatus !== 'active') {
      return error(res, 'User account is not active', 404);
    }

    // Flatten counts
    const { _count, ...userData } = user;
    const result = {
      ...userData,
      educationCount: _count.education,
      experienceCount: _count.experience,
      followerCount: _count.followers,
      followingCount: _count.following,
      friendCount: _count.friendsInitiated + _count.friendsReceived,
    };

    return success(res, result);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/users/me — update own profile
// ─────────────────────────────────────────────────

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const body = req.body;

    // Whitelist only allowed fields
    const data = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        data[key] = body[key];
      }
    }

    if (Object.keys(data).length === 0) {
      return error(res, 'No valid fields provided for update', 400);
    }

    // Auto-rebuild fullName if firstName or lastName changes
    if (data.firstName !== undefined || data.lastName !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      if (!currentUser) {
        return error(res, 'User not found', 404);
      }
      const fName = data.firstName !== undefined ? data.firstName : currentUser.firstName;
      const lName = data.lastName !== undefined ? data.lastName : currentUser.lastName;
      data.fullName = [fName, lName].filter(Boolean).join(' ') || null;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: USER_OWN_SELECT,
    });

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PUT /api/users/me/secondary-email
// ─────────────────────────────────────────────────

exports.updateSecondaryEmail = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { secondaryEmail } = req.body;

    if (!secondaryEmail || !secondaryEmail.includes('@')) {
      return error(res, 'A valid secondary email is required', 400);
    }

    // Make sure it is not already used as a primary email by another user
    const existing = await prisma.user.findFirst({
      where: {
        email: secondaryEmail.toLowerCase().trim(),
        id: { not: userId },
      },
    });

    if (existing) {
      return error(res, 'This email is already in use by another account', 409);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { secondaryEmail: secondaryEmail.toLowerCase().trim() },
      select: USER_OWN_SELECT,
    });

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// DELETE /api/users/me — soft-delete account
// ─────────────────────────────────────────────────

exports.softDeleteAccount = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'deleted',
        deletedAt: new Date(),
      },
    });

    // Revoke all refresh tokens
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return success(res, { message: 'Account deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// POST /api/users/upload-url — S3 presigned URL
// ─────────────────────────────────────────────────

exports.getProfileUploadUrl = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { contentType, folder = 'profilePhotos' } = req.body;

    if (!contentType) {
      return error(res, 'contentType is required', 400);
    }

    const allowedFolders = ['profilePhotos', 'coverPhoto'];
    if (!allowedFolders.includes(folder)) {
      return error(res, `folder must be one of: ${allowedFolders.join(', ')}`, 400);
    }

    const extension = contentType.split('/')[1] || 'jpg';
    const key = `${folder}/${userId}/${Date.now()}.${extension}`;
    const url = await getUploadUrl(key, contentType);

    return success(res, { url, key });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// EDUCATION CRUD
// ─────────────────────────────────────────────────

exports.listEducation = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== 'active') {
      return error(res, 'User not found', 404);
    }

    const education = await prisma.userEducation.findMany({
      where: { userId },
      orderBy: [{ isCurrent: 'desc' }, { startYear: 'desc' }],
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

    if (!institution) {
      return error(res, 'institution is required', 400);
    }

    const education = await prisma.userEducation.create({
      data: {
        userId,
        institution,
        degree: degree || null,
        field: field || null,
        startYear: startYear ? Number(startYear) : null,
        endYear: endYear ? Number(endYear) : null,
        isCurrent: isCurrent === true,
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
        ...(startYear !== undefined && { startYear: startYear ? Number(startYear) : null }),
        ...(endYear !== undefined && { endYear: endYear ? Number(endYear) : null }),
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

// ─────────────────────────────────────────────────
// EXPERIENCE CRUD
// ─────────────────────────────────────────────────

exports.listExperience = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== 'active') {
      return error(res, 'User not found', 404);
    }

    const experience = await prisma.userProfessionalExperience.findMany({
      where: { userId },
      orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }],
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

    if (!company) {
      return error(res, 'company is required', 400);
    }

    const experience = await prisma.userProfessionalExperience.create({
      data: {
        userId,
        company,
        title: title || null,
        location: location || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isCurrent: isCurrent === true,
        description: description || null,
      },
    });

    return success(res, experience, 201);
  } catch (err) {
    next(err);
  }
};

exports.updateExperience = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;
    const { company, title, location, startDate, endDate, isCurrent, description } = req.body;

    const existing = await prisma.userProfessionalExperience.findUnique({ where: { id } });
    if (!existing) {
      return error(res, 'Experience record not found', 404);
    }
    if (existing.userId !== userId) {
      return error(res, 'Not authorized to update this record', 403);
    }

    const updated = await prisma.userProfessionalExperience.update({
      where: { id },
      data: {
        ...(company !== undefined && { company }),
        ...(title !== undefined && { title }),
        ...(location !== undefined && { location }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(isCurrent !== undefined && { isCurrent }),
        ...(description !== undefined && { description }),
      },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

exports.deleteExperience = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.userProfessionalExperience.findUnique({ where: { id } });
    if (!existing) {
      return error(res, 'Experience record not found', 404);
    }
    if (existing.userId !== userId) {
      return error(res, 'Not authorized to delete this record', 403);
    }

    await prisma.userProfessionalExperience.delete({ where: { id } });

    return success(res, { message: 'Experience record deleted' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// AWARDS / CERTIFICATES
// ─────────────────────────────────────────────────

exports.listAwards = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== 'active') {
      return error(res, 'User not found', 404);
    }

    const [awards, certificates] = await Promise.all([
      prisma.userHonorsAward.findMany({
        where: { userId },
        orderBy: { year: 'desc' },
      }),
      prisma.userCertificate.findMany({
        where: { userId },
        orderBy: { issuedDate: 'desc' },
      }),
    ]);

    return success(res, { awards, certificates });
  } catch (err) {
    next(err);
  }
};

exports.addAward = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { title, issuer, year, description } = req.body;

    if (!title) {
      return error(res, 'title is required', 400);
    }

    const award = await prisma.userHonorsAward.create({
      data: {
        userId,
        title,
        issuer: issuer || null,
        year: year ? Number(year) : null,
        description: description || null,
      },
    });

    return success(res, award, 201);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// FILTERS (from likerslaGetFilter / likerslaInsertFilter)
// ─────────────────────────────────────────────────

exports.getFilters = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const filters = await prisma.userFilterSelection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return success(res, filters);
  } catch (err) {
    next(err);
  }
};

exports.setFilters = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { selections } = req.body;

    if (!Array.isArray(selections)) {
      return error(res, 'selections must be an array of { categoryId, subCategoryId, isActive }', 400);
    }

    // Transactional: delete old selections, insert new ones
    await prisma.$transaction(async (tx) => {
      await tx.userFilterSelection.deleteMany({ where: { userId } });

      if (selections.length > 0) {
        await tx.userFilterSelection.createMany({
          data: selections.map((s) => ({
            userId,
            categoryId: s.categoryId || null,
            subCategoryId: s.subCategoryId || null,
            isActive: s.isActive !== false,
          })),
        });
      }
    });

    // Return the newly created selections
    const filters = await prisma.userFilterSelection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return success(res, filters);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// CONTACT SUPPORT (from likerslaContactSupport — 7 modes)
// ─────────────────────────────────────────────────

exports.createSupportTicket = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { subject, message } = req.body;

    if (!subject || !message) {
      return error(res, 'subject and message are required', 400);
    }

    const ticket = await prisma.contactSupport.create({
      data: {
        userId,
        subject,
        status: 'open',
        messages: {
          create: {
            senderId: userId,
            content: message,
          },
        },
      },
      include: {
        messages: true,
      },
    });

    return success(res, ticket, 201);
  } catch (err) {
    next(err);
  }
};

exports.addSupportMessage = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message) {
      return error(res, 'message is required', 400);
    }

    // Verify ticket exists and belongs to the user (or user is admin)
    const ticket = await prisma.contactSupport.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      return error(res, 'Support ticket not found', 404);
    }
    if (ticket.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to access this ticket', 403);
    }
    if (ticket.status === 'closed') {
      return error(res, 'This ticket is closed', 400);
    }

    const supportMessage = await prisma.contactSupportMessage.create({
      data: {
        ticketId,
        senderId: userId,
        content: message,
      },
    });

    // Update ticket timestamp
    await prisma.contactSupport.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() },
    });

    return success(res, supportMessage, 201);
  } catch (err) {
    next(err);
  }
};

exports.listMyTickets = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { userId };
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      prisma.contactSupport.findMany({
        where,
        include: {
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.contactSupport.count({ where }),
    ]);

    return paginated(res, tickets, total, page, limit);
  } catch (err) {
    next(err);
  }
};

exports.getTicketDetail = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { ticketId } = req.params;

    const ticket = await prisma.contactSupport.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePhotoKey: true,
          },
        },
      },
    });

    if (!ticket) {
      return error(res, 'Support ticket not found', 404);
    }

    if (ticket.userId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized to access this ticket', 403);
    }

    return success(res, ticket);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// SEARCH HISTORY
// ─────────────────────────────────────────────────

exports.clearSearchHistory = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const { count } = await prisma.userSearchHistory.deleteMany({
      where: { userId },
    });

    return success(res, { message: 'Search history cleared', deletedCount: count });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// PHONE NUMBER MANAGEMENT (from likerslaUserPhoneNumber)
// ─────────────────────────────────────────────────

exports.updatePhoneNumber = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { phoneNumber, countryCode } = req.body;

    if (!phoneNumber) return error(res, 'Phone number is required', 400);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        primaryPhoneNo: phoneNumber,
        primaryPhoneCc: countryCode || null,
        isPrimaryPhoneVerified: false, // Requires re-verification
      },
      select: { id: true, primaryPhoneNo: true, primaryPhoneCc: true, isPrimaryPhoneVerified: true },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};
