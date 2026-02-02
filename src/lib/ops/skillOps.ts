import { getDatabase } from "../core/db.js";
import { getSkillRegistry } from "../skills/skillRegistry.js";

export interface SkillUsageStat {
  skill_name: string;
  usage_count: number;
  last_used?: string;
}

export interface SkillEnvUsage {
  skill_name: string;
  environments: string[];
}

export interface SkillPermissionDiff {
  added: string[];
  removed: string[];
}

export function getSkillUsageStats(): Record<string, SkillUsageStat> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT json_each.key as skill_name,
           COUNT(*) as usage_count,
           MAX(started_at) as last_used
    FROM traces, json_each(traces.skill_versions)
    GROUP BY json_each.key
  `).all() as { skill_name: string; usage_count: number; last_used: string }[];

  const stats: Record<string, SkillUsageStat> = {};
  for (const row of rows) {
    stats[row.skill_name] = {
      skill_name: row.skill_name,
      usage_count: row.usage_count,
      last_used: row.last_used
    };
  }
  return stats;
}

export function getSkillEnvironmentUsage(): Record<string, SkillEnvUsage> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT json_each.key as skill_name,
           workspace_pins.environment as environment
    FROM workspace_pins, json_each(workspace_pins.skill_pins)
  `).all() as { skill_name: string; environment: string }[];

  const usage: Record<string, SkillEnvUsage> = {};
  for (const row of rows) {
    if (!usage[row.skill_name]) {
      usage[row.skill_name] = { skill_name: row.skill_name, environments: [] };
    }
    if (!usage[row.skill_name].environments.includes(row.environment)) {
      usage[row.skill_name].environments.push(row.environment);
    }
  }
  return usage;
}

export function getPermissionDiff(name: string, version: string): SkillPermissionDiff {
  const registry = getSkillRegistry();
  const versions = registry.listVersions(name);
  const index = versions.findIndex((v) => v === version);
  const previousVersion = index >= 0 ? versions[index + 1] : undefined;

  const current = registry.getAnyState(name, version);
  const previous = previousVersion ? registry.getAnyState(name, previousVersion) : null;

  const currentTools = new Set(current?.manifest.permissions?.tools || []);
  const previousTools = new Set(previous?.manifest.permissions?.tools || []);

  const added = Array.from(currentTools).filter((tool) => !previousTools.has(tool));
  const removed = Array.from(previousTools).filter((tool) => !currentTools.has(tool));

  return { added, removed };
}
