const { prisma, success, error, paginated } = require('shared');

// POST /api/groups
const createGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupName, description, privacy, categoryId, coverImageKey, policy } = req.body;

    if (!groupName) {
      return error(res, 'Group name is required', 400);
    }

    const group = await prisma.userGroup.create({
      data: {
        ownerId: userId,
        groupName,
        description: description || null,
        privacy: privacy || 'PUBLIC',
        categoryId: categoryId || null,
        coverImageKey: coverImageKey || null,
        policy: policy || null,
        totalMembers: 1,
      },
    });

    // Auto-add creator as Admin member
    await prisma.userGroupMember.create({
      data: {
        groupId: group.id,
        userId,
        memberRole: 'Admin',
        status: 'Active',
      },
    });

    return success(res, group, 201);
  } catch (err) {
    next(err);
  }
};

// GET /api/groups (discover public groups)
const discoverGroups = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      privacy: 'PUBLIC',
      status: 'Active',
      deletedAt: null,
    };

    if (search) {
      where.groupName = { contains: search, mode: 'insensitive' };
    }

    const [groups, total] = await Promise.all([
      prisma.userGroup.findMany({
        where,
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
            },
          },
          category: { select: { id: true, name: true } },
        },
        orderBy: { totalMembers: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.userGroup.count({ where }),
    ]);

    return paginated(res, groups, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /api/groups/:groupId
const getGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.userGroup.findUnique({
      where: { id: groupId },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePhotoKey: true,
          },
        },
        category: { select: { id: true, name: true } },
        _count: { select: { members: true, posts: true } },
      },
    });

    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    return success(res, group);
  } catch (err) {
    next(err);
  }
};

// PUT /api/groups/:groupId
const updateGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { groupName, description, privacy, categoryId, coverImageKey, policy } = req.body;

    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    if (group.ownerId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    const updateData = {};
    if (groupName !== undefined) updateData.groupName = groupName;
    if (description !== undefined) updateData.description = description;
    if (privacy !== undefined) updateData.privacy = privacy;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (coverImageKey !== undefined) updateData.coverImageKey = coverImageKey;
    if (policy !== undefined) updateData.policy = policy;

    const updated = await prisma.userGroup.update({
      where: { id: groupId },
      data: updateData,
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/groups/:groupId (soft delete)
const deleteGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;

    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    if (group.ownerId !== userId && req.user.role !== 'Admin') {
      return error(res, 'Not authorized', 403);
    }

    await prisma.userGroup.update({
      where: { id: groupId },
      data: { deletedAt: new Date(), status: 'Deleted' },
    });

    return success(res, { message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/groups/:groupId/join
const joinGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;

    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    // Check if already a member
    const existing = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) {
      return error(res, 'Already a member or pending', 409);
    }

    // PRIVATE groups: Pending status; PUBLIC groups: Active status
    const status = group.privacy === 'PRIVATE' ? 'Pending' : 'Active';

    const member = await prisma.userGroupMember.create({
      data: {
        groupId,
        userId,
        memberRole: 'User',
        status,
      },
    });

    // Only increment totalMembers for PUBLIC (immediately active)
    if (status === 'Active') {
      await prisma.userGroup.update({
        where: { id: groupId },
        data: { totalMembers: { increment: 1 } },
      });
    }

    return success(res, member, 201);
  } catch (err) {
    next(err);
  }
};

// POST /api/groups/:groupId/leave
const leaveGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;

    const member = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) {
      return error(res, 'Not a member of this group', 404);
    }

    await prisma.userGroupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    // Only decrement if they were Active
    if (member.status === 'Active') {
      await prisma.userGroup.update({
        where: { id: groupId },
        data: { totalMembers: { decrement: 1 } },
      });
    }

    return success(res, { message: 'Left the group' });
  } catch (err) {
    next(err);
  }
};

// GET /api/groups/:groupId/members
const listMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { groupId };
    if (status) where.status = status;

    const [members, total] = await Promise.all([
      prisma.userGroupMember.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              profilePhotoKey: true,
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
        skip,
        take: Number(limit),
      }),
      prisma.userGroupMember.count({ where }),
    ]);

    return paginated(res, members, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// PUT /api/groups/:groupId/members/:userId
const updateMember = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { groupId, userId } = req.params;
    const { memberRole, status } = req.body;

    // Check that the current user is an Admin of this group
    const currentMember = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId: currentUserId } },
    });

    if (!currentMember || currentMember.memberRole !== 'Admin') {
      if (req.user.role !== 'Admin') {
        return error(res, 'Only group admins can update members', 403);
      }
    }

    const targetMember = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!targetMember) {
      return error(res, 'Member not found', 404);
    }

    const updateData = {};
    if (memberRole !== undefined) updateData.memberRole = memberRole;
    if (status !== undefined) {
      updateData.status = status;
      // If approving a Pending member, increment totalMembers
      if (status === 'Active' && targetMember.status === 'Pending') {
        await prisma.userGroup.update({
          where: { id: groupId },
          data: { totalMembers: { increment: 1 } },
        });
      }
      // If blocking an Active member, decrement totalMembers
      if (status === 'Blocked' && targetMember.status === 'Active') {
        await prisma.userGroup.update({
          where: { id: groupId },
          data: { totalMembers: { decrement: 1 } },
        });
      }
    }

    const updated = await prisma.userGroupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: updateData,
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// GET /api/groups/me
const myGroups = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { userId, status: 'Active' };

    const [memberships, total] = await Promise.all([
      prisma.userGroupMember.findMany({
        where,
        include: {
          group: {
            include: {
              owner: {
                select: {
                  id: true,
                  username: true,
                  fullName: true,
                  profilePhotoKey: true,
                },
              },
              category: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.userGroupMember.count({ where }),
    ]);

    const groups = memberships.map((m) => ({
      ...m.group,
      memberRole: m.memberRole,
      joinedAt: m.joinedAt,
    }));

    return paginated(res, groups, total, page, limit);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createGroup,
  discoverGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  joinGroup,
  leaveGroup,
  listMembers,
  updateMember,
  myGroups,
};
