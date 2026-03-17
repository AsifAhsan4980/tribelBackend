const router = require('express').Router();
const { authenticate } = require('shared');
const ctrl = require('../controllers/story.controller');

router.use(authenticate);

router.post('/', ctrl.createStory);
router.get('/feed', ctrl.getStoryFeed);
router.get('/:storyId', ctrl.getStory);
router.delete('/:storyId', ctrl.deleteStory);
router.post('/:storyId/view', ctrl.viewStory);
router.post('/:storyId/like', ctrl.likeStory);
router.delete('/:storyId/like', ctrl.unlikeStory);

module.exports = router;
