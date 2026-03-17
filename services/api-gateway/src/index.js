require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use(limiter);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// ── Public routes (no auth) ───────────────────────
app.use('/api/auth', proxy(process.env.AUTH_SERVICE_URL));

// ── Protected routes ──────────────────────────────
app.use('/api/users',         authenticate, proxy(process.env.USER_SERVICE_URL));
app.use('/api/posts',         authenticate, proxy(process.env.POST_SERVICE_URL));
app.use('/api/social',        authenticate, proxy(process.env.SOCIAL_SERVICE_URL));
app.use('/api/feed',          authenticate, proxy(process.env.FEED_SERVICE_URL));
app.use('/api/comments',      authenticate, proxy(process.env.COMMENT_SERVICE_URL));
app.use('/api/engagement',    authenticate, proxy(process.env.ENGAGEMENT_SERVICE_URL));
app.use('/api/stories',       authenticate, proxy(process.env.STORY_SERVICE_URL));
app.use('/api/articles',      authenticate, proxy(process.env.ARTICLE_SERVICE_URL));
app.use('/api/groups',        authenticate, proxy(process.env.GROUP_SERVICE_URL));
app.use('/api/messages',      authenticate, proxy(process.env.MESSAGE_SERVICE_URL));
app.use('/api/notifications', authenticate, proxy(process.env.NOTIFICATION_SERVICE_URL));
app.use('/api/media',         authenticate, proxy(process.env.MEDIA_SERVICE_URL));
app.use('/api/analytics',     authenticate, proxy(process.env.ANALYTICS_SERVICE_URL));
app.use('/api/ads',           authenticate, proxy(process.env.AD_SERVICE_URL));
app.use('/api/moderation',    authenticate, proxy(process.env.MODERATION_SERVICE_URL));

app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
