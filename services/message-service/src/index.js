require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const messageRoutes = require('./routes/message.routes');

const app = express();
const PORT = process.env.PORT || 3011;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'message-service' }));

app.use('/api/messages', messageRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Message service running on port ${PORT}`));
