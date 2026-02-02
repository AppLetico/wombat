/**
 * Workspace Change Impact Analysis
 *
 * Analyze the impact of workspace changes before applying them.
 * Features:
 * - List affected skills
 * - List affected permissions
 * - Estimate cost impact
 */

import { getWorkspaceVersioning, type WorkspaceDiff, type FileDiff } from './workspaceVersioning.js';
import { getSkillRegistry, type SkillState } from '../skills/skillRegistry.js';
import type { SkillManifest } from '../skills/skillManifest.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
  /** Summary of the analysis */
  summary: {
    totalFilesChanged: number;
    skillsAffected: number;
    permissionsChanged: number;
    estimatedCostImpact: 'increase' | 'decrease' | 'unchanged' | 'unknown';
  };

  /** Files that changed */
  fileChanges: {
    added: string[];
    modified: string[];
    deleted: string[];
  };

  /** Skills affected by the changes */
  affectedSkills: AffectedSkill[];

  /** Permission changes */
  permissionChanges: PermissionChange[];

  /** Prompt size impact */
  promptImpact: {
    currentSize: number;
    newSize: number;
    delta: number;
    percentChange: number;
  };

  /** Recommendations */
  recommendations: string[];

  /** Risk assessment */
  risk: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
}

/**
 * An affected skill
 */
export interface AffectedSkill {
  name: string;
  version?: string;
  state?: SkillState;
  changeType: 'added' | 'modified' | 'deleted' | 'dependency_changed';
  affectedFiles: string[];
}

/**
 * A permission change
 */
export interface PermissionChange {
  skillName: string;
  toolName: string;
  changeType: 'added' | 'removed';
}

// ============================================================================
// Impact Analysis Functions
// ============================================================================

/**
 * Analyze the impact of changes between two workspace versions
 */
export function analyzeImpact(
  workspacePath: string,
  oldVersionHash: string,
  newVersionHash: string
): ImpactAnalysis {
  const versioning = getWorkspaceVersioning(workspacePath);
  const diff = versioning.diff(oldVersionHash, newVersionHash);

  return analyzeFromDiff(diff);
}

/**
 * Analyze impact from current workspace against a version
 */
export function analyzeImpactFromCurrent(
  workspacePath: string,
  workspaceId: string,
  versionHash: string
): ImpactAnalysis {
  const versioning = getWorkspaceVersioning(workspacePath);
  const diff = versioning.diffFromCurrent(versionHash, workspaceId);

  return analyzeFromDiff(diff);
}

/**
 * Analyze impact from a diff
 */
export function analyzeFromDiff(diff: WorkspaceDiff): ImpactAnalysis {
  const fileChanges = categorizeFileChanges(diff.files);
  const affectedSkills = identifyAffectedSkills(diff.files);
  const permissionChanges = identifyPermissionChanges(affectedSkills);
  const promptImpact = estimatePromptImpact(diff.files);
  const recommendations = generateRecommendations(affectedSkills, permissionChanges, promptImpact);
  const risk = assessRisk(affectedSkills, permissionChanges, promptImpact);

  return {
    summary: {
      totalFilesChanged: diff.summary.added + diff.summary.modified + diff.summary.deleted,
      skillsAffected: affectedSkills.length,
      permissionsChanged: permissionChanges.length,
      estimatedCostImpact: estimateCostImpact(promptImpact),
    },
    fileChanges,
    affectedSkills,
    permissionChanges,
    promptImpact,
    recommendations,
    risk,
  };
}

/**
 * Categorize file changes
 */
function categorizeFileChanges(files: FileDiff[]): ImpactAnalysis['fileChanges'] {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const file of files) {
    switch (file.status) {
      case 'added':
        added.push(file.path);
        break;
      case 'modified':
        modified.push(file.path);
        break;
      case 'deleted':
        deleted.push(file.path);
        break;
    }
  }

  return { added, modified, deleted };
}

/**
 * Identify skills affected by file changes
 */
function identifyAffectedSkills(files: FileDiff[]): AffectedSkill[] {
  const skills: Map<string, AffectedSkill> = new Map();
  const registry = getSkillRegistry();

  for (const file of files) {
    if (file.status === 'unchanged') continue;

    // Check if file is a skill file
    const skillMatch = extractSkillFromPath(file.path);
    if (skillMatch) {
      const existing = skills.get(skillMatch.name);
      if (existing) {
        existing.affectedFiles.push(file.path);
      } else {
        // Try to get skill info from registry
        const skill = registry.getAnyState(skillMatch.name);

        skills.set(skillMatch.name, {
          name: skillMatch.name,
          version: skill?.version,
          state: skill?.state,
          changeType: file.status === 'added' ? 'added' :
                      file.status === 'deleted' ? 'deleted' : 'modified',
          affectedFiles: [file.path],
        });
      }
    }

    // Check if file is a shared dependency (e.g., SOUL.md, IDENTITY.md)
    if (isSharedDependency(file.path)) {
      // Mark all skills as having dependency changes
      const allSkills = registry.list();
      for (const s of allSkills.skills) {
        if (!skills.has(s.name)) {
          skills.set(s.name, {
            name: s.name,
            version: s.version,
            state: s.state,
            changeType: 'dependency_changed',
            affectedFiles: [file.path],
          });
        }
      }
    }
  }

  return Array.from(skills.values());
}

/**
 * Extract skill name from file path
 */
