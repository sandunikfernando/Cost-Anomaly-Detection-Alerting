'use strict';

const express = require('express');
const router  = express.Router();
const { runAnomalyDetection, getAnomaliesForDate } = require('../services/anomalyService');
const logger = require('../utils/logger');

/**
 * POST /api/anomaly/detect
 * Airflow Task 3 — Run anomaly detection for a given date
 * Body: { date: "YYYY-MM-DD" }
 */
router.post('/detect', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    logger.info(`[Route] POST /anomaly/detect — date: ${date}`);
    const result = await runAnomalyDetection(date);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/anomaly/list?date=YYYY-MM-DD
 * List all anomalies for a given date
 */
router.get('/list', async (req, res, next) => {
  try {
    const { date } = req.query;
    const anomalies = await getAnomaliesForDate(date);
    res.json({ date, count: anomalies.length, anomalies });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
