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

// ─── Helpers ───────────────────────────────────────────────

const SALT_ROUNDS = 10;
const REFRESH_EXPIRY_DAYS = 30;

/**
 * Hash a raw refresh token with SHA-256 for storage in DB.
 */
const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Create an access + refresh token pair for a user.
 * Stores the refresh token hash in the database.
 */
const issueTokens = async (user, { deviceId, ipAddress, userAgent } = {}) => {
  const accessToken = signAccessToken(user);

  // signRefreshToken expects (user, jti) — we use the RefreshToken row id as jti
  // We need to create the row first with a placeholder, then update
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

  const rawRefreshToken = signRefreshToken(user, refreshRow.id);
  const tokenHash = hashToken(rawRefreshToken);

  // Update with real hash
  await prisma.refreshToken.update({
    where: { id: refreshRow.id },
    data: { tokenHash },
  });

  return { accessToken, refreshToken: rawRefreshToken };
};

// ─── Register ──────────────────────────────────────────────

exports.register = async (req, res, next) => {
  try {
    const { email, password, username, firstName, lastName } = req.body;

    // Check if email or username already taken
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'Email' : 'Username';
      return error(res, `${field} already in use`, 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email,
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

    return success(
      res,
      {
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

// ─── Login ─────────────────────────────────────────────────

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return error(res, 'Invalid email or password', 401);
    }

    if (user.accountStatus !== 'active') {
      return error(res, `Account is ${user.accountStatus}`, 403);
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
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Refresh ───────────────────────────────────────────────

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
      return error(res, 'Refresh token has been revoked', 401);
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

// ─── Logout ────────────────────────────────────────────────

exports.logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
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

// ─── Forgot Password ──────────────────────────────────────

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    // Check user exists (do not reveal if they don't)
    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    return success(res, {
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
};

// ─── Change Password ──────────────────────────────────────

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

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Revoke all existing refresh tokens for security
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

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

// ─── Google OAuth Callback ─────────────────────────────────

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

    // For OAuth flows, redirect with tokens as query params (or return JSON)
    // Returning JSON for API clients
    return success(res, {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Apple Sign-In ─────────────────────────────────────────

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

    if (oauthAccount) {
      user = oauthAccount.user;
    } else {
      // Check if a user with this email exists
      user = await prisma.user.findUnique({ where: { email } });

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
            email,
            username,
            firstName: firstName || null,
            lastName: lastName || null,
            fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
            emailVerified: true,
            signupDate: new Date(),
            lastActiveAt: new Date(),
          },
        });
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

    return success(res, {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get Me ────────────────────────────────────────────────

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
