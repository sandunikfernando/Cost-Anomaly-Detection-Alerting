'use strict';

const { getBigQueryClient } = require('../config/bigquery');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const DATASET = process.env.GCP_BILLING_DATASET || 'billing_dataset';
const TABLE   = process.env.GCP_BILLING_TABLE   || 'gcp_billing_export_v1';

/**
 * STEP 1 — Fetch raw billing data from GCP BigQuery for a given date
 * and persist it into the raw_costs table for downstream tasks.
 *
 * @param {string} date - ISO date string YYYY-MM-DD
 * @returns {object} Summary of fetched records
 */
async function fetchBillingData(date) {
  logger.info(`[BillingService] Fetching billing data for date: ${date}`);
  const bq = getBigQueryClient();

  const sql = `
    SELECT
      project.id                              AS project_id,
      project.name                            AS project_name,
      IFNULL(
        (SELECT value FROM UNNEST(labels) WHERE key = 'team' LIMIT 1),
        'untagged'
      )                                       AS team,
      service.description                     AS service_name,
      sku.description                         AS sku_description,
      ROUND(SUM(cost), 4)                     AS total_cost,
      currency                                AS currency,
      DATE(usage_start_time)                  AS cost_date
    FROM
      \`${process.env.GCP_PROJECT_ID}.${DATASET}.${TABLE}_*\`
    WHERE
      DATE(usage_start_time) = @date
      AND cost > 0
    GROUP BY
      project_id, project_name, team, service_name, sku_description, currency, cost_date
    ORDER BY
      total_cost DESC
  `;

  const options = {
    query: sql,
    params: { date },
    location: 'US',
  };

  const [rows] = await bq.query(options);
  logger.info(`[BillingService] Fetched ${rows.length} rows from BigQuery`);

  if (rows.length === 0) {
    logger.warn(`[BillingService] No billing data found for ${date}`);
    return { date, rowsFetched: 0, message: 'No data found for this date' };
  }

  // Persist raw rows to Postgres
  await persistRawCosts(rows, date);

  return {
    date,
    rowsFetched: rows.length,
    totalCost: rows.reduce((s, r) => s + Number(r.total_cost), 0).toFixed(2),
    currency: rows[0]?.currency || 'USD',
  };
}

/**
 * Persist raw GCP billing rows into the raw_costs table
 */
async function persistRawCosts(rows, date) {
  // Clear previous data for this date (idempotent re-runs)
  await query('DELETE FROM raw_costs WHERE cost_date = $1', [date]);

  for (const row of rows) {
    await query(
      `INSERT INTO raw_costs
         (project_id, project_name, team, service_name, sku_description,
          total_cost, currency, cost_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.project_id,
        row.project_name,
        row.team,
        row.service_name,
        row.sku_description,
        row.total_cost,
        row.currency,
        row.cost_date,
      ]
    );
  }

  logger.info(`[BillingService] Persisted ${rows.length} raw cost records for ${date}`);
}

/**
 * STEP 2 — Aggregate raw costs by team and project for a given date.
 * Results are written to the aggregated_costs table.
 *
 * @param {string} date - ISO date string YYYY-MM-DD
 * @returns {object} Aggregated cost summary
 */
async function aggregateCosts(date) {
  logger.info(`[BillingService] Aggregating costs for date: ${date}`);

  // Check raw data exists for this date
  const { rows: rawCheck } = await query(
    'SELECT COUNT(*) AS cnt FROM raw_costs WHERE cost_date = $1',
    [date]
  );
  if (parseInt(rawCheck[0].cnt) === 0) {
    throw new Error(`No raw costs found for ${date}. Run fetch_billing first.`);
  }

  // Clear previous aggregations for this date (idempotent)
  await query('DELETE FROM aggregated_costs WHERE cost_date = $1', [date]);

  // Aggregate by team
  const teamAgg = await query(
    `INSERT INTO aggregated_costs (team, project_id, total_cost, service_breakdown, cost_date)
     SELECT
       team,
       project_id,
       ROUND(SUM(total_cost), 2) AS total_cost,
       json_agg(json_build_object(
         'service', service_name,
         'cost',    ROUND(total_cost, 2)
       ) ORDER BY total_cost DESC)  AS service_breakdown,
       cost_date
     FROM raw_costs
     WHERE cost_date = $1
     GROUP BY team, project_id, cost_date
     RETURNING *`,
    [date]
  );

  const summary = teamAgg.rows.map((r) => ({
    team: r.team,
    project: r.project_id,
    totalCost: r.total_cost,
    date: r.cost_date,
  }));

  logger.info(`[BillingService] Aggregated into ${summary.length} team/project records`);
  return { date, aggregated: summary };
}

/**
 * Retrieve aggregated costs for a specific date (used by anomaly detection)
 */
async function getAggregatedCosts(date) {
  const { rows } = await query(
    'SELECT * FROM aggregated_costs WHERE cost_date = $1 ORDER BY total_cost DESC',
    [date]
  );
  return rows;
}

/**
 * Retrieve historical daily costs for a team over the past N days
 */
async function getHistoricalCosts(team, projectId, lookbackDays = 7, beforeDate) {
  const { rows } = await query(
    `SELECT cost_date, total_cost
     FROM aggregated_costs
     WHERE team = $1
       AND project_id = $2
       AND cost_date < $3
     ORDER BY cost_date DESC
     LIMIT $4`,
    [team, projectId, beforeDate, lookbackDays]
  );
  return rows.map((r) => Number(r.total_cost));
}

module.exports = {
  fetchBillingData,
  aggregateCosts,
  getAggregatedCosts,
  getHistoricalCosts,
};
