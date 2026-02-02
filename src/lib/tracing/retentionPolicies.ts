/**
 * Trace Retention Policies
 *
 * Per-tenant configuration for trace retention.
 * Features:
 * - Configurable retention duration
 * - Sampling strategies (full, partial, sampled)
 * - Storage modes (full, summary)
 * - Automatic cleanup
 */

import { getDatabase } from '../core/db.js';
import { getTraceStore } from './traceStore.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Sampling strategies
 */
export type SamplingStrategy = 'full' | 'sampled' | 'errors_only';

/**
 * Storage modes
 */
export type StorageMode = 'full' | 'summary' | 'minimal';

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  tenantId: string;
  retentionDays: number;
  samplingStrategy: SamplingStrategy;
  storageMode: StorageMode;
  createdAt: string;
  updatedAt: string;
}

/**
 * Policy enforcement result
 */
export interface EnforcementResult {
  tenantId: string;
  tracesDeleted: number;
  cutoffDate: string;
  duration: number;
}

/**
 * Default policy values
 */
export const DefaultPolicy: Omit<RetentionPolicy, 'tenantId' | 'createdAt' | 'updatedAt'> = {
  retentionDays: 90,
  samplingStrategy: 'full',
  storageMode: 'full',
};

// ============================================================================
// Retention Policies Class
// ============================================================================

export class RetentionPolicies {
  /**
   * Set or update a retention policy for a tenant
   */
  setPolicy(tenantId: string, policy: Partial<Omit<RetentionPolicy, 'tenantId' | 'createdAt' | 'updatedAt'>>): RetentionPolicy {
    const db = getDatabase();
    const now = new Date().toISOString();

    const retentionDays = policy.retentionDays ?? DefaultPolicy.retentionDays;
    const samplingStrategy = policy.samplingStrategy ?? DefaultPolicy.samplingStrategy;
    const storageMode = policy.storageMode ?? DefaultPolicy.storageMode;

    const stmt = db.prepare(`
      INSERT INTO tenant_retention_policies (
        tenant_id, retention_days, sampling_strategy, storage_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        retention_days = excluded.retention_days,
        sampling_strategy = excluded.sampling_strategy,
        storage_mode = excluded.storage_mode,
        updated_at = excluded.updated_at
    `);

    stmt.run(tenantId, retentionDays, samplingStrategy, storageMode, now, now);

    return this.getPolicy(tenantId)!;
  }

  /**
   * Get retention policy for a tenant
   */
  getPolicy(tenantId: string): RetentionPolicy | null {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM tenant_retention_policies WHERE tenant_id = ?')
      .get(tenantId) as PolicyRow | undefined;

    if (!row) return null;

    return this.rowToPolicy(row);
  }

  /**
   * Get policy or return default
   */
  getPolicyOrDefault(tenantId: string): RetentionPolicy {
    const policy = this.getPolicy(tenantId);
    if (policy) return policy;

    // Return default policy (not saved)
    const now = new Date().toISOString();
    return {
      tenantId,
      ...DefaultPolicy,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Delete retention policy for a tenant
   */
  deletePolicy(tenantId: string): boolean {
    const db = getDatabase();

    const result = db
      .prepare('DELETE FROM tenant_retention_policies WHERE tenant_id = ?')
      .run(tenantId);

    return result.changes > 0;
  }

  /**
   * List all retention policies
   */
  listPolicies(): RetentionPolicy[] {
    const db = getDatabase();

    const rows = db
      .prepare('SELECT * FROM tenant_retention_policies ORDER BY tenant_id')
      .all() as PolicyRow[];

    return rows.map(this.rowToPolicy);
  }

  /**
   * Enforce retention policy for a tenant
   */
  enforcePolicy(tenantId: string): EnforcementResult {
    const startTime = Date.now();
    const policy = this.getPolicyOrDefault(tenantId);

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
    const cutoffIso = cutoffDate.toISOString();

    // Delete old traces
    const traceStore = getTraceStore();
    const tracesDeleted = traceStore.deleteOlderThan(cutoffIso, tenantId);

    const duration = Date.now() - startTime;

    return {
      tenantId,
      tracesDeleted,
      cutoffDate: cutoffIso,
      duration,
    };
  }

  /**
   * Enforce retention policies for all tenants with configured policies
   */
  enforceAllPolicies(): EnforcementResult[] {
    const policies = this.listPolicies();
    const results: EnforcementResult[] = [];

    for (const policy of policies) {
      const result = this.enforcePolicy(policy.tenantId);
      results.push(result);
    }

    return results;
  }

  /**
   * Get tenants with traces older than their retention policy
   */
  getTenantsNeedingCleanup(): { tenantId: string; oldTraceCount: number; retentionDays: number }[] {
    const db = getDatabase();
    const policies = this.listPolicies();
    const results: { tenantId: string; oldTraceCount: number; retentionDays: number }[] = [];

    for (const policy of policies) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
      const cutoffIso = cutoffDate.toISOString();

      const countRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM traces WHERE tenant_id = ? AND started_at < ?`
        )
        .get(policy.tenantId, cutoffIso) as { count: number };

      if (countRow.count > 0) {
        results.push({
          tenantId: policy.tenantId,
          oldTraceCount: countRow.count,
          retentionDays: policy.retentionDays,
        });
      }
    }

    return results;
  }

  /**
   * Check if a trace should be retained based on sampling strategy
   */
  shouldRetainTrace(
    tenantId: string,
    hasError: boolean,
    sampleRate: number = 0.1
  ): boolean {
    const policy = this.getPolicyOrDefault(tenantId);

    switch (policy.samplingStrategy) {
      case 'full':
        return true;
      case 'errors_only':
        return hasError;
      case 'sampled':
        return hasError || Math.random() < sampleRate;
      default:
        return true;
    }
  }

  /**
   * Get stats about retention
   */
  getStats(): {
    totalPolicies: number;
    avgRetentionDays: number;
    tenantsNeedingCleanup: number;
  } {
    const policies = this.listPolicies();
    const needingCleanup = this.getTenantsNeedingCleanup();

    const avgRetention =
      policies.length > 0
        ? policies.reduce((sum, p) => sum + p.retentionDays, 0) / policies.length
        : 0;

    return {
      totalPolicies: policies.length,
      avgRetentionDays: Math.round(avgRetention),
      tenantsNeedingCleanup: needingCleanup.length,
    };
  }

  /**
   * Convert database row to policy
   */
  private rowToPolicy(row: PolicyRow): RetentionPolicy {
    return {
      tenantId: row.tenant_id,
      retentionDays: row.retention_days,
      samplingStrategy: row.sampling_strategy as SamplingStrategy,
      storageMode: row.storage_mode as StorageMode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface PolicyRow {
  tenant_id: string;
  retention_days: number;
  sampling_strategy: string;
  storage_mode: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: RetentionPolicies | null = null;

/**
 * Get the RetentionPolicies instance
 */
export function getRetentionPolicies(): RetentionPolicies {
  if (!instance) {
    instance = new RetentionPolicies();
  }
  return instance;
}

/**
 * Reset the instance (for testing)
 */
export function resetRetentionPolicies(): void {
  instance = null;
}
