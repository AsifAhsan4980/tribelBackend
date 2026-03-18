require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const notificationRoutes = require('./routes/notification.routes');
require('./config/firebase');

const app = express();
const PORT = process.env.PORT || 3012;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));

app.use('/api/notifications', notificationRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Notification service running on port ${PORT}`));
