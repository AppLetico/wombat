import { config } from "../core/config.js";
import { getBudgetManager } from "../governance/budgetManager.js";
import { getSkillRegistry } from "../skills/skillRegistry.js";
import { getWorkspaceLoader } from "../workspace/workspace.js";
import { analyzeImpact } from "../workspace/impactAnalysis.js";
import { getWorkspaceEnvironments } from "../workspace/workspaceEnvironments.js";
import { getWorkspacePins } from "../workspace/workspacePins.js";

export interface PromotionCheckResult {
  name: string;
  passed: boolean;
  details?: string;
}

export interface PromotionChecksView {
  workspace_id: string;
  source_env: string;
  target_env: string;
  blocked: boolean;
  checks: PromotionCheckResult[];
  impact?: ReturnType<typeof analyzeImpact>;
  cost_forecast?: {
    estimated_cost: number;
    budget_remaining?: number;
    would_exceed_budget: boolean;
    warning?: string;
  };
  deprecated_skills: string[];
}

export function runPromotionChecks(params: {
  workspaceId: string;
  sourceEnv: string;
  targetEnv: string;
}): PromotionChecksView {
  const { workspaceId, sourceEnv, targetEnv } = params;
  const envs = getWorkspaceEnvironments();
  const pins = getWorkspacePins();
  const registry = getSkillRegistry();
  const checks: PromotionCheckResult[] = [];

  const source = envs.getEnvironment(workspaceId, sourceEnv);
  const target = envs.getEnvironment(workspaceId, targetEnv);

  if (!source) {
    return {
      workspace_id: workspaceId,
      source_env: sourceEnv,
      target_env: targetEnv,
      blocked: true,
      checks: [{ name: "source_env_exists", passed: false, details: "Source environment not found" }],
      deprecated_skills: []
    };
  }

  if (!source.versionHash) {
    checks.push({
      name: "source_has_version",
      passed: false,
      details: "Source environment has no version pinned"
    });
  } else {
    checks.push({ name: "source_has_version", passed: true });
  }

  if (target?.locked) {
    checks.push({
      name: "target_unlocked",
      passed: false,
      details: `Target environment ${targetEnv} is locked`
    });
  } else {
    checks.push({ name: "target_unlocked", passed: true });
  }

  const sourcePin = pins.get(workspaceId, sourceEnv);
  checks.push({
    name: "workspace_pinned",
    passed: !!sourcePin,
    details: sourcePin ? undefined : "Workspace not pinned in source environment"
  });

  const deprecatedSkills: string[] = [];
  if (sourcePin?.skillPins) {
    for (const [skillName, version] of Object.entries(sourcePin.skillPins)) {
      const skill = registry.getAnyState(skillName, version);
      if (skill?.state === "deprecated") {
        deprecatedSkills.push(`${skillName}@${version}`);
      }
    }
  }

  checks.push({
    name: "deprecated_skills",
    passed: deprecatedSkills.length === 0,
    details: deprecatedSkills.length > 0 ? `${deprecatedSkills.length} deprecated skill(s)` : undefined
  });

  let impactResult: ReturnType<typeof analyzeImpact> | undefined;
  if (source.versionHash && target?.versionHash) {
    const workspacePath = getWorkspaceLoader().getWorkspacePath();
    impactResult = analyzeImpact(workspacePath, target.versionHash, source.versionHash);
    checks.push({
      name: "impact_reviewed",
      passed: true,
      details: `Files changed: ${impactResult.summary.totalFilesChanged}`
    });
  } else {
    checks.push({
      name: "impact_reviewed",
      passed: false,
      details: "Impact analysis requires both source and target versions"
    });
  }

  let costForecast: PromotionChecksView["cost_forecast"];
  if (impactResult) {
    const budgetManager = getBudgetManager();
    const modelPin = sourcePin?.modelPin || config.llmModelDefault;
    const forecast = budgetManager.forecastCost({
      tenantId: workspaceId,
      promptSize: impactResult.promptImpact.newSize,
      maxOutputTokens: 1000,
      model: modelPin,
      provider: sourcePin?.providerPin
    });
    costForecast = {
      estimated_cost: forecast.estimatedCost,
      budget_remaining: forecast.budgetRemaining,
      would_exceed_budget: forecast.wouldExceedBudget,
      warning: forecast.warning
    };
    checks.push({
      name: "cost_forecast",
      passed: !forecast.wouldExceedBudget,
      details: forecast.warning
    });
  } else {
    checks.push({
      name: "cost_forecast",
      passed: false,
      details: "Cost forecast unavailable without impact analysis"
    });
  }

  const blocked = checks.some((check) => check.passed === false);

  return {
    workspace_id: workspaceId,
    source_env: sourceEnv,
    target_env: targetEnv,
    blocked,
    checks,
    impact: impactResult,
    cost_forecast: costForecast,
    deprecated_skills: deprecatedSkills
  };
}
