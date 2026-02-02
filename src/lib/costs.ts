/**
 * Cost tracking module.
 * Following OpenClaw's usage tracking pattern.
 */

import { TokenUsage } from "./openaiClient.js";

/**
 * Model pricing per 1M tokens (in USD).
 * Source: OpenAI pricing page (as of 2026)
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Default pricing for common models.
 * These can be overridden via config.
 *
 * Note: pi-ai provides its own cost tracking, but we maintain this for
 * backward compatibility and the local usage tracker.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ===== OpenAI =====
  // GPT-4o family
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },

  // GPT-4.1 family
  "gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // GPT-4 Turbo
  "gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
  "gpt-4-turbo-preview": { inputPer1M: 10, outputPer1M: 30 },

  // GPT-4
  "gpt-4": { inputPer1M: 30, outputPer1M: 60 },

  // GPT-3.5
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  "gpt-3.5-turbo-16k": { inputPer1M: 3, outputPer1M: 4 },

  // ===== Anthropic =====
  // Claude 4 family
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75 },

  // Claude 3.5 family
  "claude-3-5-sonnet-20241022": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.8, outputPer1M: 4 },

  // Claude 3 family
  "claude-3-opus-20240229": { inputPer1M: 15, outputPer1M: 75 },
  "claude-3-sonnet-20240229": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },

  // ===== Google =====
  // Gemini 2.5 family
  "gemini-2.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },

  // Gemini 2.0 family
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.0-flash-thinking": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // Gemini 1.5 family
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },

  // ===== xAI =====
  "grok-2": { inputPer1M: 2, outputPer1M: 10 },
  "grok-2-mini": { inputPer1M: 0.2, outputPer1M: 1 },

  // ===== Groq =====
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },
  "mixtral-8x7b-32768": { inputPer1M: 0.24, outputPer1M: 0.24 },

  // ===== Mistral =====
  "mistral-large-latest": { inputPer1M: 2, outputPer1M: 6 },
  "mistral-small-latest": { inputPer1M: 0.2, outputPer1M: 0.6 },
  "codestral-latest": { inputPer1M: 0.3, outputPer1M: 0.9 }
};

/**
 * Cost breakdown for a request.
 */
export interface CostBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "USD";
}

/**
 * Calculate cost for a request given usage and model.
 */
export function calculateCost(usage: TokenUsage, model: string): CostBreakdown {
  const pricing = MODEL_PRICING[model];

  let inputCost = 0;
  let outputCost = 0;

  if (pricing) {
    inputCost = (usage.prompt_tokens / 1_000_000) * pricing.inputPer1M;
    outputCost = (usage.completion_tokens / 1_000_000) * pricing.outputPer1M;
  }

  return {
    model,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    inputCost: roundToMicro(inputCost),
    outputCost: roundToMicro(outputCost),
    totalCost: roundToMicro(inputCost + outputCost),
    currency: "USD"
  };
}

/**
 * Round to 6 decimal places (micro-dollar precision).
 */
function roundToMicro(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Format cost for display.
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    // Show in micro-dollars for small amounts
    return `$${(cost * 100).toFixed(4)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Aggregate usage tracker for a session.
 */
export class UsageTracker {
  private requests: CostBreakdown[] = [];

  /**
   * Track a request's cost.
   */
  track(usage: TokenUsage, model: string): CostBreakdown {
    const cost = calculateCost(usage, model);
    this.requests.push(cost);
    return cost;
  }

  /**
   * Get aggregate stats.
   */
  getStats(): UsageStats {
    const totalInputTokens = this.requests.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = this.requests.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalCost = this.requests.reduce((sum, r) => sum + r.totalCost, 0);

    return {
      requestCount: this.requests.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost: roundToMicro(totalCost),
      currency: "USD"
    };
  }

  /**
   * Clear tracked requests.
   */
  clear(): void {
    this.requests = [];
  }
}

/**
 * Aggregate usage statistics.
 */
export interface UsageStats {
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  currency: "USD";
}

/**
 * Global usage tracker instance.
 */
let globalTracker: UsageTracker | null = null;

export function getUsageTracker(): UsageTracker {
  if (!globalTracker) {
    globalTracker = new UsageTracker();
  }
  return globalTracker;
}

export function resetUsageTracker(): void {
  globalTracker = null;
}
