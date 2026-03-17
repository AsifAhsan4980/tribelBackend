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
          // Existing user — update tokens
          await prisma.userOAuth.update({
            where: { id: oauthAccount.id },
            data: {
              accessToken: accessToken || null,
              refreshToken: refreshToken || null,
            },
          });
          return done(null, oauthAccount.user);
        }

        // Check if a user with this email already exists
        let user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
          // Create a new user
          const baseUsername = (profile.displayName || email.split('@')[0])
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '');
          // Ensure username uniqueness by appending random digits
          let username = baseUsername;
          const existing = await prisma.user.findUnique({ where: { username } });
          if (existing) {
            username = `${baseUsername}${Date.now().toString(36)}`;
          }

          user = await prisma.user.create({
            data: {
              email,
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

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
