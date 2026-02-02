/**
 * Standardized Schema Definitions
 *
 * Provides consistent type definitions and format standards
 * to reduce UI and API drift across the Ops Console.
 */

// ============================================================================
// Timestamp Standards
// ============================================================================

/**
 * All timestamps use ISO 8601 format: 2026-02-02T12:00:00.000Z
 */
export type ISOTimestamp = string;

/**
 * Format a Date to ISO 8601 string
 */
export function formatTimestamp(date: Date): ISOTimestamp {
  return date.toISOString();
}

/**
 * Parse an ISO 8601 timestamp to Date
 */
export function parseTimestamp(timestamp: ISOTimestamp): Date {
  return new Date(timestamp);
}

// ============================================================================
// Cost Standards
// ============================================================================

/**
 * Cost representation with currency
 */
export interface Cost {
  value: number;
  currency: "USD";
}

/**
 * Format cost to standard representation
 * USD with 6 decimal places for precision
 */
export function formatCost(value: number): Cost {
  return {
    value: Math.round(value * 1000000) / 1000000,
    currency: "USD"
  };
}

/**
 * Format cost for display: $0.001234
 */
export function formatCostDisplay(value: number): string {
  return `$${value.toFixed(6)}`;
}

/**
 * Format cost for compact display: $0.0012
 */
export function formatCostCompact(value: number): string {
  return `$${value.toFixed(4)}`;
}

// ============================================================================
// Risk Enums
// ============================================================================

/**
 * Risk level enum
 */
export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

/**
 * All valid risk levels in order of severity
 */
export const RISK_LEVELS: RiskLevel[] = ["none", "low", "medium", "high", "critical"];

/**
 * Risk level severity score (for sorting/comparison)
 */
export const RISK_SEVERITY: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

/**
 * Check if risk level meets or exceeds threshold
 */
export function isRiskAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_SEVERITY[level] >= RISK_SEVERITY[threshold];
}

// ============================================================================
// Status Enums
// ============================================================================

/**
 * Execution status enum
 */
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * All valid execution statuses
 */
export const EXECUTION_STATUSES: ExecutionStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
];

/**
 * Check if status represents a terminal state
 */
export function isTerminalStatus(status: ExecutionStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ============================================================================
// Skill State Enums
// ============================================================================

/**
 * Skill lifecycle state
 */
export type SkillState = "draft" | "tested" | "approved" | "active" | "deprecated";

/**
 * All valid skill states in lifecycle order
 */
export const SKILL_STATES: SkillState[] = [
  "draft",
  "tested",
  "approved",
  "active",
  "deprecated"
];

/**
 * Skill state metadata
 */
export const SKILL_STATE_META: Record<SkillState, { label: string; color: string; executable: boolean }> = {
  draft: { label: "Draft", color: "#6b7280", executable: false },
  tested: { label: "Tested", color: "#3b82f6", executable: false },
  approved: { label: "Approved", color: "#8b5cf6", executable: false },
  active: { label: "Active", color: "#22c55e", executable: true },
  deprecated: { label: "Deprecated", color: "#f59e0b", executable: false }
};

// ============================================================================
// Skill Deprecation
// ============================================================================

/**
 * Deprecation metadata for a skill
 */
export interface SkillDeprecation {
  deprecated: boolean;
  deprecated_at?: ISOTimestamp;
  deprecated_reason?: string;
  replacement_skill?: string;
}

/**
 * Build deprecation metadata
 */
export function buildDeprecation(params?: {
  deprecatedAt?: Date;
  reason?: string;
  replacement?: string;
}): SkillDeprecation {
  if (!params) {
    return { deprecated: false };
  }

  return {
    deprecated: true,
    deprecated_at: params.deprecatedAt?.toISOString(),
    deprecated_reason: params.reason,
    replacement_skill: params.replacement
  };
}

// ============================================================================
// Token Usage
// ============================================================================

/**
 * Token usage representation
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * Build token usage from counts
 */
export function buildTokenUsage(input: number, output: number): TokenUsage {
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output
  };
}

// ============================================================================
// Duration
// ============================================================================

/**
 * Duration in milliseconds
 */
export type DurationMs = number;

/**
 * Format duration for display
 */
export function formatDuration(ms: DurationMs): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
