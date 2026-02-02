/**
 * Skill Registry
 *
 * SQLite-backed registry for versioned skills.
 * Supports publishing, fetching, and searching skills.
 * Designed for sharing across deployments.
 */

import { getDatabase } from '../core/db.js';
import {
  SkillManifest,
  SkillManifestSchema,
  calculateSkillChecksum,
  formatSkillForPrompt,
} from './skillManifest.js';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * Skill lifecycle states
 */
export type SkillState = 'draft' | 'tested' | 'approved' | 'active' | 'deprecated';

/**
 * Valid state transitions
 */
export const SkillStateTransitions: Record<SkillState, SkillState[]> = {
  draft: ['tested', 'deprecated'],
  tested: ['approved', 'draft', 'deprecated'],
  approved: ['active', 'tested', 'deprecated'],
  active: ['deprecated'],
  deprecated: [], // Terminal state
};

/**
 * A published skill in the registry
 */
export interface PublishedSkill {
  name: string;
  version: string;
  description: string;
  manifest: SkillManifest;
  instructions: string;
  checksum: string;
  publishedAt: string;
  publishedBy?: string;
  state: SkillState;
}

/**
 * Options for listing skills
 */
export interface SkillListOptions {
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  state?: SkillState;
  includeDeprecated?: boolean;
}

/**
 * Result of listing skills
 */
export interface SkillListResult {
  skills: PublishedSkill[];
  total: number;
  hasMore: boolean;
}

// ============================================================================
// Skill Registry Class
// ============================================================================

export class SkillRegistry {
  /**
   * Publish a skill to the registry
   * If the version already exists, it will be rejected (immutable)
   * Skills are published in 'draft' state by default
   */
  publish(
    manifest: SkillManifest,
    publishedBy?: string,
    initialState: SkillState = 'draft'
  ): PublishedSkill {
    const db = getDatabase();

    // Validate manifest
    const validated = SkillManifestSchema.parse(manifest);

    // Check if version already exists
    const existing = db
      .prepare('SELECT name, version FROM skill_registry WHERE name = ? AND version = ?')
      .get(validated.name, validated.version);

    if (existing) {
      throw new Error(
        `Skill ${validated.name}@${validated.version} already exists. Versions are immutable.`
      );
    }

    const checksum = calculateSkillChecksum(validated);
    const publishedAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO skill_registry (
        name, version, description, manifest, instructions, checksum, published_at, published_by, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      validated.name,
      validated.version,
      validated.description,
      JSON.stringify(validated),
      validated.instructions,
      checksum,
      publishedAt,
      publishedBy || null,
      initialState
    );

    return {
      name: validated.name,
      version: validated.version,
      description: validated.description,
      manifest: validated,
      instructions: validated.instructions,
      checksum,
      publishedAt,
      publishedBy,
      state: initialState,
    };
  }

  /**
   * Get a skill by name and version
   * If version is 'latest' or not provided, returns the latest version
   * By default, only returns active skills unless state is specified
   */
  get(name: string, version?: string, options?: { state?: SkillState; anyState?: boolean }): PublishedSkill | null {
    const db = getDatabase();

    let row: SkillRow | undefined;

    // Build state filter
    let stateClause = '';
    const stateParams: string[] = [];
    if (options?.state) {
      stateClause = ' AND state = ?';
      stateParams.push(options.state);
    } else if (!options?.anyState) {
      // Default: return active skills only for execution
      stateClause = ' AND state = ?';
      stateParams.push('active');
    }

    if (!version || version === 'latest') {
      // Get latest version (by semver sorting)
      row = db
        .prepare(
          `
          SELECT * FROM skill_registry 
          WHERE name = ? ${stateClause}
          ORDER BY 
            CAST(SUBSTR(version, 1, INSTR(version, '.') - 1) AS INTEGER) DESC,
            CAST(SUBSTR(SUBSTR(version, INSTR(version, '.') + 1), 1, 
              INSTR(SUBSTR(version, INSTR(version, '.') + 1), '.') - 1) AS INTEGER) DESC,
            CAST(SUBSTR(version, LENGTH(version) - INSTR(REVERSE(version), '.') + 2) AS INTEGER) DESC
          LIMIT 1
        `
        )
        .get(name, ...stateParams) as SkillRow | undefined;
    } else {
      row = db
        .prepare(`SELECT * FROM skill_registry WHERE name = ? AND version = ? ${stateClause}`)
        .get(name, version, ...stateParams) as SkillRow | undefined;
    }

    if (!row) return null;

    return this.rowToSkill(row);
  }

  /**
   * Get a skill by name and version without state filtering (for admin operations)
   */
  getAnyState(name: string, version?: string): PublishedSkill | null {
    return this.get(name, version, { anyState: true });
  }

