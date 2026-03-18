require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const analyticsRoutes = require('./routes/analytics.routes');

const app = express();
const PORT = process.env.PORT || 3014;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'analytics-service' }));

app.use('/api/analytics', analyticsRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Analytics service running on port ${PORT}`));
