const router = require('express').Router();
const { authenticate } = require('shared');
const commentController = require('../controllers/comment.controller');

// Comment routes
router.post('/', authenticate, commentController.createComment);
router.get('/post/:postId', authenticate, commentController.getCommentsByPost);
router.put('/:commentId', authenticate, commentController.updateComment);
router.delete('/:commentId', authenticate, commentController.deleteComment);

// Reply routes
router.post('/:commentId/replies', authenticate, commentController.createReply);
router.get('/:commentId/replies', authenticate, commentController.getRepliesByComment);
router.delete('/replies/:replyId', authenticate, commentController.deleteReply);

module.exports = router;
