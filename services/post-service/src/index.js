require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const postRoutes = require('./routes/post.routes');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'post-service' }));

app.use('/api/posts', postRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Post service running on port ${PORT}`));
