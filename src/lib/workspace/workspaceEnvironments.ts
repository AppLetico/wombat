/**
 * Workspace Environments
 *
 * Support for dev, staging, prod environments.
 * Features:
 * - Environment-specific configurations
 * - Promotion flow between environments
 * - Environment-aware workspace loading
 */

import { getDatabase } from '../core/db.js';
import { getWorkspacePins, type WorkspacePin } from './workspacePins.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Standard environment names
 */
export type StandardEnvironment = 'dev' | 'staging' | 'prod';

/**
 * Environment configuration
 */
export interface WorkspaceEnvConfig {
  id: number;
  workspaceId: string;
  environment: string;
  description?: string;
  versionHash?: string;
  isDefault: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Environment promotion result
 */
export interface PromotionResult {
  success: boolean;
  sourceEnv: string;
  targetEnv: string;
  versionHash?: string;
  error?: string;
}

/**
 * Standard promotion paths
 */
export const StandardPromotionPaths: Record<StandardEnvironment, StandardEnvironment | null> = {
  dev: 'staging',
  staging: 'prod',
  prod: null, // Can't promote from prod
};

// ============================================================================
// Workspace Environments Class
// ============================================================================

export class WorkspaceEnvironments {
  /**
   * Create or update an environment
   */
  upsertEnvironment(
    workspaceId: string,
    environment: string,
    options?: {
      description?: string;
      versionHash?: string;
      isDefault?: boolean;
      locked?: boolean;
    }
  ): WorkspaceEnvConfig {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Check if exists
    const existing = this.getEnvironment(workspaceId, environment);

    if (existing) {
      // Update
      const updateFields: string[] = ['updated_at = ?'];
      const updateParams: unknown[] = [now];

      if (options?.description !== undefined) {
        updateFields.push('description = ?');
        updateParams.push(options.description);
      }
      if (options?.versionHash !== undefined) {
        updateFields.push('version_hash = ?');
        updateParams.push(options.versionHash);
      }
      if (options?.isDefault !== undefined) {
        updateFields.push('is_default = ?');
        updateParams.push(options.isDefault ? 1 : 0);
      }
      if (options?.locked !== undefined) {
        updateFields.push('locked = ?');
        updateParams.push(options.locked ? 1 : 0);
      }

      updateParams.push(workspaceId, environment);

      db.prepare(`
        UPDATE workspace_environments 
        SET ${updateFields.join(', ')}
        WHERE workspace_id = ? AND environment = ?
      `).run(...updateParams);

      return this.getEnvironment(workspaceId, environment)!;
    } else {
      // Insert
      const stmt = db.prepare(`
        INSERT INTO workspace_environments (
          workspace_id, environment, description, version_hash, is_default, locked, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        workspaceId,
        environment,
        options?.description || null,
        options?.versionHash || null,
        options?.isDefault ? 1 : 0,
        options?.locked ? 1 : 0,
        now,
        now
      );

      return this.getEnvironment(workspaceId, environment)!;
    }
  }

  /**
   * Get an environment
   */
  getEnvironment(workspaceId: string, environment: string): WorkspaceEnvConfig | null {
    const db = getDatabase();

    const row = db
      .prepare(
        `SELECT * FROM workspace_environments WHERE workspace_id = ? AND environment = ?`
      )
      .get(workspaceId, environment) as EnvRow | undefined;

    if (!row) return null;

    return this.rowToEnvironment(row);
  }

  /**
   * List all environments for a workspace
   */
  listEnvironments(workspaceId: string): WorkspaceEnvConfig[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `SELECT * FROM workspace_environments WHERE workspace_id = ? ORDER BY 
          CASE environment 
            WHEN 'dev' THEN 1 
            WHEN 'staging' THEN 2 
            WHEN 'prod' THEN 3 
            ELSE 4 
          END, environment`
      )
      .all(workspaceId) as EnvRow[];

    return rows.map(this.rowToEnvironment);
  }

  /**
   * Get default environment for a workspace
   */
  getDefaultEnvironment(workspaceId: string): WorkspaceEnvConfig | null {
    const db = getDatabase();

    const row = db
      .prepare(
        `SELECT * FROM workspace_environments WHERE workspace_id = ? AND is_default = 1 LIMIT 1`
      )
      .get(workspaceId) as EnvRow | undefined;

    if (!row) return null;

    return this.rowToEnvironment(row);
  }

  /**
   * Set an environment as default
   */
  setDefaultEnvironment(workspaceId: string, environment: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Clear current default
    db.prepare(
      `UPDATE workspace_environments SET is_default = 0, updated_at = ? WHERE workspace_id = ?`
    ).run(now, workspaceId);

    // Set new default
    const result = db
      .prepare(
        `UPDATE workspace_environments SET is_default = 1, updated_at = ? WHERE workspace_id = ? AND environment = ?`
      )
      .run(now, workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Lock an environment (prevent changes)
   */
  lockEnvironment(workspaceId: string, environment: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = db
      .prepare(
        `UPDATE workspace_environments SET locked = 1, updated_at = ? WHERE workspace_id = ? AND environment = ?`
      )
      .run(now, workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Unlock an environment
   */
  unlockEnvironment(workspaceId: string, environment: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = db
      .prepare(
        `UPDATE workspace_environments SET locked = 0, updated_at = ? WHERE workspace_id = ? AND environment = ?`
      )
      .run(now, workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Promote from one environment to another
   */
  promote(
    workspaceId: string,
    sourceEnv: string,
    targetEnv?: string
  ): PromotionResult {
    // Determine target environment
    const target =
      targetEnv || StandardPromotionPaths[sourceEnv as StandardEnvironment];

    if (!target) {
      return {
        success: false,
        sourceEnv,
        targetEnv: targetEnv || 'unknown',
        error: `No promotion target for environment: ${sourceEnv}`,
      };
    }

    // Check source exists and has a version
    const source = this.getEnvironment(workspaceId, sourceEnv);
    if (!source) {
      return {
        success: false,
        sourceEnv,
        targetEnv: target,
        error: `Source environment ${sourceEnv} not found`,
      };
    }

    if (!source.versionHash) {
      return {
        success: false,
        sourceEnv,
        targetEnv: target,
        error: `Source environment ${sourceEnv} has no version pinned`,
      };
    }

    // Check target is not locked
    const targetEnvRecord = this.getEnvironment(workspaceId, target);
    if (targetEnvRecord?.locked) {
      return {
        success: false,
        sourceEnv,
        targetEnv: target,
        error: `Target environment ${target} is locked`,
      };
    }

    // Create or update target environment with source's version
    this.upsertEnvironment(workspaceId, target, {
      versionHash: source.versionHash,
    });

    // Also update the workspace pin for this environment
    const pins = getWorkspacePins();
    pins.pin({
      workspaceId,
      environment: target,
      versionHash: source.versionHash,
    });

    return {
      success: true,
      sourceEnv,
      targetEnv: target,
      versionHash: source.versionHash,
    };
  }

  /**
   * Initialize standard environments for a workspace
   */
  initializeStandardEnvironments(
    workspaceId: string,
    defaultEnv: StandardEnvironment = 'dev'
  ): WorkspaceEnvConfig[] {
    const envs: WorkspaceEnvConfig[] = [];

    for (const env of ['dev', 'staging', 'prod'] as StandardEnvironment[]) {
      const created = this.upsertEnvironment(workspaceId, env, {
        description: `${env.charAt(0).toUpperCase() + env.slice(1)} environment`,
        isDefault: env === defaultEnv,
        locked: env === 'prod', // Lock prod by default
      });
      envs.push(created);
    }

    return envs;
  }

  /**
   * Delete an environment
   */
  deleteEnvironment(workspaceId: string, environment: string): boolean {
    const db = getDatabase();

    // Check if locked
    const env = this.getEnvironment(workspaceId, environment);
    if (env?.locked) {
      return false; // Can't delete locked environment
    }

    const result = db
      .prepare(
        `DELETE FROM workspace_environments WHERE workspace_id = ? AND environment = ?`
      )
      .run(workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Get environment with its associated pin
   */
  getEnvironmentWithPin(
    workspaceId: string,
    environment: string
  ): { environment: WorkspaceEnvConfig | null; pin: WorkspacePin | null } {
    const env = this.getEnvironment(workspaceId, environment);
    const pins = getWorkspacePins();
    const pin = pins.get(workspaceId, environment);

    return { environment: env, pin };
  }

  /**
   * Convert database row to environment
   */
  private rowToEnvironment(row: EnvRow): WorkspaceEnvConfig {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      environment: row.environment,
      description: row.description || undefined,
      versionHash: row.version_hash || undefined,
      isDefault: row.is_default === 1,
      locked: row.locked === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface EnvRow {
  id: number;
  workspace_id: string;
  environment: string;
  description: string | null;
  version_hash: string | null;
  is_default: number;
  locked: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: WorkspaceEnvironments | null = null;

/**
 * Get the WorkspaceEnvironments instance
 */
export function getWorkspaceEnvironments(): WorkspaceEnvironments {
  if (!instance) {
    instance = new WorkspaceEnvironments();
  }
  return instance;
}

/**
 * Reset the instance (for testing)
 */
export function resetWorkspaceEnvironments(): void {
  instance = null;
}
