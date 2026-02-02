/**
 * Trace Diff
 *
 * Compare two agent execution traces and return structured differences.
 * Used for debugging regressions and understanding behavior changes.
 */

import type {
  AgentTrace,
  TraceStep,
  ToolCallTrace,
  LLMCallStep,
  ToolCallStep,
  ToolResultStep,
} from './trace.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Diff result for two traces
 */
export interface TraceDiff {
  /** IDs of the compared traces */
  traceIds: {
    base: string;
    compare: string;
  };

  /** Whether the traces are from the same tenant/workspace */
  context: {
    sameTenant: boolean;
    sameWorkspace: boolean;
    sameAgent: boolean;
  };

  /** Timing differences */
  timing: {
    baseDurationMs: number | null;
    compareDurationMs: number | null;
    deltaMs: number | null;
    percentChange: number | null;
  };

  /** Model/provider differences */
  model: {
    baseModel: string;
    compareModel: string;
    baseProvider: string;
    compareProvider: string;
    changed: boolean;
  };

  /** Workspace version differences */
  workspace: {
    baseHash: string | null;
    compareHash: string | null;
    changed: boolean;
  };

  /** Skill version differences */
  skills: {
    added: Record<string, string>;
    removed: Record<string, string>;
    changed: Record<string, { base: string; compare: string }>;
    unchanged: Record<string, string>;
  };

  /** Token usage differences */
  usage: {
    baseInputTokens: number;
    compareInputTokens: number;
    baseOutputTokens: number;
    compareOutputTokens: number;
    inputTokenDelta: number;
    outputTokenDelta: number;
    totalTokenDelta: number;
  };

  /** Cost differences */
  cost: {
    baseCost: number;
    compareCost: number;
    delta: number;
    percentChange: number | null;
  };

  /** Tool call differences */
  toolCalls: ToolCallDiff;

  /** Step-by-step differences */
  steps: StepsDiff;

  /** Output differences */
  output: OutputDiff;

  /** Error differences */
  errors: {
    baseError: string | null;
    compareError: string | null;
    baseHasError: boolean;
    compareHasError: boolean;
  };

  /** Summary statistics */
  summary: {
    totalDifferences: number;
    significantChanges: string[];
  };
}

/**
 * Tool call comparison
 */
export interface ToolCallDiff {
  /** Tool calls only in base trace */
  removed: ToolCallSummary[];
  /** Tool calls only in compare trace */
  added: ToolCallSummary[];
  /** Tool calls in both with differences */
  changed: ToolCallChange[];
  /** Identical tool calls */
  unchanged: number;
  /** Total tool calls in base */
  baseCount: number;
  /** Total tool calls in compare */
  compareCount: number;
}

export interface ToolCallSummary {
  id: string;
  name: string;
  success: boolean;
  durationMs: number;
}

export interface ToolCallChange {
  name: string;
  baseId: string;
  compareId: string;
  differences: {
    argumentsChanged: boolean;
    resultChanged: boolean;
    successChanged: boolean;
    durationDelta: number;
  };
}

/**
 * Step-by-step comparison
 */
export interface StepsDiff {
  baseStepCount: number;
  compareStepCount: number;
  llmCallCountDelta: number;
  toolCallCountDelta: number;
  errorCountDelta: number;
  /** Steps that differ by type or order */
  structuralDifferences: number;
}

/**
 * Output comparison
 */
export interface OutputDiff {
  baseHasOutput: boolean;
  compareHasOutput: boolean;
  messagesEqual: boolean;
  baseMessageLength: number | null;
  compareMessageLength: number | null;
  messageLengthDelta: number | null;
}

// ============================================================================
// Diff Functions
// ============================================================================

/**
 * Compare two traces and return a structured diff
 */
