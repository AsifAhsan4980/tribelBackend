const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/article.controller');

// Public routes
router.get('/', ctrl.listArticles);
router.get('/:articleId', ctrl.getArticle);
router.get('/:articleId/comments', ctrl.listComments);

// Protected routes
router.post('/', authenticate, ctrl.createArticle);
router.put('/:articleId', authenticate, ctrl.updateArticle);
router.delete('/:articleId', authenticate, ctrl.deleteArticle);
router.post('/:articleId/comments', authenticate, ctrl.addComment);
router.post('/:articleId/like', authenticate, ctrl.likeArticle);
router.delete('/:articleId/like', authenticate, ctrl.unlikeArticle);

module.exports = router;
