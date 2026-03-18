'use strict';

const express = require('express'); //import express library to handle http requests
const router  = express.Router();
const { sendAlerts } = require('../services/alertService');
const logger = require('../utils/logger');

/**
 * POST /api/alerts/send
 * Airflow Task 5 — Send Slack + email alerts for anomalies
 * Body: { date: "YYYY-MM-DD" }
 */
router.post('/send', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    logger.info(`[Route] POST /alerts/send — date: ${date}`);
    const result = await sendAlerts(date);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
