const router = require('express').Router();
const { authenticate, requireRole } = require('shared');
const ctrl = require('../controllers/article.controller');

// Public routes (no auth required)
router.get('/', ctrl.listArticles);
router.get('/:articleId', ctrl.getArticle);
router.get('/:articleId/comments', ctrl.listComments);

// Protected routes (auth required)
router.post('/', authenticate, ctrl.createArticle);
router.put('/:articleId', authenticate, ctrl.updateArticle);
router.delete('/:articleId', authenticate, ctrl.deleteArticle);

// Admin only routes (block/unblock)
router.patch('/:articleId/block', authenticate, requireRole('Admin'), ctrl.boxArticle);
router.patch('/:articleId/unblock', authenticate, requireRole('Admin'), ctrl.unboxArticle);

// Article comments
router.post('/:articleId/comments', authenticate, ctrl.addComment);
router.post('/comments/:commentId/replies', authenticate, ctrl.addReply);

// Article likes
router.post('/:articleId/like', authenticate, ctrl.likeArticle);
router.delete('/:articleId/like', authenticate, ctrl.unlikeArticle);

// Article comment likes
router.post('/comments/:commentId/like', authenticate, ctrl.likeArticleComment);
router.delete('/comments/:commentId/like', authenticate, ctrl.unlikeArticleComment);

// ── Collaboration routes (from likerslaCollaboration*Mutation) ──
router.post('/collaborations', authenticate, ctrl.createCollaboration);
router.get('/collaborations', ctrl.listCollaborations);
router.get('/collaborations/:collabId', ctrl.getCollaboration);
router.put('/collaborations/:collabId', authenticate, ctrl.updateCollaboration);
router.delete('/collaborations/:collabId', authenticate, ctrl.deleteCollaboration);
router.post('/collaborations/:collabId/comments', authenticate, ctrl.addCollaborationComment);
router.post('/collaborations/comments/:commentId/replies', authenticate, ctrl.addCollaborationReply);
router.post('/collaborations/like', authenticate, ctrl.likeCollaboration);
router.delete('/collaborations/unlike/:targetType/:targetId', authenticate, ctrl.unlikeCollaboration);

module.exports = router;
