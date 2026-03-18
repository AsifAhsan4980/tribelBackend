const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const {
  createPost,
  getPost,
  updatePost,
  deletePost,
  changeVisibility,
  changeCategory,
  boxPost,
  unboxPost,
  sharePost,
  manageHashtags,
  pinPost,
  unpinPost,
  getNextPreviousPost,
  getCategories,
  getSinglePostEnriched,
} = require('../controllers/post.controller');

// ── Static / non-parameterised routes (before :postId to avoid conflicts) ──

router.get('/categories', authenticate, getCategories);

// ── Enriched single-post detail view ────────────────────────────────────────

router.get('/single/:postId', authenticate, getSinglePostEnriched);

// ── CRUD ────────────────────────────────────────────────────────────────────

router.post('/', authenticate, createPost);
router.get('/:postId', authenticate, getPost);
router.put('/:postId', authenticate, updatePost);
router.delete('/:postId', authenticate, deletePost);

// ── Visibility ──────────────────────────────────────────────────────────────

router.patch('/:postId/visibility', authenticate, changeVisibility);

// ── Category (admin only) ───────────────────────────────────────────────────

router.patch(
  '/:postId/category',
  authenticate,
  requireRole('Admin'),
  changeCategory
);

// ── Block / Unblock (admin only) ────────────────────────────────────────────

router.patch(
  '/:postId/block',
  authenticate,
  requireRole('Admin'),
  boxPost
);

router.patch(
  '/:postId/unblock',
  authenticate,
  requireRole('Admin'),
  unboxPost
);

// ── Share ────────────────────────────────────────────────────────────────────

router.post('/:postId/share', authenticate, sharePost);

// ── Hashtags management ─────────────────────────────────────────────────────

router.post('/:postId/hashtags', authenticate, manageHashtags);

// ── Pin / Unpin (admin only) ────────────────────────────────────────────────

router.post(
  '/:postId/pin',
  authenticate,
  requireRole('Admin'),
  pinPost
);

router.delete(
  '/:postId/pin',
  authenticate,
  requireRole('Admin'),
  unpinPost
);

// ── Next / Previous post navigation ─────────────────────────────────────────

router.get('/:postId/nav', authenticate, getNextPreviousPost);

module.exports = router;
