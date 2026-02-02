/**
 * Trace Model
 *
 * Defines the structure of agent execution traces for observability.
 * Every agent run produces a deterministic trace that includes:
 * - Context (tenant, workspace, role)
 * - Versions (workspace hash, skill versions, model)
 * - Execution steps (LLM calls, tool calls)
 * - Metrics (tokens, cost, timing)
 */

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

/**
 * Types of execution steps in a trace
 */
export type TraceStepType = 'llm_call' | 'tool_call' | 'tool_result' | 'error';

/**
 * LLM call step data
 */
export interface LLMCallStep {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  hasToolCalls: boolean;
  finishReason?: string;
}

/**
 * Tool call step data
 */
export interface ToolCallStep {
  toolCallId: string;
  toolName: string;
  arguments: unknown; // May be redacted
  permitted: boolean;
  permissionReason?: string;
}

/**
 * Tool result step data
 */
export interface ToolResultStep {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: unknown; // May be redacted
  error?: string;
}

/**
 * Error step data
 */
export interface ErrorStep {
  code: string;
  message: string;
  recoverable: boolean;
}

/**
 * A single step in the trace
 */
export interface TraceStep {
  type: TraceStepType;
  timestamp: string; // ISO 8601
  durationMs: number;
  data: LLMCallStep | ToolCallStep | ToolResultStep | ErrorStep;
}

/**
 * Tool call trace for the output section
 */
export interface ToolCallTrace {
  id: string;
  name: string;
  arguments: unknown; // May be redacted
  result: unknown; // May be redacted
  durationMs: number;
  permitted: boolean;
  success: boolean;
}

/**
 * Complete agent execution trace
 */
export interface AgentTrace {
  // Identity
  id: string; // UUID v7 (time-ordered)
  tenantId: string;
  workspaceId: string;
  agentRole?: string;

  // Timing
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  durationMs?: number;

  // Versions (for replay)
  workspaceHash?: string; // SHA256 of workspace files
  skillVersions: Record<string, string>;
  model: string;
  provider: string;

  // Request
  input: {
    message: string;
    messageHistory: number; // Count, not content
  };

  // Execution
  steps: TraceStep[];

  // Response
  output?: {
    message: string;
    toolCalls: ToolCallTrace[];
  };

  // Metrics
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };

  // Redacted prompt for storage (optional)
  redactedPrompt?: string;

  // Error if failed
  error?: string;

  // Labels for categorization (mutable)
  labels?: Record<string, string>;

  // External entity linking (for control plane integration)
  taskId?: string;
  documentId?: string;
  messageId?: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const LLMCallStepSchema = z.object({
  model: z.string(),
  provider: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cost: z.number(),
  hasToolCalls: z.boolean(),
  finishReason: z.string().optional(),
});

export const ToolCallStepSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.unknown(),
  permitted: z.boolean(),
  permissionReason: z.string().optional(),
});

export const ToolResultStepSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const ErrorStepSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
});

export const TraceStepSchema = z.object({
  type: z.enum(['llm_call', 'tool_call', 'tool_result', 'error']),
  timestamp: z.string(),
  durationMs: z.number(),
  data: z.union([
    LLMCallStepSchema,
    ToolCallStepSchema,
    ToolResultStepSchema,
    ErrorStepSchema,
  ]),
});

export const ToolCallTraceSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.unknown(),
  result: z.unknown(),
  durationMs: z.number(),
  permitted: z.boolean(),
  success: z.boolean(),
});

export const AgentTraceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  workspaceId: z.string(),
  agentRole: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  workspaceHash: z.string().optional(),
  skillVersions: z.record(z.string()),
  model: z.string(),
  provider: z.string(),
  input: z.object({
    message: z.string(),
    messageHistory: z.number(),
  }),
  steps: z.array(TraceStepSchema),
  output: z
    .object({
      message: z.string(),
      toolCalls: z.array(ToolCallTraceSchema),
    })
    .optional(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalCost: z.number(),
  }),
  redactedPrompt: z.string().optional(),
  error: z.string().optional(),
  labels: z.record(z.string()).optional(),
  taskId: z.string().optional(),
  documentId: z.string().optional(),
  messageId: z.string().optional(),
});

// ============================================================================
// Trace Builder
// ============================================================================

/**
 * Builder class for constructing traces incrementally
 */
export class TraceBuilder {
  private trace: AgentTrace;

