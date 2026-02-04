/**
 * Wombat Server Entry Point
 * 
 * Security enhancements inspired by OpenClaw 2026.2.1:
 * - TLS 1.3 minimum for all HTTPS connections
 * - Request timeouts
 * - Path traversal prevention
 * - Prompt injection sanitization
 * 
 * @see https://github.com/openclaw/openclaw/pulls (2026.2.1 security PRs)
 */

// Prefer TLS 1.3 minimum when writable. Node 22+ makes tls.DEFAULT_MIN_VERSION read-only.
import * as tls from "node:tls";
try {
  (tls as { DEFAULT_MIN_VERSION?: string }).DEFAULT_MIN_VERSION = "TLSv1.3";
} catch {
  // Ignore: read-only in Node 22+
}

import Fastify from "fastify";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
// Core
import { config, requireEnv } from "../lib/core/config.js";
import { initDatabase, getDatabaseStats } from "../lib/core/db.js";
// Auth
import { parseSessionKey, buildAgentToken } from "../lib/auth/agentAuth.js";
import {
  requireOpsContextFromHeaders,
  OpsAuthError,
  canAccessTenant,
  canAccessWorkspace,
  requireRole,
  requirePermission,
  getContextPermissions,
  PermissionError
} from "../lib/auth/opsAuth.js";
// Providers
import { generateAgentReply, compactHistory, runLLMTask, type AgentReplyResult } from "../lib/providers/openaiClient.js";
import { streamAgentReply } from "../lib/providers/streaming.js";
// Integrations
import { listTasks, createTask, postMessage, postDocument } from "../lib/integrations/missionControl.js";
import { fireWebhook, buildCompletionPayload, type WebhookConfig } from "../lib/integrations/webhooks.js";
import { getUsageTracker } from "../lib/integrations/costs.js";
import { validateControlPlaneVersion, CLASPER_CONTRACT_VERSION } from "../lib/integrations/controlPlaneVersion.js";
// Workspace
import { getWorkspaceLoader } from "../lib/workspace/workspace.js";
import { getWorkspacePins } from "../lib/workspace/workspacePins.js";
import { getWorkspaceEnvironments } from "../lib/workspace/workspaceEnvironments.js";
import { analyzeImpact, analyzeImpactFromCurrent } from "../lib/workspace/impactAnalysis.js";
import { getWorkspaceVersioning } from "../lib/workspace/workspaceVersioning.js";
// Skills
import { getSkillsLoader } from "../lib/skills/skills.js";
import { getSkillRegistry } from "../lib/skills/skillRegistry.js";
import { SkillManifestSchema } from "../lib/skills/skillManifest.js";
import { getSkillTester } from "../lib/skills/skillTester.js";
// Tracing
import { getTraceStore } from "../lib/tracing/traceStore.js";
import { diffTraces, formatDiffSummary } from "../lib/tracing/traceDiff.js";
import { getTraceAnnotations } from "../lib/tracing/traceAnnotations.js";
import { getRetentionPolicies } from "../lib/tracing/retentionPolicies.js";
import { buildTraceDetailView, buildTraceSummaryView } from "../lib/ops/traceViews.js";
import { runPromotionChecks } from "../lib/ops/promotionChecks.js";
import { getSkillEnvironmentUsage, getSkillUsageStats, getPermissionDiff } from "../lib/ops/skillOps.js";
import { getCostDashboard, getRiskDashboard } from "../lib/ops/dashboards.js";
// Governance
import { getAuditLog, logOverrideUsed } from "../lib/governance/auditLog.js";
import { OVERRIDE_REASON_CODES, OverrideSchema, type OverrideRequest } from "../lib/ops/overrides.js";
import { getBudgetManager } from "../lib/governance/budgetManager.js";
import { calculateRiskScore, type RiskScoringInput } from "../lib/governance/riskScoring.js";
// Evals
import { getEvalRunner, type EvalDataset, type EvalOptions } from "../lib/evals/evals.js";

