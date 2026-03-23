const BigQueryService = require('./services/bigqueryService');
const { computeAnomalies } = require('./services/anomalyService');
const { checkBudgets } = require('./services/budgetService');
const { sendSlackMessage, sendEmail, buildSlackAlert } = require('./services/alertService');
const { createIssue } = require('./services/githubService');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value ?? true;
    }
  }
  return args;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

async function runPipeline(opts = {}) {
  const bqService = new BigQueryService();

  const steps = (opts.steps ? String(opts.steps).split(',') : ['fetch', 'anomaly', 'budget', 'alert', 'ticket']).map((s) => s.trim().toLowerCase());

  const endDate = opts.endDate ? new Date(opts.endDate) : new Date();
  const startDate = opts.startDate
    ? new Date(opts.startDate)
    : new Date(endDate.getTime() - 1000 * 60 * 60 * 24 * 30);

  const rangeStart = formatDate(startDate);
  const rangeEnd = formatDate(endDate);

  console.log(`Fetching daily cost by project for ${rangeStart} -> ${rangeEnd}`);
  const dailyCosts = await bqService.getCostByProject(startDate, endDate);

  let anomalies = [];
  if (steps.includes('anomaly') || steps.includes('alert') || steps.includes('ticket')) {
    console.log(`Computing anomalies for ${rangeStart} -> ${rangeEnd}`);
    anomalies = computeAnomalies(dailyCosts, {
      windowDays: Number(opts.windowDays ?? 30),
      zThreshold: Number(opts.zThreshold ?? 2.5),
      pctThreshold: Number(opts.pctThreshold ?? 0.8),
      rangeStart,
      rangeEnd,
    });
  }

  const latestCostRows = dailyCosts.filter((r) => r.date === rangeEnd);

  let budgetResults = [];
  let budgetAlerts = [];
  if (steps.includes('budget') || steps.includes('alert') || steps.includes('ticket')) {
    budgetResults = checkBudgets(latestCostRows);
    budgetAlerts = budgetResults.filter((r) => r.overBudget);
  }

  // If we are only fetching data (no alerts / tickets), return early.
  if (!steps.includes('alert') && !steps.includes('ticket')) {
    return { dailyCosts, anomalies, budgetResults, budgetAlerts };
  }

  const allAlerts = [];

  // Add anomalies as alerts
  for (const anomaly of anomalies) {
    const reason = anomaly.anomaly_reason || 'anomaly detected';
    allAlerts.push({
      projectId: anomaly.projectId,
      cost: anomaly.cost,
      date: anomaly.date,
      reason,
      type: 'anomaly',
    });
  }

  // Add budget overages as alerts
  for (const b of budgetAlerts) {
    const reason = `budget exceeded (${(b.pctOfBudget * 100).toFixed(0)}% of budget)`;
    allAlerts.push({
      projectId: b.projectId,
      cost: b.cost,
      date: rangeEnd,
      reason,
      type: 'budget',
    });
  }

  if (allAlerts.length === 0) {
    console.log('No anomalies or budget overages detected.');
    return { anomalies, budgetAlerts };
  }

  for (const alert of allAlerts) {
    const message = buildSlackAlert(alert);
    console.log('Sending Slack alert:', message);
    try {
      await sendSlackMessage(message);
    } catch (error) {
      console.warn('Slack alert failed:', error.message);
    }

    if (opts.sendEmail === 'true' || opts.sendEmail === true) {
      try {
        await sendEmail({
          subject: `Cost Alert: ${alert.projectId} (${alert.date})`,
          text: `${alert.projectId} cost ${alert.cost} on ${alert.date}. Reason: ${alert.reason}`,
        });
      } catch (error) {
        console.warn('Email alert failed:', error.message);
      }
    }

    // Create GitHub issue if configured
    try {
      await createIssue({
        title: `[ALERT] Cost Spike in ${alert.projectId} - ${alert.date}`,
        body: `**Project:** ${alert.projectId}\n**Date:** ${alert.date}\n**Cost:** $${Number(alert.cost).toFixed(2)}\n**Reason:** ${alert.reason}\n\n_This ticket was created automatically by the cost anomaly detection pipeline._`,
        labels: ['cost-alert', alert.type],
      });
      console.log(`Created GitHub issue for ${alert.projectId} (${alert.date})`);
    } catch (error) {
      console.warn('GitHub issue creation failed (check GITHUB_TOKEN/GITHUB_REPO):', error.message);
    }
  }

  return { anomalies, budgetAlerts };
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    await runPipeline(args);
  } catch (error) {
    console.error('Pipeline failed:', error.message);
    process.exit(1);
  }
}

module.exports = {
  main,
  runPipeline,
};

if (require.main === module) {
  main();
}
