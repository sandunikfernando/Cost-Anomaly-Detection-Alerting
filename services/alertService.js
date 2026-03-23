const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', 'config', '.env') });

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send a Slack message using an incoming webhook.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function sendSlackMessage(text) {
  if (!SLACK_WEBHOOK_URL) {
    throw new Error('SLACK_WEBHOOK_URL is not configured in config/.env');
  }

  const payload = {
    text,
  };

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook request failed: ${res.status} ${res.statusText} - ${body}`);
  }
}

/**
 * Send an email alert using SMTP (nodemailer).
 * All SMTP configuration is expected in config/.env.
 */
async function sendEmail({ subject, text }) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.ALERT_EMAIL_FROM;
  const to = process.env.ALERT_EMAIL_TO;

  if (!host || !port || !user || !pass || !from || !to) {
    throw new Error('Missing SMTP/email configuration in config/.env. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_FROM, ALERT_EMAIL_TO.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });
}

/**
 * Create a well-formatted alert text message for Slack.
 */
function buildSlackAlert({ projectId, cost, reason, date }) {
  const formattedCost = typeof cost === 'number' ? `$${cost.toFixed(2)}` : cost;
  return `🚨 *Cost Alert!*\n*Project:* ${projectId}\n*Cost:* ${formattedCost}\n*Date:* ${date}\n*Reason:* ${reason}`;
}

module.exports = {
  sendSlackMessage,
  sendEmail,
  buildSlackAlert,
};
