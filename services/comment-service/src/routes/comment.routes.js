const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/comment.controller');

// ─── Post Comments ─────────────────────────────────────
router.post('/', authenticate, ctrl.createComment);
router.get('/post/:postId', authenticate, ctrl.getCommentsByPost);
router.put('/:commentId', authenticate, ctrl.updateComment);
router.delete('/:commentId', authenticate, ctrl.deleteComment);

// ─── Replies ───────────────────────────────────────────
router.post('/:commentId/replies', authenticate, ctrl.createReply);
router.get('/:commentId/replies', authenticate, ctrl.getRepliesByComment);
router.delete('/replies/:replyId', authenticate, ctrl.deleteReply);

module.exports = router;
