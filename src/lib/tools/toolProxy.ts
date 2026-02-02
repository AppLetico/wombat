/**
 * Tool Proxy System
 *
 * Wombat defines tool schemas for the LLM but proxies execution to the backend.
 * This maintains Wombat's stateless architecture while enabling structured tool calling.
 *
 * Flow:
 * 1. LLM requests a tool call
 * 2. Wombat validates against skill manifest (fast, local check)
 * 3. Wombat proxies the call to backend
 * 4. Backend validates tenant permissions and executes
 * 5. Wombat receives result and feeds back to LLM
 */

import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * JSON Schema for tool parameters
 */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: string[];
}

/**
 * Tool definition (schema only - no handler, backend executes)
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Context for tool execution
 */
export interface ToolContext {
  tenantId: string;
  workspaceId: string;
  traceId: string;
  agentToken: string; // JWT for backend auth
  userId?: string;
}

/**
 * Tool call request from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of tool execution
 */
export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * OpenAI-format tool for LLM
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

/**
 * Backend tool discovery response
 */
export interface ToolDiscoveryResponse {
  tools: ToolDefinition[];
}

// ============================================================================
// Zod Schemas for validation
// ============================================================================

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(z.unknown()),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  arguments: z.record(z.unknown()),
});

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
});

// ============================================================================
// Tool Proxy Class
// ============================================================================

export class ToolProxy {
  private backendUrl: string;
  private timeout: number;

  constructor(options: { backendUrl: string; timeout?: number }) {
    this.backendUrl = options.backendUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout || 30000; // 30 second default
  }

  /**
   * Discover available tools from the backend for a tenant
   */
  async discoverTools(
    tenantId: string,
    agentToken: string
  ): Promise<ToolDefinition[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.backendUrl}/api/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': agentToken,
          'X-Tenant-ID': tenantId,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(
          `Tool discovery failed: ${response.status} ${response.statusText}`
        );
        return [];
      }

      const data = (await response.json()) as ToolDiscoveryResponse;
      return data.tools || [];
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Tool discovery timed out');
      } else {
        console.error('Tool discovery error:', error);
      }
      return [];
    }
  }

  /**
   * Convert tool definitions to OpenAI format for LLM
   */
  getOpenAIFormat(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Proxy a tool call to the backend
   */
  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
        `${this.backendUrl}/api/tools/${encodeURIComponent(call.name)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Token': context.agentToken,
            'X-Trace-ID': context.traceId,
            'X-Tenant-ID': context.tenantId,
            'X-Workspace-ID': context.workspaceId,
          },
          body: JSON.stringify({
            arguments: call.arguments,
            tenant_id: context.tenantId,
            workspace_id: context.workspaceId,
            trace_id: context.traceId,
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);
      const durationMs = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          toolCallId: call.id,
          success: false,
          error: `Backend error (${response.status}): ${errorText}`,
          durationMs,
        };
      }

      const result = await response.json();

      return {
        toolCallId: call.id,
        success: true,
        result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - start;

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          toolCallId: call.id,
          success: false,
          error: `Tool call timed out after ${this.timeout}ms`,
          durationMs,
        };
      }

      return {
        toolCallId: call.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeMany(
    calls: ToolCall[],
    context: ToolContext
  ): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.execute(call, context)));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let toolProxyInstance: ToolProxy | null = null;

/**
 * Get or create a ToolProxy instance
 */
export function getToolProxy(backendUrl?: string): ToolProxy {
  if (!toolProxyInstance) {
    const url = backendUrl || process.env.BACKEND_URL;
    if (!url) {
      throw new Error('BACKEND_URL is required for tool proxy');
    }
    toolProxyInstance = new ToolProxy({ backendUrl: url });
  }
  return toolProxyInstance;
}

/**
 * Reset the tool proxy instance (for testing)
 */
export function resetToolProxy(): void {
  toolProxyInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse tool calls from an LLM response
 * Handles both OpenAI and Anthropic formats
 */
export function parseToolCalls(
  response: unknown
): ToolCall[] {
  const calls: ToolCall[] = [];

  if (!response || typeof response !== 'object') {
    return calls;
  }

  // OpenAI format: response.tool_calls
  const openaiResponse = response as {
    tool_calls?: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
  };

  if (Array.isArray(openaiResponse.tool_calls)) {
    for (const tc of openaiResponse.tool_calls) {
      try {
        calls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      } catch {
        // Invalid JSON in arguments, skip
        if (process.env.WOMBAT_TEST_MODE !== 'true') {
          console.error(`Failed to parse tool call arguments for ${tc.function.name}`);
        }
      }
    }
  }

  // Anthropic format: response.content with tool_use blocks
  const anthropicResponse = response as {
    content?: Array<{
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };

  if (Array.isArray(anthropicResponse.content)) {
    for (const block of anthropicResponse.content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        calls.push({
          id: block.id,
          name: block.name,
          arguments: block.input || {},
        });
      }
    }
  }

  return calls;
}

/**
 * Format tool results for sending back to the LLM
 * Returns format compatible with OpenAI's tool message format
 */
export function formatToolResultsForLLM(
  results: ToolResult[]
): Array<{ role: 'tool'; tool_call_id: string; content: string }> {
  return results.map((result) => ({
    role: 'tool' as const,
    tool_call_id: result.toolCallId,
    content: result.success
      ? JSON.stringify(result.result)
      : JSON.stringify({ error: result.error }),
  }));
}
