'use strict';

const express = require('express');
const router  = express.Router();
const { createTickets } = require('../services/ticketService');
const logger = require('../utils/logger');

/**
 * POST /api/tickets/create
 * Airflow Task 6 — Create ServiceNow tickets for anomalies
 * Body: { date: "YYYY-MM-DD" }
 */
router.post('/create', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    logger.info(`[Route] POST /tickets/create — date: ${date}`);
    const result = await createTickets(date);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
