/**
 * Streaming support for agent responses.
 * Provides Server-Sent Events (SSE) streaming for real-time output.
 */

import { config } from "./config.js";
import { type TokenUsage, type ConversationMessage } from "./openaiClient.js";
import { getWorkspaceLoader, type PromptMode } from "./workspace.js";
import { getUsageTracker, type CostBreakdown } from "./costs.js";
import { llmStream, type WombatStreamEvent } from "./llmProvider.js";
import type { FastifyReply } from "fastify";

/**
 * Streaming event types.
 */
export type StreamEventType = "start" | "chunk" | "done" | "error";

/**
 * Streaming event payload.
 */
export interface StreamEvent {
  type: StreamEventType;
  data?: string;
  usage?: TokenUsage;
  cost?: CostBreakdown;
  error?: string;
}

/**
 * Format a streaming event for SSE.
 */
export function formatSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Generate a streaming agent reply.
 * Streams chunks via SSE to the reply object.
 */
export async function streamAgentReply(
  reply: FastifyReply,
  params: {
    role: string;
    userMessage: string;
    messages?: ConversationMessage[];
    metadata?: Record<string, unknown> | null;
    promptMode?: PromptMode;
    timezone?: string;
  }
): Promise<void> {
  const { role, userMessage, messages = [], metadata, promptMode = "full", timezone } = params;

  // Set SSE headers
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  try {
    // Build system prompt
    const workspace = getWorkspaceLoader();
    let systemPrompt: string;

    if (metadata?.system_prompt) {
      systemPrompt = metadata.system_prompt as string;
    } else {
      systemPrompt = workspace.buildSystemPrompt(role, promptMode);

      const memoryContext = workspace.loadMemoryContext();
      if (memoryContext) {
        systemPrompt += "\n\n" + memoryContext;
      }
    }

    // Add time context if enabled
    if (config.includeTimeContext) {
      const timeContext = workspace.buildTimeContext(
        timezone || (metadata?.timezone as string | undefined)
      );
      systemPrompt += "\n\n" + timeContext;
    }

    // Build user prompt
    const kickoffNote =
      (metadata?.kickoff_note as string | undefined) ||
      "Draft a concise plan based on the user's request.";

    const prompt = metadata?.kickoff_plan
      ? `${kickoffNote}\n\nUser request: ${userMessage}`
      : userMessage;

    // Use multi-provider streaming
    const streamGenerator = llmStream({
      systemPrompt,
      messages,
      userMessage: prompt,
      model: config.llmModelDefault,
      temperature: 0.4
    });

    // Process streaming events
    for await (const event of streamGenerator) {
      switch (event.type) {
        case "start":
          reply.raw.write(formatSSE({ type: "start" }));
          break;
        case "chunk":
          reply.raw.write(formatSSE({ type: "chunk", data: event.data }));
          break;
        case "done":
          if (event.usage) {
            getUsageTracker().track(event.usage, config.llmModelDefault);
          }
          reply.raw.write(formatSSE({ type: "done", usage: event.usage, cost: event.cost }));
          break;
        case "error":
          reply.raw.write(formatSSE({ type: "error", error: event.error }));
          break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Streaming failed";
    reply.raw.write(formatSSE({ type: "error", error: message }));
  }

  reply.raw.end();
}