// Extend Fastify types for trace ID
declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
  }
}

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
  const opsUiRoot = join(process.cwd(), "src", "ops-ui");

  // Initialize database
  try {
    initDatabase();
    app.log.info("Database initialized");
  } catch (err) {
    app.log.error({ err }, "Failed to initialize database");
  }

  // ============================================================================
  // Trace ID Hook - Every request gets a trace ID for correlation
  // ============================================================================
  app.addHook('onRequest', async (request, reply) => {
    // Use existing trace ID from header or generate a new one
    const existingTraceId = request.headers['x-trace-id'];
    request.traceId = typeof existingTraceId === 'string' ? existingTraceId : uuidv7();
    
    // Add trace ID to response headers
    reply.header('x-trace-id', request.traceId);
  });

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
   * Ops Console identity endpoint.
   * GET /ops/api/me
   *
   * Returns user identity, effective permissions, and access scope.
   * UI uses this to deterministically enable/disable actions.
   */
  app.get("/ops/api/me", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const permissions = getContextPermissions(context);

      return reply.send({
        user: {
          id: context.userId,
          role: context.role,
          roles: context.roles,
          tenant_id: context.tenantId,
          workspace_id: context.workspaceId,
          allowed_tenants: context.allowedTenants
        },
        permissions,
        scope: {
          tenants: context.allowedTenants.length > 0
            ? context.allowedTenants
            : [context.tenantId],
          workspaces: context.workspaceId ? [context.workspaceId] : []
        }
      });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Ops auth failed" });
    }
  });

  app.get("/ops", async (_request, reply) => {
    try {
      const html = readFileSync(join(opsUiRoot, "index.html"), "utf-8");
      return reply.type("text/html").send(html);
    } catch (error) {
      return reply.status(500).send({ error: "Ops UI not available" });
    }
  });

  app.get("/ops/app.js", async (_request, reply) => {
    try {
      const js = readFileSync(join(opsUiRoot, "app.js"), "utf-8");
      return reply.type("application/javascript").send(js);
    } catch (error) {
      return reply.status(500).send({ error: "Ops UI script not available" });
    }
  });

  app.get("/ops/styles.css", async (_request, reply) => {
    try {
      const css = readFileSync(join(opsUiRoot, "styles.css"), "utf-8");
      return reply.type("text/css").send(css);
    } catch (error) {
      return reply.status(500).send({ error: "Ops UI styles not available" });
    }
  });

  const OpsTraceListQuerySchema = z.object({
    tenant_id: z.string().optional(),
    workspace_id: z.string().optional(),
    agent_role: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    label_key: z.string().optional(),
    label_value: z.string().optional(),
    status: z.enum(["success", "error"]).optional(),
    min_cost: z.coerce.number().optional(),
    max_cost: z.coerce.number().optional(),
    risk_level: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/ops/api/traces", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const parsed = OpsTraceListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }

      const query = parsed.data;
      const tenantId = query.tenant_id || context.tenantId;

      if (!canAccessTenant(context, tenantId)) {
        return reply.status(403).send({ error: "Tenant access denied" });
      }
      if (!canAccessWorkspace(context, query.workspace_id)) {
        return reply.status(403).send({ error: "Workspace access denied" });
      }

      const traceStore = getTraceStore();
      const result = traceStore.list({
        tenantId,
        workspaceId: query.workspace_id,
        agentRole: query.agent_role,
        startDate: query.start_date,
        endDate: query.end_date,
        limit: query.limit,
        offset: query.offset
      });

      const annotationsStore = getTraceAnnotations();
      let summaries = result.traces.map((trace) =>
        buildTraceSummaryView({
          trace,
          annotations: annotationsStore.getForTrace(trace.id)
        })
      );

      if (query.label_key) {
        summaries = summaries.filter((trace) =>
          query.label_value
            ? trace.labels[query.label_key] === query.label_value
            : trace.labels[query.label_key] !== undefined
        );
      }
      if (query.status) {
        summaries = summaries.filter((trace) => trace.status === query.status);
      }
      if (query.min_cost !== undefined) {
        summaries = summaries.filter((trace) => trace.cost >= query.min_cost!);
      }
      if (query.max_cost !== undefined) {
        summaries = summaries.filter((trace) => trace.cost <= query.max_cost!);
      }
      if (query.risk_level) {
        summaries = summaries.filter((trace) => trace.risk.level === query.risk_level);
      }

      return reply.send({
        traces: summaries,
        total: result.total,
        filtered: summaries.length,
        has_more: result.hasMore,
        limit: query.limit,
        offset: query.offset
      });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to load traces" });
    }
  });

  app.get("/ops/api/traces/:id", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const { id } = request.params as { id: string };
      const query = request.query as { tenant_id?: string };
      const tenantId = query.tenant_id || context.tenantId;

      if (!canAccessTenant(context, tenantId)) {
        return reply.status(403).send({ error: "Tenant access denied" });
      }

      const traceStore = getTraceStore();
      const trace = traceStore.getForTenant(id, tenantId);
      if (!trace) {
        return reply.status(404).send({ error: "Trace not found" });
      }
      if (!canAccessWorkspace(context, trace.workspaceId)) {
        return reply.status(403).send({ error: "Workspace access denied" });
      }

      const annotationsStore = getTraceAnnotations();
      const detail = buildTraceDetailView({
        trace,
        annotations: annotationsStore.getForTrace(trace.id),
        role: context.role
      });

      return reply.send({ trace: detail });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to load trace" });
    }
  });

  const OpsTraceDiffSchema = z.object({
    base_trace_id: z.string(),
    compare_trace_id: z.string(),
    include_summary: z.boolean().optional().default(true)
  });

  app.post("/ops/api/traces/diff", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const parsed = OpsTraceDiffSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const traceStore = getTraceStore();
      const baseTrace = traceStore.get(parsed.data.base_trace_id);
      const compareTrace = traceStore.get(parsed.data.compare_trace_id);

      if (!baseTrace || !compareTrace) {
        return reply.status(404).send({ error: "Trace not found" });
      }

      if (!canAccessTenant(context, baseTrace.tenantId) || !canAccessTenant(context, compareTrace.tenantId)) {
        return reply.status(403).send({ error: "Tenant access denied" });
      }

      const diff = diffTraces(baseTrace, compareTrace);
      const response: Record<string, unknown> = { diff };
      if (parsed.data.include_summary) {
        response.summary_text = formatDiffSummary(diff);
      }

      return reply.send(response);
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to diff traces" });
    }
  });

  const OpsPromotionCheckSchema = z.object({
    source_env: z.string(),
    target_env: z.string()
  });

  app.post("/ops/api/workspaces/:workspaceId/promotions/check", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const parsed = OpsPromotionCheckSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { workspaceId } = request.params as { workspaceId: string };
      if (!canAccessTenant(context, workspaceId)) {
        return reply.status(403).send({ error: "Workspace access denied" });
      }

      const result = runPromotionChecks({
        workspaceId,
        sourceEnv: parsed.data.source_env,
        targetEnv: parsed.data.target_env
      });

      return reply.send({ checks: result });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to run promotion checks" });
    }
  });

  const OpsPromotionExecuteSchema = z.object({
    source_env: z.string(),
    target_env: z.string(),
    override: z.object({
      reason_code: z.enum(OVERRIDE_REASON_CODES),
      justification: z.string().min(10, "Justification must be at least 10 characters")
    }).optional(),
    annotation: z.object({
      key: z.string().min(1),
      value: z.string().min(1)
    })
  });

  app.post("/ops/api/workspaces/:workspaceId/promotions/execute", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      requirePermission(context, "workspace:promote");

      const parsed = OpsPromotionExecuteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { workspaceId } = request.params as { workspaceId: string };
      if (!canAccessTenant(context, workspaceId)) {
        return reply.status(403).send({ error: "Workspace access denied" });
      }

      const checks = runPromotionChecks({
        workspaceId,
        sourceEnv: parsed.data.source_env,
        targetEnv: parsed.data.target_env
      });

      const hasOverride = !!parsed.data.override;

      if (checks.blocked && !hasOverride) {
        return reply.status(409).send({
          error: "Promotion blocked. Use override with reason_code and justification to proceed.",
          checks,
          override_required: true
        });
      }

      // Log override usage if override is being used
      if (hasOverride && parsed.data.override) {
        logOverrideUsed(workspaceId, {
          workspaceId,
          actor: context.userId,
          role: context.role,
          action: "workspace:promote",
          targetId: workspaceId,
          reasonCode: parsed.data.override.reason_code,
          justification: parsed.data.override.justification
        });
      }

      const envs = getWorkspaceEnvironments();
      const result = envs.promote(workspaceId, parsed.data.source_env, parsed.data.target_env);

      if (!result.success) {
        return reply.status(400).send({ error: result.error || "Promotion failed" });
      }

      const auditLog = getAuditLog();
      auditLog.log("workspace_change", {
        tenantId: workspaceId,
        workspaceId,
        userId: context.userId,
        eventData: {
          action: "promote",
          source_env: parsed.data.source_env,
          target_env: parsed.data.target_env,
          version_hash: result.versionHash,
          override_used: hasOverride,
          override_reason: parsed.data.override?.reason_code,
          annotation: parsed.data.annotation,
          checks: checks.checks
        }
      });

      return reply.send({
        status: "ok",
        promotion: {
          source_env: result.sourceEnv,
          target_env: result.targetEnv,
          version_hash: result.versionHash,
          override_used: hasOverride
        }
      });
    } catch (error) {
      if (error instanceof PermissionError) {
        return reply.status(403).send({
          error: error.message,
          code: "permission_denied",
          permission: error.permission,
          required_roles: error.requiredRoles
        });
      }
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to execute promotion" });
    }
  });

  const OpsVersionListSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(20),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/ops/api/workspaces/:workspaceId/versions", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const { workspaceId } = request.params as { workspaceId: string };
      if (!canAccessTenant(context, workspaceId)) {
        return reply.status(403).send({ error: "Workspace access denied" });
      }

      const parsed = OpsVersionListSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }

      const workspace = getWorkspaceLoader();
      const versioning = getWorkspaceVersioning(workspace.getWorkspacePath());
      const result = versioning.listVersions(workspaceId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset
      });

      return reply.send({ versions: result.versions, total: result.total });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to list versions" });
    }
  });

  const OpsRollbackSchema = z.object({
    version_hash: z.string(),
    annotation: z.object({
      key: z.string().min(1),
      value: z.string().min(1)
    }),
    override: z.object({
      reason_code: z.enum(OVERRIDE_REASON_CODES),
      justification: z.string().min(10, "Justification must be at least 10 characters")
    }).optional()
  });

  app.post("/ops/api/workspaces/:workspaceId/rollback", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      requirePermission(context, "workspace:rollback");

      const { workspaceId } = request.params as { workspaceId: string };
      if (!canAccessTenant(context, workspaceId)) {
        return reply.status(403).send({ error: "Workspace access denied" });
      }

      const parsed = OpsRollbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const hasOverride = !!parsed.data.override;

      // Log override usage if override is being used
      if (hasOverride && parsed.data.override) {
        logOverrideUsed(workspaceId, {
          workspaceId,
          actor: context.userId,
          role: context.role,
          action: "workspace:rollback",
          targetId: workspaceId,
          reasonCode: parsed.data.override.reason_code,
          justification: parsed.data.override.justification
        });
      }

      const workspace = getWorkspaceLoader();
      const versioning = getWorkspaceVersioning(workspace.getWorkspacePath());
      versioning.rollback(parsed.data.version_hash);

      const auditLog = getAuditLog();
      auditLog.log("workspace_change", {
        tenantId: workspaceId,
        workspaceId,
        userId: context.userId,
        eventData: {
          action: "rollback",
          version_hash: parsed.data.version_hash,
          annotation: parsed.data.annotation,
          override_used: hasOverride,
          override_reason: parsed.data.override?.reason_code
        }
      });

      return reply.send({
        status: "ok",
        version_hash: parsed.data.version_hash,
        override_used: hasOverride
      });
    } catch (error) {
      if (error instanceof PermissionError) {
        return reply.status(403).send({
          error: error.message,
          code: "permission_denied",
          permission: error.permission,
          required_roles: error.requiredRoles
        });
      }
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to rollback workspace" });
    }
  });

  const OpsSkillListQuerySchema = z.object({
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/ops/api/skills/registry", async (request, reply) => {
    try {
      await requireOpsContextFromHeaders(request.headers);
      const parsed = OpsSkillListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }

      const registry = getSkillRegistry();
      const result = registry.search(parsed.data.q || "", {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        includeDeprecated: true
      });

      const usageStats = getSkillUsageStats();
      const envUsage = getSkillEnvironmentUsage();

      return reply.send({
        skills: result.skills.map((skill) => ({
          name: skill.name,
          version: skill.version,
          description: skill.description,
          state: skill.state,
          permissions: skill.manifest.permissions?.tools || [],
          last_used: usageStats[skill.name]?.last_used,
          usage_count: usageStats[skill.name]?.usage_count || 0,
          environments: envUsage[skill.name]?.environments || [],
          permission_diff: getPermissionDiff(skill.name, skill.version)
        })),
        total: result.total,
        has_more: result.hasMore
      });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to load skills" });
    }
  });

  const OpsSkillPromoteSchema = z.object({
    target_state: z.enum(["draft", "tested", "approved", "active", "deprecated"])
  });

  app.post("/ops/api/skills/:name/:version/promote", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      requirePermission(context, "skill:promote");

      const parsed = OpsSkillPromoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { name, version } = request.params as { name: string; version: string };
      const registry = getSkillRegistry();
      const skill = registry.getAnyState(name, version);
      if (!skill) {
        return reply.status(404).send({ error: "Skill not found" });
      }

      const result = registry.promote(name, version, parsed.data.target_state);
      if (!result.success) {
        return reply.status(400).send({ error: result.error || "Promotion failed" });
      }

      const auditLog = getAuditLog();
      auditLog.log("skill_state_changed", {
        tenantId: "system",
        userId: context.userId,
        eventData: {
          skill_name: name,
          skill_version: version,
          from_state: skill.state,
          to_state: parsed.data.target_state
        }
      });

      return reply.send({
        status: "ok",
        skill: {
          name: result.skill?.name,
          version: result.skill?.version,
          state: result.skill?.state,
          previous_state: skill.state,
          permission_diff: getPermissionDiff(name, version)
        }
      });
    } catch (error) {
      if (error instanceof PermissionError) {
        return reply.status(403).send({
          error: error.message,
          code: "permission_denied",
          permission: error.permission,
          required_roles: error.requiredRoles
        });
      }
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to promote skill" });
    }
  });

  app.get("/ops/api/dashboards/cost", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const query = request.query as { tenant_id?: string };
      const tenantId = query.tenant_id || context.tenantId;

      if (!canAccessTenant(context, tenantId)) {
        return reply.status(403).send({ error: "Tenant access denied" });
      }

      return reply.send({ dashboard: getCostDashboard(tenantId) });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to load cost dashboard" });
    }
  });

  app.get("/ops/api/dashboards/risk", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      const query = request.query as { tenant_id?: string };
      const tenantId = query.tenant_id || context.tenantId;

      if (!canAccessTenant(context, tenantId)) {
        return reply.status(403).send({ error: "Tenant access denied" });
      }

      return reply.send({ dashboard: getRiskDashboard(tenantId) });
    } catch (error) {
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to load risk dashboard" });
    }
  });

  /**
   * Ops Console audit log endpoint.
   * GET /ops/api/audit
   *
   * Requires: operator+ role (audit:view permission)
   * Query: tenant_id, workspace_id, event_type, start_date, end_date, limit, offset
   */
  const OpsAuditQuerySchema = z.object({
    tenant_id: z.string().optional(),
    workspace_id: z.string().optional(),
    event_type: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/ops/api/audit", async (request, reply) => {
    try {
      const context = await requireOpsContextFromHeaders(request.headers);
      requirePermission(context, "audit:view");

      const parsed = OpsAuditQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }

      const query = parsed.data;
      const tenantId = query.tenant_id || context.tenantId;

      if (!canAccessTenant(context, tenantId)) {
        return reply.status(403).send({ error: "Tenant access denied" });
      }

      const auditLog = getAuditLog();
      const result = auditLog.query({
        tenantId,
        workspaceId: query.workspace_id,
        eventType: query.event_type as any,
        startDate: query.start_date,
        endDate: query.end_date,
        limit: query.limit,
        offset: query.offset
      });

      return reply.send({
        entries: result.entries.map(entry => ({
          id: entry.id,
          event_type: entry.eventType,
          tenant_id: entry.tenantId,
          workspace_id: entry.workspaceId,
          trace_id: entry.traceId,
          event_data: entry.eventData,
          created_at: entry.createdAt
        })),
        total: result.total,
        has_more: result.hasMore,
        limit: query.limit,
        offset: query.offset
      });
    } catch (error) {
      if (error instanceof PermissionError) {
        return reply.status(403).send({
          error: error.message,
          code: "permission_denied",
          permission: error.permission,
          required_roles: error.requiredRoles
        });
      }
      if (error instanceof OpsAuthError) {
        const status =
          error.code === "missing_token" ? 401 :
          error.code === "config_error" ? 500 :
          403;
        return reply.status(status).send({ error: error.message, code: error.code });
      }
      return reply.status(500).send({ error: "Failed to load audit log" });
    }
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

    // Check database status
    let databaseStatus: "ok" | "error" = "ok";
    let databaseError: string | undefined;
    try {
      getDatabaseStats();
    } catch (err) {
      databaseStatus = "error";
      databaseError = err instanceof Error ? err.message : "Unknown error";
    }

    const overallStatus = workspaceAccessible && backendStatus !== "error" && databaseStatus === "ok" ? "ok" : "degraded";

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
      database: {
        status: databaseStatus,
        ...(databaseError && { error: databaseError })
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
   * Wombat version and contract information.
   * GET /api/version
   */
  app.get("/api/version", async () => {
    return {
      version: "1.2.1",
      contract_version: CLASPER_CONTRACT_VERSION,
      name: "Wombat Ops",
      features: [
        "traces",
        "trace_diff",
        "trace_labels",
        "trace_annotations",
        "trace_linking",
        "skills",
        "skill_lifecycle",
        "skill_promotion",
        "governance",
        "budgets",
        "cost_forecasting",
        "risk_scoring",
        "evals",
        "workspace_pins",
        "workspace_environments",
        "impact_analysis",
        "retention_policies"
      ]
    };
  });

  /**
   * Validate control plane version compatibility.
   * GET /api/compatibility
   */
  app.get("/api/compatibility", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const result = await validateControlPlaneVersion();

    if (!result.compatible) {
      return reply.status(503).send({
        compatible: false,
        clasper_contract_version: result.clasperContractVersion,
        control_plane_contract_version: result.controlPlaneContractVersion,
        error: result.error,
        missing_features: result.missingFeatures
      });
    }

    return reply.send({
      compatible: true,
      clasper_contract_version: result.clasperContractVersion,
      control_plane_contract_version: result.controlPlaneContractVersion,
      warnings: result.warnings
    });
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

  // ============================================================================
  // Trace Endpoints - Agent observability
  // ============================================================================

  /**
   * List traces with filtering and pagination.
   * Requires tenant_id query parameter.
   */
  const TraceListQuerySchema = z.object({
    tenant_id: z.string(),
    workspace_id: z.string().optional(),
    agent_role: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/traces", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = TraceListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const traceStore = getTraceStore();

    const result = traceStore.list({
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      agentRole: query.agent_role,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({
      traces: result.traces,
      total: result.total,
      has_more: result.hasMore,
      limit: query.limit,
      offset: query.offset
    });
  });

  /**
   * Get a single trace by ID.
   * Requires tenant_id query parameter for authorization.
   */
  app.get("/traces/:id", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const query = request.query as { tenant_id?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const traceStore = getTraceStore();
    const trace = traceStore.getForTenant(id, query.tenant_id);

    if (!trace) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    return reply.send({ trace });
  });

  /**
   * Get trace statistics for a tenant.
   */
  app.get("/traces/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string; start_date?: string; end_date?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const traceStore = getTraceStore();
    const stats = traceStore.getStats(query.tenant_id, query.start_date, query.end_date);

    return reply.send({ stats });
  });

  /**
   * Replay a trace with different configuration.
   * Returns comparison between original and replayed execution.
   */
  const ReplaySchema = z.object({
    model: z.string().optional(),
    skill_version: z.string().optional()
  });

  app.post("/traces/:id/replay", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const parsed = ReplaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const traceStore = getTraceStore();
    const replayContext = traceStore.getReplayContext(id);

    if (!replayContext) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    // TODO: Implement full replay with different model/skill version
    // For now, return the replay context
    return reply.send({
      status: "pending",
      message: "Replay functionality coming soon",
      original_trace: replayContext.trace,
      replay_config: parsed.data
    });
  });

  /**
   * Compare two traces and return structured differences.
   * POST /traces/diff
   */
  const TraceDiffSchema = z.object({
    base_trace_id: z.string(),
    compare_trace_id: z.string(),
    include_summary: z.boolean().default(true)
  });

  app.post("/traces/diff", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = TraceDiffSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { base_trace_id, compare_trace_id, include_summary } = parsed.data;
    const traceStore = getTraceStore();

    const baseTrace = traceStore.get(base_trace_id);
    if (!baseTrace) {
      return reply.status(404).send({ error: "Base trace not found", trace_id: base_trace_id });
    }

    const compareTrace = traceStore.get(compare_trace_id);
    if (!compareTrace) {
      return reply.status(404).send({ error: "Compare trace not found", trace_id: compare_trace_id });
    }

    const diff = diffTraces(baseTrace, compareTrace);
    const response: Record<string, unknown> = { diff };

    if (include_summary) {
      response.summary_text = formatDiffSummary(diff);
    }

    return reply.send(response);
  });

  /**
   * Set labels for a trace.
   * POST /traces/:id/label
   */
  const TraceLabelSchema = z.object({
    labels: z.record(z.string())
  });

  app.post("/traces/:id/label", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const parsed = TraceLabelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const traceStore = getTraceStore();
    const success = traceStore.setLabels(id, parsed.data.labels);

    if (!success) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    return reply.send({
      status: "ok",
      trace_id: id,
      labels: parsed.data.labels
    });
  });

  /**
   * Add an annotation to a trace (append-only).
   * POST /traces/:id/annotate
   */
  const TraceAnnotateSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
    created_by: z.string().optional()
  });

  app.post("/traces/:id/annotate", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const parsed = TraceAnnotateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    // Verify trace exists
    const traceStore = getTraceStore();
    const trace = traceStore.get(id);
    if (!trace) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    const annotations = getTraceAnnotations();
    const annotation = annotations.annotate(
      id,
      parsed.data.key,
      parsed.data.value,
      parsed.data.created_by
    );

    return reply.status(201).send({
      status: "ok",
      annotation: {
        id: annotation.id,
        trace_id: annotation.traceId,
        key: annotation.key,
        value: annotation.value,
        created_at: annotation.createdAt,
        created_by: annotation.createdBy
      }
    });
  });

  /**
   * Get annotations for a trace.
   * GET /traces/:id/annotations
   */
  app.get("/traces/:id/annotations", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };

    const annotations = getTraceAnnotations();
    const traceAnnotations = annotations.getForTrace(id);

    return reply.send({
      trace_id: id,
      annotations: traceAnnotations.map(a => ({
        id: a.id,
        key: a.key,
        value: a.value,
        created_at: a.createdAt,
        created_by: a.createdBy
      }))
    });
  });

  /**
   * Find traces by external entity ID (task, document, or message).
   * GET /traces/by-entity
   */
  const TraceByEntityQuerySchema = z.object({
    task_id: z.string().optional(),
    document_id: z.string().optional(),
    message_id: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100)
  });

  app.get("/traces/by-entity", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = TraceByEntityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { task_id, document_id, message_id, limit } = parsed.data;
    const traceStore = getTraceStore();

    if (!task_id && !document_id && !message_id) {
      return reply.status(400).send({
        error: "At least one of task_id, document_id, or message_id is required"
      });
    }

    let traces;
    let entityType;
    let entityId;

    if (task_id) {
      traces = traceStore.findByTaskId(task_id, limit);
      entityType = 'task';
      entityId = task_id;
    } else if (document_id) {
      traces = traceStore.findByDocumentId(document_id, limit);
      entityType = 'document';
      entityId = document_id;
    } else {
      traces = traceStore.findByMessageId(message_id!, limit);
      entityType = 'message';
      entityId = message_id;
    }

    return reply.send({
      entity_type: entityType,
      entity_id: entityId,
      traces,
      count: traces.length
    });
  });

  /**
   * Find traces by label.
   * GET /traces/by-label
   */
  const TraceByLabelQuerySchema = z.object({
    tenant_id: z.string(),
    label_key: z.string(),
    label_value: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100)
  });

  app.get("/traces/by-label", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = TraceByLabelQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { tenant_id, label_key, label_value, limit } = parsed.data;
    const traceStore = getTraceStore();
    const traces = traceStore.findByLabel(tenant_id, label_key, label_value, limit);

    return reply.send({
      traces,
      count: traces.length
    });
  });

  /**
   * Database stats endpoint for monitoring.
   */
  app.get("/db/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    try {
      const stats = getDatabaseStats();
      return reply.send({ stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get database stats";
      return reply.status(500).send({ error: message });
    }
  });

  // ============================================================================
  // Skill Registry Endpoints
  // ============================================================================

  /**
   * Publish a skill to the registry.
   */
  app.post("/skills/publish", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    try {
      const manifest = SkillManifestSchema.parse(request.body);
      const registry = getSkillRegistry();
      const published = registry.publish(manifest);

      return reply.status(201).send({
        status: "ok",
        skill: {
          name: published.name,
          version: published.version,
          checksum: published.checksum,
          published_at: published.publishedAt
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid manifest", details: err.flatten() });
      }
      const message = err instanceof Error ? err.message : "Failed to publish skill";
      return reply.status(400).send({ error: message });
    }
  });

  /**
   * Get a skill by name (optionally with version).
   */
  app.get("/skills/registry/:name", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name } = request.params as { name: string };
    const query = request.query as { version?: string };

    const registry = getSkillRegistry();
    const skill = registry.get(name, query.version);

    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    return reply.send({ skill });
  });

  /**
   * List all versions of a skill.
   */
  app.get("/skills/registry/:name/versions", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name } = request.params as { name: string };
    const registry = getSkillRegistry();
    const versions = registry.listVersions(name);

    return reply.send({ name, versions });
  });

  /**
   * Search skills in the registry.
   */
  const SkillSearchQuerySchema = z.object({
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/skills/registry", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SkillSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { q, limit, offset } = parsed.data;
    const registry = getSkillRegistry();
    const result = registry.search(q || '', { limit, offset });

    return reply.send({
      skills: result.skills.map(s => ({
        name: s.name,
        version: s.version,
        description: s.description,
        checksum: s.checksum,
        published_at: s.publishedAt
      })),
      total: result.total,
      has_more: result.hasMore
    });
  });

  /**
   * Run tests for a skill.
   */
  const SkillTestOptionsSchema = z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    mock_tools: z.boolean().optional(),
    timeout: z.number().int().positive().optional()
  });

  app.post("/skills/registry/:name/test", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name } = request.params as { name: string };
    const query = request.query as { version?: string };

    const parsed = SkillTestOptionsSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid options", details: parsed.error.flatten() });
    }

    const registry = getSkillRegistry();
    const skill = registry.get(name, query.version);

    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    if (!skill.manifest.tests || skill.manifest.tests.length === 0) {
      return reply.status(400).send({ error: "Skill has no tests defined" });
    }

    try {
      const tester = getSkillTester();
      const result = await tester.runTests(skill, {
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        mockTools: parsed.data.mock_tools,
        timeout: parsed.data.timeout
      });

      return reply.send({
        status: result.passRate === 1 ? "passed" : "failed",
        result: {
          skill_name: result.skillName,
          skill_version: result.skillVersion,
          model: result.model,
          pass_count: result.passCount,
          fail_count: result.failCount,
          pass_rate: result.passRate,
          total_duration_ms: result.totalDurationMs,
          total_cost: result.totalCost,
          results: result.results
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test execution failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * Promote a skill to a new state.
   * POST /skills/:name/:version/promote
   */
  const SkillPromoteSchema = z.object({
    target_state: z.enum(['draft', 'tested', 'approved', 'active', 'deprecated'])
  });

  app.post("/skills/:name/:version/promote", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name, version } = request.params as { name: string; version: string };
    const parsed = SkillPromoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const registry = getSkillRegistry();
    const skill = registry.getAnyState(name, version);

    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    const result = registry.promote(name, version, parsed.data.target_state);

    if (!result.success) {
      return reply.status(400).send({
        error: "Promotion failed",
        message: result.error,
        current_state: skill.state,
        target_state: parsed.data.target_state
      });
    }

    // Log the state change to audit log
    const auditLog = getAuditLog();
    auditLog.log('skill_state_changed', {
      tenantId: 'system',
      eventData: {
        skill_name: name,
        skill_version: version,
        from_state: skill.state,
        to_state: parsed.data.target_state
      }
    });

    return reply.send({
      status: "ok",
      skill: {
        name: result.skill?.name,
        version: result.skill?.version,
        state: result.skill?.state,
        previous_state: skill.state
      }
    });
  });

  /**
   * Get skill state.
   * GET /skills/:name/:version/state
   */
  app.get("/skills/:name/:version/state", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name, version } = request.params as { name: string; version: string };
    const registry = getSkillRegistry();
    const skill = registry.getAnyState(name, version);

    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    return reply.send({
      name: skill.name,
      version: skill.version,
      state: skill.state,
      is_executable: skill.state === 'active'
    });
  });

  /**
   * List skills by state.
   * GET /skills/by-state
   */
  const SkillsByStateSchema = z.object({
    state: z.enum(['draft', 'tested', 'approved', 'active', 'deprecated']),
    limit: z.coerce.number().int().min(1).max(500).default(100)
  });

  app.get("/skills/by-state", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SkillsByStateSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { state, limit } = parsed.data;
    const registry = getSkillRegistry();
    const skills = registry.getByState(state, limit);

    return reply.send({
      state,
      skills: skills.map(s => ({
        name: s.name,
        version: s.version,
        description: s.description,
        published_at: s.publishedAt
      })),
      count: skills.length
    });
  });

  // ============================================================================
  // Workspace Pins Endpoints
  // ============================================================================

  /**
   * Pin a workspace version.
   * POST /workspace/pin
   */
  const WorkspacePinSchema = z.object({
    workspace_id: z.string(),
    environment: z.string().default('default'),
    version_hash: z.string(),
    skill_pins: z.record(z.string()).optional(),
    model_pin: z.string().optional(),
    provider_pin: z.string().optional(),
    pinned_by: z.string().optional()
  });

  app.post("/workspace/pin", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = WorkspacePinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const pins = getWorkspacePins();
    const pin = pins.pin({
      workspaceId: parsed.data.workspace_id,
      environment: parsed.data.environment,
      versionHash: parsed.data.version_hash,
      skillPins: parsed.data.skill_pins,
      modelPin: parsed.data.model_pin,
      providerPin: parsed.data.provider_pin,
      pinnedBy: parsed.data.pinned_by
    });

    // Log the pin to audit log
    const auditLog = getAuditLog();
    auditLog.log('workspace_change', {
      tenantId: 'system',
      workspaceId: parsed.data.workspace_id,
      eventData: {
        action: 'pin',
        environment: parsed.data.environment,
        version_hash: parsed.data.version_hash
      }
    });

    return reply.status(201).send({
      status: "ok",
      pin: {
        id: pin.id,
        workspace_id: pin.workspaceId,
        environment: pin.environment,
        version_hash: pin.versionHash,
        skill_pins: pin.skillPins,
        model_pin: pin.modelPin,
        provider_pin: pin.providerPin,
        pinned_at: pin.pinnedAt
      }
    });
  });

  /**
   * Get workspace pin.
   * GET /workspace/pin
   */
  const WorkspacePinQuerySchema = z.object({
    workspace_id: z.string(),
    environment: z.string().default('default')
  });

  app.get("/workspace/pin", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = WorkspacePinQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const pins = getWorkspacePins();
    const pin = pins.get(parsed.data.workspace_id, parsed.data.environment);

    if (!pin) {
      return reply.status(404).send({ error: "Pin not found" });
    }

    return reply.send({
      pin: {
        id: pin.id,
        workspace_id: pin.workspaceId,
        environment: pin.environment,
        version_hash: pin.versionHash,
        skill_pins: pin.skillPins,
        model_pin: pin.modelPin,
        provider_pin: pin.providerPin,
        pinned_at: pin.pinnedAt,
        pinned_by: pin.pinnedBy
      }
    });
  });

  /**
   * List all pins for a workspace.
   * GET /workspace/:id/pins
   */
  app.get("/workspace/:id/pins", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const pins = getWorkspacePins();
    const workspacePins = pins.listForWorkspace(id);

    return reply.send({
      workspace_id: id,
      pins: workspacePins.map(p => ({
        id: p.id,
        environment: p.environment,
        version_hash: p.versionHash,
        skill_pins: p.skillPins,
        model_pin: p.modelPin,
        provider_pin: p.providerPin,
        pinned_at: p.pinnedAt
      }))
    });
  });

  /**
   * Remove a workspace pin.
   * DELETE /workspace/pin
   */
  app.delete("/workspace/pin", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = WorkspacePinQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const pins = getWorkspacePins();
    const success = pins.unpin(parsed.data.workspace_id, parsed.data.environment);

    if (!success) {
      return reply.status(404).send({ error: "Pin not found" });
    }

    return reply.send({ status: "ok" });
  });

  // ============================================================================
  // Workspace Environments Endpoints
  // ============================================================================

  /**
   * Create or update a workspace environment.
   * POST /workspace/envs
   */
  const WorkspaceEnvSchema = z.object({
    workspace_id: z.string(),
    environment: z.string(),
    description: z.string().optional(),
    version_hash: z.string().optional(),
    is_default: z.boolean().optional(),
    locked: z.boolean().optional()
  });

  app.post("/workspace/envs", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = WorkspaceEnvSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const envs = getWorkspaceEnvironments();
    const env = envs.upsertEnvironment(parsed.data.workspace_id, parsed.data.environment, {
      description: parsed.data.description,
      versionHash: parsed.data.version_hash,
      isDefault: parsed.data.is_default,
      locked: parsed.data.locked
    });

    return reply.status(201).send({
      status: "ok",
      environment: {
        id: env.id,
        workspace_id: env.workspaceId,
        environment: env.environment,
        description: env.description,
        version_hash: env.versionHash,
        is_default: env.isDefault,
        locked: env.locked,
        created_at: env.createdAt,
        updated_at: env.updatedAt
      }
    });
  });

  /**
   * List environments for a workspace.
   * GET /workspace/envs
   */
  app.get("/workspace/envs", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { workspace_id?: string };
    if (!query.workspace_id) {
      return reply.status(400).send({ error: "workspace_id query parameter is required" });
    }

    const envs = getWorkspaceEnvironments();
    const environments = envs.listEnvironments(query.workspace_id);

    return reply.send({
      workspace_id: query.workspace_id,
      environments: environments.map(e => ({
        id: e.id,
        environment: e.environment,
        description: e.description,
        version_hash: e.versionHash,
        is_default: e.isDefault,
        locked: e.locked,
        created_at: e.createdAt,
        updated_at: e.updatedAt
      }))
    });
  });

  /**
   * Promote an environment to the next stage.
   * POST /workspace/envs/promote
   */
  const EnvPromoteSchema = z.object({
    workspace_id: z.string(),
    source_env: z.string(),
    target_env: z.string().optional()
  });

  app.post("/workspace/envs/promote", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = EnvPromoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const envs = getWorkspaceEnvironments();
    const result = envs.promote(
      parsed.data.workspace_id,
      parsed.data.source_env,
      parsed.data.target_env
    );

    if (!result.success) {
      return reply.status(400).send({
        error: "Promotion failed",
        message: result.error,
        source_env: result.sourceEnv,
        target_env: result.targetEnv
      });
    }

    // Log to audit
    const auditLog = getAuditLog();
    auditLog.log('workspace_change', {
      tenantId: 'system',
      workspaceId: parsed.data.workspace_id,
      eventData: {
        action: 'promote',
        source_env: result.sourceEnv,
        target_env: result.targetEnv,
        version_hash: result.versionHash
      }
    });

    return reply.send({
      status: "ok",
      promotion: {
        source_env: result.sourceEnv,
        target_env: result.targetEnv,
        version_hash: result.versionHash
      }
    });
  });

  /**
   * Initialize standard environments (dev, staging, prod).
   * POST /workspace/envs/init
   */
  const EnvInitSchema = z.object({
    workspace_id: z.string(),
    default_env: z.enum(['dev', 'staging', 'prod']).optional().default('dev')
  });

  app.post("/workspace/envs/init", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = EnvInitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const envs = getWorkspaceEnvironments();
    const created = envs.initializeStandardEnvironments(
      parsed.data.workspace_id,
      parsed.data.default_env
    );

    return reply.status(201).send({
      status: "ok",
      environments: created.map(e => ({
        environment: e.environment,
        is_default: e.isDefault,
        locked: e.locked
      }))
    });
  });

  // ============================================================================
  // Workspace Impact Analysis Endpoints
  // ============================================================================

  /**
   * Analyze the impact of workspace changes.
   * POST /workspace/impact
   */
  const ImpactAnalysisSchema = z.object({
    workspace_path: z.string().optional(),
    old_version_hash: z.string(),
    new_version_hash: z.string().optional()
  });

  app.post("/workspace/impact", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = ImpactAnalysisSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    try {
      const workspace = getWorkspaceLoader();
      const workspacePath = parsed.data.workspace_path || workspace.getWorkspacePath();

      let analysis;
      if (parsed.data.new_version_hash) {
        // Compare two versions
        analysis = analyzeImpact(
          workspacePath,
          parsed.data.old_version_hash,
          parsed.data.new_version_hash
        );
      } else {
        // Compare version to current workspace
        analysis = analyzeImpactFromCurrent(
          workspacePath,
          'default',
          parsed.data.old_version_hash
        );
      }

      return reply.send({
        status: "ok",
        analysis: {
          summary: analysis.summary,
          file_changes: analysis.fileChanges,
          affected_skills: analysis.affectedSkills.map(s => ({
            name: s.name,
            version: s.version,
            state: s.state,
            change_type: s.changeType,
            affected_files: s.affectedFiles
          })),
          permission_changes: analysis.permissionChanges.map(p => ({
            skill_name: p.skillName,
            tool_name: p.toolName,
            change_type: p.changeType
          })),
          prompt_impact: {
            current_size: analysis.promptImpact.currentSize,
            new_size: analysis.promptImpact.newSize,
            delta: analysis.promptImpact.delta,
            percent_change: analysis.promptImpact.percentChange
          },
          risk: analysis.risk,
          recommendations: analysis.recommendations
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impact analysis failed";
      return reply.status(400).send({ error: message });
    }
  });

  // ============================================================================
  // Audit Log Endpoints
  // ============================================================================

  /**
   * Query the audit log.
   */
  const AuditQuerySchema = z.object({
    tenant_id: z.string(),
    workspace_id: z.string().optional(),
    trace_id: z.string().optional(),
    event_type: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/audit", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = AuditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const auditLog = getAuditLog();

    const result = auditLog.query({
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      traceId: query.trace_id,
      eventType: query.event_type as any,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({
      entries: result.entries,
      total: result.total,
      has_more: result.hasMore
    });
  });

  /**
   * Get audit log statistics.
   */
  app.get("/audit/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string; start_date?: string; end_date?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const auditLog = getAuditLog();
    const stats = auditLog.getStats(query.tenant_id, query.start_date, query.end_date);

    return reply.send({ stats });
  });

  // ============================================================================
  // Budget Endpoints
  // ============================================================================

  /**
   * Get budget for a tenant.
   */
  app.get("/budget", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const budgetManager = getBudgetManager();
    const budget = budgetManager.getBudget(query.tenant_id);

    if (!budget) {
      return reply.status(404).send({ error: "No budget set for this tenant" });
    }

    const stats = budgetManager.getStats(query.tenant_id);

    return reply.send({ budget, stats });
  });

  /**
   * Set or update budget for a tenant.
   */
  const SetBudgetSchema = z.object({
    tenant_id: z.string(),
    budget_usd: z.number().positive(),
    period_start: z.string().optional(),
    period_end: z.string().optional(),
    hard_limit: z.boolean().optional(),
    alert_threshold: z.number().min(0).max(1).optional()
  });

  app.post("/budget", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SetBudgetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const budgetManager = getBudgetManager();

    const budget = budgetManager.setBudget(data.tenant_id, {
      budgetUsd: data.budget_usd,
      periodStart: data.period_start,
      periodEnd: data.period_end,
      hardLimit: data.hard_limit,
      alertThreshold: data.alert_threshold
    });

    return reply.send({ status: "ok", budget });
  });

  /**
   * Check if a request is within budget.
   */
  app.get("/budget/check", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string; estimated_cost?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const estimatedCost = query.estimated_cost ? parseFloat(query.estimated_cost) : 0;
    const budgetManager = getBudgetManager();
    const result = budgetManager.checkBudget(query.tenant_id, estimatedCost);

    return reply.send(result);
  });

  /**
   * Forecast cost before execution.
   * POST /cost/forecast
   */
  const CostForecastSchema = z.object({
    tenant_id: z.string(),
    prompt_size: z.number().int().positive(),
    max_output_tokens: z.number().int().positive().optional().default(1000),
    model: z.string(),
    provider: z.string().optional()
  });

  app.post("/cost/forecast", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = CostForecastSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const budgetManager = getBudgetManager();
    const forecast = budgetManager.forecastCost({
      tenantId: parsed.data.tenant_id,
      promptSize: parsed.data.prompt_size,
      maxOutputTokens: parsed.data.max_output_tokens,
      model: parsed.data.model,
      provider: parsed.data.provider
    });

    // Return forecast with budget status
    return reply.send({
      forecast: {
        estimated_cost: forecast.estimatedCost,
        input_cost: forecast.inputCost,
        output_cost: forecast.outputCost,
        budget_allowed: forecast.budgetAllowed,
        budget_remaining: forecast.budgetRemaining,
        would_exceed_budget: forecast.wouldExceedBudget,
        warning: forecast.warning
      },
      details: {
        input_tokens: forecast.details.inputTokens,
        output_tokens: forecast.details.outputTokens,
        model: forecast.details.model,
        input_price_per_token: forecast.details.inputPricePerToken,
        output_price_per_token: forecast.details.outputPricePerToken
      }
    });
  });

  // ============================================================================
  // Trace Retention Endpoints
  // ============================================================================

  /**
   * Set retention policy for a tenant.
   * POST /retention/policy
   */
  const RetentionPolicySchema = z.object({
    tenant_id: z.string(),
    retention_days: z.number().int().min(1).max(3650).optional(),
    sampling_strategy: z.enum(['full', 'sampled', 'errors_only']).optional(),
    storage_mode: z.enum(['full', 'summary', 'minimal']).optional()
  });

  app.post("/retention/policy", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = RetentionPolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const retention = getRetentionPolicies();
    const policy = retention.setPolicy(parsed.data.tenant_id, {
      retentionDays: parsed.data.retention_days,
      samplingStrategy: parsed.data.sampling_strategy,
      storageMode: parsed.data.storage_mode
    });

    return reply.send({
      status: "ok",
      policy: {
        tenant_id: policy.tenantId,
        retention_days: policy.retentionDays,
        sampling_strategy: policy.samplingStrategy,
        storage_mode: policy.storageMode,
        created_at: policy.createdAt,
        updated_at: policy.updatedAt
      }
    });
  });

  /**
   * Get retention policy for a tenant.
   * GET /retention/policy
   */
  app.get("/retention/policy", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string };
    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const retention = getRetentionPolicies();
    const policy = retention.getPolicy(query.tenant_id);

    if (!policy) {
      return reply.status(404).send({ error: "No retention policy set for this tenant" });
    }

    return reply.send({
      policy: {
        tenant_id: policy.tenantId,
        retention_days: policy.retentionDays,
        sampling_strategy: policy.samplingStrategy,
        storage_mode: policy.storageMode,
        created_at: policy.createdAt,
        updated_at: policy.updatedAt
      }
    });
  });

  /**
   * Enforce retention policy for a tenant.
   * POST /retention/enforce
   */
  app.post("/retention/enforce", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const body = request.body as { tenant_id?: string };

    const retention = getRetentionPolicies();

    if (body.tenant_id) {
      // Enforce for specific tenant
      const result = retention.enforcePolicy(body.tenant_id);
      return reply.send({
        status: "ok",
        result: {
          tenant_id: result.tenantId,
          traces_deleted: result.tracesDeleted,
          cutoff_date: result.cutoffDate,
          duration_ms: result.duration
        }
      });
    } else {
      // Enforce for all tenants with policies
      const results = retention.enforceAllPolicies();
      return reply.send({
        status: "ok",
        results: results.map(r => ({
          tenant_id: r.tenantId,
          traces_deleted: r.tracesDeleted,
          cutoff_date: r.cutoffDate,
          duration_ms: r.duration
        })),
        total_deleted: results.reduce((sum, r) => sum + r.tracesDeleted, 0)
      });
    }
  });

  /**
   * Get retention stats.
   * GET /retention/stats
   */
  app.get("/retention/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const retention = getRetentionPolicies();
    const stats = retention.getStats();
    const needingCleanup = retention.getTenantsNeedingCleanup();

    return reply.send({
      stats,
      tenants_needing_cleanup: needingCleanup.map(t => ({
        tenant_id: t.tenantId,
        old_trace_count: t.oldTraceCount,
        retention_days: t.retentionDays
      }))
    });
  });

  // ============================================================================
  // Risk Scoring Endpoints
  // ============================================================================

  /**
   * Calculate risk score for an execution.
   * POST /risk/score
   */
  const RiskScoreSchema = z.object({
    tool_count: z.number().int().min(0),
    tool_names: z.array(z.string()).optional(),
    skill_state: z.enum(['draft', 'tested', 'approved', 'active', 'deprecated']).optional(),
    temperature: z.number().min(0).max(2).optional(),
    data_sensitivity: z.enum(['none', 'low', 'medium', 'high', 'pii']).optional(),
    model: z.string().optional(),
    skill_tested: z.boolean().optional(),
    skill_pinned: z.boolean().optional(),
    custom_flags: z.array(z.string()).optional()
  });

  app.post("/risk/score", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = RiskScoreSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const input: RiskScoringInput = {
      toolCount: parsed.data.tool_count,
      toolNames: parsed.data.tool_names,
      skillState: parsed.data.skill_state,
      temperature: parsed.data.temperature,
      dataSensitivity: parsed.data.data_sensitivity,
      model: parsed.data.model,
      skillTested: parsed.data.skill_tested,
      skillPinned: parsed.data.skill_pinned,
      customFlags: parsed.data.custom_flags
    };

    const score = calculateRiskScore(input);

    return reply.send({
      risk_score: score.score,
      risk_level: score.level,
      factors: {
        tool_breadth: score.factors.toolBreadth,
        skill_maturity: score.factors.skillMaturity,
        model_volatility: score.factors.modelVolatility,
        data_sensitivity: score.factors.dataSensitivity,
        custom_factors: score.factors.customFactors
      },
      risk_factors: score.riskFactors,
      recommendations: score.recommendations
    });
  });

  // ============================================================================
  // Evaluation Endpoints
  // ============================================================================

  /**
   * Run an evaluation.
   */
  const EvalCaseSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.string(),
    expected_output: z.string().optional(),
    expected_tool_calls: z.array(z.string()).optional(),
    acceptable_outputs: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  });

  const RunEvalSchema = z.object({
    dataset: z.object({
      name: z.string(),
      description: z.string().optional(),
      cases: z.array(EvalCaseSchema).min(1)
    }),
    options: z.object({
      model: z.string(),
      skill_name: z.string().optional(),
      skill_version: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      timeout: z.number().int().positive().optional(),
      mock_tools: z.boolean().optional()
    })
  });

  app.post("/evals/run", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = RunEvalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { dataset: rawDataset, options: rawOptions } = parsed.data;

    // Convert to internal format
    const dataset: EvalDataset = {
      name: rawDataset.name,
      description: rawDataset.description,
      cases: rawDataset.cases.map(c => ({
        id: c.id,
        name: c.name,
        input: c.input,
        expectedOutput: c.expected_output,
        expectedToolCalls: c.expected_tool_calls,
        acceptableOutputs: c.acceptable_outputs,
        tags: c.tags
      }))
    };

    const options: EvalOptions = {
      model: rawOptions.model,
      skillName: rawOptions.skill_name,
      skillVersion: rawOptions.skill_version,
      temperature: rawOptions.temperature,
      timeout: rawOptions.timeout,
      mockTools: rawOptions.mock_tools
    };

    try {
      const evalRunner = getEvalRunner();
      const result = await evalRunner.run(dataset, options);

      return reply.send({
        status: result.scores.passRate === 1 ? "passed" : "failed",
        result: {
          id: result.id,
          dataset_name: result.datasetName,
          model: result.model,
          skill_name: result.skillName,
          skill_version: result.skillVersion,
          scores: result.scores,
          case_count: result.cases.length,
          pass_count: result.cases.filter(c => c.passed).length,
          duration_ms: result.durationMs
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Evaluation failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * Get evaluation result by ID.
   */
  app.get("/evals/:id", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const evalRunner = getEvalRunner();
    const result = evalRunner.getResult(id);

    if (!result) {
      return reply.status(404).send({ error: "Evaluation result not found" });
    }

    return reply.send({ result });
  });

  /**
   * List evaluation results.
   */
  const EvalListQuerySchema = z.object({
    dataset_name: z.string().optional(),
    skill_name: z.string().optional(),
    model: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/evals", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = EvalListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const evalRunner = getEvalRunner();
    const result = evalRunner.listResults({
      datasetName: query.dataset_name,
      skillName: query.skill_name,
      model: query.model,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({
      results: result.results.map(r => ({
        id: r.id,
        dataset_name: r.datasetName,
        model: r.model,
        skill_name: r.skillName,
        scores: r.scores,
        started_at: r.startedAt
      })),
      total: result.total
    });
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
    // 3. Find/create by CLASPER_DEFAULT_TASK env var
    // 4. Error if none of the above
    let taskId: string | null = payload.task_id || null;

    if (!taskId) {
      // Determine task title: request > env > none
      const taskTitle = payload.task_title || config.defaultTaskTitle;

      if (!taskTitle) {
        return reply.status(400).send({
          error: "Task not specified. Provide task_id, task_title, or set CLASPER_DEFAULT_TASK env var."
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
      trace_id: request.traceId,
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

if (process.env.CLASPER_TEST_MODE !== "true") {
  const app = buildApp();
  app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
