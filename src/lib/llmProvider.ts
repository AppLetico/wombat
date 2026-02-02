/**
 * Multi-provider LLM abstraction using pi-ai.
 * Provides a unified interface for OpenAI, Anthropic, Google, and other providers.
 */

import {
  getModel,
  complete,
  stream
} from "@mariozechner/pi-ai";
import { config } from "./config.js";

/**
 * Supported LLM providers.
 */
export type Provider = "openai" | "anthropic" | "google" | "xai" | "groq" | "mistral" | "openrouter";

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
 * Result from LLM completion.
 */
export interface CompletionResult {
  response: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  model: string;
  provider: string;
}

/**
 * Streaming event types.
 */
export type StreamEventType = "start" | "chunk" | "done" | "error";

/**
 * Streaming event payload.
 */
export interface WombatStreamEvent {
  type: StreamEventType;
  data?: string;
  usage?: TokenUsage;
  cost?: CostBreakdown;
  error?: string;
}

/**
 * Parse a model string in "provider/model" format.
 * If no provider is specified, uses the default provider.
 */
export function parseModelString(modelString: string): { provider: Provider; modelId: string } {
  const parts = modelString.split("/");
  if (parts.length === 2) {
    return {
      provider: parts[0] as Provider,
      modelId: parts[1]
    };
  }
  // No provider specified, use default
  return {
    provider: config.llmProvider as Provider,
    modelId: modelString
  };
}

/**
 * Get the API key for a provider from config.
 */
function getApiKey(provider: Provider): string {
  const keys: Record<Provider, string> = {
    openai: config.openaiApiKey,
    anthropic: config.anthropicApiKey,
    google: config.googleApiKey,
    xai: config.xaiApiKey,
    groq: config.groqApiKey,
    mistral: config.mistralApiKey,
    openrouter: config.openrouterApiKey
  };
  return keys[provider] || "";
}

/**
 * Validate that the required API key is available for a provider.
 */
function validateApiKey(provider: Provider): void {
  const key = getApiKey(provider);
  if (!key) {
    const envVars: Record<Provider, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GEMINI_API_KEY",
      xai: "XAI_API_KEY",
      groq: "GROQ_API_KEY",
      mistral: "MISTRAL_API_KEY",
      openrouter: "OPENROUTER_API_KEY"
    };
    throw new Error(`API key not configured for provider "${provider}". Set ${envVars[provider]} environment variable.`);
  }
}

/**
 * Get a pi-ai model instance.
 * Uses 'any' to work around pi-ai's strict model ID typing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPiAiModel(provider: Provider, modelId: string): any {
  validateApiKey(provider);
  // pi-ai's getModel requires exact model ID types, so we cast
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getModel(provider as any, modelId as any);
}

/**
 * Convert pi-ai usage to our TokenUsage format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertUsage(piUsage: any): TokenUsage {
  return {
    prompt_tokens: piUsage?.input ?? 0,
    completion_tokens: piUsage?.output ?? 0,
    total_tokens: (piUsage?.input ?? 0) + (piUsage?.output ?? 0)
  };
}

/**
 * Convert pi-ai cost to our CostBreakdown format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertCost(piUsage: any, modelId: string): CostBreakdown {
  const cost = piUsage?.cost ?? { input: 0, output: 0, total: 0 };
  return {
    model: modelId,
    inputTokens: piUsage?.input ?? 0,
    outputTokens: piUsage?.output ?? 0,
    inputCost: roundToMicro(cost.input ?? 0),
    outputCost: roundToMicro(cost.output ?? 0),
    totalCost: roundToMicro(cost.total ?? 0),
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
 * Build pi-ai context messages from our conversation history.
 * Returns a properly typed messages array for pi-ai.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPiAiMessages(messages: ConversationMessage[]): any[] {
  return messages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => {
      if (msg.role === "user") {
        return {
          role: "user" as const,
          content: msg.content,
          timestamp: Date.now()
        };
      }
      // For assistant messages, pi-ai expects content blocks
      return {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: msg.content }],
        usage: { input: 0, output: 0, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "stop" as const,
        timestamp: Date.now()
      };
    });
}

/**
 * Extract text content from pi-ai AssistantMessage.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextContent(message: any): string {
  if (!message?.content) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textBlocks = message.content.filter((block: any) => block.type === "text");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return textBlocks.map((block: any) => block.text || "").join("");
}

/**
 * Check if an error is retryable (transient).
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Rate limits
    if (message.includes("rate limit") || message.includes("429")) return true;
    // Server errors
    if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504"))
      return true;
    // Network errors
    if (message.includes("timeout")) return true;
    if (message.includes("econnreset")) return true;
    if (message.includes("econnrefused")) return true;
    if (message.includes("network")) return true;
  }
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = config.retryDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.retryMaxDelayMs);
  const jitterRange = cappedDelay * config.retryJitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, cappedDelay + jitter);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Complete a chat with retry and model failover.
 */
