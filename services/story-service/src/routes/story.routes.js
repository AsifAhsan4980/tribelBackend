const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/story.controller');

// All story routes require authentication
router.use(authenticate);

// Story CRUD
router.post('/', ctrl.createStory);
router.get('/feed', ctrl.getStoryFeed);
router.get('/me', ctrl.getMyStories);
router.get('/:storyId', ctrl.getStory);
router.delete('/:storyId', ctrl.deleteStory);

// Story engagement
router.post('/:storyId/like', ctrl.likeStory);
router.delete('/:storyId/like', ctrl.unlikeStory);
router.post('/:storyId/view', ctrl.viewStory);

// Story comments
router.post('/:storyId/comments', ctrl.createStoryComment);
router.put('/comments/:commentId', ctrl.updateStoryComment);
router.delete('/comments/:commentId', ctrl.deleteStoryComment);
router.post('/comments/:commentId/like', ctrl.likeStoryComment);
router.delete('/comments/:commentId/like', ctrl.unlikeStoryComment);

// Story comment replies
router.post('/comments/:commentId/replies', ctrl.createStoryReply);
router.delete('/replies/:replyId', ctrl.deleteStoryReply);

module.exports = router;
