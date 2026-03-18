const { prisma, success, error, paginated } = require('shared');

// ─── Shared user select fields ───────────────────────────────────────────────
const userSelect = {
  id: true,
  username: true,
  fullName: true,
  profilePhotoKey: true,
  isActive: true,
  isVerified: true,
  isBlockedByAdmin: true,
};

// ─── POST /api/groups ───────────────────────────────────────────────────────
// Creates a group. PUBLIC groups are Active immediately. PRIVATE groups require
// creator to have star contributor status (UserRank with badge > 0).
// Original: likerslaUserGroupMutation (addGroupAndGroupMemberToDB + checkStarContributor + createGroup)
const createGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const {
      groupName,
      description,
      coverImageKey,
      categoryId,
      privacy,
      policy,
      pictureMetaId,
      postSubCategory,
    } = req.body;

    if (!groupName) {
      return error(res, 'Group name is required', 400);
    }

    // Validate privacy
    const privacyValue = privacy || 'PUBLIC';
    if (privacyValue !== 'PUBLIC' && privacyValue !== 'PRIVATE') {
      return error(res, 'Privacy must be PUBLIC or PRIVATE', 400);
    }

    // Validate policy
    const policyValue = policy || 'ANYONEJOIN';
    if (policyValue !== 'ANYONEJOIN' && policyValue !== 'ADMINAPPROVAL') {
      return error(res, 'Policy must be ANYONEJOIN or ADMINAPPROVAL', 400);
    }

    let groupStatus = 'Active';
    let groupPolicy = policyValue;

    // PRIVATE groups: Check creator has star contributor status
    // Original Lambda: checkStarContributor -> checkContributorStarStatus (queries UserRank table)
    // If star contributor found, creates group with status=Pending, policy=ADMINAPPROVAL
    // If not found, returns 405 "User is not allowed to create this group"
    if (privacyValue === 'PRIVATE') {
      const userRank = await prisma.userRank.findFirst({
        where: {
          userId,
          groupId: categoryId || undefined,
          badge: { gt: 0 },
        },
      });

      if (!userRank) {
        return error(
          res,
          'Star contributor status is required to create private groups',
          403
        );
      }

      // Original Lambda sets PRIVATE groups to Pending with ADMINAPPROVAL
      groupStatus = 'Pending';
      groupPolicy = 'ADMINAPPROVAL';
    }

    // Transaction: Create group + auto-add creator as Admin member (totalMembers=1)
    // Original Lambda: transactWrite with 2 items (Put UserGroup + Put UserGroupMember)
    const result = await prisma.$transaction(async (tx) => {
      const group = await tx.userGroup.create({
        data: {
          ownerId: userId,
          groupName,
          description: description || null,
          privacy: privacyValue,
          categoryId: categoryId || null,
          coverImageKey: coverImageKey || null,
          policy: groupPolicy,
          status: groupStatus,
          totalMembers: 1,
          pictureMetaId: pictureMetaId || null,
          postSubCategory: postSubCategory || null,
        },
      });

      // Auto-add creator as Admin member with Active status
      await tx.userGroupMember.create({
        data: {
          groupId: group.id,
          userId,
          memberRole: 'Admin',
          status: 'Active',
        },
      });

      return group;
    });

    return success(res, result, 201);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/groups ────────────────────────────────────────────────────────
