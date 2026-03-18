'use strict';

const { query } = require('../config/database');
const { getAnomaliesForDate } = require('./anomalyService');
const logger = require('../utils/logger');

const BUDGET_ALERT_THRESHOLD = parseFloat(process.env.BUDGET_ALERT_THRESHOLD || '0.8');

/**
 * STEP 4 — Compare detected anomalies against allocated budgets.
 * Marks anomalies that also exceed their budget thresholds.
 * Updates the anomalies table with budget_breached flag.
 *
 * @param {string} date - ISO date string YYYY-MM-DD
 * @returns {object} Budget comparison results
 */
async function compareToBudgets(date) {
  logger.info(`[BudgetService] Comparing anomalies to budgets for: ${date}`);

  const anomalies = await getAnomaliesForDate(date);

  if (anomalies.length === 0) {
    logger.info(`[BudgetService] No anomalies to compare for ${date}`);
    return { date, compared: 0, budgetBreaches: [] };
  }

  const budgetBreaches = [];

  for (const anomaly of anomalies) {
    // Fetch current month's total spend for this team/project
    const monthStart = date.substring(0, 7) + '-01'; // YYYY-MM-01
    const { rows: spendRows } = await query(
      `SELECT COALESCE(SUM(total_cost), 0) AS month_spend
       FROM aggregated_costs
       WHERE team = $1
         AND project_id = $2
         AND cost_date >= $3
         AND cost_date <= $4`,
      [anomaly.team, anomaly.project_id, monthStart, date]
    );

    const monthSpend = parseFloat(spendRows[0]?.month_spend || 0);

    // Fetch budget for this team/project
    const { rows: budgetRows } = await query(
      `SELECT monthly_budget, alert_threshold, owner_email
       FROM budgets
       WHERE team_id = $1 AND project_id = $2`,
      [anomaly.team, anomaly.project_id]
    );

    const budget = budgetRows[0];
    let budgetBreached = false;
    let budgetUtilization = null;

    if (budget) {
      const threshold = budget.alert_threshold || BUDGET_ALERT_THRESHOLD;
      budgetUtilization = monthSpend / budget.monthly_budget;
      budgetBreached = budgetUtilization >= threshold;

      logger.info(
        `[BudgetService] ${anomaly.team}/${anomaly.project_id}: ` +
        `$${monthSpend.toFixed(2)} / $${budget.monthly_budget} ` +
        `(${(budgetUtilization * 100).toFixed(1)}% utilized)`
      );
    } else {
      logger.warn(`[BudgetService] No budget found for ${anomaly.team}/${anomaly.project_id}`);
    }

    // Update anomaly record with budget info
    await query(
      `UPDATE anomalies
       SET month_to_date_spend = $1,
           budget_amount       = $2,
           budget_utilization  = $3,
           budget_breached     = $4,
           owner_email         = $5
       WHERE id = $6`,
      [
        monthSpend,
        budget?.monthly_budget || null,
        budgetUtilization,
        budgetBreached,
        budget?.owner_email || null,
        anomaly.id,
      ]
    );

    if (budgetBreached || !budget) {
      budgetBreaches.push({
        ...anomaly,
        monthSpend,
        budgetAmount:       budget?.monthly_budget,
        budgetUtilization:  budgetUtilization ? (budgetUtilization * 100).toFixed(1) + '%' : 'No budget set',
        ownerEmail:         budget?.owner_email,
      });
    }
  }

  logger.info(
    `[BudgetService] ${budgetBreaches.length} / ${anomalies.length} anomalies also breached budget`
  );

  return {
    date,
    compared:      anomalies.length,
    budgetBreaches,
  };
}

//List all configured budgets
async function getAllBudgets() {
  const { rows } = await query('SELECT * FROM budgets ORDER BY team_id, project_id');
  return rows;
}

//Upsert a budget record
async function upsertBudget({ teamId, projectId, monthlyBudget, alertThreshold, ownerEmail }) {
  const { rows } = await query(
    `INSERT INTO budgets (team_id, project_id, monthly_budget, alert_threshold, owner_email)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (team_id, project_id)
     DO UPDATE SET
       monthly_budget   = EXCLUDED.monthly_budget,
       alert_threshold  = EXCLUDED.alert_threshold,
       owner_email      = EXCLUDED.owner_email,
       updated_at       = NOW()
     RETURNING *`,
    [teamId, projectId, monthlyBudget, alertThreshold || BUDGET_ALERT_THRESHOLD, ownerEmail]
  );
  return rows[0];
}

module.exports = { compareToBudgets, getAllBudgets, upsertBudget };
