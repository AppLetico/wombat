/**
 * Risk Scoring Tests
 */

import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  isHighRisk,
  quickRiskLevel,
  formatRiskScore,
  type RiskScoringInput,
} from './riskScoring.js';

describe('calculateRiskScore', () => {
  describe('tool breadth risk', () => {
    it('should have low risk with few tools', () => {
      const result = calculateRiskScore({ toolCount: 1 });

      expect(result.factors.toolBreadth).toBeLessThan(30);
    });

    it('should have higher risk with many tools', () => {
      const result = calculateRiskScore({ toolCount: 5 });

      expect(result.factors.toolBreadth).toBeGreaterThan(50);
    });

    it('should increase risk for high-risk tools', () => {
      const withoutHighRisk = calculateRiskScore({
        toolCount: 2,
        toolNames: ['search', 'read_file'],
      });

      const withHighRisk = calculateRiskScore({
        toolCount: 2,
        toolNames: ['search', 'execute_code'],
      });

      expect(withHighRisk.factors.toolBreadth).toBeGreaterThan(withoutHighRisk.factors.toolBreadth);
    });
  });

  describe('skill maturity risk', () => {
    it('should have low risk for active skills', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillState: 'active',
      });

      expect(result.factors.skillMaturity).toBe(0);
    });

    it('should have high risk for draft skills', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
      });

      expect(result.factors.skillMaturity).toBe(60);
    });

    it('should have very high risk for deprecated skills', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillState: 'deprecated',
      });

      expect(result.factors.skillMaturity).toBe(80);
    });

    it('should reduce risk if skill is tested', () => {
      const untested = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
        skillTested: false,
      });

      const tested = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
        skillTested: true,
      });

      expect(tested.factors.skillMaturity).toBeLessThan(untested.factors.skillMaturity);
    });

    it('should reduce risk if skill is pinned', () => {
      const unpinned = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
        skillPinned: false,
      });

      const pinned = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
        skillPinned: true,
      });

      expect(pinned.factors.skillMaturity).toBeLessThan(unpinned.factors.skillMaturity);
    });
  });

  describe('model volatility risk', () => {
    it('should have low risk for temperature 0', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        temperature: 0,
      });

      expect(result.factors.modelVolatility).toBe(0);
    });

    it('should have max risk for temperature 2', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        temperature: 2,
      });

      expect(result.factors.modelVolatility).toBe(100);
    });

    it('should scale linearly with temperature', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        temperature: 1,
      });

      expect(result.factors.modelVolatility).toBe(50);
    });
  });

  describe('data sensitivity risk', () => {
    it('should have no risk for none sensitivity', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        dataSensitivity: 'none',
      });

      expect(result.factors.dataSensitivity).toBe(0);
    });

    it('should have max risk for PII', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        dataSensitivity: 'pii',
      });

      expect(result.factors.dataSensitivity).toBe(100);
    });
  });

  describe('risk levels', () => {
    it('should classify low risk correctly', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillState: 'active',
        temperature: 0,
        dataSensitivity: 'none',
      });

      expect(result.level).toBe('low');
    });

    it('should classify high risk correctly', () => {
      const result = calculateRiskScore({
        toolCount: 5,
        skillState: 'draft',
        temperature: 1.5,
        dataSensitivity: 'high',
      });

      expect(['high', 'critical']).toContain(result.level);
    });
  });

  describe('risk factors identification', () => {
    it('should identify draft skill as risk factor', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
      });

      expect(result.riskFactors.some(f => f.includes('draft'))).toBe(true);
    });

    it('should identify PII as risk factor', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        dataSensitivity: 'pii',
      });

      expect(result.riskFactors.some(f => f.includes('PII'))).toBe(true);
    });

    it('should identify high temperature as risk factor', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        temperature: 1.5,
      });

      expect(result.riskFactors.some(f => f.includes('temperature'))).toBe(true);
    });
  });

  describe('recommendations', () => {
    it('should recommend promoting draft skills', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillState: 'draft',
      });

      expect(result.recommendations.some(r => r.includes('Promote'))).toBe(true);
    });

    it('should recommend pinning skills', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        skillPinned: false,
      });

      expect(result.recommendations.some(r => r.includes('Pin'))).toBe(true);
    });

    it('should recommend lowering temperature', () => {
      const result = calculateRiskScore({
        toolCount: 1,
        temperature: 1.5,
      });

      expect(result.recommendations.some(r => r.includes('temperature'))).toBe(true);
    });
  });
});

describe('isHighRisk', () => {
  it('should return true for high risk inputs', () => {
    const result = isHighRisk({
      toolCount: 5,
      skillState: 'draft',
      temperature: 1.5,
      dataSensitivity: 'pii',
    });

    expect(result).toBe(true);
  });

  it('should return false for low risk inputs', () => {
    const result = isHighRisk({
      toolCount: 1,
      skillState: 'active',
      temperature: 0,
      dataSensitivity: 'none',
    });

    expect(result).toBe(false);
  });

  it('should respect custom threshold', () => {
    const input: RiskScoringInput = {
      toolCount: 2,
      temperature: 0.5,
    };

    expect(isHighRisk(input, 10)).toBe(true);
    expect(isHighRisk(input, 80)).toBe(false);
  });
});

describe('quickRiskLevel', () => {
  it('should return risk level', () => {
    const level = quickRiskLevel({
      toolCount: 1,
      skillState: 'active',
    });

    expect(['low', 'medium', 'high', 'critical']).toContain(level);
  });
});

describe('formatRiskScore', () => {
  it('should format score as readable string', () => {
    const score = calculateRiskScore({
      toolCount: 3,
      skillState: 'draft',
      temperature: 1.0,
    });

    const formatted = formatRiskScore(score);

    expect(formatted).toContain('Risk Score:');
    expect(formatted).toContain('Factors:');
    expect(formatted).toContain('Tool Breadth:');
  });
});
