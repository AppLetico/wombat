/**
 * Break-Glass Override Model
 *
 * Overrides allow operators to bypass certain safety checks in emergency situations.
 * All overrides require structured justification and emit audit events.
 */

import { z } from "zod";

/**
 * Reason codes for break-glass overrides.
 * Each code represents a valid justification category.
 */
export const OVERRIDE_REASON_CODES = [
  "incident_response",
  "hotfix",
  "business_deadline",
  "data_correction",
  "other"
] as const;

export type OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];

/**
 * Minimum justification length to ensure meaningful explanations
 */
export const MIN_JUSTIFICATION_LENGTH = 10;

/**
 * Override request structure
 */
export interface OverrideRequest {
  reason_code: OverrideReasonCode;
  justification: string;
}

/**
 * Zod schema for override validation
 */
export const OverrideSchema = z.object({
  reason_code: z.enum(OVERRIDE_REASON_CODES),
  justification: z.string().min(MIN_JUSTIFICATION_LENGTH, {
    message: `Justification must be at least ${MIN_JUSTIFICATION_LENGTH} characters`
  })
});

/**
 * Validate an override request.
 * Throws ZodError if validation fails.
 */
export function validateOverride(request: unknown): OverrideRequest {
  return OverrideSchema.parse(request);
}

/**
 * Check if an override request is valid without throwing.
 */
export function isValidOverride(request: unknown): request is OverrideRequest {
  return OverrideSchema.safeParse(request).success;
}

/**
 * Override audit event data structure
 */
export interface OverrideAuditData {
  actor: string;
  role: string;
  action: string;
  target_id: string;
  reason_code: OverrideReasonCode;
  justification: string;
  timestamp: string;
}

/**
 * Build override audit event data for logging
 */
export function buildOverrideAuditData(params: {
  actor: string;
  role: string;
  action: string;
  targetId: string;
  override: OverrideRequest;
}): OverrideAuditData {
  return {
    actor: params.actor,
    role: params.role,
    action: params.action,
    target_id: params.targetId,
    reason_code: params.override.reason_code,
    justification: params.override.justification,
    timestamp: new Date().toISOString()
  };
}

/**
 * Human-readable labels for reason codes
 */
export const REASON_CODE_LABELS: Record<OverrideReasonCode, string> = {
  incident_response: "Incident Response",
  hotfix: "Hotfix",
  business_deadline: "Business Deadline",
  data_correction: "Data Correction",
  other: "Other"
};

/**
 * Get human-readable label for a reason code
 */
export function getReasonCodeLabel(code: OverrideReasonCode): string {
  return REASON_CODE_LABELS[code] || code;
}
