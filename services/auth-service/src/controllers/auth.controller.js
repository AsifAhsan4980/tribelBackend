const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const appleSignin = require('apple-signin-auth');
const {
  prisma,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  success,
  error,
} = require('shared');

// ─── Constants ────────────────────────────────────────────────────────────────

const SALT_ROUNDS = 10;
const REFRESH_EXPIRY_DAYS = 30;
const RESET_TOKEN_EXPIRY_HOURS = 1;
const SUPPORT_USER_ID = process.env.SUPPORT_USER_ID || null;
const WELCOME_MESSAGE = process.env.WELCOME_MESSAGE || "Welcome to Tribel family! We're glad you're here.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hash a raw token with SHA-256 for secure storage in DB.
 */
const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Create an access + refresh token pair for a user.
 * Stores the refresh token hash in the database.
 */
const issueTokens = async (user, { deviceId, ipAddress, userAgent } = {}) => {
  const accessToken = signAccessToken(user);

  // Create the RefreshToken row with a temporary placeholder hash
  const refreshRow = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: crypto.randomUUID(), // temporary placeholder
      deviceId: deviceId || null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  // Sign the refresh JWT using the row id as jti
  const rawRefreshToken = signRefreshToken(user, refreshRow.id);
  const tokenHash = hashToken(rawRefreshToken);

  // Update with real hash
  await prisma.refreshToken.update({
    where: { id: refreshRow.id },
    data: { tokenHash },
  });

  return { accessToken, refreshToken: rawRefreshToken };
};

/**
 * Sanitize a user record for API response.
 */
const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: user.fullName,
  role: user.role,
  profilePhotoKey: user.profilePhotoKey,
  isAccountVerified: user.isAccountVerified,
});

/**
 * Post-registration side-effects (from likerslaPostConfirmation):
 * 1. Auto-friend with support account (bidirectional, status=accepted)
 * 2. Create welcome chat room with welcome message
 * 3. Create welcome notification
 */
const runPostRegistration = async (newUser) => {
  if (!SUPPORT_USER_ID) {
    console.warn('SUPPORT_USER_ID not configured. Skipping post-registration actions.');
    return;
  }

  // Verify support user exists
  const supportUser = await prisma.user.findUnique({
    where: { id: SUPPORT_USER_ID },
    select: { id: true, accountStatus: true },
  });

  if (!supportUser || supportUser.accountStatus !== 'active') {
    console.warn('Support user not found or inactive. Skipping post-registration actions.');
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Auto-friend with support account (bidirectional)
      await tx.userFriend.createMany({
        data: [
          {
            userId: newUser.id,
            friendUserId: SUPPORT_USER_ID,
            status: 'accepted',
            isFollower: false,
          },
          {
            userId: SUPPORT_USER_ID,
            friendUserId: newUser.id,
            status: 'accepted',
            isFollower: false,
          },
        ],
        skipDuplicates: true,
      });

      // Increment totalFriends for both users
      await tx.user.update({
        where: { id: newUser.id },
        data: { totalFriends: { increment: 1 } },
      });

      await tx.user.update({
        where: { id: SUPPORT_USER_ID },
        data: { totalFriends: { increment: 1 } },
      });

      // 2. Create welcome chat room
      const chatRoom = await tx.userChatRoom.create({
        data: {
          ownerId: newUser.id,
          receiverId: SUPPORT_USER_ID,
          roomType: 'direct',
          status: 'Active',
          lastMessageAt: new Date(),
        },
      });

      // Create welcome message from the support account
      await tx.message.create({
        data: {
          roomId: chatRoom.id,
          senderId: SUPPORT_USER_ID,
          receiverId: newUser.id,
          content: WELCOME_MESSAGE,
          contentType: 'Text',
          sentAt: new Date(),
        },
      });

      // 3. Create welcome notification
      await tx.notification.create({
        data: {
          ownerId: newUser.id,
          actionCreatorId: SUPPORT_USER_ID,
          notificationType: 'system',
          isSeen: false,
          notificationDate: new Date(),
        },
      });
    });
  } catch (err) {
    // Post-registration is best-effort; don't fail the registration
    console.error('Post-registration error:', err.message);
  }
};

