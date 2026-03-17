require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const engagementRoutes = require('./routes/engagement.routes');

const app = express();
const PORT = process.env.PORT || 3007;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'engagement-service' }));
app.use('/api/engagement', engagementRoutes);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Engagement Service running on port ${PORT}`));
