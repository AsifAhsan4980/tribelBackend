require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('shared');
const storyRoutes = require('./routes/story.routes');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'story-service' }));

app.use('/api/stories', storyRoutes);

app.use(errorHandler);

app.listen(PORT, () => console.log(`Story service running on port ${PORT}`));