export function diffTraces(base: AgentTrace, compare: AgentTrace): TraceDiff {
  const skillsDiff = diffSkillVersions(base.skillVersions, compare.skillVersions);
  const toolCallsDiff = diffToolCalls(
    base.output?.toolCalls || [],
    compare.output?.toolCalls || []
  );
  const stepsDiff = diffSteps(base.steps, compare.steps);
  const outputDiff = diffOutput(base, compare);

  const baseDuration = base.durationMs ?? null;
  const compareDuration = compare.durationMs ?? null;
  const durationDelta = baseDuration !== null && compareDuration !== null
    ? compareDuration - baseDuration
    : null;
  const durationPercentChange = baseDuration !== null && compareDuration !== null && baseDuration > 0
    ? ((compareDuration - baseDuration) / baseDuration) * 100
    : null;

  const costDelta = compare.usage.totalCost - base.usage.totalCost;
  const costPercentChange = base.usage.totalCost > 0
    ? (costDelta / base.usage.totalCost) * 100
    : null;

  const significantChanges: string[] = [];

  // Identify significant changes
  if (base.model !== compare.model) {
    significantChanges.push('Model changed');
  }
  if (base.workspaceHash !== compare.workspaceHash) {
    significantChanges.push('Workspace changed');
  }
  if (Object.keys(skillsDiff.changed).length > 0) {
    significantChanges.push('Skill versions changed');
  }
  if (toolCallsDiff.added.length > 0 || toolCallsDiff.removed.length > 0) {
    significantChanges.push('Tool calls differ');
  }
  if (base.error !== compare.error) {
    significantChanges.push('Error status changed');
  }
  if (costPercentChange !== null && Math.abs(costPercentChange) > 20) {
    significantChanges.push('Cost changed significantly');
  }
  if (!outputDiff.messagesEqual) {
    significantChanges.push('Output message differs');
  }

  return {
    traceIds: {
      base: base.id,
      compare: compare.id,
    },
    context: {
      sameTenant: base.tenantId === compare.tenantId,
      sameWorkspace: base.workspaceId === compare.workspaceId,
      sameAgent: base.agentRole === compare.agentRole,
    },
    timing: {
      baseDurationMs: baseDuration,
      compareDurationMs: compareDuration,
      deltaMs: durationDelta,
      percentChange: durationPercentChange,
    },
    model: {
      baseModel: base.model,
      compareModel: compare.model,
      baseProvider: base.provider,
      compareProvider: compare.provider,
      changed: base.model !== compare.model || base.provider !== compare.provider,
    },
    workspace: {
      baseHash: base.workspaceHash ?? null,
      compareHash: compare.workspaceHash ?? null,
      changed: base.workspaceHash !== compare.workspaceHash,
    },
    skills: skillsDiff,
    usage: {
      baseInputTokens: base.usage.inputTokens,
      compareInputTokens: compare.usage.inputTokens,
      baseOutputTokens: base.usage.outputTokens,
      compareOutputTokens: compare.usage.outputTokens,
      inputTokenDelta: compare.usage.inputTokens - base.usage.inputTokens,
      outputTokenDelta: compare.usage.outputTokens - base.usage.outputTokens,
      totalTokenDelta:
        (compare.usage.inputTokens + compare.usage.outputTokens) -
        (base.usage.inputTokens + base.usage.outputTokens),
    },
    cost: {
      baseCost: base.usage.totalCost,
      compareCost: compare.usage.totalCost,
      delta: costDelta,
      percentChange: costPercentChange,
    },
    toolCalls: toolCallsDiff,
    steps: stepsDiff,
    output: outputDiff,
    errors: {
      baseError: base.error ?? null,
      compareError: compare.error ?? null,
      baseHasError: !!base.error,
      compareHasError: !!compare.error,
    },
    summary: {
      totalDifferences: significantChanges.length,
      significantChanges,
    },
  };
}

/**
 * Compare skill versions between two traces
 */
function diffSkillVersions(
  base: Record<string, string>,
  compare: Record<string, string>
): TraceDiff['skills'] {
  const added: Record<string, string> = {};
  const removed: Record<string, string> = {};
  const changed: Record<string, { base: string; compare: string }> = {};
  const unchanged: Record<string, string> = {};

  const allSkills = new Set([...Object.keys(base), ...Object.keys(compare)]);

  for (const skill of allSkills) {
    const baseVersion = base[skill];
    const compareVersion = compare[skill];

    if (baseVersion && !compareVersion) {
      removed[skill] = baseVersion;
    } else if (!baseVersion && compareVersion) {
      added[skill] = compareVersion;
    } else if (baseVersion !== compareVersion) {
      changed[skill] = { base: baseVersion, compare: compareVersion };
    } else {
      unchanged[skill] = baseVersion;
    }
  }

  return { added, removed, changed, unchanged };
}

/**
 * Compare tool calls between two traces
 */
function diffToolCalls(
  base: ToolCallTrace[],
  compare: ToolCallTrace[]
): ToolCallDiff {
  const baseByName = new Map<string, ToolCallTrace[]>();
  const compareByName = new Map<string, ToolCallTrace[]>();

  // Group by tool name
  for (const tc of base) {
    if (!baseByName.has(tc.name)) {
      baseByName.set(tc.name, []);
    }
    baseByName.get(tc.name)!.push(tc);
  }

  for (const tc of compare) {
    if (!compareByName.has(tc.name)) {
      compareByName.set(tc.name, []);
    }
    compareByName.get(tc.name)!.push(tc);
  }

  const allToolNames = new Set([...baseByName.keys(), ...compareByName.keys()]);

  const removed: ToolCallSummary[] = [];
  const added: ToolCallSummary[] = [];
  const changed: ToolCallChange[] = [];
  let unchanged = 0;

  for (const toolName of allToolNames) {
    const baseCalls = baseByName.get(toolName) || [];
    const compareCalls = compareByName.get(toolName) || [];

    // Simple comparison: compare by index
    const maxLen = Math.max(baseCalls.length, compareCalls.length);

    for (let i = 0; i < maxLen; i++) {
      const baseCall = baseCalls[i];
      const compareCall = compareCalls[i];

      if (baseCall && !compareCall) {
        removed.push({
          id: baseCall.id,
          name: baseCall.name,
          success: baseCall.success,
          durationMs: baseCall.durationMs,
        });
      } else if (!baseCall && compareCall) {
        added.push({
          id: compareCall.id,
          name: compareCall.name,
          success: compareCall.success,
          durationMs: compareCall.durationMs,
        });
      } else if (baseCall && compareCall) {
        const argsEqual = JSON.stringify(baseCall.arguments) === JSON.stringify(compareCall.arguments);
        const resultEqual = JSON.stringify(baseCall.result) === JSON.stringify(compareCall.result);
        const successEqual = baseCall.success === compareCall.success;

        if (!argsEqual || !resultEqual || !successEqual) {
          changed.push({
            name: toolName,
            baseId: baseCall.id,
            compareId: compareCall.id,
            differences: {
              argumentsChanged: !argsEqual,
              resultChanged: !resultEqual,
              successChanged: !successEqual,
              durationDelta: compareCall.durationMs - baseCall.durationMs,
            },
          });
        } else {
          unchanged++;
        }
      }
    }
  }

  return {
    removed,
    added,
    changed,
    unchanged,
    baseCount: base.length,
    compareCount: compare.length,
  };
}

