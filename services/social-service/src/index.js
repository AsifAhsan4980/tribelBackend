require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const socialRoutes = require('./routes/social.routes');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'social-service' }));
app.use('/api/social', socialRoutes);
app.use(errorHandler);

app.listen(PORT, () => console.log(`Social Service running on port ${PORT}`));
