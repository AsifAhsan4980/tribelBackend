const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/media.controller');

router.use(authenticate);

router.post('/upload-url', ctrl.getUploadUrl);
router.post('/confirm', ctrl.confirmUpload);
router.get('/post/:postId', ctrl.getMediaForPost);
router.post('/link-preview', ctrl.linkPreview);
router.get('/:id', ctrl.getMedia);
router.delete('/:id', ctrl.deleteMedia);

module.exports = router;