// ─── Register ─────────────────────────────────────────────────────────────────

exports.register = async (req, res, next) => {
  try {
    const { email, password, username, firstName, lastName } = req.body;

    // Check if email or username already taken
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: email.toLowerCase() }, { username }],
      },
    });

    if (existingUser) {
      const field = existingUser.email === email.toLowerCase() ? 'Email' : 'Username';
      return error(res, `${field} already in use`, 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
        emailVerified: false,
        signupDate: new Date(),
        lastActiveAt: new Date(),
      },
    });

    const tokens = await issueTokens(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Run post-registration side-effects asynchronously (fire-and-forget)
    runPostRegistration(user).catch((err) => {
      console.error('Post-registration async error:', err.message);
    });

    return success(
      res,
      {
        ...tokens,
        user: sanitizeUser(user),
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user) {
      return error(res, 'Invalid email or password', 401);
    }

    if (user.accountStatus === 'deleted') {
      return error(res, 'This account has been deleted', 403);
    }

    if (user.accountStatus === 'blocked') {
      return error(res, 'Your account has been blocked. Please contact support.', 403);
    }

    if (user.accountStatus === 'deactivated') {
      return error(res, 'Your account is deactivated. Please reactivate your account.', 403);
    }

    if (!user.passwordHash) {
      return error(res, 'This account uses social login. Please sign in with Google or Apple.', 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return error(res, 'Invalid email or password', 401);
    }

    // Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const tokens = await issueTokens(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return success(res, {
      ...tokens,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Refresh ──────────────────────────────────────────────────────────────────

exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    // Verify JWT signature and decode
    let decoded;
    try {
      decoded = verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    // Look up the hashed token in DB
    const tokenHash = hashToken(refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      return error(res, 'Refresh token not found', 401);
    }

    if (storedToken.revokedAt) {
      // Token reuse detected -- revoke all tokens for this user (security measure)
      await prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return error(res, 'Refresh token has been revoked. All sessions terminated for security.', 401);
    }

    if (new Date() > storedToken.expiresAt) {
      return error(res, 'Refresh token has expired', 401);
    }

    if (storedToken.user.accountStatus !== 'active') {
      return error(res, `Account is ${storedToken.user.accountStatus}`, 403);
    }

    // Issue new access token (keep the same refresh token)
    const accessToken = signAccessToken(storedToken.user);

    return success(res, { accessToken });
  } catch (err) {
    next(err);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return success(res, { message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Forgot Password ─────────────────────────────────────────────────────────

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (user && user.accountStatus === 'active' && user.passwordHash) {
      // Generate a cryptographically random reset token
      const rawResetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = hashToken(rawResetToken);
      const resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

      // Store the hash in the user record (reuse passwordHash field is not ideal;
      // instead we store in a dedicated field approach: use a RefreshToken row with a special flag)
      // For simplicity, we create a RefreshToken with a known deviceId prefix to identify it as reset token.
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: resetTokenHash,
          deviceId: 'password-reset',
          expiresAt: resetTokenExpiry,
        },
      });

      // In production, send email with the raw token:
      // Example: `${FRONTEND_URL}/reset-password?token=${rawResetToken}&email=${email}`
      console.log(`[FORGOT-PASSWORD] Reset token for ${email}: ${rawResetToken}`);
      // TODO: integrate with email service (SendGrid, SES, etc.)
    }

    // Always return success to prevent email enumeration
    return success(res, {
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
};

// ─── Reset Password (validate token and update password) ──────────────────────

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, email, newPassword } = req.body;

    if (!token || !email || !newPassword) {
      return error(res, 'token, email, and newPassword are required', 400);
    }

    if (newPassword.length < 8) {
      return error(res, 'Password must be at least 8 characters', 400);
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return error(res, 'Invalid or expired reset token', 400);
    }

    // Look up the reset token
    const resetTokenHash = hashToken(token);
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        userId: user.id,
        tokenHash: resetTokenHash,
        deviceId: 'password-reset',
        revokedAt: null,
      },
    });

    if (!storedToken) {
      return error(res, 'Invalid or expired reset token', 400);
    }

    if (new Date() > storedToken.expiresAt) {
      // Clean up expired token
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      return error(res, 'Reset token has expired. Please request a new one.', 400);
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password, revoke the reset token, and revoke all refresh tokens
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      // Revoke the reset token
      prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      }),
      // Revoke all existing refresh tokens for security
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null, deviceId: { not: 'password-reset' } },
        data: { revokedAt: new Date() },
      }),
    ]);

    return success(res, { message: 'Password reset successfully. Please log in with your new password.' });
  } catch (err) {
    next(err);
  }
};

