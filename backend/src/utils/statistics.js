'use strict';

/**
 * Calculate arithmetic mean of an array of numbers
 */
function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + Number(v), 0) / values.length;
}

/**
 * Calculate population standard deviation
 */
function stddev(values) {
  if (!values || values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => Math.pow(Number(v) - avg, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Calculate z-score: how many std deviations a value is from the mean
 */
function zScore(value, avg, std) {
  if (std === 0) return 0;
  return (value - avg) / std;
}

/**
 * Calculate percentage change between two values
 */
function percentChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Calculate simple moving average over the last N values
 */
function movingAverage(values, window = 7) {
  if (!values || values.length === 0) return [];
  const result = [];
  for (let i = 0; i < values.length; i++) {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    result.push(mean(slice));
  }
  return result;
}

/**
 * Detect anomalies in a data series using z-score method
 * @param {number} todayCost - Current day cost to evaluate
 * @param {number[]} historicalCosts - Array of past N days costs
 * @param {number} threshold - Z-score threshold (default 2.5)
 */
function detectAnomaly(todayCost, historicalCosts, threshold = 2.5) {
  const avg = mean(historicalCosts);
  const std = stddev(historicalCosts);
  const score = zScore(todayCost, avg, std);
  const pctChange = percentChange(todayCost, avg);

  return {
    isAnomaly: Math.abs(score) > threshold,
    zScore: parseFloat(score.toFixed(4)),
    avgCost: parseFloat(avg.toFixed(2)),
    stdDev: parseFloat(std.toFixed(2)),
    percentChange: parseFloat(pctChange.toFixed(2)),
    severity: getSeverity(score, threshold),
  };
}

/**
 * Get severity label based on z-score
 */
function getSeverity(score, threshold) {
  const absScore = Math.abs(score);
  if (absScore < threshold) return 'normal';
  if (absScore < threshold * 1.5) return 'warning';
  if (absScore < threshold * 2) return 'high';
  return 'critical';
}

module.exports = { mean, stddev, zScore, percentChange, movingAverage, detectAnomaly, getSeverity };