export async function llmComplete(params: {
  systemPrompt: string;
  messages: ConversationMessage[];
  userMessage: string;
  model?: string;
  fallbackModel?: string;
  temperature?: number;
}): Promise<CompletionResult> {
  const {
    systemPrompt,
    messages,
    userMessage,
    model = config.llmModelDefault,
    fallbackModel = config.llmModelFallback,
    temperature = 0.4
  } = params;

  const { provider, modelId } = parseModelString(model);

  // Build pi-ai context
  const piMessages = buildPiAiMessages(messages);
  // Add current user message
  piMessages.push({
    role: "user" as const,
    content: userMessage,
    timestamp: Date.now()
  });

  const context = {
    systemPrompt,
    messages: piMessages
  };

  let lastError: unknown = null;
  let currentProvider = provider;
  let currentModelId = modelId;

  // Try with retries
  for (let attempt = 0; attempt < config.retryAttempts; attempt++) {
    try {
      const piModel = getPiAiModel(currentProvider, currentModelId);
      const apiKey = getApiKey(currentProvider);

      const response = await complete(piModel, context, {
        apiKey,
        temperature
      });

      const responseText = extractTextContent(response);
      const usage = convertUsage(response.usage);
      const cost = convertCost(response.usage, currentModelId);

      return {
        response: responseText,
        usage,
        cost,
        model: currentModelId,
        provider: currentProvider
      };
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < config.retryAttempts - 1) {
        const delay = calculateRetryDelay(attempt);
        await sleep(delay);
      }
    }
  }

  // If primary model exhausted retries and we have a fallback, try it
  if (fallbackModel && fallbackModel !== model) {
    const fallback = parseModelString(fallbackModel);
    currentProvider = fallback.provider;
    currentModelId = fallback.modelId;

    for (let attempt = 0; attempt < config.retryAttempts; attempt++) {
      try {
        const piModel = getPiAiModel(currentProvider, currentModelId);
        const apiKey = getApiKey(currentProvider);

        const response = await complete(piModel, context, {
          apiKey,
          temperature
        });

        const responseText = extractTextContent(response);
        const usage = convertUsage(response.usage);
        const cost = convertCost(response.usage, currentModelId);

        return {
          response: responseText,
          usage,
          cost,
          model: currentModelId,
          provider: currentProvider
        };
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error)) {
          throw error;
        }

        if (attempt < config.retryAttempts - 1) {
          const delay = calculateRetryDelay(attempt);
          await sleep(delay);
        }
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Stream a chat completion.
 * Returns an async generator of streaming events.
 */
export async function* llmStream(params: {
  systemPrompt: string;
  messages: ConversationMessage[];
  userMessage: string;
  model?: string;
  temperature?: number;
}): AsyncGenerator<WombatStreamEvent> {
  const {
    systemPrompt,
    messages,
    userMessage,
    model = config.llmModelDefault,
    temperature = 0.4
  } = params;

  const { provider, modelId } = parseModelString(model);

  // Build pi-ai context
  const piMessages = buildPiAiMessages(messages);
  piMessages.push({
    role: "user" as const,
    content: userMessage,
    timestamp: Date.now()
  });

  const context = {
    systemPrompt,
    messages: piMessages
  };

  try {
    const piModel = getPiAiModel(provider, modelId);
    const apiKey = getApiKey(provider);

    const streamResult = stream(piModel, context, {
      apiKey,
      temperature
    });

    yield { type: "start" };

    for await (const event of streamResult) {
      switch (event.type) {
        case "text_delta":
          yield { type: "chunk", data: event.delta };
          break;
        case "done":
          // eslint-disable-next-line no-case-declarations
          const response = await streamResult.result();
          // eslint-disable-next-line no-case-declarations
          const usage = convertUsage(response.usage);
          // eslint-disable-next-line no-case-declarations
          const cost = convertCost(response.usage, modelId);
          yield { type: "done", usage, cost };
          break;
        case "error":
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          yield { type: "error", error: (event as any).error?.errorMessage || "Stream error" };
          break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Streaming failed";
    yield { type: "error", error: message };
  }
}

/**
 * Run a structured LLM task that returns JSON.
 */
export async function llmTask(params: {
  prompt: string;
  input?: unknown;
  schema?: Record<string, unknown>;
  model?: string;
  temperature?: number;
}): Promise<{
  output: unknown;
  usage: TokenUsage;
  cost: CostBreakdown;
  validated: boolean;
}> {
  const {
    prompt,
    input,
    schema,
    model = config.llmModelDefault,
    temperature = 0.3
  } = params;

  const { provider, modelId } = parseModelString(model);

  // Build the user prompt with optional input
  let userPrompt = prompt;
  if (input !== undefined) {
    userPrompt += `\n\nInput:\n${JSON.stringify(input, null, 2)}`;
  }

  // Build system prompt for JSON-only output
  let jsonSystemPrompt =
    "You are a structured data processor. Output ONLY valid JSON. No code fences, no commentary, no explanation. Just the JSON object.";

  if (schema) {
    jsonSystemPrompt += `\n\nThe output must conform to this JSON Schema:\n${JSON.stringify(schema, null, 2)}`;
  }

  const context = {
    systemPrompt: jsonSystemPrompt,
    messages: [{ role: "user" as const, content: userPrompt, timestamp: Date.now() }]
  };

  const piModel = getPiAiModel(provider, modelId);
  const apiKey = getApiKey(provider);

  const response = await complete(piModel, context, {
    apiKey,
    temperature
  });

  const content = extractTextContent(response).trim();

  // Parse JSON
  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    throw new Error(`LLM task failed: invalid JSON returned: ${content.slice(0, 100)}...`);
  }

  // Validate against schema if provided
  let validated = false;
  if (schema) {
    validated = validateJsonSchema(output, schema);
  }

  const usage = convertUsage(response.usage);
  const cost = convertCost(response.usage, modelId);

  return { output, usage, cost, validated };
}

/**
 * Compact conversation history by summarizing older messages.
 */
export async function llmCompact(params: {
  messages: ConversationMessage[];
  instructions?: string;
  keepRecent?: number;
}): Promise<{
  compactedMessages: ConversationMessage[];
  usage: TokenUsage;
}> {
  const { messages, instructions, keepRecent = 2 } = params;

  if (messages.length <= keepRecent) {
    return {
      compactedMessages: messages,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  // Split messages
  const toSummarize = messages.slice(0, -keepRecent);
  const toKeep = messages.slice(-keepRecent);

  // Build compaction prompt
  const historyText = toSummarize.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  const compactionPrompt = instructions
    ? `Summarize the following conversation history. ${instructions}\n\n---\n\n${historyText}`
    : `Summarize the following conversation history concisely, preserving key facts, decisions, and context needed for continuation:\n\n---\n\n${historyText}`;

  // Use cheap model for compaction
  const model = config.llmModelCheap || config.llmModelDefault;
  const { provider, modelId } = parseModelString(model);

  const context = {
    systemPrompt:
      "You are a conversation summarizer. Create a concise summary that preserves essential context, decisions, and facts. Output only the summary, no preamble.",
    messages: [{ role: "user" as const, content: compactionPrompt, timestamp: Date.now() }]
  };

  const piModel = getPiAiModel(provider, modelId);
  const apiKey = getApiKey(provider);

  const response = await complete(piModel, context, {
    apiKey,
    temperature: 0.3
  });

  const summary = extractTextContent(response).trim();
  if (!summary) {
    throw new Error("Compaction failed: no summary returned");
  }

  const compactedMessages: ConversationMessage[] = [
    {
      role: "system",
      content: `[Previous conversation summary]\n${summary}`
    },
    ...toKeep
  ];

  const usage = convertUsage(response.usage);

  return { compactedMessages, usage };
}

/**
 * Basic JSON Schema validation (type checking only).
 */
function validateJsonSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (schema.type === "object" && typeof value !== "object") return false;
  if (schema.type === "array" && !Array.isArray(value)) return false;
  if (schema.type === "string" && typeof value !== "string") return false;
  if (schema.type === "number" && typeof value !== "number") return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;

  if (schema.required && Array.isArray(schema.required) && typeof value === "object" && value !== null) {
    for (const prop of schema.required) {
      if (!(prop in value)) return false;
    }
  }

  return true;
}

/**
 * Get available providers with configured API keys.
 */
export function getConfiguredProviders(): Provider[] {
  const providers: Provider[] = [];
  if (config.openaiApiKey) providers.push("openai");
  if (config.anthropicApiKey) providers.push("anthropic");
  if (config.googleApiKey) providers.push("google");
  if (config.xaiApiKey) providers.push("xai");
  if (config.groqApiKey) providers.push("groq");
  if (config.mistralApiKey) providers.push("mistral");
  if (config.openrouterApiKey) providers.push("openrouter");
  return providers;
}