// ─── Change Password ──────────────────────────────────────────────────────────

exports.changePassword = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { oldPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    if (!user.passwordHash) {
      return error(res, 'This account uses social login and has no password to change.', 400);
    }

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) {
      return error(res, 'Current password is incorrect', 401);
    }

    if (oldPassword === newPassword) {
      return error(res, 'New password must be different from the current password', 400);
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password and revoke all existing refresh tokens
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Issue fresh tokens
    const tokens = await issueTokens(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return success(res, {
      message: 'Password changed successfully',
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Google OAuth Callback ────────────────────────────────────────────────────

exports.googleCallback = async (req, res, next) => {
  try {
    // req.user is set by passport after successful authentication
    const user = req.user;

    if (!user) {
      return error(res, 'Google authentication failed', 401);
    }

    // Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const tokens = await issueTokens(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return success(res, {
      ...tokens,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Apple Sign-In ────────────────────────────────────────────────────────────

exports.appleSignIn = async (req, res, next) => {
  try {
    const { idToken, firstName, lastName } = req.body;

    // Verify the Apple id_token
    let applePayload;
    try {
      applePayload = await appleSignin.verifyIdToken(idToken, {
        audience: process.env.APPLE_CLIENT_ID,
        ignoreExpiration: false,
      });
    } catch {
      return error(res, 'Invalid Apple ID token', 401);
    }

    const { sub: appleUserId, email } = applePayload;

    if (!email) {
      return error(res, 'Apple Sign-In did not provide an email address', 400);
    }

    // Check if an OAuth account already exists
    let oauthAccount = await prisma.userOAuth.findUnique({
      where: {
        provider_providerId: {
          provider: 'apple',
          providerId: appleUserId,
        },
      },
      include: { user: true },
    });

    let user;
    let isNewUser = false;

    if (oauthAccount) {
      user = oauthAccount.user;
    } else {
      // Check if a user with this email exists
      user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

      if (!user) {
        // Create new user
        const baseUsername = (email.split('@')[0] || 'user')
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '');
        let username = baseUsername;
        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) {
          username = `${baseUsername}${Date.now().toString(36)}`;
        }

        user = await prisma.user.create({
          data: {
            email: email.toLowerCase(),
            username,
            firstName: firstName || null,
            lastName: lastName || null,
            fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
            emailVerified: true,
            signupDate: new Date(),
            lastActiveAt: new Date(),
          },
        });

        isNewUser = true;
      }

      // Create OAuth link
      await prisma.userOAuth.create({
        data: {
          userId: user.id,
          provider: 'apple',
          providerId: appleUserId,
        },
      });
    }

    // Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const tokens = await issueTokens(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Run post-registration for new social sign-up users
    if (isNewUser) {
      runPostRegistration(user).catch((err) => {
        console.error('Post-registration async error:', err.message);
      });
    }

    return success(res, {
      ...tokens,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get Me ───────────────────────────────────────────────────────────────────

exports.getMe = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
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
        primaryPhoneNo: true,
        primaryPhoneCc: true,
        isPrimaryPhoneVerified: true,
        secondaryEmail: true,
        emailVerified: true,
        isAccountVerified: true,
        accountStatus: true,
        role: true,
        isLikerUser: true,
        isInfluencer: true,
        signupDate: true,
        lastActiveAt: true,
        createdAt: true,
        updatedAt: true,
        // Onboarding flags
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
      },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    return success(res, user);
  } catch (err) {
    next(err);
  }
};

// ─── Delete Account (GDPR — from likerslaRevokeUserToken) ────────────────────

exports.deleteAccount = async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Verify the user exists and get current status
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, accountStatus: true },
    });

    if (!user) {
      return error(res, 'User not found', 404);
    }

    if (user.accountStatus === 'deleted') {
      return error(res, 'Account already deleted', 400);
    }

    const now = new Date();
    const anonymizedEmail = `deleted_${userId}@deleted.tribel.com`;

    // Run the entire cascade deletion in a single transaction
    await prisma.$transaction(async (tx) => {
      // 1. Delete all UserRank records
      await tx.userRank.deleteMany({ where: { userId } });

      // 2. Soft-delete all posts (mark isDeleted=true)
      await tx.post.updateMany({
        where: { userId },
        data: { isDeleted: true, deletedAt: now },
      });

      // 3. Delete all UserGroupMember records
      await tx.userGroupMember.deleteMany({ where: { userId } });

      // 4. Delete all notifications where user is the action creator
      await tx.notification.deleteMany({ where: { actionCreatorId: userId } });

      // Also delete notifications owned by the user
      await tx.notification.deleteMany({ where: { ownerId: userId } });

      // 5. Delete all UserFollower records (both directions)
      await tx.userFollower.deleteMany({
        where: { OR: [{ userId }, { followerId: userId }] },
      });

      // 6. Delete all UserFriend records (both directions)
      await tx.userFriend.deleteMany({
        where: { OR: [{ userId }, { friendUserId: userId }] },
      });

      // 7. Delete all BlockedUser records (both directions)
      await tx.blockedUser.deleteMany({
        where: { OR: [{ userId }, { blockedId: userId }] },
      });

      // 8. Delete all RefreshToken records
      await tx.refreshToken.deleteMany({ where: { userId } });

      // 9. Delete all PushNotificationSubscriber records
      await tx.pushNotificationSubscriber.deleteMany({ where: { userId } });

      // 10. Delete OAuth accounts
      await tx.userOAuth.deleteMany({ where: { userId } });

      // 11. Soft-delete comments and replies
      await tx.postComment.updateMany({
        where: { userId },
        data: { isDeleted: true, deletedAt: now },
      });

      await tx.postCommentReply.updateMany({
        where: { userId },
        data: { isDeleted: true, deletedAt: now },
      });

      // 12. Delete likes
      await tx.like.deleteMany({ where: { userId } });

      // 13. Delete stories
      await tx.story.deleteMany({ where: { userId } });

      // 14. Delete articles (soft delete)
      await tx.article.updateMany({
        where: { userId },
        data: { deletedAt: now },
      });

      // 15. Delete messages (soft delete)
      await tx.message.updateMany({
        where: { senderId: userId },
        data: { isDeleted: true },
      });

      // 16. Delete search history
      await tx.userSearchHistory.deleteMany({ where: { userId } });

      // 17. Delete user interests
      await tx.userInterest.deleteMany({ where: { userId } });

      // 18. Delete user education, experience, awards, certificates
      await tx.userEducation.deleteMany({ where: { userId } });
      await tx.userProfessionalExperience.deleteMany({ where: { userId } });
      await tx.userHonorsAward.deleteMany({ where: { userId } });
      await tx.userCertificate.deleteMany({ where: { userId } });

      // 19. Delete filter selections
      await tx.userFilterSelection.deleteMany({ where: { userId } });

      // 20. Delete daily activity
      await tx.userDailyActivity.deleteMany({ where: { userId } });

      // 21. Delete login info
      await tx.userLoginInfo.deleteMany({ where: { userId } });

      // 22. Soft-delete the user: anonymize email, mark as deleted
      await tx.user.update({
        where: { id: userId },
        data: {
          accountStatus: 'deleted',
          deletedAt: now,
          email: anonymizedEmail,
          passwordHash: null,
          firstName: null,
          lastName: null,
          fullName: 'Deleted User',
          bio: null,
          headline: null,
          profilePhotoKey: null,
          coverPhotoKey: null,
          primaryPhoneNo: null,
          primaryPhoneCc: null,
          secondaryEmail: null,
          totalFollowers: 0,
          totalFollowing: 0,
          totalFriends: 0,
        },
      });
    });

    return success(res, { message: 'Account deleted successfully. All personal data has been removed.' });
  } catch (err) {
    next(err);
  }
};
