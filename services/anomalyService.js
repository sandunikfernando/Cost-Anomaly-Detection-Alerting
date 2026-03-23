/**
 * Anomaly detection utilities.
 *
 * The algorithm is a simple rolling-window z-score and percent-growth check.
 */

/**
 * Compute anomalies using a rolling window.
 *
 * @param {Array<{date: string, projectId: string, cost: number}>} rows - sorted by projectId then date
 * @param {Object} options
 * @param {number} [options.windowDays=30]
 * @param {number} [options.zThreshold=2.5]
 * @param {number} [options.pctThreshold=0.8] - e.g. 0.8 means 80% increase
 * @param {string} options.rangeStart - inclusive YYYY-MM-DD of range to report anomalies for
 * @param {string} options.rangeEnd - inclusive YYYY-MM-DD of range to report anomalies for
 * @returns {Array} anomaly objects
 */
function computeAnomalies(rows, options) {
  const {
    windowDays = 30,
    zThreshold = 2.5,
    pctThreshold = 0.8,
    rangeStart,
    rangeEnd,
  } = options;

  const projects = {};
  for (const row of rows) {
    const date = row.date;
    const pid = row.projectId;
    const cost = Number(row.cost || 0);
    if (!pid || !date) continue;
    projects[pid] = projects[pid] || [];
    projects[pid].push({ date, cost });
  }

  const anomalies = [];

  for (const [pid, data] of Object.entries(projects)) {
    data.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const window = [];
    let prevCost = null;

    for (const { date, cost } of data) {
      const inRange = date >= rangeStart && date <= rangeEnd;

      // Only compute stats once we have enough history (window excludes current day)
      const canComputeStats = window.length >= 2;
      let mean = 0;
      let std = 0;
      let zScore = null;
      let pctIncrease = null;
      const reasons = [];

      if (canComputeStats) {
        mean = window.reduce((acc, v) => acc + v, 0) / window.length;
        const variance = window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / window.length;
        std = Math.sqrt(variance);
        if (std > 0) {
          zScore = (cost - mean) / std;
          if (zScore > zThreshold) {
            reasons.push(`z>${zThreshold}`);
          }
        }
      }

      if (prevCost != null && prevCost !== 0) {
        pctIncrease = (cost - prevCost) / prevCost;
        if (pctIncrease > pctThreshold) {
          reasons.push(`+${Math.round(pctThreshold * 100)}%`);
        }
      }

      if (inRange && reasons.length > 0) {
        anomalies.push({
          date,
          projectId: pid,
          cost,
          mean_30: mean,
          std_30: std,
          z_score: zScore,
          pct_increase: pctIncrease,
          anomaly_reason: reasons.join(', '),
        });
      }

      window.push(cost);
      if (window.length > windowDays) {
        window.shift();
      }
      prevCost = cost;
    }
  }

  return anomalies;
}

module.exports = {
  computeAnomalies,
};
