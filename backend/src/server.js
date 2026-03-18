'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { apiKeyAuth } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const billingRoutes = require('./routes/billing');
const anomalyRoutes = require('./routes/anomaly');
const budgetRoutes = require('./routes/budget');
const alertRoutes = require('./routes/alerts');
const ticketRoutes = require('./routes/tickets');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*' }));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// ─── Request Parsing & Logging ─────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/health', healthRoutes);                    // No auth — for health checks
app.use('/api', apiKeyAuth);                         // All /api routes require API key
app.use('/api/billing', billingRoutes);
app.use('/api/anomaly', anomalyRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/tickets', ticketRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Cost Anomaly Backend running on port ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app; // for testing
