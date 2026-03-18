const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/ad.controller');

// ── Public: active ads for frontend (no auth needed) ──
router.get('/active', ctrl.getActiveAdsForFrontend);

// ── Public lists (optional auth for filtering) ──
router.get('/static', ctrl.listStaticAds);
router.get('/video', ctrl.listVideoAds);

// ── All remaining routes require authentication ──
router.use(authenticate);

// ── Ad view tracking (any authenticated user) ──
router.post('/:adType/:adId/view', ctrl.recordAdView);

// ── Influencer (any authenticated user can apply) ──
router.post('/influencer/apply', ctrl.applyForInfluencer);

// ── Influencer admin management ──
router.put('/influencer/:userId/approve', requireRole('Admin'), ctrl.approveInfluencer);
router.put('/influencer/:userId/remove', requireRole('Admin'), ctrl.removeInfluencer);

// ── Highlighted users (admin) ──
router.post('/highlighted-users', requireRole('Admin'), ctrl.createHighlightedUser);
router.delete('/highlighted-users/:id', requireRole('Admin'), ctrl.deleteHighlightedUser);

// ── Ad creation (AdUser or Admin) ──
router.post('/static', requireRole('AdUser', 'Admin'), ctrl.createStaticAd);
router.post('/video', requireRole('AdUser', 'Admin'), ctrl.createVideoAd);

// ── Campaigns (AdUser or Admin) ──
router.post('/campaigns', requireRole('AdUser', 'Admin'), ctrl.createCampaign);
router.get('/campaigns', requireRole('AdUser', 'Admin'), ctrl.listCampaigns);

module.exports = router;
