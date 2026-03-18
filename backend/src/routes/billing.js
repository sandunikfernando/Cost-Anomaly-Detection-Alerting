'use strict';

const express = require('express');
const router  = express.Router();
const { fetchBillingData, aggregateCosts } = require('../services/billingService');
const logger = require('../utils/logger');

/**
 * POST /api/billing/fetch
 * Airflow Task 1 — Pull billing data from GCP BigQuery for a given date
 * Body: { date: "YYYY-MM-DD" }
 */
router.post('/fetch', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    logger.info(`[Route] POST /billing/fetch — date: ${date}`);
    const result = await fetchBillingData(date);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/aggregate
 * Airflow Task 2 — Aggregate raw costs by team/project
 * Body: { date: "YYYY-MM-DD" }
 */
router.post('/aggregate', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    logger.info(`[Route] POST /billing/aggregate — date: ${date}`);
    const result = await aggregateCosts(date);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/raw?date=YYYY-MM-DD
 * View raw cost records for a given date
 */
router.get('/raw', async (req, res, next) => {
  try {
    const { query } = require('../config/database');
    const { date } = req.query;
    const { rows } = await query(
      'SELECT * FROM raw_costs WHERE cost_date = $1 ORDER BY total_cost DESC',
      [date]
    );
    res.json({ date, count: rows.length, records: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