/**
 * Compare steps between two traces
 */
function diffSteps(base: TraceStep[], compare: TraceStep[]): StepsDiff {
  const countByType = (steps: TraceStep[], type: string) =>
    steps.filter((s) => s.type === type).length;

  const baseLLMCalls = countByType(base, 'llm_call');
  const compareLLMCalls = countByType(compare, 'llm_call');
  const baseToolCalls = countByType(base, 'tool_call');
  const compareToolCalls = countByType(compare, 'tool_call');
  const baseErrors = countByType(base, 'error');
  const compareErrors = countByType(compare, 'error');

  // Count structural differences (type mismatches at same index)
  let structuralDifferences = 0;
  const maxLen = Math.max(base.length, compare.length);
  for (let i = 0; i < maxLen; i++) {
    if (base[i]?.type !== compare[i]?.type) {
      structuralDifferences++;
    }
  }

  return {
    baseStepCount: base.length,
    compareStepCount: compare.length,
    llmCallCountDelta: compareLLMCalls - baseLLMCalls,
    toolCallCountDelta: compareToolCalls - baseToolCalls,
    errorCountDelta: compareErrors - baseErrors,
    structuralDifferences,
  };
}

/**
 * Compare output between two traces
 */
function diffOutput(base: AgentTrace, compare: AgentTrace): OutputDiff {
  const baseHasOutput = !!base.output?.message;
  const compareHasOutput = !!compare.output?.message;

  const baseMessage = base.output?.message ?? null;
  const compareMessage = compare.output?.message ?? null;

  const messagesEqual = baseMessage === compareMessage;
  const baseLen = baseMessage?.length ?? null;
  const compareLen = compareMessage?.length ?? null;

  return {
    baseHasOutput,
    compareHasOutput,
    messagesEqual,
    baseMessageLength: baseLen,
    compareMessageLength: compareLen,
    messageLengthDelta: baseLen !== null && compareLen !== null ? compareLen - baseLen : null,
  };
}

/**
 * Create a human-readable summary of a trace diff
 */
export function formatDiffSummary(diff: TraceDiff): string {
  const lines: string[] = [];

  lines.push(`Trace Diff: ${diff.traceIds.base} vs ${diff.traceIds.compare}`);
  lines.push('');

  if (diff.summary.significantChanges.length === 0) {
    lines.push('No significant changes detected.');
  } else {
    lines.push('Significant Changes:');
    for (const change of diff.summary.significantChanges) {
      lines.push(`  - ${change}`);
    }
  }

  lines.push('');
  lines.push('Summary:');

  if (diff.model.changed) {
    lines.push(`  Model: ${diff.model.baseModel} -> ${diff.model.compareModel}`);
  }

  if (diff.cost.percentChange !== null) {
    const sign = diff.cost.delta >= 0 ? '+' : '';
    lines.push(`  Cost: $${diff.cost.baseCost.toFixed(4)} -> $${diff.cost.compareCost.toFixed(4)} (${sign}${diff.cost.percentChange.toFixed(1)}%)`);
  }

  if (diff.timing.deltaMs !== null) {
    const sign = diff.timing.deltaMs >= 0 ? '+' : '';
    lines.push(`  Duration: ${diff.timing.baseDurationMs}ms -> ${diff.timing.compareDurationMs}ms (${sign}${diff.timing.deltaMs}ms)`);
  }

  lines.push(`  Tool Calls: ${diff.toolCalls.baseCount} -> ${diff.toolCalls.compareCount}`);

  if (diff.toolCalls.added.length > 0) {
    lines.push(`    Added: ${diff.toolCalls.added.map(t => t.name).join(', ')}`);
  }
  if (diff.toolCalls.removed.length > 0) {
    lines.push(`    Removed: ${diff.toolCalls.removed.map(t => t.name).join(', ')}`);
  }

  if (Object.keys(diff.skills.changed).length > 0) {
    lines.push('  Skill Version Changes:');
    for (const [skill, { base, compare }] of Object.entries(diff.skills.changed)) {
      lines.push(`    ${skill}: ${base} -> ${compare}`);
    }
  }

  return lines.join('\n');
}
