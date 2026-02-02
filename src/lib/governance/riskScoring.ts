/**
 * Risk Scoring
 *
 * Calculate risk scores for agent execution based on multiple factors:
 * - Permission breadth (number of tools requested)
 * - Skill maturity (lifecycle state)
 * - Model volatility (temperature)
 * - Data sensitivity
 */

import type { SkillState } from '../skills/skillRegistry.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Risk level classification
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Input for risk calculation
 */
export interface RiskScoringInput {
  /** Number of tools being used */
  toolCount: number;
  
  /** Tools being used */
  toolNames?: string[];
  
  /** Skill lifecycle state */
  skillState?: SkillState;
  
  /** Model temperature (0-2) */
  temperature?: number;
  
  /** Custom data sensitivity flag */
  dataSensitivity?: 'none' | 'low' | 'medium' | 'high' | 'pii';
  
  /** Model being used */
  model?: string;
  
  /** Whether the skill has been tested */
  skillTested?: boolean;
  
  /** Whether the skill is pinned */
  skillPinned?: boolean;
  
  /** Custom risk flags */
  customFlags?: string[];
}

/**
 * Result of risk scoring
 */
export interface RiskScore {
  /** Overall score (0-100) */
  score: number;
  
  /** Risk level */
  level: RiskLevel;
  
  /** Individual factor scores */
  factors: {
    toolBreadth: number;
    skillMaturity: number;
    modelVolatility: number;
    dataSensitivity: number;
    customFactors: number;
  };
  
  /** Risk factors identified */
  riskFactors: string[];
  
