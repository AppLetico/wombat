import Fastify from "fastify";
import { z } from "zod";
import { config, requireEnv } from "../lib/config.js";
import { parseSessionKey, buildAgentToken } from "../lib/agentAuth.js";
import { generateAgentReply, compactHistory, runLLMTask, type AgentReplyResult } from "../lib/openaiClient.js";
import { listTasks, createTask, postMessage, postDocument } from "../lib/missionControl.js";
import { getWorkspaceLoader } from "../lib/workspace.js";
import { getUsageTracker } from "../lib/costs.js";
import { getSkillsLoader } from "../lib/skills.js";
import { streamAgentReply } from "../lib/streaming.js";
import { fireWebhook, buildCompletionPayload, type WebhookConfig } from "../lib/webhooks.js";

/**
 * Message in conversation history.
 * Following OpenAI's message format for compatibility.
 */
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string()
});

/**
 * Webhook configuration schema.
 */
const WebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
  headers: z.record(z.string()).optional()
});

export function buildApp() {
  const app = Fastify({ logger: true });

  const SendSchema = z.object({
    user_id: z.string(),
    session_key: z.string(),
    message: z.string(),
    // Conversation history (OpenClaw-inspired context management)
    // Backend can inject prior messages for multi-turn conversations
    messages: z.array(MessageSchema).optional(),
    // Task handling options (all optional for flexibility):
    // - task_id: Use this specific task (backend-owned task creation)
    // - task_title: Find or create a task with this title
    // - task_description: Description for auto-created tasks
    // - task_metadata: Metadata for auto-created tasks
    task_id: z.string().optional(),
    task_title: z.string().optional(),
    task_description: z.string().optional(),
    task_metadata: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
    // Webhook callback (optional)
    webhook: WebhookSchema.optional(),
    // Streaming mode (optional)
    stream: z.boolean().optional()
  });

  /**
   * Compact history endpoint.
   * Summarizes conversation history to reduce token usage.
   * Following OpenClaw's compaction pattern.
   */
  const CompactSchema = z.object({
    messages: z.array(MessageSchema).min(1),
    instructions: z.string().optional(),
    keep_recent: z.number().int().min(0).default(2)
  });

  app.post("/compact", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = CompactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { messages, instructions, keep_recent } = parsed.data;

    try {
      const result = await compactHistory({
        messages,
        instructions,
        keepRecent: keep_recent
      });

      return reply.send({
        status: "ok",
        compacted_messages: result.compactedMessages,
        usage: result.usage,
        original_count: messages.length,
        compacted_count: result.compactedMessages.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compaction failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * LLM Task endpoint for structured JSON output.
   * Following OpenClaw's llm-task pattern for workflow engines.
   */
  const LLMTaskSchema = z.object({
    prompt: z.string(),
    input: z.any().optional(),
    schema: z.record(z.any()).optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional()
  });

  app.post("/llm-task", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = LLMTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    try {
      const result = await runLLMTask(parsed.data);
      return reply.send({
        status: "ok",
        output: result.output,
        usage: result.usage,
        cost: result.cost,
        validated: result.validated
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM task failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * Usage stats endpoint for cost tracking.
   * Following OpenClaw's usage tracking pattern.
   */
  app.get("/usage", async () => {
    const tracker = getUsageTracker();
    return tracker.getStats();
  });

  /**
   * Enhanced health check endpoint.
   * Following OpenClaw's health check pattern with component status.
   */
  app.get("/health", async (request) => {
    const workspace = getWorkspaceLoader();
    const workspaceAccessible = workspace.isAccessible();

    // Check backend connectivity (simple fetch to health endpoint)
    let backendStatus: "ok" | "error" | "unchecked" = "unchecked";
    let backendError: string | undefined;

    // Only check backend if query param ?deep=true is passed
    const query = request.query as Record<string, string>;
    if (query.deep === "true") {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${config.backendUrl}/health`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        backendStatus = response.ok ? "ok" : "error";
      } catch (err) {
        backendStatus = "error";
        backendError = err instanceof Error ? err.message : "Unknown error";
      }
    }

    const overallStatus = workspaceAccessible && backendStatus !== "error" ? "ok" : "degraded";

    // Get skills info
    const skillsLoader = getSkillsLoader();
    const skillsContext = skillsLoader.load();

    return {
      status: overallStatus,
      workspace: {
        path: workspace.getWorkspacePath(),
        status: workspaceAccessible ? "ok" : "missing",
        maxCharsPerFile: workspace.getMaxChars(),
        bootComplete: workspace.isBootComplete()
      },
      skills: {
        enabled: skillsContext.enabledCount,
        total: skillsContext.totalCount
      },
      backend: {
        url: config.backendUrl,
        status: backendStatus,
        ...(backendError && { error: backendError })
      },
      config: {
        port: config.port,
        defaultTask: config.defaultTaskTitle || "(not set)",
        model: config.openaiModelDefault,
        fallbackModel: config.openaiModelFallback || "(not set)"
      }
    };
  });

  /**
   * Context stats endpoint for prompt size visibility.
   * Following OpenClaw's /context pattern.
   */
  app.get("/context", async (request) => {
    const query = request.query as Record<string, string>;
    const role = query.role;
    const workspace = getWorkspaceLoader();
    return workspace.getContextStats(role);
  });

  /**
   * Skills endpoint for listing available skills.
   * Following OpenClaw's skills pattern.
   */
  app.get("/skills", async () => {
    const loader = getSkillsLoader();
    const context = loader.load();
    return {
      enabled: context.enabledCount,
      total: context.totalCount,
      skills: context.skills.map((s) => ({
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        gateReason: s.gateReason,
        location: s.location,
        metadata: s.metadata
      }))
    };
  });

  /**
   * Boot status endpoint.
   * Checks if BOOT.md has been run.
   */
  app.get("/boot", async () => {
    const workspace = getWorkspaceLoader();
    const bootContent = workspace.loadBoot();
    const isComplete = workspace.isBootComplete();

    return {
      hasBoot: bootContent !== null,
      isComplete,
      content: isComplete ? null : bootContent
    };
  });

  /**
   * Mark boot as complete.
   */
  app.post("/boot/complete", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const workspace = getWorkspaceLoader();
    workspace.markBootComplete();

    return { status: "ok" };
  });

  /**
   * Streaming endpoint for real-time responses.
   * Returns Server-Sent Events (SSE).
   */
  const StreamSchema = z.object({
    user_id: z.string(),
    session_key: z.string(),
    message: z.string(),
    messages: z.array(MessageSchema).optional(),
    metadata: z.record(z.any()).optional()
  });

  app.post("/api/agents/stream", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = StreamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const { role } = parseSessionKey(payload.session_key);

    await streamAgentReply(reply, {
      role,
      userMessage: payload.message,
      messages: payload.messages,
      metadata: payload.metadata
    });
  });

  app.post("/api/agents/send", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const { userId, role } = parseSessionKey(payload.session_key);
    if (userId !== payload.user_id) {
      return reply.status(400).send({ error: "user_id does not match session_key" });
    }

    requireEnv("AGENT_JWT_SECRET", config.agentJwtSecret);
    const agentToken = await buildAgentToken(payload.user_id, role);

    // Resolve task_id with flexible options:
    // 1. Use provided task_id directly (backend-owned)
    // 2. Find/create by task_title from request
    // 3. Find/create by WOMBAT_DEFAULT_TASK env var
    // 4. Error if none of the above
    let taskId: string | null = payload.task_id || null;

    if (!taskId) {
      // Determine task title: request > env > none
      const taskTitle = payload.task_title || config.defaultTaskTitle;

      if (!taskTitle) {
        return reply.status(400).send({
          error: "Task not specified. Provide task_id, task_title, or set WOMBAT_DEFAULT_TASK env var."
        });
      }

      // Look for existing task with this title
      const tasks = await listTasks(agentToken);
      const existing = tasks.find((task) => task.title === taskTitle);

      if (existing) {
        taskId = existing.id;
      } else {
        // Auto-create the task (any role can create now)
        const created = await createTask(agentToken, {
          title: taskTitle,
          description: payload.task_description || `Agent thread: ${taskTitle}`,
          status: "in_progress",
          metadata: payload.task_metadata || { type: "agent_thread" }
        });
        taskId = created.id;
      }
    }

    if (!taskId) {
      return reply.status(500).send({ error: "Failed to resolve task_id" });
    }

    // Handle streaming mode
    if (payload.stream) {
      await streamAgentReply(reply, {
        role,
        userMessage: payload.message,
        messages: payload.messages,
        metadata: payload.metadata
      });
      return;
    }

    // Generate agent reply with optional conversation history
    const result: AgentReplyResult = await generateAgentReply({
      role,
      userMessage: payload.message,
      messages: payload.messages,
      metadata: payload.metadata
    });

    await postMessage(agentToken, {
      task_id: taskId,
      content: result.response,
      actor_type: "agent",
      agent_role: role
    });

    if (payload.metadata?.kickoff_plan) {
      await postDocument(agentToken, {
        task_id: taskId,
        title: payload.metadata.plan_title || "Plan",
        content: result.response,
        doc_type: "plan"
      });
    }

    // Build response with token usage, cost, and context info
    const response: Record<string, unknown> = {
      status: "ok",
      task_id: taskId,
      response: result.response,
      usage: result.usage,
      cost: result.cost
    };

    // Add context warning if approaching limit
    if (result.contextWarning) {
      response.context_warning = result.contextWarning;
    }

    // Fire webhook if configured (async, doesn't block response)
    if (payload.webhook) {
      fireWebhook(
        payload.webhook as WebhookConfig,
        buildCompletionPayload({
          taskId,
          userId: payload.user_id,
          role,
          response: result.response,
          usage: result.usage,
          cost: result.cost,
          metadata: payload.metadata
        }),
        app.log
      );
    }

    return reply.send(response);
  });

  return app;
}

if (process.env.WOMBAT_TEST_MODE !== "true") {
  const app = buildApp();
  app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