function extractSkillFromPath(path: string): { name: string } | null {
  // Match patterns like: skills/foo.md, skills/foo.yaml, skill_foo.md
  const skillDirMatch = path.match(/^skills\/([^/]+)\.(md|yaml|yml)$/i);
  if (skillDirMatch) {
    return { name: skillDirMatch[1] };
  }

  const skillFileMatch = path.match(/^skill_([^/]+)\.(md|yaml|yml)$/i);
  if (skillFileMatch) {
    return { name: skillFileMatch[1] };
  }

  return null;
}

/**
 * Check if file is a shared dependency
 */
function isSharedDependency(path: string): boolean {
  const sharedFiles = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'AGENTS.md'];
  return sharedFiles.some(f => path.endsWith(f));
}

/**
 * Identify permission changes
 */
function identifyPermissionChanges(affectedSkills: AffectedSkill[]): PermissionChange[] {
  const changes: PermissionChange[] = [];

  // For now, this is a placeholder - full implementation would
  // parse skill manifests and compare permissions
  // This would require loading the old and new skill definitions

  for (const skill of affectedSkills) {
    if (skill.changeType === 'added') {
      // New skill - all its permissions are "added"
      const registry = getSkillRegistry();
      const registrySkill = registry.getAnyState(skill.name);
      if (registrySkill?.manifest.permissions?.tools) {
        for (const tool of registrySkill.manifest.permissions.tools) {
          changes.push({
            skillName: skill.name,
            toolName: tool,
            changeType: 'added',
          });
        }
      }
    } else if (skill.changeType === 'deleted') {
      // Deleted skill - all its permissions are "removed"
      // Note: We'd need the old version to know what permissions it had
    }
  }

  return changes;
}

/**
 * Estimate prompt size impact
 */
function estimatePromptImpact(files: FileDiff[]): ImpactAnalysis['promptImpact'] {
  let currentSize = 0;
  let newSize = 0;

  for (const file of files) {
    const oldSize = file.oldSize || 0;
    const newFileSize = file.newSize || 0;

    switch (file.status) {
      case 'added':
        newSize += newFileSize;
        break;
      case 'deleted':
        currentSize += oldSize;
        break;
      case 'modified':
        currentSize += oldSize;
        newSize += newFileSize;
        break;
      case 'unchanged':
        currentSize += oldSize;
        newSize += oldSize;
        break;
    }
  }

  const delta = newSize - currentSize;
  const percentChange = currentSize > 0 ? (delta / currentSize) * 100 : 0;

  return {
    currentSize,
    newSize,
    delta,
    percentChange,
  };
}

/**
 * Estimate cost impact
 */
function estimateCostImpact(
  promptImpact: ImpactAnalysis['promptImpact']
): ImpactAnalysis['summary']['estimatedCostImpact'] {
  if (promptImpact.delta === 0) return 'unchanged';
  if (promptImpact.percentChange > 5) return 'increase';
  if (promptImpact.percentChange < -5) return 'decrease';
  return 'unchanged';
}

/**
 * Generate recommendations
 */
function generateRecommendations(
  affectedSkills: AffectedSkill[],
  permissionChanges: PermissionChange[],
  promptImpact: ImpactAnalysis['promptImpact']
): string[] {
  const recommendations: string[] = [];

  // Check for draft skills
  const draftSkills = affectedSkills.filter(s => s.state === 'draft');
  if (draftSkills.length > 0) {
    recommendations.push(`${draftSkills.length} skill(s) are in draft state - consider promoting before deployment`);
  }

  // Check for permission additions
  const addedPermissions = permissionChanges.filter(p => p.changeType === 'added');
  if (addedPermissions.length > 0) {
    recommendations.push(`${addedPermissions.length} new tool permission(s) added - review for security`);
  }

  // Check for prompt size increase
  if (promptImpact.percentChange > 20) {
    recommendations.push(`Prompt size increased by ${promptImpact.percentChange.toFixed(1)}% - may impact costs`);
  }

  // Check for deleted skills
  const deletedSkills = affectedSkills.filter(s => s.changeType === 'deleted');
  if (deletedSkills.length > 0) {
    recommendations.push(`${deletedSkills.length} skill(s) will be removed - ensure no dependencies`);
  }

  return recommendations;
}

/**
 * Assess risk level
 */
function assessRisk(
  affectedSkills: AffectedSkill[],
  permissionChanges: PermissionChange[],
  promptImpact: ImpactAnalysis['promptImpact']
): ImpactAnalysis['risk'] {
  const factors: string[] = [];
  let score = 0;

  // More affected skills = higher risk
  if (affectedSkills.length > 5) {
    factors.push(`Many skills affected (${affectedSkills.length})`);
    score += 2;
  } else if (affectedSkills.length > 2) {
    score += 1;
  }

  // Permission changes are risky
  if (permissionChanges.length > 0) {
    factors.push(`Permission changes (${permissionChanges.length})`);
    score += permissionChanges.length;
  }

  // Large prompt size changes are risky
  if (Math.abs(promptImpact.percentChange) > 30) {
    factors.push(`Large prompt size change (${promptImpact.percentChange.toFixed(1)}%)`);
    score += 2;
  }

  // Deleting skills is risky
  const deletedSkills = affectedSkills.filter(s => s.changeType === 'deleted');
  if (deletedSkills.length > 0) {
    factors.push(`Skills being deleted (${deletedSkills.length})`);
    score += deletedSkills.length;
  }

  // Draft skills in production are risky
  const draftSkills = affectedSkills.filter(s => s.state === 'draft');
  if (draftSkills.length > 0) {
    factors.push(`Draft skills affected (${draftSkills.length})`);
    score += draftSkills.length;
  }

  let level: 'low' | 'medium' | 'high';
  if (score < 2) {
    level = 'low';
  } else if (score < 5) {
    level = 'medium';
  } else {
    level = 'high';
  }

  return { level, factors };
}
