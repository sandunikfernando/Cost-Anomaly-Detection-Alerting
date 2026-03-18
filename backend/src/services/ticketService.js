'use strict';

const axios  = require('axios');
const { query }               = require('../config/database');
const { getAnomaliesForDate } = require('./anomalyService');
const logger = require('../utils/logger');

const SN_BASE    = process.env.SERVICENOW_INSTANCE;
const SN_USER    = process.env.SERVICENOW_USER;
const SN_PASS    = process.env.SERVICENOW_PASS;
const SN_GROUP   = process.env.SERVICENOW_ASSIGNMENT_GROUP || 'FinOps Team';

const PRIORITY_MAP = {
  critical: '1',  // Critical
  high:     '2',  // High
  warning:  '3',  // Moderate
  normal:   '4',  // Low
};

/**
 * STEP 6 — Create ServiceNow investigation tickets for all detected anomalies.
 * One ticket per anomaly, assigned to the FinOps team member responsible.
 *
 * @param {string} date - ISO date string YYYY-MM-DD
 * @returns {object} Ticket creation results
 */
async function createTickets(date) {
  logger.info(`[TicketService] Creating ServiceNow tickets for anomalies on: ${date}`);

  const anomalies = await getAnomaliesForDate(date);

  if (anomalies.length === 0) {
    logger.info('[TicketService] No anomalies to create tickets for');
    return { date, ticketsCreated: 0 };
  }

  const results = [];

  for (const anomaly of anomalies) {
    try {
      const ticketNumber = await createServiceNowTicket(anomaly, date);

      // Record ticket number back to anomaly record
      await query(
        'UPDATE anomalies SET servicenow_ticket = $1 WHERE id = $2',
        [ticketNumber, anomaly.id]
      );

      results.push({
        team:     anomaly.team,
        project:  anomaly.project_id,
        ticket:   ticketNumber,
        success:  true,
      });

      logger.info(`[TicketService] Ticket ${ticketNumber} created for ${anomaly.team}/${anomaly.project_id}`);
    } catch (err) {
      logger.error(`[TicketService] Failed to create ticket for ${anomaly.team}:`, err.message);
      results.push({
        team:     anomaly.team,
        project:  anomaly.project_id,
        success:  false,
        error:    err.message,
      });
    }
  }

  const created = results.filter((r) => r.success).length;
  logger.info(`[TicketService] Created ${created} / ${results.length} tickets`);

  return { date, ticketsCreated: created, results };
}

/**
 * Create a single ServiceNow incident ticket
 */
async function createServiceNowTicket(anomaly, date) {
  const pctChange = anomaly.percent_change > 0
    ? `+${anomaly.percent_change}%`
    : `${anomaly.percent_change}%`;

  const description =
    `COST ANOMALY INVESTIGATION\n` +
    `===========================\n\n` +
    `An unusual cost spike was detected and requires investigation.\n\n` +
    `DETAILS:\n` +
    `  Team:           ${anomaly.team}\n` +
    `  Project:        ${anomaly.project_id}\n` +
    `  Detection Date: ${date}\n` +
    `  Today's Cost:   $${Number(anomaly.today_cost).toLocaleString()}\n` +
    `  7-Day Average:  $${Number(anomaly.avg_cost).toLocaleString()}\n` +
    `  Change:         ${pctChange}\n` +
    `  Z-Score:        ${anomaly.z_score}\n` +
    `  Severity:       ${anomaly.severity.toUpperCase()}\n` +
    `${anomaly.budget_amount ? `  Budget:         $${Number(anomaly.budget_amount).toLocaleString()}\n` : ''}` +
    `${anomaly.month_to_date_spend ? `  MTD Spend:      $${Number(anomaly.month_to_date_spend).toLocaleString()} (${anomaly.budget_utilization})\n` : ''}` +
    `\nTOP SERVICES BY COST:\n` +
    formatServiceBreakdown(anomaly.service_breakdown) +
    `\nINVESTIGATION STEPS:\n` +
    `  1. Review the GCP Console for project: ${anomaly.project_id}\n` +
    `  2. Check for any new resource deployments or scaling events\n` +
    `  3. Review BigQuery billing export for line-item details\n` +
    `  4. Identify root cause and update this ticket\n` +
    `  5. Take corrective action if spend is unauthorized\n`;

  const payload = {
    short_description: `[FinOps] Cost Anomaly — ${anomaly.team} / ${anomaly.project_id} (${anomaly.severity.toUpperCase()})`,
    description,
    category:          'Cost Management',
    subcategory:       'Cloud Spend Anomaly',
    assignment_group:  SN_GROUP,
    priority:          PRIORITY_MAP[anomaly.severity] || '3',
    urgency:           anomaly.severity === 'critical' ? '1' : '2',
    impact:            anomaly.severity === 'critical' ? '1' : '2',
    caller_id:         SN_USER,
    u_team:            anomaly.team,
    u_project:         anomaly.project_id,
    u_detection_date:  date,
  };

  const response = await axios.post(
    `${SN_BASE}/api/now/table/incident`,
    payload,
    {
      auth:    { username: SN_USER, password: SN_PASS },
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000,
    }
  );

  return response.data?.result?.number;
}

function formatServiceBreakdown(breakdown) {
  if (!breakdown) return '  No breakdown available\n';
  try {
    const services = typeof breakdown === 'string' ? JSON.parse(breakdown) : breakdown;
    return services
      .slice(0, 5)
      .map((s) => `  - ${s.service}: $${Number(s.cost).toLocaleString()}`)
      .join('\n') + '\n';
  } catch {
    return '  Unable to parse service breakdown\n';
  }
}

module.exports = { createTickets };
