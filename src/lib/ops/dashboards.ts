import { getDatabase } from "../core/db.js";
import { getTraceStore } from "../tracing/traceStore.js";
import { getRetentionPolicies } from "../tracing/retentionPolicies.js";
import { computeTraceRisk } from "./traceViews.js";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "./pagination.js";

/**
 * Coverage metadata for dashboard data fidelity
 */
export interface DashboardCoverage {
  retention_mode: "full" | "sampled" | "errors_only";
  sampling_strategy: string | null;
  time_window: {
    start: string;
    end: string;
  };
  disclaimer: string;
}

/**
 * Get coverage metadata for a tenant's dashboard
 */
function getCoverageMetadata(tenantId: string): DashboardCoverage {
  const retention = getRetentionPolicies();
  const policy = retention.getPolicy(tenantId);

  const now = new Date();
  const retentionDays = policy?.retentionDays || 90;
  const startDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const samplingStrategy = policy?.samplingStrategy || "full";
  const retentionMode = samplingStrategy as "full" | "sampled" | "errors_only";

  let disclaimer = `Metrics based on ${retentionMode} traces`;
  if (samplingStrategy !== "full") {
    disclaimer += ` (${samplingStrategy})`;
  }
  disclaimer += `, last ${retentionDays} days`;

  return {
    retention_mode: retentionMode,
    sampling_strategy: samplingStrategy === "full" ? null : samplingStrategy,
    time_window: {
      start: startDate.toISOString(),
      end: now.toISOString()
    },
    disclaimer
  };
}

export interface CostDashboardOptions {
  dailyLimit?: number;
  workspaceLimit?: number;
  skillLimit?: number;
}

export function getCostDashboard(tenantId: string, options: CostDashboardOptions = {}) {
  const db = getDatabase();

  // Apply pagination limits with caps
  const dailyLimit = Math.min(options.dailyLimit || 30, MAX_PAGE_SIZE);
  const workspaceLimit = Math.min(options.workspaceLimit || 20, MAX_PAGE_SIZE);
  const skillLimit = Math.min(options.skillLimit || 20, MAX_PAGE_SIZE);

  const daily = db.prepare(`
    SELECT strftime('%Y-%m-%d', started_at) as day,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces
    WHERE tenant_id = ?
    GROUP BY day
    ORDER BY day DESC
    LIMIT ?
  `).all(tenantId, dailyLimit) as { day: string; total_cost: number; trace_count: number }[];

  const byWorkspace = db.prepare(`
    SELECT workspace_id,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces
    WHERE tenant_id = ?
    GROUP BY workspace_id
    ORDER BY total_cost DESC
    LIMIT ?
  `).all(tenantId, workspaceLimit) as { workspace_id: string; total_cost: number; trace_count: number }[];

  const bySkill = db.prepare(`
    SELECT json_each.key as skill_name,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces, json_each(traces.skill_versions)
    WHERE tenant_id = ?
    GROUP BY json_each.key
    ORDER BY total_cost DESC
    LIMIT ?
  `).all(tenantId, skillLimit) as { skill_name: string; total_cost: number; trace_count: number }[];

  return {
    daily,
    byWorkspace,
    bySkill,
    coverage: getCoverageMetadata(tenantId)
  };
}

export interface RiskDashboardOptions {
  limit?: number;
  highRiskLimit?: number;
}

export function getRiskDashboard(tenantId: string, options: RiskDashboardOptions = {}) {
  const traceStore = getTraceStore();

  // Apply pagination limits with caps
  const limit = Math.min(options.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const highRiskLimit = Math.min(options.highRiskLimit || 20, MAX_PAGE_SIZE);

  const result = traceStore.list({ tenantId, limit, offset: 0 });

  const levels: Record<string, number> = {};
  const recentHighRisk: string[] = [];

  for (const trace of result.traces) {
    const risk = computeTraceRisk(trace);
    levels[risk.level] = (levels[risk.level] || 0) + 1;
    if (risk.level === "high" || risk.level === "critical") {
      recentHighRisk.push(trace.id);
    }
  }

  return {
    levels,
    recent_high_risk: recentHighRisk.slice(0, highRiskLimit),
    coverage: getCoverageMetadata(tenantId)
  };
}
