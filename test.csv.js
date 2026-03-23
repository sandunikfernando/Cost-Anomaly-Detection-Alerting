/**
 * test.csv.js — Run the full pipeline using the existing agg.csv file.
 *
 * Usage:
 *   node test.csv.js
 *   node test.csv.js --csv=path/to/your/file.csv
 *
 * What it does:
 *   1. Reads agg.csv (or a file you specify) — no BigQuery needed
 *   2. Converts it into the same shape bigqueryService returns
 *   3. Runs anomaly detection, budget checks, alerting, and logging
 *   4. Prints all detections and saves to logs/alerts_log.json
 *
 * agg.csv format expected:
 *   date,project_id,total_cost
 */

const fs   = require('fs');
const path = require('path');

// ── Parse --csv argument ─────────────────────────────────────────────────────
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--')) {
    const [k, v] = arg.slice(2).split('=');
    args[k] = v ?? true;
  }
}

const CSV_PATH = args.csv
  ? path.resolve(args.csv)
  : path.join(__dirname, 'agg.csv');

// ── Parse CSV into row objects ───────────────────────────────────────────────
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`CSV file not found: ${filePath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());

  const dateIdx    = headers.indexOf('date');
  const projectIdx = headers.findIndex((h) => h === 'project_id' || h === 'projectId');
  const costIdx    = headers.findIndex((h) => h === 'total_cost'  || h === 'cost');

  if (dateIdx < 0 || projectIdx < 0 || costIdx < 0) {
    console.error('CSV must have columns: date, project_id (or projectId), total_cost (or cost)');
    process.exit(1);
  }

  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return {
      date      : cols[dateIdx].trim(),
      projectId : cols[projectIdx].trim(),
      cost      : parseFloat(cols[costIdx].trim()) || 0,
    };
  });
}

// ── Stub alert channels (console only, no real calls) ───────────────────────
const alertService  = require('./services/alertService');
const githubService = require('./services/githubService');

alertService.sendSlackMessage = async (text) => {
  console.log('\n[TEST] Slack message would be sent:');
  console.log(text);
};
alertService.sendEmail = async ({ subject, text }) => {
  console.log('\n[TEST] Email would be sent:');
  console.log(`  Subject : ${subject}`);
  console.log(`  Body    : ${text}`);
};
githubService.createIssue = async ({ title }) => {
  console.log(`\n[TEST] GitHub issue would be created: "${title}"`);
  return { html_url: 'https://github.com/mock/issue/1' };
};

// ── Swap BigQuery service with a CSV reader ──────────────────────────────────
const Module = require('module');
const REAL_BQ = path.resolve(__dirname, 'services/bigqueryService.js');

// Inline mock that returns parsed CSV rows
const csvRows = parseCSV(CSV_PATH);
console.log(`[CSV] Loaded ${csvRows.length} rows from ${path.basename(CSV_PATH)}`);

// Print a preview of the data
const dates    = [...new Set(csvRows.map((r) => r.date))].sort();
const projects = [...new Set(csvRows.map((r) => r.projectId))];
console.log(`[CSV] Date range : ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`[CSV] Projects   : ${projects.join(', ')}\n`);

const _resolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = (request, parent, ...args) => {
  const resolved = _resolveFilename(request, parent, ...args);
  if (resolved !== REAL_BQ) return resolved;

  // Return a temporary in-memory mock
  const tmpPath = path.join(__dirname, '_bq_csv_shim.js');
  if (!fs.existsSync(tmpPath)) {
    fs.writeFileSync(tmpPath, `
      const rows = ${JSON.stringify(csvRows)};
      class BigQueryService {
        constructor() { console.log('[CSV SHIM] Using CSV data as BigQuery source.'); }
        async getCostByProject(startDate, endDate) {
          const s = startDate.toISOString().split('T')[0];
          const e = endDate.toISOString().split('T')[0];
          return rows.filter(r => r.date >= s && r.date <= e);
        }
      }
      module.exports = BigQueryService;
    `);
  }
  return tmpPath;
};

// ── Run pipeline ─────────────────────────────────────────────────────────────
const { runPipeline } = require('./index');

const startDate = dates[0];
const endDate   = dates[dates.length - 1];

(async () => {
  console.log('=== CSV PIPELINE TEST ===\n');

  const result = await runPipeline({
    startDate,
    endDate,
    sendEmail    : true,
    zThreshold   : 2.5,
    pctThreshold : 0.8,
    windowDays   : 30,
  });

  console.log('\n=== RESULTS ===');
  console.log(`Anomalies detected : ${result.anomalies.length}`);
  console.log(`Budget alerts      : ${result.budgetAlerts.length}`);

  if (result.anomalies.length > 0) {
    console.log('\nAnomaly details:');
    for (const a of result.anomalies) {
      console.log(`  [${a.date}] ${a.projectId} — $${Number(a.cost).toFixed(2)} — ${a.anomaly_reason}`);
    }
  }

  if (result.budgetAlerts.length > 0) {
    console.log('\nBudget alert details:');
    for (const b of result.budgetAlerts) {
      console.log(`  [${endDate}] ${b.projectId} — $${Number(b.cost).toFixed(2)} — ${(b.pctOfBudget * 100).toFixed(0)}% of budget`);
    }
  }

  // Clean up temp shim file
  const shim = path.join(__dirname, '_bq_csv_shim.js');
  if (fs.existsSync(shim)) fs.unlinkSync(shim);

  console.log('\nCheck logs/alerts_log.json to see saved alert records.');
  console.log('=== TEST COMPLETE ===\n');
})();