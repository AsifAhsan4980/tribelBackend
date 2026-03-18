require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');
const { errorHandler } = require('shared');
const authRoutes = require('./routes/auth.routes');
require('./config/passport');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(passport.initialize());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

app.use('/api/auth', authRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Auth service running on port ${PORT}`));
