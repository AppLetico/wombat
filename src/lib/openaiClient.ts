/**
 * OpenAI client compatibility layer.
 * This module maintains backward compatibility while using the new multi-provider LLM abstraction.
 *
 * @deprecated Import from llmProvider.ts for new code.
 */

import { config } from "./config.js";
import { getWorkspaceLoader, type PromptMode } from "./workspace.js";
import { getUsageTracker, type CostBreakdown } from "./costs.js";
import {
  llmComplete,
  llmCompact,
  llmTask,
  type ConversationMessage as LLMConversationMessage,
  type TokenUsage as LLMTokenUsage,
  type CostBreakdown as LLMCostBreakdown
} from "./llmProvider.js";

/**
 * Message in conversation history.
 */
export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Token usage statistics.
 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Result from agent reply generation.
 */
export interface AgentReplyResult {
  response: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  contextWarning?: string;
}

/**
 * Result from history compaction.
 */
export interface CompactionResult {
  compactedMessages: ConversationMessage[];
  usage: TokenUsage;
}

/**
 * Default context window sizes by model.
 * Used for context overflow warnings.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4.1": 128000,
  "gpt-4.1-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  // Anthropic
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  "claude-sonnet-4-20250514": 200000,
  "claude-3-opus-20240229": 200000,
  // Google
  "gemini-2.0-flash": 1000000,
  "gemini-2.5-flash": 1000000,
  "gemini-1.5-pro": 2000000
};

/**
 * Get the context window size for a model.
 * Defaults to 128000 for unknown models.
 */
function getContextWindow(model: string): number {
  // Strip provider prefix if present
  const modelId = model.includes("/") ? model.split("/")[1] : model;
  return MODEL_CONTEXT_WINDOWS[modelId] || 128000;
}

/**
 * Estimate tokens from text (rough: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function generateAgentReply(params: {
  role: string;
  userMessage: string;
  messages?: ConversationMessage[];
  metadata?: Record<string, any> | null;
  promptMode?: PromptMode;
  timezone?: string;
}): Promise<AgentReplyResult> {
  const { role, userMessage, messages = [], metadata, promptMode = "full", timezone } = params;

  // Load system prompt from workspace files (OpenClaw-inspired pattern)
  // Priority: metadata.system_prompt > workspace files > generic fallback
  let systemPrompt: string;
  const workspace = getWorkspaceLoader();

  if (metadata?.system_prompt) {
    // Allow full override via request payload
    systemPrompt = metadata.system_prompt;
  } else {
    // Load from workspace: souls/<role>.md or SOUL.md + AGENTS.md
    // Use promptMode to control context size (minimal for sub-agents)
    systemPrompt = workspace.buildSystemPrompt(role, promptMode);

    // Inject memory files if available
    const memoryContext = workspace.loadMemoryContext();
    if (memoryContext) {
      systemPrompt += "\n\n" + memoryContext;
    }
  }

  // Inject time context if enabled (OpenClaw-inspired)
  if (config.includeTimeContext) {
    const timeContext = workspace.buildTimeContext(timezone || metadata?.timezone);
    systemPrompt += "\n\n" + timeContext;
  }

  const kickoffNote =
    metadata?.kickoff_note ||
    "Draft a concise plan based on the user's request.";

  const prompt = metadata?.kickoff_plan
    ? `${kickoffNote}\n\nUser request: ${userMessage}`
    : userMessage;

  // Estimate context usage for warning
  const estimatedPromptTokens =
    estimateTokens(systemPrompt) +
    messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0) +
    estimateTokens(prompt);
  const contextWindow = getContextWindow(config.llmModelDefault);
  const contextUsagePercent = (estimatedPromptTokens / contextWindow) * 100;

  // Use multi-provider LLM completion with retry and failover
  const result = await llmComplete({
    systemPrompt,
    messages,
    userMessage: prompt,
    model: config.llmModelDefault,
    fallbackModel: config.llmModelFallback || undefined,
    temperature: 0.4
  });

  // Track usage
  getUsageTracker().track(result.usage, result.model);

  // Build result with optional context warning
  const agentResult: AgentReplyResult = {
    response: result.response,
    usage: result.usage,
    cost: result.cost
  };

  // Add context warning if usage is high
  if (contextUsagePercent > config.contextWarningThreshold) {
    agentResult.contextWarning = `Context usage is ${contextUsagePercent.toFixed(1)}% of ${contextWindow} tokens. Consider compacting history.`;
  }

  return agentResult;
}

/**
 * Compact conversation history by summarizing older messages.
 * Following OpenClaw's compaction pattern.
 */
export async function compactHistory(params: {
  messages: ConversationMessage[];
  instructions?: string;
  keepRecent?: number;
}): Promise<CompactionResult> {
  // Delegate to the multi-provider implementation
  const result = await llmCompact(params);
  return {
    compactedMessages: result.compactedMessages,
    usage: result.usage
  };
}

/**
 * Result from LLM task execution.
 */
export interface LLMTaskResult {
  output: unknown;
  usage: TokenUsage;
  cost: CostBreakdown;
  validated: boolean;
}

/**
 * Run a structured LLM task that returns JSON.
 * Following OpenClaw's llm-task pattern for workflow engines.
 */
export async function runLLMTask(params: {
  prompt: string;
  input?: unknown;
  schema?: Record<string, unknown>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<LLMTaskResult> {
  // Delegate to the multi-provider implementation
  const result = await llmTask({
    prompt: params.prompt,
    input: params.input,
    schema: params.schema,
    model: params.model,
    temperature: params.temperature
  });

  // Track usage
  getUsageTracker().track(result.usage, params.model || config.llmModelDefault);

  return result;
}
