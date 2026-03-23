const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'logs', 'alerts_log.json');

/**
 * Ensure the logs directory and file exist.
 */
function ensureLogFile() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, JSON.stringify([], null, 2), 'utf8');
  }
}

/**
 * Read all existing alert records from the log file.
 * @returns {Array}
 */
function readLog() {
  ensureLogFile();
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save a single alert record to the local JSON log file.
 *
 * @param {Object} alert
 * @param {string} alert.projectId
 * @param {number} alert.cost
 * @param {string} alert.date          - YYYY-MM-DD of the cost spike
 * @param {string} alert.reason        - e.g. "z>2.5, +80%"
 * @param {string} alert.type          - "anomaly" | "budget"
 * @param {Object} alert.channels      - which channels were attempted
 * @param {boolean} alert.channels.slack
 * @param {boolean} alert.channels.email
 * @param {boolean} alert.channels.github
 */
function saveAlert(alert) {
  ensureLogFile();

  const record = {
    id: `${alert.projectId}-${alert.date}-${Date.now()}`,
    projectId: alert.projectId,
    cost: alert.cost,
    date: alert.date,
    reason: alert.reason,
    type: alert.type,
    channels: alert.channels || {},
    loggedAt: new Date().toISOString(),
  };

  const existing = readLog();
  existing.push(record);
  fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2), 'utf8');

  return record;
}

/**
 * Return all saved alert records, optionally filtered.
 *
 * @param {Object} [filters]
 * @param {string} [filters.projectId]  - filter by project
 * @param {string} [filters.type]       - "anomaly" | "budget"
 * @param {string} [filters.from]       - YYYY-MM-DD start date (inclusive)
 * @param {string} [filters.to]         - YYYY-MM-DD end date (inclusive)
 * @returns {Array}
 */
function getAlerts(filters = {}) {
  let records = readLog();

  if (filters.projectId) {
    records = records.filter((r) => r.projectId === filters.projectId);
  }
  if (filters.type) {
    records = records.filter((r) => r.type === filters.type);
  }
  if (filters.from) {
    records = records.filter((r) => r.date >= filters.from);
  }
  if (filters.to) {
    records = records.filter((r) => r.date <= filters.to);
  }

  return records;
}

/**
 * Print a summary of saved alerts to the console.
 */
function printSummary() {
  const records = readLog();
  if (records.length === 0) {
    console.log('No alerts logged yet.');
    return;
  }

  const byProject = {};
  for (const r of records) {
    byProject[r.projectId] = (byProject[r.projectId] || 0) + 1;
  }

  console.log(`\n--- Alert Log Summary (${records.length} total) ---`);
  for (const [pid, count] of Object.entries(byProject)) {
    console.log(`  ${pid}: ${count} alert(s)`);
  }
  console.log(`  Log file: ${LOG_PATH}\n`);
}

module.exports = { saveAlert, getAlerts, printSummary };