  /**
   * List all versions of a skill
   */
  listVersions(name: string): string[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT version FROM skill_registry 
        WHERE name = ?
        ORDER BY published_at DESC
      `
      )
      .all(name) as { version: string }[];

    return rows.map((r) => r.version);
  }

  /**
   * Search skills
   */
  search(query: string, options?: SkillListOptions): SkillListResult {
    const db = getDatabase();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // Build WHERE clause for search
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query) {
      conditions.push('(name LIKE ? OR description LIKE ? OR instructions LIKE ?)');
      const searchTerm = `%${query}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Filter by state
    if (options?.state) {
      conditions.push('state = ?');
      params.push(options.state);
    } else if (!options?.includeDeprecated) {
      // By default, exclude deprecated skills
      conditions.push("state != 'deprecated'");
    }

    // Get latest version of each skill
    let whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total unique skills matching
    const countRow = db
      .prepare(
        `
        SELECT COUNT(DISTINCT name) as count 
        FROM skill_registry 
        ${whereClause}
      `
      )
      .get(...params) as { count: number };

    const total = countRow.count;

    // Get skills (latest version of each)
    const rows = db
      .prepare(
        `
        SELECT sr.* FROM skill_registry sr
        INNER JOIN (
          SELECT name, MAX(published_at) as max_published
          FROM skill_registry
          ${whereClause}
          GROUP BY name
        ) latest ON sr.name = latest.name AND sr.published_at = latest.max_published
        ORDER BY sr.name
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as SkillRow[];

    const skills = rows.map((row) => this.rowToSkill(row));

    return {
      skills,
      total,
      hasMore: offset + skills.length < total,
    };
  }

  /**
   * List all skills (latest versions only)
   */
  list(options?: SkillListOptions): SkillListResult {
    return this.search('', options);
  }

  /**
   * Delete a skill version (admin only, use with caution)
   */
  delete(name: string, version: string): boolean {
    const db = getDatabase();

    const result = db
      .prepare('DELETE FROM skill_registry WHERE name = ? AND version = ?')
      .run(name, version);

    return result.changes > 0;
  }

  /**
   * Delete all versions of a skill (admin only)
   */
  deleteAll(name: string): number {
    const db = getDatabase();

    const result = db
      .prepare('DELETE FROM skill_registry WHERE name = ?')
      .run(name);

    return result.changes;
  }

  /**
   * Check if a skill exists
   */
  exists(name: string, version?: string): boolean {
    const db = getDatabase();

    if (version) {
      const row = db
        .prepare('SELECT 1 FROM skill_registry WHERE name = ? AND version = ?')
        .get(name, version);
      return !!row;
    } else {
      const row = db
        .prepare('SELECT 1 FROM skill_registry WHERE name = ?')
        .get(name);
      return !!row;
    }
  }

  /**
   * Get skills formatted for prompt injection
   */
  getSkillsForPrompt(skillNames: string[]): string {
    const skills: SkillManifest[] = [];

    for (const name of skillNames) {
      const skill = this.get(name);
      if (skill) {
        skills.push(skill.manifest);
      }
    }

    return skills.map((s) => formatSkillForPrompt(s)).join('\n\n---\n\n');
  }

  /**
   * Get the current state of a skill
   */
  getState(name: string, version: string): SkillState | null {
    const skill = this.getAnyState(name, version);
    return skill?.state ?? null;
  }

  /**
   * Set the state of a skill (bypasses transition validation)
   * Use promote() for validated state transitions
   */
  setState(name: string, version: string, state: SkillState): boolean {
    const db = getDatabase();

    const result = db
      .prepare('UPDATE skill_registry SET state = ? WHERE name = ? AND version = ?')
      .run(state, name, version);

    return result.changes > 0;
  }

  /**
   * Promote a skill to a new state with validation
   * Only allows valid state transitions
   */
  promote(
    name: string,
    version: string,
    targetState: SkillState
  ): { success: boolean; error?: string; skill?: PublishedSkill } {
    const skill = this.getAnyState(name, version);

    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }

    const currentState = skill.state;
    const allowedTransitions = SkillStateTransitions[currentState];

    if (!allowedTransitions.includes(targetState)) {
      return {
        success: false,
        error: `Invalid state transition: ${currentState} -> ${targetState}. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      };
    }

    const updated = this.setState(name, version, targetState);
    if (!updated) {
      return { success: false, error: 'Failed to update state' };
    }

    // Return updated skill
    const updatedSkill = this.getAnyState(name, version);
    return { success: true, skill: updatedSkill ?? undefined };
  }

  /**
   * Get skills by state
   */
  getByState(state: SkillState, limit: number = 100): PublishedSkill[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT * FROM skill_registry 
        WHERE state = ?
        ORDER BY name, published_at DESC
        LIMIT ?
      `
      )
      .all(state, limit) as SkillRow[];

    return rows.map((row) => this.rowToSkill(row));
  }

  /**
   * Check if a skill is executable (state is 'active')
   */
  isExecutable(name: string, version?: string): boolean {
    const skill = this.get(name, version, { state: 'active' });
    return skill !== null;
  }

  /**
   * Convert database row to PublishedSkill
   */
  private rowToSkill(row: SkillRow): PublishedSkill {
    const manifest: SkillManifest = JSON.parse(row.manifest);

    return {
      name: row.name,
      version: row.version,
      description: row.description || manifest.description,
      manifest,
      instructions: row.instructions,
      checksum: row.checksum || '',
      publishedAt: row.published_at,
      publishedBy: row.published_by || undefined,
      state: (row.state as SkillState) || 'active',
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface SkillRow {
  name: string;
  version: string;
  description: string | null;
  manifest: string;
  instructions: string;
  checksum: string | null;
  published_at: string;
  published_by: string | null;
  state: string | null;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let skillRegistryInstance: SkillRegistry | null = null;

/**
 * Get or create the SkillRegistry instance
 */
export function getSkillRegistry(): SkillRegistry {
  if (!skillRegistryInstance) {
    skillRegistryInstance = new SkillRegistry();
  }
  return skillRegistryInstance;
}

/**
 * Reset the skill registry instance (for testing)
 */
export function resetSkillRegistry(): void {
  skillRegistryInstance = null;
}

// ============================================================================
// Helper for REVERSE function in SQLite
// ============================================================================

// Note: SQLite doesn't have REVERSE by default, so we use a simpler sorting approach
// The version sorting above is a best-effort semver sort
