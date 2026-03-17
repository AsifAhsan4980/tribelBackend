const router = require('express').Router();
const passport = require('passport');
const { authenticate, validate } = require('shared');
const {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  changePassword,
  googleCallback,
  appleSignIn,
  getMe,
} = require('../controllers/auth.controller');
const {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  forgotPasswordSchema,
  appleTokenSchema,
} = require('../utils/validation');

// Local auth
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshSchema), refresh);
router.post('/logout', authenticate, logout);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
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

module.exports = router;
