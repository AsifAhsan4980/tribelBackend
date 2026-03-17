require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const adRoutes = require('./routes/ad.routes');

const app = express();
const PORT = process.env.PORT || 3015;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ad-service' }));

app.use('/api/ads', adRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Ad service running on port ${PORT}`));
