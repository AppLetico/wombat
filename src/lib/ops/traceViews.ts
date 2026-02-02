import { calculateRiskScore } from "../governance/riskScoring.js";
import { getSkillRegistry } from "../skills/skillRegistry.js";
import type { AgentTrace, TraceStep } from "../tracing/trace.js";

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
  raw_trace: AgentTrace;
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

export function buildTraceDetailView(params: {
  trace: AgentTrace;
  annotations: { key: string; value: string }[];
}): TraceDetailView {
  const { trace, annotations } = params;
  const skillStates = getSkillStates(trace.skillVersions);
  const summary = buildTraceSummaryView({ trace, annotations });

  return {
    ...summary,
    input: {
      message: trace.input.message,
      message_history: trace.input.messageHistory
    },
    output: trace.output
      ? {
          message: trace.output.message,
          tool_calls: trace.output.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            duration_ms: tc.durationMs,
            permitted: tc.permitted,
            success: tc.success
          }))
        }
      : undefined,
    steps: trace.steps.map((step) => ({
      type: step.type,
      timestamp: step.timestamp,
      duration_ms: step.durationMs,
      data: step.data
    })),
    skill_versions: trace.skillVersions,
    skill_states: skillStates,
    governance_signals: {
      redaction_applied: !!trace.redactedPrompt,
      permission_denials: getPermissionDenials(trace.steps)
    },
    raw_trace: trace
  };
}