  /** Recommendations for reducing risk */
  recommendations: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Weight for each risk factor (should sum to 1)
 */
const FACTOR_WEIGHTS = {
  toolBreadth: 0.25,
  skillMaturity: 0.25,
  modelVolatility: 0.20,
  dataSensitivity: 0.20,
  customFactors: 0.10,
};

/**
 * High-risk tools that increase score
 */
const HIGH_RISK_TOOLS = [
  'execute_code',
  'run_command',
  'delete_file',
  'send_email',
  'make_purchase',
  'modify_database',
  'admin_action',
];

/**
 * Skill state risk mapping
 */
const SKILL_STATE_RISK: Record<SkillState, number> = {
  active: 0,
  approved: 10,
  tested: 30,
  draft: 60,
  deprecated: 80,
};

/**
 * Data sensitivity risk mapping
 */
const DATA_SENSITIVITY_RISK: Record<string, number> = {
  none: 0,
  low: 20,
  medium: 40,
  high: 70,
  pii: 100,
};

// ============================================================================
// Risk Calculation
// ============================================================================

/**
 * Calculate risk score for an agent execution
 */
export function calculateRiskScore(input: RiskScoringInput): RiskScore {
  const factors = {
    toolBreadth: calculateToolBreadthRisk(input),
    skillMaturity: calculateSkillMaturityRisk(input),
    modelVolatility: calculateModelVolatilityRisk(input),
    dataSensitivity: calculateDataSensitivityRisk(input),
    customFactors: calculateCustomFactorsRisk(input),
  };
  
  // Calculate weighted score
  const score = Math.min(100, Math.round(
    factors.toolBreadth * FACTOR_WEIGHTS.toolBreadth +
    factors.skillMaturity * FACTOR_WEIGHTS.skillMaturity +
    factors.modelVolatility * FACTOR_WEIGHTS.modelVolatility +
    factors.dataSensitivity * FACTOR_WEIGHTS.dataSensitivity +
    factors.customFactors * FACTOR_WEIGHTS.customFactors
  ));
  
  const level = scoreToLevel(score);
  const riskFactors = identifyRiskFactors(input, factors);
  const recommendations = generateRecommendations(input, factors);
  
  return {
    score,
    level,
    factors,
    riskFactors,
    recommendations,
  };
}

/**
 * Calculate tool breadth risk
 */
function calculateToolBreadthRisk(input: RiskScoringInput): number {
  // Base risk from tool count
  let risk = Math.min(100, input.toolCount * 15);
  
  // Additional risk for high-risk tools
  if (input.toolNames) {
    const highRiskCount = input.toolNames.filter((t) =>
      HIGH_RISK_TOOLS.some((hr) => t.toLowerCase().includes(hr))
    ).length;
    risk += highRiskCount * 20;
  }
  
  return Math.min(100, risk);
}

/**
 * Calculate skill maturity risk
 */
function calculateSkillMaturityRisk(input: RiskScoringInput): number {
  let risk = 0;
  
  // Base risk from skill state
  if (input.skillState) {
    risk = SKILL_STATE_RISK[input.skillState];
  } else {
    // No skill state means unknown maturity
    risk = 50;
  }
  
  // Reduce risk if skill is tested
  if (input.skillTested) {
    risk = Math.max(0, risk - 20);
  }
  
  // Reduce risk if skill is pinned
  if (input.skillPinned) {
    risk = Math.max(0, risk - 10);
  }
  
  return risk;
}

/**
 * Calculate model volatility risk
 */
function calculateModelVolatilityRisk(input: RiskScoringInput): number {
  // Default temperature is ~0.7 for most models
  const temp = input.temperature ?? 0.7;
  
  // Temperature 0 = 0 risk, temperature 2 = 100 risk
  return Math.round((temp / 2) * 100);
}

/**
 * Calculate data sensitivity risk
 */
function calculateDataSensitivityRisk(input: RiskScoringInput): number {
  const sensitivity = input.dataSensitivity || 'none';
  return DATA_SENSITIVITY_RISK[sensitivity] || 0;
}

/**
 * Calculate custom factors risk
 */
function calculateCustomFactorsRisk(input: RiskScoringInput): number {
  if (!input.customFlags || input.customFlags.length === 0) {
    return 0;
  }
  
  // Each custom flag adds 20 risk
  return Math.min(100, input.customFlags.length * 20);
}

/**
 * Convert score to risk level
 */
function scoreToLevel(score: number): RiskLevel {
  if (score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'critical';
}

/**
 * Identify specific risk factors
 */
function identifyRiskFactors(
  input: RiskScoringInput,
  factors: RiskScore['factors']
): string[] {
  const risks: string[] = [];
  
  if (factors.toolBreadth > 50) {
    risks.push(`High tool count (${input.toolCount} tools)`);
  }
  
  if (input.toolNames) {
    const highRiskTools = input.toolNames.filter((t) =>
      HIGH_RISK_TOOLS.some((hr) => t.toLowerCase().includes(hr))
    );
    if (highRiskTools.length > 0) {
      risks.push(`High-risk tools: ${highRiskTools.join(', ')}`);
    }
  }
  
  if (input.skillState === 'draft') {
    risks.push('Skill is in draft state (not production-ready)');
  } else if (input.skillState === 'deprecated') {
    risks.push('Skill is deprecated');
  }
  
  if (input.temperature && input.temperature > 1.0) {
    risks.push(`High temperature (${input.temperature}) increases unpredictability`);
  }
  
  if (input.dataSensitivity === 'pii') {
    risks.push('Processing PII data');
  } else if (input.dataSensitivity === 'high') {
    risks.push('Processing high-sensitivity data');
  }
  
  if (input.customFlags && input.customFlags.length > 0) {
    risks.push(`Custom risk flags: ${input.customFlags.join(', ')}`);
  }
  
  return risks;
}

/**
 * Generate recommendations for reducing risk
 */
function generateRecommendations(
  input: RiskScoringInput,
  factors: RiskScore['factors']
): string[] {
  const recommendations: string[] = [];
  
  if (factors.skillMaturity > 30 && input.skillState !== 'active') {
    recommendations.push('Promote skill to active state after thorough testing');
  }
  
  if (!input.skillPinned) {
    recommendations.push('Pin skill version to prevent unexpected changes');
  }
  
  if (factors.modelVolatility > 50) {
    recommendations.push('Consider lowering temperature for more predictable outputs');
  }
  
  if (factors.toolBreadth > 50) {
    recommendations.push('Review if all tools are necessary for this task');
  }
  
  if (input.dataSensitivity === 'pii' || input.dataSensitivity === 'high') {
    recommendations.push('Ensure proper data redaction is configured');
  }
  
  return recommendations;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick risk check - returns true if risk exceeds threshold
 */
export function isHighRisk(input: RiskScoringInput, threshold: number = 50): boolean {
  const score = calculateRiskScore(input);
  return score.score >= threshold;
}

/**
 * Get risk level only (faster than full score calculation)
 */
export function quickRiskLevel(input: RiskScoringInput): RiskLevel {
  const score = calculateRiskScore(input);
  return score.level;
}

/**
 * Format risk score for display
 */
export function formatRiskScore(score: RiskScore): string {
  const lines: string[] = [];
  
  lines.push(`Risk Score: ${score.score}/100 (${score.level.toUpperCase()})`);
  lines.push('');
  lines.push('Factors:');
  lines.push(`  Tool Breadth: ${score.factors.toolBreadth}`);
  lines.push(`  Skill Maturity: ${score.factors.skillMaturity}`);
  lines.push(`  Model Volatility: ${score.factors.modelVolatility}`);
  lines.push(`  Data Sensitivity: ${score.factors.dataSensitivity}`);
  
  if (score.riskFactors.length > 0) {
    lines.push('');
    lines.push('Risk Factors:');
    for (const factor of score.riskFactors) {
      lines.push(`  - ${factor}`);
    }
  }
  
  if (score.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const rec of score.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }
  
  return lines.join('\n');
}
