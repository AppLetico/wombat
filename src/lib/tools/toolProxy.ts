/**
 * Tool Proxy System
 *
 * Wombat defines tool schemas for the LLM but proxies execution to the backend.
 * This maintains Wombat's stateless architecture while enabling structured tool calling.
 *
 * Flow:
 * 1. LLM requests a tool call
 * 2. Wombat validates against skill manifest (fast, local check)
 * 3. Wombat validates tool arguments (path safety, injection prevention)
 * 4. Wombat proxies the call to backend
 * 5. Backend validates tenant permissions and executes
 * 6. Wombat receives result and feeds back to LLM
 * 
 * Security enhancements inspired by OpenClaw 2026.2.1:
 * - Path traversal prevention (defense in depth)
 * - Request timeouts to prevent hangs
 * - UTC timestamps on timeout events
 * 
 * @see OpenClaw PR: "security(message-tool): validate filePath/path against sandbox root"
 * @see OpenClaw PR: "fix(security): restrict local path extraction in media parser to prevent LFI"
 */

import { z } from 'zod';
import { isPathSafe, sanitizePath, nowUTC, detectInjectionPatterns } from '../security/index.js';

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

/** Path-like argument names that should be validated */
const PATH_ARGUMENT_NAMES = ['path', 'filePath', 'file_path', 'filepath', 'directory', 'dir', 'folder'];

/** Known safe sandbox roots for path validation */
const SANDBOX_ROOTS = ['/tmp', '/var/tmp', process.cwd()];

export class ToolProxy {
  private backendUrl: string;
  private timeout: number;
  private enablePathValidation: boolean;
  private sandboxRoots: string[];

  constructor(options: { 
    backendUrl: string; 
    timeout?: number;
    /** Enable path validation for defense in depth (default: true) */
    enablePathValidation?: boolean;
    /** Allowed sandbox roots for path validation */
    sandboxRoots?: string[];
  }) {
    this.backendUrl = options.backendUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout || 30000; // 30 second default
    this.enablePathValidation = options.enablePathValidation ?? true;
    this.sandboxRoots = options.sandboxRoots || SANDBOX_ROOTS;
  }

  /**
   * Validate tool arguments for security issues.
   * This is defense-in-depth - the backend also validates, but we catch obvious issues early.
   * 
   * @see OpenClaw PR: "security(message-tool): validate filePath/path against sandbox root"
   */
  private validateArguments(
    toolName: string, 
    args: Record<string, unknown>
  ): { valid: boolean; error?: string; warnings: string[] } {
    const warnings: string[] = [];

    // Check for path-like arguments
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string') continue;

      // Check if this looks like a path argument
      const isPathArg = PATH_ARGUMENT_NAMES.some(name => 
        key.toLowerCase().includes(name.toLowerCase())
      );

      if (isPathArg && this.enablePathValidation) {
        // Check for path traversal
        const sanitized = sanitizePath(value);
        if (sanitized === null) {
          return {
            valid: false,
            error: `Invalid path in argument '${key}': path contains dangerous components`,
            warnings
          };
        }

        // Check if path is within sandbox (if it's absolute)
        if (value.startsWith('/') || value.match(/^[A-Z]:\\/i)) {
          const isSafe = this.sandboxRoots.some(root => isPathSafe(value, root));
          if (!isSafe) {
            warnings.push(`Path argument '${key}' may be outside sandbox`);
          }
        }
      }

      // Check for potential prompt injection in string arguments
      const injectionPatterns = detectInjectionPatterns(value);
      if (injectionPatterns.length > 0) {
        warnings.push(`Potential injection patterns in '${key}': ${injectionPatterns.join(', ')}`);
      }
    }

    return { valid: true, warnings };
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
   * Proxy a tool call to the backend.
   * 
   * Security features:
   * - Validates arguments for path traversal and injection patterns
   * - Request timeout to prevent indefinite hangs
   * - UTC timestamps on timeout errors for debugging
   */
  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const start = Date.now();

    // Validate arguments before sending to backend (defense in depth)
    const validation = this.validateArguments(call.name, call.arguments);
    if (!validation.valid) {
      return {
        toolCallId: call.id,
        success: false,
        error: `Security validation failed: ${validation.error}`,
        durationMs: Date.now() - start,
      };
    }

    // Log warnings but don't block (backend is the authoritative validator)
    if (validation.warnings.length > 0 && process.env.CLASPER_TEST_MODE !== 'true') {
      console.warn(`Tool '${call.name}' security warnings:`, validation.warnings);
    }

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
          error: `Tool call timed out after ${this.timeout}ms ${nowUTC()}`,
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
        if (process.env.CLASPER_TEST_MODE !== 'true') {
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
