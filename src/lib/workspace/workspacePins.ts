/**
 * Workspace Pins
 *
 * Pin workspace versions, skill versions, and models to prevent silent upgrades.
 * Supports environment-specific pins (dev, staging, prod).
 */

import { getDatabase } from '../core/db.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Environment names for pinning
 */
export type WorkspaceEnvironment = 'dev' | 'staging' | 'prod' | 'default' | string;

/**
 * A workspace pin configuration
 */
export interface WorkspacePin {
  id: number;
  workspaceId: string;
  environment: WorkspaceEnvironment;
  versionHash: string;
  skillPins: Record<string, string>; // skill name -> version
  modelPin?: string;
  providerPin?: string;
  pinnedAt: string;
  pinnedBy?: string;
}

/**
 * Options for creating a pin
 */
export interface PinOptions {
  workspaceId: string;
  environment?: WorkspaceEnvironment;
  versionHash: string;
  skillPins?: Record<string, string>;
  modelPin?: string;
  providerPin?: string;
  pinnedBy?: string;
}

// ============================================================================
// Workspace Pins Class
// ============================================================================

export class WorkspacePins {
  /**
   * Pin a workspace version (creates or updates)
   */
  pin(options: PinOptions): WorkspacePin {
    const db = getDatabase();
    const environment = options.environment || 'default';

    // Check if pin exists for this workspace/environment
    const existing = this.get(options.workspaceId, environment);

    if (existing) {
      // Update existing pin
      const stmt = db.prepare(`
        UPDATE workspace_pins SET
          version_hash = ?,
          skill_pins = ?,
          model_pin = ?,
          provider_pin = ?,
          pinned_at = datetime('now'),
          pinned_by = ?
        WHERE workspace_id = ? AND environment = ?
      `);

      stmt.run(
        options.versionHash,
        JSON.stringify(options.skillPins || {}),
        options.modelPin || null,
        options.providerPin || null,
        options.pinnedBy || null,
        options.workspaceId,
        environment
      );

      return this.get(options.workspaceId, environment)!;
    } else {
      // Create new pin
      const stmt = db.prepare(`
        INSERT INTO workspace_pins (
          workspace_id, environment, version_hash, skill_pins, model_pin, provider_pin, pinned_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        options.workspaceId,
        environment,
        options.versionHash,
        JSON.stringify(options.skillPins || {}),
        options.modelPin || null,
        options.providerPin || null,
        options.pinnedBy || null
      );

      return {
        id: result.lastInsertRowid as number,
        workspaceId: options.workspaceId,
        environment,
        versionHash: options.versionHash,
        skillPins: options.skillPins || {},
        modelPin: options.modelPin,
        providerPin: options.providerPin,
        pinnedAt: new Date().toISOString(),
        pinnedBy: options.pinnedBy,
      };
    }
  }

  /**
   * Get pin for a workspace/environment
   */
  get(workspaceId: string, environment: WorkspaceEnvironment = 'default'): WorkspacePin | null {
    const db = getDatabase();

    const row = db
      .prepare(
        `SELECT * FROM workspace_pins WHERE workspace_id = ? AND environment = ?`
      )
      .get(workspaceId, environment) as PinRow | undefined;

    if (!row) return null;

    return this.rowToPin(row);
  }

  /**
   * Get all pins for a workspace
   */
  listForWorkspace(workspaceId: string): WorkspacePin[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `SELECT * FROM workspace_pins WHERE workspace_id = ? ORDER BY environment`
      )
      .all(workspaceId) as PinRow[];

    return rows.map(this.rowToPin);
  }

  /**
   * Get pins by environment across all workspaces
   */
  listByEnvironment(environment: WorkspaceEnvironment): WorkspacePin[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `SELECT * FROM workspace_pins WHERE environment = ? ORDER BY workspace_id`
      )
      .all(environment) as PinRow[];

    return rows.map(this.rowToPin);
  }

  /**
   * Pin a specific skill version
   */
  pinSkill(
    workspaceId: string,
    skillName: string,
    skillVersion: string,
    environment: WorkspaceEnvironment = 'default'
  ): boolean {
    const pin = this.get(workspaceId, environment);
    if (!pin) return false;

    const skillPins = { ...pin.skillPins, [skillName]: skillVersion };

    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE workspace_pins SET skill_pins = ? WHERE workspace_id = ? AND environment = ?`
      )
      .run(JSON.stringify(skillPins), workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Unpin a specific skill
   */
  unpinSkill(
    workspaceId: string,
    skillName: string,
    environment: WorkspaceEnvironment = 'default'
  ): boolean {
    const pin = this.get(workspaceId, environment);
    if (!pin) return false;

    const skillPins = { ...pin.skillPins };
    delete skillPins[skillName];

    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE workspace_pins SET skill_pins = ? WHERE workspace_id = ? AND environment = ?`
      )
      .run(JSON.stringify(skillPins), workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Pin a model
   */
  pinModel(
    workspaceId: string,
    model: string,
    provider?: string,
    environment: WorkspaceEnvironment = 'default'
  ): boolean {
    const db = getDatabase();

    const result = db
      .prepare(
        `UPDATE workspace_pins SET model_pin = ?, provider_pin = ? WHERE workspace_id = ? AND environment = ?`
      )
      .run(model, provider || null, workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Unpin a model
   */
  unpinModel(
    workspaceId: string,
    environment: WorkspaceEnvironment = 'default'
  ): boolean {
    const db = getDatabase();

    const result = db
      .prepare(
        `UPDATE workspace_pins SET model_pin = NULL, provider_pin = NULL WHERE workspace_id = ? AND environment = ?`
      )
      .run(workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Remove a pin entirely
   */
  unpin(workspaceId: string, environment: WorkspaceEnvironment = 'default'): boolean {
    const db = getDatabase();

    const result = db
      .prepare(
        `DELETE FROM workspace_pins WHERE workspace_id = ? AND environment = ?`
      )
      .run(workspaceId, environment);

    return result.changes > 0;
  }

  /**
   * Remove all pins for a workspace
   */
  unpinAll(workspaceId: string): number {
    const db = getDatabase();

    const result = db
      .prepare(`DELETE FROM workspace_pins WHERE workspace_id = ?`)
      .run(workspaceId);

    return result.changes;
  }

  /**
   * Check if a workspace is pinned
   */
  isPinned(workspaceId: string, environment: WorkspaceEnvironment = 'default'): boolean {
    const pin = this.get(workspaceId, environment);
    return pin !== null;
  }

  /**
   * Get the pinned skill version (if any)
   */
  getPinnedSkillVersion(
    workspaceId: string,
    skillName: string,
    environment: WorkspaceEnvironment = 'default'
  ): string | null {
    const pin = this.get(workspaceId, environment);
    if (!pin) return null;

    return pin.skillPins[skillName] || null;
  }

  /**
   * Get the pinned model (if any)
   */
  getPinnedModel(
    workspaceId: string,
    environment: WorkspaceEnvironment = 'default'
  ): { model: string; provider?: string } | null {
    const pin = this.get(workspaceId, environment);
    if (!pin || !pin.modelPin) return null;

    return {
      model: pin.modelPin,
      provider: pin.providerPin,
    };
  }

  /**
   * Get stats about pins
   */
  getStats(): {
    totalPins: number;
    byEnvironment: Record<string, number>;
    workspacesWithPins: number;
  } {
    const db = getDatabase();

    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM workspace_pins`)
      .get() as { count: number };

    const byEnvRows = db
      .prepare(
        `SELECT environment, COUNT(*) as count FROM workspace_pins GROUP BY environment`
      )
      .all() as { environment: string; count: number }[];

    const workspacesRow = db
      .prepare(`SELECT COUNT(DISTINCT workspace_id) as count FROM workspace_pins`)
      .get() as { count: number };

    const byEnvironment: Record<string, number> = {};
    for (const row of byEnvRows) {
      byEnvironment[row.environment] = row.count;
    }

    return {
      totalPins: totalRow.count,
      byEnvironment,
      workspacesWithPins: workspacesRow.count,
    };
  }

  /**
   * Convert database row to WorkspacePin
   */
  private rowToPin(row: PinRow): WorkspacePin {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      environment: row.environment,
      versionHash: row.version_hash,
      skillPins: JSON.parse(row.skill_pins || '{}'),
      modelPin: row.model_pin || undefined,
      providerPin: row.provider_pin || undefined,
      pinnedAt: row.pinned_at,
      pinnedBy: row.pinned_by || undefined,
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface PinRow {
  id: number;
  workspace_id: string;
  environment: string;
  version_hash: string;
  skill_pins: string;
  model_pin: string | null;
  provider_pin: string | null;
  pinned_at: string;
  pinned_by: string | null;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: WorkspacePins | null = null;

/**
 * Get the WorkspacePins instance
 */
export function getWorkspacePins(): WorkspacePins {
  if (!instance) {
    instance = new WorkspacePins();
  }
  return instance;
}

/**
 * Reset the instance (for testing)
 */
export function resetWorkspacePins(): void {
  instance = null;
}