  constructor(options: {
    tenantId: string;
    workspaceId: string;
    model: string;
    provider: string;
    agentRole?: string;
    inputMessage: string;
    messageHistory?: number;
  }) {
    this.trace = {
      id: uuidv7(),
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      agentRole: options.agentRole,
      model: options.model,
      provider: options.provider,
      startedAt: new Date().toISOString(),
      skillVersions: {},
      input: {
        message: options.inputMessage,
        messageHistory: options.messageHistory || 0,
      },
      steps: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
      },
    };
  }

  /**
   * Get the trace ID
   */
  getId(): string {
    return this.trace.id;
  }

  /**
   * Set workspace hash
   */
  setWorkspaceHash(hash: string): this {
    this.trace.workspaceHash = hash;
    return this;
  }

  /**
   * Set skill versions
   */
  setSkillVersions(versions: Record<string, string>): this {
    this.trace.skillVersions = versions;
    return this;
  }

  /**
   * Add an LLM call step
   */
  addLLMCall(data: LLMCallStep, durationMs: number): this {
    this.trace.steps.push({
      type: 'llm_call',
      timestamp: new Date().toISOString(),
      durationMs,
      data,
    });

    // Accumulate usage
    this.trace.usage.inputTokens += data.inputTokens;
    this.trace.usage.outputTokens += data.outputTokens;
    this.trace.usage.totalCost += data.cost;

    return this;
  }

  /**
   * Add a tool call step
   */
  addToolCall(data: ToolCallStep, durationMs: number = 0): this {
    this.trace.steps.push({
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      durationMs,
      data,
    });
    return this;
  }

  /**
   * Add a tool result step
   */
  addToolResult(data: ToolResultStep, durationMs: number): this {
    this.trace.steps.push({
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      durationMs,
      data,
    });
    return this;
  }

  /**
   * Add an error step
   */
  addError(data: ErrorStep, durationMs: number = 0): this {
    this.trace.steps.push({
      type: 'error',
      timestamp: new Date().toISOString(),
      durationMs,
      data,
    });
    return this;
  }

  /**
   * Set the output
   */
  setOutput(message: string, toolCalls: ToolCallTrace[] = []): this {
    this.trace.output = {
      message,
      toolCalls,
    };
    return this;
  }

  /**
   * Set the error
   */
  setError(error: string): this {
    this.trace.error = error;
    return this;
  }

  /**
   * Set redacted prompt
   */
  setRedactedPrompt(prompt: string): this {
    this.trace.redactedPrompt = prompt;
    return this;
  }

  /**
   * Complete the trace
   */
  complete(): AgentTrace {
    this.trace.completedAt = new Date().toISOString();
    this.trace.durationMs =
      new Date(this.trace.completedAt).getTime() -
      new Date(this.trace.startedAt).getTime();
    return this.trace;
  }

  /**
   * Get the current trace (without completing it)
   */
  getTrace(): AgentTrace {
    return { ...this.trace };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a new trace ID (UUID v7 for time-ordering)
 */
export function generateTraceId(): string {
  return uuidv7();
}

/**
 * Extract tool call traces from steps
 */
export function extractToolCallTraces(steps: TraceStep[]): ToolCallTrace[] {
  const toolCalls: Map<string, Partial<ToolCallTrace>> = new Map();

  for (const step of steps) {
    if (step.type === 'tool_call') {
      const data = step.data as ToolCallStep;
      toolCalls.set(data.toolCallId, {
        id: data.toolCallId,
        name: data.toolName,
        arguments: data.arguments,
        permitted: data.permitted,
        durationMs: 0,
        success: false,
      });
    } else if (step.type === 'tool_result') {
      const data = step.data as ToolResultStep;
      const existing = toolCalls.get(data.toolCallId);
      if (existing) {
        existing.result = data.result;
        existing.success = data.success;
        existing.durationMs = step.durationMs;
      }
    }
  }

  return Array.from(toolCalls.values()).filter(
    (tc): tc is ToolCallTrace =>
      tc.id !== undefined &&
      tc.name !== undefined &&
      tc.permitted !== undefined &&
      tc.success !== undefined
  );
}

/**
 * Calculate total tokens and cost from steps
 */
export function calculateUsageFromSteps(steps: TraceStep[]): {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;

  for (const step of steps) {
    if (step.type === 'llm_call') {
      const data = step.data as LLMCallStep;
      inputTokens += data.inputTokens;
      outputTokens += data.outputTokens;
      totalCost += data.cost;
    }
  }

  return { inputTokens, outputTokens, totalCost };
}
