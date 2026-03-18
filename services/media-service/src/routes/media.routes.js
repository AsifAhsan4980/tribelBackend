const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/media.controller');

// All media routes require authentication
router.use(authenticate);

// Upload & confirm
router.post('/upload-url', ctrl.getPresignedUrl);
router.post('/confirm', ctrl.confirmUpload);

// Link preview
router.post('/link-preview', ctrl.getLinkPreview);

// Get media for a specific post
router.get('/post/:postId', ctrl.getMediaForPost);

// Single media CRUD
router.get('/:id', ctrl.getMedia);
router.delete('/:id', ctrl.deleteMedia);

module.exports = router;
