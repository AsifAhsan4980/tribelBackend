require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const moderationRoutes = require('./routes/moderation.routes');

const app = express();
const PORT = process.env.PORT || 3016;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'moderation-service' }));

app.use('/api/moderation', moderationRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Moderation service running on port ${PORT}`));
