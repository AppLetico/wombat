import { calculateRiskScore } from "../governance/riskScoring.js";
import { getSkillRegistry } from "../skills/skillRegistry.js";
import type { AgentTrace, TraceStep } from "../tracing/trace.js";
import type { OpsRole } from "../auth/opsAuth.js";
import { config } from "../core/config.js";

/**
 * Role hierarchy rank for comparison
 */
const ROLE_RANK: Record<OpsRole, number> = {
  viewer: 1,
  operator: 2,
  release_manager: 3,
  admin: 4
};

/**
 * Check if role meets minimum threshold
 */
function roleAtLeast(role: OpsRole, minimumRole: OpsRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/**
 * Placeholder text for withheld sensitive content
 */
const SENSITIVE_CONTENT_PLACEHOLDER = "[Sensitive content withheld]";

export interface TraceSummaryView {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agent_role?: string;
  environment: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: "success" | "error";
  model: string;
  provider: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
  };
  risk: {
    score: number;
    level: string;
    factors: string[];
  };
  deprecated_skill_used: boolean;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

/**
 * Redaction information for trace detail
 */
export interface RedactionInfo {
  applied: boolean;
  types_detected: string[];
  count: number;
}

/**
 * Linked identifier with optional deep link URL
 */
export interface LinkedId {
  value: string | null;
  url: string | null;
}

export interface TraceDetailView extends TraceSummaryView {
  input: {
    message: string;
    message_history: number;
  };
  output?: {
    message: string;
    tool_calls: {
      id: string;
      name: string;
      duration_ms: number;
      permitted: boolean;
      success: boolean;
    }[];
  };
  steps: {
    type: string;
    timestamp: string;
    duration_ms: number;
    data: unknown;
  }[];
  skill_versions: Record<string, string>;
  skill_states: Record<string, string>;
  governance_signals: {
    redaction_applied: boolean;
    permission_denials: {
      tool_name: string;
      reason?: string;
    }[];
  };
  redaction_info: RedactionInfo;
  linked_ids: {
    task_id: LinkedId;
    document_id: LinkedId;
    message_id: LinkedId;
  };
  raw_trace: AgentTrace | null;
}

function deriveEnvironment(trace: AgentTrace): string {
  const labels = trace.labels || {};
  return labels.environment || labels.env || "unknown";
}

function getToolNames(steps: TraceStep[]): string[] {
  return steps
    .filter((step) => step.type === "tool_call")
    .map((step) => (step.data as { toolName?: string }).toolName)
    .filter((name): name is string => !!name);
}

function getPermissionDenials(steps: TraceStep[]) {
  return steps
    .filter((step) => step.type === "tool_call")
    .map((step) => step.data as { toolName: string; permitted: boolean; permissionReason?: string })
    .filter((data) => data.permitted === false)
    .map((data) => ({
      tool_name: data.toolName,
      reason: data.permissionReason
    }));
}

function getSkillStates(skillVersions: Record<string, string>): Record<string, string> {
  const registry = getSkillRegistry();
  const states: Record<string, string> = {};
  for (const [name, version] of Object.entries(skillVersions)) {
    const skill = registry.getAnyState(name, version);
    if (skill) {
      states[name] = skill.state;
    }
  }
  return states;
}

function hasDeprecatedSkill(skillStates: Record<string, string>): boolean {
  return Object.values(skillStates).some((state) => state === "deprecated");
}

function pickSkillStateForRisk(skillStates: Record<string, string>): string | undefined {
  const priority: Record<string, number> = {
    draft: 5,
    deprecated: 4,
    tested: 3,
    approved: 2,
    active: 1
  };
  let best: { state: string; score: number } | null = null;
  for (const state of Object.values(skillStates)) {
    const score = priority[state] || 0;
    if (!best || score > best.score) {
      best = { state, score };
    }
  }
  return best?.state;
}

export function computeTraceRisk(trace: AgentTrace, skillStates?: Record<string, string>) {
  const states = skillStates || getSkillStates(trace.skillVersions);
  const toolNames = getToolNames(trace.steps);
  const score = calculateRiskScore({
    toolCount: toolNames.length,
    toolNames,
    skillState: pickSkillStateForRisk(states),
    model: trace.model,
    dataSensitivity: "none"
  });

  return {
    score: score.score,
    level: score.level,
    factors: score.riskFactors
  };
}

function buildAnnotationsMap(entries: { key: string; value: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    if (!map[entry.key]) {
      map[entry.key] = entry.value;
    }
  }
  return map;
}

export function buildTraceSummaryView(params: {
  trace: AgentTrace;
  annotations: { key: string; value: string }[];
}): TraceSummaryView {
  const { trace, annotations } = params;
  const skillStates = getSkillStates(trace.skillVersions);
  const risk = computeTraceRisk(trace, skillStates);
  const labels = trace.labels || {};

  return {
    id: trace.id,
    tenant_id: trace.tenantId,
    workspace_id: trace.workspaceId,
    agent_role: trace.agentRole,
    environment: deriveEnvironment(trace),
    started_at: trace.startedAt,
    completed_at: trace.completedAt,
    duration_ms: trace.durationMs,
    status: trace.error ? "error" : "success",
    model: trace.model,
    provider: trace.provider,
    cost: trace.usage.totalCost,
    tokens: {
      input: trace.usage.inputTokens,
      output: trace.usage.outputTokens
    },
    risk,
    deprecated_skill_used: hasDeprecatedSkill(skillStates),
    labels,
    annotations: buildAnnotationsMap(annotations)
  };
}

/**
 * Detect redaction types from redacted prompt content
 */
function detectRedactionTypes(redactedPrompt: string | undefined): string[] {
  if (!redactedPrompt) return [];

  const types: string[] = [];
  const lowerContent = redactedPrompt.toLowerCase();

  if (lowerContent.includes("[email]") || lowerContent.includes("email redacted")) {
    types.push("email");
  }
  if (lowerContent.includes("[ssn]") || lowerContent.includes("ssn redacted")) {
    types.push("ssn");
  }
  if (lowerContent.includes("[phone]") || lowerContent.includes("phone redacted")) {
    types.push("phone");
  }
  if (lowerContent.includes("[address]") || lowerContent.includes("address redacted")) {
    types.push("address");
  }
  if (lowerContent.includes("[credit_card]") || lowerContent.includes("card redacted")) {
    types.push("credit_card");
  }
  if (lowerContent.includes("[name]") || lowerContent.includes("name redacted")) {
    types.push("name");
  }
  if (lowerContent.includes("[redacted]")) {
    types.push("other");
  }

  return types;
}

/**
 * Count redaction occurrences in content
 */
function countRedactions(redactedPrompt: string | undefined): number {
  if (!redactedPrompt) return 0;
  const matches = redactedPrompt.match(/\[[\w_]+\]/g) || [];
  return matches.length;
}

/**
 * Build deep link URL from template
 */
function buildDeepLinkUrl(template: string | undefined, id: string | null): string | null {
  if (!template || !id) return null;
  return template.replace("{id}", id);
}

export function buildTraceDetailView(params: {
  trace: AgentTrace;
  annotations: { key: string; value: string }[];
  role?: OpsRole;
}): TraceDetailView {
  const { trace, annotations, role = "viewer" } = params;
  const skillStates = getSkillStates(trace.skillVersions);
  const summary = buildTraceSummaryView({ trace, annotations });

  // Role-based field stripping: only admin can see raw sensitive content
  const isAdmin = roleAtLeast(role, "admin");

  // Get redaction info
  const redactionInfo: RedactionInfo = {
    applied: !!trace.redactedPrompt,
    types_detected: detectRedactionTypes(trace.redactedPrompt),
    count: countRedactions(trace.redactedPrompt)
  };

  // Build linked IDs with deep link URLs
  const taskId = (trace as any).taskId || null;
  const documentId = (trace as any).documentId || null;
  const messageId = (trace as any).messageId || null;

  // Get deep link templates from config (will be added)
  const deepLinkTask = process.env.DEEP_LINK_TASK_TEMPLATE;
  const deepLinkDoc = process.env.DEEP_LINK_DOC_TEMPLATE;
  const deepLinkMsg = process.env.DEEP_LINK_MSG_TEMPLATE;

  const linkedIds = {
    task_id: {
      value: taskId,
      url: buildDeepLinkUrl(deepLinkTask, taskId)
    },
    document_id: {
      value: documentId,
      url: buildDeepLinkUrl(deepLinkDoc, documentId)
    },
    message_id: {
      value: messageId,
      url: buildDeepLinkUrl(deepLinkMsg, messageId)
    }
  };

  // Strip sensitive data for non-admin users
  const inputMessage = isAdmin ? trace.input.message : SENSITIVE_CONTENT_PLACEHOLDER;
  const outputMessage = isAdmin
    ? trace.output?.message
    : trace.output ? SENSITIVE_CONTENT_PLACEHOLDER : undefined;

  // Strip step data for non-admin
  const steps = trace.steps.map((step) => ({
    type: step.type,
    timestamp: step.timestamp,
    duration_ms: step.durationMs,
    data: isAdmin ? step.data : { type: step.type, withheld: true }
  }));

  return {
    ...summary,
    input: {
      message: inputMessage,
      message_history: trace.input.messageHistory
    },
    output: trace.output
      ? {
          message: outputMessage!,
          tool_calls: trace.output.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            duration_ms: tc.durationMs,
            permitted: tc.permitted,
            success: tc.success
          }))
        }
      : undefined,
    steps,
    skill_versions: trace.skillVersions,
    skill_states: skillStates,
    governance_signals: {
      redaction_applied: !!trace.redactedPrompt,
      permission_denials: getPermissionDenials(trace.steps)
    },
    redaction_info: redactionInfo,
    linked_ids: linkedIds,
    raw_trace: isAdmin ? trace : null
  };
}
