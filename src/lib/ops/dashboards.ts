import { getDatabase } from "../core/db.js";
import { getTraceStore } from "../tracing/traceStore.js";
import { computeTraceRisk } from "./traceViews.js";

export function getCostDashboard(tenantId: string) {
  const db = getDatabase();
  const daily = db.prepare(`
    SELECT strftime('%Y-%m-%d', started_at) as day,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces
    WHERE tenant_id = ?
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
  `).all(tenantId) as { day: string; total_cost: number; trace_count: number }[];

  const byWorkspace = db.prepare(`
    SELECT workspace_id,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces
    WHERE tenant_id = ?
    GROUP BY workspace_id
    ORDER BY total_cost DESC
    LIMIT 20
  `).all(tenantId) as { workspace_id: string; total_cost: number; trace_count: number }[];

  const bySkill = db.prepare(`
    SELECT json_each.key as skill_name,
           SUM(total_cost) as total_cost,
           COUNT(*) as trace_count
    FROM traces, json_each(traces.skill_versions)
    WHERE tenant_id = ?
    GROUP BY json_each.key
    ORDER BY total_cost DESC
    LIMIT 20
  `).all(tenantId) as { skill_name: string; total_cost: number; trace_count: number }[];

  return { daily, byWorkspace, bySkill };
}

export function getRiskDashboard(tenantId: string) {
  const traceStore = getTraceStore();
  const result = traceStore.list({ tenantId, limit: 200, offset: 0 });

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
    recent_high_risk: recentHighRisk.slice(0, 20)
  };
}
