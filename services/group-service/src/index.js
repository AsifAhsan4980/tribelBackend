require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const groupRoutes = require('./routes/group.routes');

const app = express();
const PORT = process.env.PORT || 3010;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'group-service' }));

app.use('/api/groups', groupRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Group service running on port ${PORT}`));
