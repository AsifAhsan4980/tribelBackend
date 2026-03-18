const router = require('express').Router();
const passport = require('passport');
const { authenticate, validate } = require('shared');
const {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  googleCallback,
  appleSignIn,
  getMe,
  deleteAccount,
} = require('../controllers/auth.controller');
const {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  appleTokenSchema,
} = require('../utils/validation');

// Public auth routes (no authentication required)
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshSchema), refresh);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

// Authenticated auth routes
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, validate(changePasswordSchema), changePassword);

// Google OAuth
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/api/auth/google' }),
  googleCallback
);

// Apple Sign-In
router.post('/apple', validate(appleTokenSchema), appleSignIn);

// Current user
router.get('/me', authenticate, getMe);

// Account deletion (GDPR)
router.delete('/account', authenticate, deleteAccount);

module.exports = router;
