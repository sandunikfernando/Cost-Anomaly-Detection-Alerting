'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/database');
const { getBigQueryClient } = require('../config/bigquery');
const logger = require('../utils/logger');

/**
 * GET /health
 * Liveness probe — used by Docker, Kubernetes, and Airflow to verify the service is up
 */
router.get('/', async (req, res) => {
  const checks = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    service:   'cost-anomaly-backend',
    version:   process.env.npm_package_version || '1.0.0',
    checks:    {},
  };

  // PostgreSQL check
  try {
    await pool.query('SELECT 1');
    checks.checks.postgres = 'ok';
  } catch (err) {
    checks.checks.postgres = `error: ${err.message}`;
    checks.status = 'degraded';
  }

  // BigQuery check (light — just verify client initializes)
  try {
    getBigQueryClient();
    checks.checks.bigquery = 'ok';
  } catch (err) {
    checks.checks.bigquery = `error: ${err.message}`;
    checks.status = 'degraded';
  }

  const httpStatus = checks.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(checks);
});

module.exports = router;
