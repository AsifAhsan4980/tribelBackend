const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/ad.controller');

// Public read routes (for serving ads)
router.get('/static', ctrl.listStaticAds);
router.get('/video', ctrl.listVideoAds);

// Protected routes
router.use(authenticate);

// Ad view tracking (any authenticated user)
router.post('/:adId/view', ctrl.recordAdView);

// Ad user and admin only routes
router.post('/static', requireRole('AdUser', 'Admin'), ctrl.createStaticAd);
router.post('/video', requireRole('AdUser', 'Admin'), ctrl.createVideoAd);
router.post('/campaigns', requireRole('AdUser', 'Admin'), ctrl.createCampaign);
router.get('/campaigns', requireRole('AdUser', 'Admin'), ctrl.listCampaigns);

module.exports = router;
