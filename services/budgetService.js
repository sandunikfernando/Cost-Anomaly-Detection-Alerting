const path = require('path');

const budgets = require(path.join(__dirname, '..', 'config', 'budgets.json'));

/**
 * Get the budget for a given project/team.
 * @param {string} projectId
 * @returns {number|null} Budget amount, or null if not configured
 */
function getBudget(projectId) {
  if (!projectId) return null;
  return budgets[projectId] ?? null;
}

/**
 * Compare actual cost to budget.
 * @param {string} projectId
 * @param {number} cost
 * @returns {{projectId:string, cost:number, budget:number|null, pctOfBudget:number|null, overBudget:boolean}}
 */
function compareCostToBudget(projectId, cost) {
  const budget = getBudget(projectId);
  if (budget == null || budget === 0) {
    return {
      projectId,
      cost,
      budget: null,
      pctOfBudget: null,
      overBudget: false,
    };
  }

  const pctOfBudget = cost / budget;
  return {
    projectId,
    cost,
    budget,
    pctOfBudget,
    overBudget: pctOfBudget > 1,
  };
}

/**
 * Check multiple project costs against budgets.
 * @param {Array<{projectId:string, cost:number}>} projectCosts
 * @returns {Array} Results for each project
 */
function checkBudgets(projectCosts) {
  return projectCosts.map(({ projectId, cost }) => compareCostToBudget(projectId, cost));
}

module.exports = {
  getBudget,
  compareCostToBudget,
  checkBudgets,
};
