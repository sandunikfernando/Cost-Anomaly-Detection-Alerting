'use strict';

const { getAggregatedCosts, getHistoricalCosts } = require('./billingService');
const { detectAnomaly } = require('../utils/statistics');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const ZSCORE_THRESHOLD = parseFloat(process.env.ANOMALY_ZSCORE_THRESHOLD || '2.5');
const LOOKBACK_DAYS    = parseInt(process.env.ANOMALY_LOOKBACK_DAYS || '7');

/**
 * STEP 3 — Run anomaly detection on aggregated costs for a given date.
 * Compares each team/project cost against its historical baseline.
 * Results are persisted in the anomalies table.
 *
 * @param {string} date - ISO date string YYYY-MM-DD
 * @returns {object} Detection results
 */
async function runAnomalyDetection(date) {
  logger.info(`[AnomalyService] Running anomaly detection for: ${date}`);

  const todayCosts = await getAggregatedCosts(date);

  if (todayCosts.length === 0) {
    throw new Error(`No aggregated costs found for ${date}. Run aggregate_costs first.`);
  }

  // Clear previous anomalies for this date (idempotent)
  await query('DELETE FROM anomalies WHERE detection_date = $1', [date]);

  const anomalies  = [];
  const evaluated  = [];

  for (const record of todayCosts) {
    const historicalCosts = await getHistoricalCosts(
      record.team,
      record.project_id,
      LOOKBACK_DAYS,
      date
    );

    // Need at least 3 data points for meaningful statistics
    if (historicalCosts.length < 3) {
      logger.debug(
        `[AnomalyService] Insufficient history for ${record.team}/${record.project_id} — skipping`
      );
      evaluated.push({ team: record.team, project: record.project_id, skipped: true, reason: 'insufficient_history' });
      continue;
    }

    const result = detectAnomaly(
      Number(record.total_cost),
      historicalCosts,
      ZSCORE_THRESHOLD
    );

    const evaluation = {
      team:          record.team,
      project:       record.project_id,
      todayCost:     Number(record.total_cost),
      ...result,
      skipped: false,
    };

    evaluated.push(evaluation);

    if (result.isAnomaly) {
      // Persist anomaly to Postgres
      await query(
        `INSERT INTO anomalies
           (team, project_id, detection_date, today_cost, avg_cost, std_dev,
            z_score, percent_change, severity, service_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          record.team,
          record.project_id,
          date,
          record.total_cost,
          result.avgCost,
          result.stdDev,
          result.zScore,
          result.percentChange,
          result.severity,
          record.service_breakdown,
        ]
      );

      anomalies.push(evaluation);
      logger.warn(
        `[AnomalyService] ANOMALY detected — team: ${record.team}, ` +
        `project: ${record.project_id}, cost: $${record.total_cost}, ` +
        `z-score: ${result.zScore}, severity: ${result.severity}`
      );
    }
  }

  logger.info(
    `[AnomalyService] Detection complete — ${evaluated.length} evaluated, ` +
    `${anomalies.length} anomalies found`
  );

  return {
    date,
    totalEvaluated: evaluated.length,
    anomaliesFound:  anomalies.length,
    anomalies,
  };
}

/**
 * Retrieve anomalies for a specific date
 */
async function getAnomaliesForDate(date) {
  const { rows } = await query(
    `SELECT a.*, b.monthly_budget, b.alert_threshold
     FROM anomalies a
     LEFT JOIN budgets b ON a.team = b.team_id AND a.project_id = b.project_id
     WHERE a.detection_date = $1
     ORDER BY a.severity DESC, a.z_score DESC`,
    [date]
  );
  return rows;
}

module.exports = { runAnomalyDetection, getAnomaliesForDate };
