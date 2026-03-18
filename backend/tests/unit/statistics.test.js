'use strict';

const { mean, stddev, zScore, percentChange, detectAnomaly, getSeverity } = require('../../src/utils/statistics');

describe('Statistics Utilities', () => {

  describe('mean()', () => {
    it('calculates mean of integers', () => {
      expect(mean([2, 4, 6, 8])).toBe(5);
    });
    it('returns 0 for empty array', () => {
      expect(mean([])).toBe(0);
    });
    it('handles a single value', () => {
      expect(mean([42])).toBe(42);
    });
  });

  describe('stddev()', () => {
    it('calculates standard deviation', () => {
      const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.0, 1);
    });
    it('returns 0 for single-element array', () => {
      expect(stddev([5])).toBe(0);
    });
    it('returns 0 for empty array', () => {
      expect(stddev([])).toBe(0);
    });
  });

  describe('zScore()', () => {
    it('computes z-score correctly', () => {
      expect(zScore(10, 7, 2)).toBeCloseTo(1.5, 2);
    });
    it('returns 0 when std is 0', () => {
      expect(zScore(5, 5, 0)).toBe(0);
    });
  });

  describe('percentChange()', () => {
    it('calculates positive change', () => {
      expect(percentChange(120, 100)).toBe(20);
    });
    it('calculates negative change', () => {
      expect(percentChange(80, 100)).toBe(-20);
    });
    it('handles previous = 0', () => {
      expect(percentChange(50, 0)).toBe(100);
    });
  });

  describe('detectAnomaly()', () => {
    const history = [100, 105, 98, 102, 100, 103, 99]; // stable history ~101

    it('does not flag normal spend', () => {
      const result = detectAnomaly(104, history);
      expect(result.isAnomaly).toBe(false);
      expect(result.severity).toBe('normal');
    });

    it('flags a large cost spike as anomaly', () => {
      const result = detectAnomaly(350, history, 2.5);
      expect(result.isAnomaly).toBe(true);
      expect(['warning', 'high', 'critical']).toContain(result.severity);
    });

    it('returns correct z-score structure', () => {
      const result = detectAnomaly(104, history);
      expect(result).toHaveProperty('zScore');
      expect(result).toHaveProperty('avgCost');
      expect(result).toHaveProperty('stdDev');
      expect(result).toHaveProperty('percentChange');
    });

    it('uses custom threshold', () => {
      // With a very low threshold (0.1), even slight change is anomaly
      const result = detectAnomaly(106, history, 0.1);
      expect(result.isAnomaly).toBe(true);
    });
  });

  describe('getSeverity()', () => {
    const threshold = 2.5;
    it('returns normal below threshold', () => expect(getSeverity(1.0, threshold)).toBe('normal'));
    it('returns warning just above threshold', () => expect(getSeverity(2.8, threshold)).toBe('warning'));
    it('returns high at 1.5x threshold', () => expect(getSeverity(3.8, threshold)).toBe('high'));
    it('returns critical at 2x threshold', () => expect(getSeverity(6.0, threshold)).toBe('critical'));
  });
});
