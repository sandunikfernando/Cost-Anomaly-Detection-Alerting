'use strict';

const axios  = require('axios');
const sgMail = require('@sendgrid/mail');
const { query }              = require('../config/database');
const { getAnomaliesForDate } = require('./anomalyService');
const logger = require('../utils/logger');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const SEVERITY_EMOJI = {
  warning:  ':warning:',
  high:     ':rotating_light:',
  critical: ':fire:',
  normal:   ':white_check_mark:',
};

const SEVERITY_COLOR = {
  warning:  '#FFA500',
  high:     '#FF4500',
  critical: '#CC0000',
  normal:   '#36a64f',
};

/**
 * STEP 5 — Send alerts for all anomalies detected on a given date.
 * Sends Slack message + email notification for each budget-breaching anomaly.
 *
 * @param {string} date - ISO date string YYYY-MM-DD
 * @returns {object} Alert dispatch results
 */
async function sendAlerts(date) {
  logger.info(`[AlertService] Sending alerts for anomalies on: ${date}`);

  const anomalies = await getAnomaliesForDate(date);
  const toAlert   = anomalies.filter((a) => a.severity !== 'normal');

  if (toAlert.length === 0) {
    logger.info('[AlertService] No anomalies requiring alerts');
    return { date, alertsSent: 0 };
  }

  const results = [];

  for (const anomaly of toAlert) {
    const alertResult = { team: anomaly.team, project: anomaly.project_id };

    try {
      await sendSlackAlert(anomaly, date);
      alertResult.slackSent = true;
    } catch (err) {
      logger.error(`[AlertService] Slack alert failed for ${anomaly.team}:`, err.message);
      alertResult.slackSent = false;
      alertResult.slackError = err.message;
    }

    if (anomaly.owner_email) {
      try {
        await sendEmailAlert(anomaly, date);
        alertResult.emailSent = true;
      } catch (err) {
        logger.error(`[AlertService] Email alert failed for ${anomaly.team}:`, err.message);
        alertResult.emailSent = false;
        alertResult.emailError = err.message;
      }
    }

    // Record alert in DB to prevent duplicate sends
    await query(
      `INSERT INTO alert_log (anomaly_id, alert_date, slack_sent, email_sent, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (anomaly_id) DO UPDATE SET
         slack_sent = EXCLUDED.slack_sent,
         email_sent = EXCLUDED.email_sent`,
      [anomaly.id, date, alertResult.slackSent, alertResult.emailSent || false]
    );

    results.push(alertResult);
  }

  logger.info(`[AlertService] Sent ${results.length} alerts`);
  return { date, alertsSent: results.length, results };
}

//Build and send a Slack notification
async function sendSlackAlert(anomaly, date) {
  const emoji     = SEVERITY_EMOJI[anomaly.severity] || ':warning:';
  const color     = SEVERITY_COLOR[anomaly.severity] || '#FFA500';
  const pctChange = anomaly.percent_change > 0
    ? `+${anomaly.percent_change}%`
    : `${anomaly.percent_change}%`;

  const budgetLine = anomaly.budget_amount
    ? `*Budget:* $${Number(anomaly.budget_amount).toLocaleString()} | *MTD Spend:* $${Number(anomaly.month_to_date_spend || 0).toLocaleString()} (${anomaly.budget_utilization})`
    : '*Budget:* Not configured';

  const payload = {
    channel: process.env.SLACK_CHANNEL || '#finops-alerts',
    text: `${emoji} *Cost Anomaly Detected* — ${anomaly.team} / ${anomaly.project_id}`,
    attachments: [
      {
        color,
        fields: [
          { title: 'Team',           value: anomaly.team,                        short: true },
          { title: 'Project',        value: anomaly.project_id,                  short: true },
          { title: "Today's Cost",   value: `$${Number(anomaly.today_cost).toLocaleString()}`, short: true },
          { title: '7-Day Avg',      value: `$${Number(anomaly.avg_cost).toLocaleString()}`,   short: true },
          { title: 'Change',         value: pctChange,                           short: true },
          { title: 'Z-Score',        value: anomaly.z_score.toString(),          short: true },
          { title: 'Severity',       value: anomaly.severity.toUpperCase(),      short: true },
          { title: 'Date',           value: date,                                short: true },
          { title: 'Budget Status',  value: budgetLine,                          short: false },
        ],
        footer: 'FinOps Cost Anomaly Detection',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  const response = await axios.post(process.env.SLACK_WEBHOOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  logger.info(`[AlertService] Slack alert sent for ${anomaly.team} — status: ${response.status}`);
}

//Build and send an email alert via SendGrid
async function sendEmailAlert(anomaly, date) {
  const subject = `[${anomaly.severity.toUpperCase()}] Cost Anomaly — ${anomaly.team} / ${anomaly.project_id}`;

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${SEVERITY_COLOR[anomaly.severity]};padding:16px;border-radius:8px 8px 0 0">
        <h2 style="color:white;margin:0">💸 Cost Anomaly Detected</h2>
      </div>
      <div style="border:1px solid #ddd;padding:20px;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;font-weight:bold;width:40%">Team</td><td>${anomaly.team}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px;font-weight:bold">Project</td><td>${anomaly.project_id}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Date</td><td>${date}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px;font-weight:bold">Today's Cost</td><td>$${Number(anomaly.today_cost).toLocaleString()}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">7-Day Average</td><td>$${Number(anomaly.avg_cost).toLocaleString()}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px;font-weight:bold">Change</td><td>${anomaly.percent_change > 0 ? '+' : ''}${anomaly.percent_change}%</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Z-Score</td><td>${anomaly.z_score}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px;font-weight:bold">Severity</td><td><strong>${anomaly.severity.toUpperCase()}</strong></td></tr>
          ${anomaly.budget_amount ? `<tr><td style="padding:8px;font-weight:bold">Monthly Budget</td><td>$${Number(anomaly.budget_amount).toLocaleString()}</td></tr>` : ''}
          ${anomaly.month_to_date_spend ? `<tr style="background:#f9f9f9"><td style="padding:8px;font-weight:bold">MTD Spend</td><td>$${Number(anomaly.month_to_date_spend).toLocaleString()} (${anomaly.budget_utilization})</td></tr>` : ''}
        </table>
        <p style="margin-top:20px;color:#666;font-size:12px">
          This alert was generated automatically by the FinOps Cost Anomaly Detection system.<br>
          A ServiceNow investigation ticket has been created for this anomaly.
        </p>
      </div>
    </div>
  `;

  const recipients = [
    process.env.ALERT_EMAIL_TO,
    anomaly.owner_email,
  ].filter(Boolean);

  await sgMail.sendMultiple({
    to:      recipients,
    from:    process.env.ALERT_EMAIL_FROM || 'finops-alerts@yourcompany.com',
    subject,
    html:    htmlBody,
  });

  logger.info(`[AlertService] Email sent to ${recipients.join(', ')}`);
}

module.exports = { sendAlerts };
