const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { prisma } = require('shared');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('No email found in Google profile'), null);
        }

        const normalizedEmail = email.toLowerCase();

        // Check if an OAuth account already exists for this Google ID
        let oauthAccount = await prisma.userOAuth.findUnique({
          where: {
            provider_providerId: {
              provider: 'google',
              providerId: profile.id,
            },
          },
          include: { user: true },
        });

        if (oauthAccount) {
          // Existing user -- update OAuth tokens
          await prisma.userOAuth.update({
            where: { id: oauthAccount.id },
            data: {
              accessToken: accessToken || null,
              refreshToken: refreshToken || null,
            },
          });

          // Check account status
          if (oauthAccount.user.accountStatus !== 'active') {
            return done(new Error(`Account is ${oauthAccount.user.accountStatus}`), null);
          }

          return done(null, oauthAccount.user);
        }

        // Check if a user with this email already exists
        let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        let isNewUser = false;

        if (!user) {
          // Create a new user
          const baseUsername = (profile.displayName || email.split('@')[0])
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '');
          let username = baseUsername;
          const existing = await prisma.user.findUnique({ where: { username } });
          if (existing) {
            username = `${baseUsername}${Date.now().toString(36)}`;
          }

          user = await prisma.user.create({
            data: {
              email: normalizedEmail,
              username,
              firstName: profile.name?.givenName || null,
              lastName: profile.name?.familyName || null,
              fullName: profile.displayName || null,
              profilePhotoKey: profile.photos?.[0]?.value || null,
              emailVerified: true,
              signupDate: new Date(),
              lastActiveAt: new Date(),
            },
          });

          isNewUser = true;
        }

        // Create the OAuth link
        await prisma.userOAuth.create({
          data: {
            userId: user.id,
            provider: 'google',
            providerId: profile.id,
            accessToken: accessToken || null,
            refreshToken: refreshToken || null,
          },
        });

        // Run post-registration for new Google sign-up users
        if (isNewUser) {
          // Import runPostRegistration dynamically to avoid circular deps
          // Fire-and-forget: post-registration is best-effort
          const SUPPORT_USER_ID = process.env.SUPPORT_USER_ID || null;
          const WELCOME_MESSAGE = process.env.WELCOME_MESSAGE || "Welcome to Tribel family! We're glad you're here.";

          if (SUPPORT_USER_ID) {
            (async () => {
              try {
                const supportUser = await prisma.user.findUnique({
                  where: { id: SUPPORT_USER_ID },
                  select: { id: true, accountStatus: true },
                });

                if (supportUser && supportUser.accountStatus === 'active') {
                  await prisma.$transaction(async (tx) => {
                    // Auto-friend bidirectional
                    await tx.userFriend.createMany({
                      data: [
                        { userId: user.id, friendUserId: SUPPORT_USER_ID, status: 'accepted' },
                        { userId: SUPPORT_USER_ID, friendUserId: user.id, status: 'accepted' },
                      ],
                      skipDuplicates: true,
                    });

                    await tx.user.update({
                      where: { id: user.id },
                      data: { totalFriends: { increment: 1 } },
                    });

                    await tx.user.update({
                      where: { id: SUPPORT_USER_ID },
                      data: { totalFriends: { increment: 1 } },
                    });

                    // Welcome chat room
                    const chatRoom = await tx.userChatRoom.create({
                      data: {
                        ownerId: user.id,
                        receiverId: SUPPORT_USER_ID,
                        roomType: 'direct',
                        status: 'Active',
                        lastMessageAt: new Date(),
                      },
                    });

                    await tx.message.create({
                      data: {
                        roomId: chatRoom.id,
                        senderId: SUPPORT_USER_ID,
                        receiverId: user.id,
                        content: WELCOME_MESSAGE,
                        contentType: 'Text',
                        sentAt: new Date(),
                      },
                    });

                    // Welcome notification
                    await tx.notification.create({
                      data: {
                        ownerId: user.id,
                        actionCreatorId: SUPPORT_USER_ID,
                        notificationType: 'system',
                        isSeen: false,
                        notificationDate: new Date(),
                      },
                    });
                  });
                }
              } catch (err) {
                console.error('Google OAuth post-registration error:', err.message);
              }
            })();
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
