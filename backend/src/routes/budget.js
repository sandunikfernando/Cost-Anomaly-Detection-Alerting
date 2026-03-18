'use strict';

const express = require('express');
const router  = express.Router();
const { compareToBudgets, getAllBudgets, upsertBudget } = require('../services/budgetService');
const logger = require('../utils/logger');

/**
 * POST /api/budget/compare
 * Airflow Task 4 — Compare anomalies against budgets
 * Body: { date: "YYYY-MM-DD" }
 */
router.post('/compare', async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid or missing date. Expected YYYY-MM-DD.' });
    }
    logger.info(`[Route] POST /budget/compare — date: ${date}`);
    const result = await compareToBudgets(date);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/budget/list
 * List all team budgets
 */
router.get('/list', async (req, res, next) => {
  try {
    const budgets = await getAllBudgets();
    res.json({ count: budgets.length, budgets });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/budget/upsert
 * Create or update a budget entry
 * Body: { teamId, projectId, monthlyBudget, alertThreshold, ownerEmail }
 */
router.post('/upsert', async (req, res, next) => {
  try {
    const { teamId, projectId, monthlyBudget, alertThreshold, ownerEmail } = req.body;
    if (!teamId || !projectId || !monthlyBudget) {
      return res.status(400).json({ error: 'teamId, projectId, and monthlyBudget are required' });
    }
    const budget = await upsertBudget({ teamId, projectId, monthlyBudget, alertThreshold, ownerEmail });
    res.json({ success: true, budget });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
