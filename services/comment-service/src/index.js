require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const commentRoutes = require('./routes/comment.routes');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'comment-service' }));
app.use('/api/comments', commentRoutes);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Comment Service running on port ${PORT}`));
