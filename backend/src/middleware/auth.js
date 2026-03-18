'use strict';

const logger = require('../utils/logger');

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!process.env.API_KEY) {
    logger.warn('API_KEY not configured — authentication disabled (dev mode)');
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Pass X-API-Key header.' });
  }

  if (apiKey !== process.env.API_KEY) {
    logger.warn(`Invalid API key attempt from IP: ${req.ip}`);
    return res.status(403).json({ error: 'Invalid API key.' });
  }

  next();
}

module.exports = { apiKeyAuth };
