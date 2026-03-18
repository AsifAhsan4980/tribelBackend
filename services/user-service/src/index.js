require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const userRoutes = require('./routes/user.routes');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'user-service' }));

app.use('/api/users', userRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`User service running on port ${PORT}`));
