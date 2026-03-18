require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const mediaRoutes = require('./routes/media.routes');

const app = express();
const PORT = process.env.PORT || 3013;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'media-service' }));

app.use('/api/media', mediaRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Media service running on port ${PORT}`));
