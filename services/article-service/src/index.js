require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const articleRoutes = require('./routes/article.routes');

const app = express();
const PORT = process.env.PORT || 3009;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'article-service' }));

app.use('/api/articles', articleRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Article service running on port ${PORT}`));
