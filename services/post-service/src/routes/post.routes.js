const router = require('express').Router();
const { authenticate } = require('shared');
const {
  createPost,
  getPost,
  updatePost,
  deletePost,
  getUserPosts,
  addHashtags,
  pinPost,
  unpinPost,
  getPostsByHashtag,
} = require('../controllers/post.controller');

// Hashtag lookup (before :postId to avoid route conflict)
router.get('/hashtag/:tag', authenticate, getPostsByHashtag);

// User wall posts
router.get('/user/:userId', authenticate, getUserPosts);

// CRUD
router.post('/', authenticate, createPost);
router.get('/:postId', authenticate, getPost);
router.put('/:postId', authenticate, updatePost);
router.delete('/:postId', authenticate, deletePost);

// Hashtags on a post
router.post('/:postId/hashtags', authenticate, addHashtags);

// Pin / unpin
router.post('/:postId/pin', authenticate, pinPost);
router.delete('/:postId/pin', authenticate, unpinPost);

module.exports = router;