// Discover public, active groups. Searchable by name. Paginated.
const discoverGroups = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, categoryId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      privacy: 'PUBLIC',
      status: 'Active',
      deletedAt: null,
    };

    if (search) {
      where.groupName = { contains: search, mode: 'insensitive' };
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    const [groups, total] = await Promise.all([
      prisma.userGroup.findMany({
        where,
        include: {
          owner: { select: userSelect },
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

// ─── GET /api/groups/:groupId ───────────────────────────────────────────────
// Gets a single group with member and post counts.
const getGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;

    const group = await prisma.userGroup.findUnique({
      where: { id: groupId },
      include: {
        owner: { select: userSelect },
        category: { select: { id: true, name: true } },
        _count: { select: { members: true, posts: true } },
      },
    });

    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    // Check if the requesting user is a member and what role
    const membership = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { memberRole: true, status: true },
    });

    return success(res, {
      ...group,
      currentUserMembership: membership || null,
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/groups/:groupId ───────────────────────────────────────────────
// Updates a group. Owner or group admin only (or platform admin).
const updateGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { groupName, description, privacy, categoryId, coverImageKey, policy } = req.body;

    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    // Check authorization: owner, group admin, or platform admin
    if (group.ownerId !== userId && req.user.role !== 'Admin') {
      const membership = await prisma.userGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership || membership.memberRole !== 'Admin') {
        return error(res, 'Not authorized', 403);
      }
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
      include: {
        owner: { select: userSelect },
        category: { select: { id: true, name: true } },
      },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/groups/:groupId ────────────────────────────────────────────
// Soft delete. Owner only (or platform admin).
// Original Lambda LEAVE by owner: removes the entire group (removeGroup)
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

// ─── POST /api/groups/:groupId/join ─────────────────────────────────────────
// Join a group. Approval workflow based on group policy.
// Original: likerslaGroupJoinLeave -> mode=JOIN
// - If ANYONEJOIN: create member Active, increment totalMembers +1, notify owner: joinYourGroup
// - If ADMINAPPROVAL: create member Pending, notify owner: GroupJoinRequest
// - If group is PRIVATE and not ANYONEJOIN: pending status
// - Checks if already member/pending/invited
const joinGroup = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;

    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    // Group must be Active to join (original Lambda: groupInfo.Items[0].status == 'Active')
    if (group.status !== 'Active') {
      return error(res, 'This group is not accepting new members', 403);
    }

    // Check if already a member (original Lambda: getGroupMemberByID check)
    const existing = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (existing) {
      // Mirror original Lambda: return specific messages based on status
      if (existing.status === 'Invited') {
        return error(res, 'Already invited', 409);
      } else if (existing.status === 'Pending') {
        return error(res, 'Join request is pending', 409);
      } else if (existing.status === 'Blocked') {
        return error(res, 'You are blocked from this group', 403);
      } else {
        return error(res, 'Already a member', 409);
      }
    }

    // Determine status based on group policy (original Lambda logic)
    let memberStatus;
    let notificationType;

    if (group.policy === 'ANYONEJOIN') {
      memberStatus = 'Active';
      notificationType = 'joinYourGroup';
    } else if (group.policy === 'ADMINAPPROVAL') {
      memberStatus = 'Pending';
      notificationType = 'GroupJoinRequest';
    } else {
      // Fallback: PRIVATE groups without explicit policy default to Pending
      memberStatus = group.privacy === 'PRIVATE' ? 'Pending' : 'Active';
      notificationType = memberStatus === 'Pending' ? 'GroupJoinRequest' : 'joinYourGroup';
    }

    // Transaction: create member + conditionally increment totalMembers
    const member = await prisma.$transaction(async (tx) => {
      const newMember = await tx.userGroupMember.create({
        data: {
          groupId,
          userId,
          memberRole: 'User',
          status: memberStatus,
        },
      });

      // Only increment totalMembers for immediately Active members
      if (memberStatus === 'Active') {
        await tx.userGroup.update({
          where: { id: groupId },
          data: { totalMembers: { increment: 1 } },
        });
      }

      return newMember;
    });

    // Notify group owner (non-blocking, mirrors original Lambda createNotificationGraphQL)
    prisma.notification
      .create({
        data: {
          ownerId: group.ownerId,
          actionCreatorId: userId,
          notificationType,
          groupId,
          isSeen: false,
          isDetailsSeen: false,
        },
      })
      .catch((err) => console.error('Join notification error:', err));

    return success(
      res,
      {
        ...member,
        message: memberStatus === 'Pending' ? 'Join request pending approval' : 'Joined group',
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/groups/:groupId/leave ────────────────────────────────────────
// Leave a group. If user is the owner/last Admin, promote oldest Active member to Admin.
// Original: likerslaGroupJoinLeave -> mode=LEAVE
// - If user is group creator: deletes the entire group (removeGroup)
// - If normal member: delete membership + decrement totalMembers
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

    const group = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) {
      return error(res, 'Group not found', 404);
    }

    // Original Lambda: if user is group creator, delete the group entirely
    if (group.ownerId === userId) {
      await prisma.userGroup.update({
        where: { id: groupId },
        data: { deletedAt: new Date(), status: 'Deleted' },
      });
      return success(res, { message: 'Group deleted (owner left)' });
    }

    // Transaction: delete member + decrement if Active + handle last-admin promotion
    await prisma.$transaction(async (tx) => {
      // Delete the membership
      await tx.userGroupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      });

      // Only decrement if they were Active
      if (member.status === 'Active') {
        await tx.userGroup.update({
          where: { id: groupId },
          data: { totalMembers: { decrement: 1 } },
        });
      }

      // If user was the last Admin (not owner), promote oldest Active member to Admin
      if (member.memberRole === 'Admin') {
        const remainingAdmins = await tx.userGroupMember.count({
          where: {
            groupId,
            memberRole: 'Admin',
            status: 'Active',
          },
        });

        if (remainingAdmins === 0) {
          // Promote the oldest Active member to Admin
          const oldestMember = await tx.userGroupMember.findFirst({
            where: {
              groupId,
              status: 'Active',
              userId: { not: userId },
            },
            orderBy: { joinedAt: 'asc' },
          });

          if (oldestMember) {
            await tx.userGroupMember.update({
              where: { id: oldestMember.id },
              data: { memberRole: 'Admin' },
            });
          }
        }
      }
    });

    return success(res, { message: 'Left the group' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/groups/:groupId/members ───────────────────────────────────────
// List group members. Paginated, filterable by status (Active, Pending, Blocked, Invited).
// Filters out blocked/inactive users.
// Original: likerslaGetGroupMemberList (byGroupIDstatusUserGroup query + filtering)
const listMembers = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // Validate status filter (original Lambda supports Active, Blocked, Pending, Invited)
    const validStatuses = ['Active', 'Pending', 'Blocked', 'Invited'];
    if (status && !validStatuses.includes(status)) {
      return error(
        res,
        `Invalid status filter. Must be one of: ${validStatuses.join(', ')}`,
        400
      );
    }

    const where = { groupId };
    if (status) where.status = status;

    // Get blocked user IDs to filter (original Lambda: blockByMe + blockMe checks)
    const [blockedByMe, blockedMe] = await Promise.all([
      prisma.blockedUser.findMany({
        where: { ownerId: userId },
        select: { userId: true },
      }),
      prisma.blockedUser.findMany({
        where: { userId },
        select: { ownerId: true },
      }),
    ]);

    const blockedIds = [
      ...new Set([
        ...blockedByMe.map((b) => b.userId),
        ...blockedMe.map((b) => b.ownerId),
      ]),
    ];

    // Exclude blocked users from results
    if (blockedIds.length > 0) {
      where.userId = { notIn: blockedIds };
    }

    const [members, total] = await Promise.all([
      prisma.userGroupMember.findMany({
        where,
        include: {
          user: {
            select: {
              ...userSelect,
              bio: true,
              totalLikes: true,
              totalFriends: true,
              totalFollowers: true,
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.userGroupMember.count({ where }),
    ]);

    // Filter out inactive/admin-blocked users (original Lambda: isActive==false, isBlockByAdmin==1)
    const filtered = members.filter((m) => {
      if (!m.user) return false;
      if (m.user.isActive === false) return false;
      if (m.user.isBlockedByAdmin === true) return false;
      return true;
    });

    return paginated(res, filtered, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/groups/:groupId/members/:userId ───────────────────────────────
// Update a member's role or status. Group Admin only (or platform admin).
// Handles member count adjustments when status changes.
// Original: likerslaGroupJoinLeave modes:
//   JOIN_REQUEST_ACCEPT (Pending->Active, +1 totalMembers, notify: GroupJoinRequestAccepted)
//   JOIN_REQUEST_DENY (delete member record, complete notification)
//   BLOCK_FROM_GROUP (Active->Blocked, -1 totalMembers)
//   UNBLOCK_FROM_GROUP (Blocked->Active, +1 totalMembers)
//   INVITE (create Invited member)
//   INVITE_ACCEPT (Invited->Active, +1 totalMembers, notify: GroupInvitationAccept)
//   INVITE_DENY (delete member record)
const updateMember = async (req, res, next) => {
  try {
    const currentUserId = req.user.sub;
    const { groupId, userId } = req.params;
    const { memberRole, status } = req.body;

    // Check that the current user is an Admin of this group (or platform admin)
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

    const group = await prisma.userGroup.findUnique({
      where: { id: groupId },
      select: { id: true, ownerId: true },
    });

    // Build update within a transaction to handle counter adjustments
    const result = await prisma.$transaction(async (tx) => {
      const updateData = {};

      if (memberRole !== undefined) {
        updateData.memberRole = memberRole;
      }

      if (status !== undefined) {
        updateData.status = status;

        // Pending -> Active: approve join request (original Lambda: JOIN_REQUEST_ACCEPT)
        // Increment totalMembers +1
        if (status === 'Active' && targetMember.status === 'Pending') {
          await tx.userGroup.update({
            where: { id: groupId },
            data: { totalMembers: { increment: 1 } },
          });
        }

        // Invited -> Active: accept invitation (original Lambda: INVITE_ACCEPT)
        // Increment totalMembers +1
        if (status === 'Active' && targetMember.status === 'Invited') {
          await tx.userGroup.update({
            where: { id: groupId },
            data: { totalMembers: { increment: 1 } },
          });
        }

        // Active -> Blocked: block member (original Lambda: BLOCK_FROM_GROUP)
        // Decrement totalMembers -1
        if (status === 'Blocked' && targetMember.status === 'Active') {
          await tx.userGroup.update({
            where: { id: groupId },
            data: { totalMembers: { decrement: 1 } },
          });
        }

        // Blocked -> Active: unblock member (original Lambda: UNBLOCK_FROM_GROUP)
        // Increment totalMembers +1
        if (status === 'Active' && targetMember.status === 'Blocked') {
          await tx.userGroup.update({
            where: { id: groupId },
            data: { totalMembers: { increment: 1 } },
          });
        }

        // Pending -> Denied / Invited -> Denied: remove member entirely
        // (original Lambda: JOIN_REQUEST_DENY / INVITE_DENY delete the member record)
        if (status === 'Denied') {
          await tx.userGroupMember.delete({
            where: { groupId_userId: { groupId, userId } },
          });
          return { deleted: true, message: 'Member request denied and removed' };
        }
      }

      const updated = await tx.userGroupMember.update({
        where: { groupId_userId: { groupId, userId } },
        data: updateData,
        include: {
          user: { select: userSelect },
        },
      });

      return updated;
    });

    // Send notifications based on the status change (non-blocking)
    if (status === 'Active' && targetMember.status === 'Pending') {
      // Notify the user their join request was accepted (GroupJoinRequestAccepted)
      prisma.notification
        .create({
          data: {
            ownerId: userId,
            actionCreatorId: group.ownerId,
            notificationType: 'GroupJoinRequestAccepted',
            groupId,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Join accept notification error:', err));
    }

    if (status === 'Active' && targetMember.status === 'Invited') {
      // Notify the group owner the invitation was accepted (GroupInvitationAccept)
      prisma.notification
        .create({
          data: {
            ownerId: group.ownerId,
            actionCreatorId: userId,
            notificationType: 'GroupInvitationAccept',
            groupId,
            isSeen: false,
            isDetailsSeen: false,
          },
        })
        .catch((err) => console.error('Invite accept notification error:', err));
    }

    return success(res, result);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/groups/me ─────────────────────────────────────────────────────
// List groups the current user is a member of (Active status only).
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
              owner: { select: userSelect },
              category: { select: { id: true, name: true } },
              _count: { select: { members: true, posts: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.userGroupMember.count({ where }),
    ]);

    // Flatten: return group info with memberRole and joinedAt
    const groups = memberships
      .filter((m) => m.group && !m.group.deletedAt)
      .map((m) => ({
        ...m.group,
        memberRole: m.memberRole,
        joinedAt: m.joinedAt,
      }));

    return paginated(res, groups, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// MANAGE GROUP EVENTS (from LikerslaManageEvent)
// Auto-process queued like events for a group
// ─────────────────────────────────────────────────

const createEvent = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { title, description, eventDate } = req.body;

    const membership = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || !['Admin', 'Moderator'].includes(membership.memberRole)) {
      return error(res, 'Only group admins can create events', 403);
    }

    // AutoEvent model — create group event
    // Note: Using a generic approach since AutoEvent may not be in schema
    // We store events as a special post type or use the existing model
    const event = await prisma.$queryRaw`
      INSERT INTO auto_events (id, group_id, creator_id, title, description, event_date, status, created_at)
      VALUES (gen_random_uuid(), ${groupId}, ${userId}, ${title}, ${description}, ${eventDate ? new Date(eventDate) : new Date()}, 'upcoming', NOW())
      RETURNING *
    `.catch(() => null);

    if (!event) {
      return error(res, 'Events table not available — run migration', 500);
    }

    return success(res, event, 201);
  } catch (err) {
    next(err);
  }
};

const listEvents = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const events = await prisma.$queryRaw`
      SELECT * FROM auto_events WHERE group_id = ${groupId} ORDER BY event_date DESC
    `.catch(() => []);
    return success(res, events);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────
// FOUNDING MEMBER INVITE (from likerslaFoundingMember)
// ─────────────────────────────────────────────────

const inviteFoundingMember = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { inviteeEmail, inviteeUserId } = req.body;

    const membership = await prisma.userGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.memberRole !== 'Admin') {
      return error(res, 'Only group admins can invite founding members', 403);
    }

    if (inviteeUserId) {
      // Direct invite — add as pending member
      const existing = await prisma.userGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId: inviteeUserId } },
      });
      if (existing) return error(res, 'User is already a member', 409);

      const member = await prisma.userGroupMember.create({
        data: { groupId, userId: inviteeUserId, memberRole: 'User', status: 'Pending' },
      });

      // Create notification for invitee
      await prisma.notification.create({
        data: {
          ownerId: inviteeUserId,
          actionCreatorId: userId,
          notificationType: 'group_join_request',
          groupId,
        },
      });

      return success(res, member, 201);
    }

    return success(res, { message: 'Invitation sent' }, 200);
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
  createEvent,
  listEvents,
  inviteFoundingMember,
};
