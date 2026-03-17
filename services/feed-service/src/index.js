require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const feedRoutes = require('./routes/feed.routes');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'feed-service' }));
app.use('/api/feed', feedRoutes);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Feed Service running on port ${PORT}`));
