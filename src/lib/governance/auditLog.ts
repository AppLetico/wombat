/**
 * Audit Log
 *
 * Immutable, append-only log of events for compliance and debugging.
 * Stored in SQLite with no UPDATE/DELETE operations exposed.
 */

import { getDatabase } from '../core/db.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Types of events that can be logged
 */
export type AuditEventType =
  | 'agent_execution_started'
  | 'agent_execution_completed'
  | 'agent_execution_failed'
  | 'tool_call_requested'
  | 'tool_call_succeeded'
  | 'tool_call_failed'
  | 'tool_permission_denied'
  | 'skill_published'
  | 'skill_test_run'
  | 'skill_state_changed'
  | 'skill_deprecated_used'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'workspace_change'
  | 'auth_success'
  | 'auth_failure'
  | 'rate_limit_exceeded'
  | 'config_change'
  | 'system_startup'
  | 'system_shutdown'
  | 'ops_override_used';

/**
 * An entry in the audit log
 */
export interface AuditEntry {
  id: number;
  tenantId: string;
  workspaceId?: string;
  traceId?: string;
  userId?: string;
  eventType: AuditEventType;
  eventData: Record<string, unknown>;
  createdAt: string;
}

/**
 * Options for querying the audit log
 */
export interface AuditQueryOptions {
  tenantId: string;
  workspaceId?: string;
  traceId?: string;
  userId?: string;
  eventType?: AuditEventType;
  eventTypes?: AuditEventType[];
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Result of querying the audit log
 */
export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * Statistics about audit log entries
 */
export interface AuditStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  oldestEntry?: string;
  newestEntry?: string;
}

// ============================================================================
// Audit Log Class
// ============================================================================

export class AuditLog {
  /**
   * Log an event (append-only, no modification allowed)
   */
  log(
    eventType: AuditEventType,
    data: {
      tenantId: string;
      workspaceId?: string;
      traceId?: string;
      userId?: string;
      eventData?: Record<string, unknown>;
    }
  ): number {
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT INTO audit_log (
        tenant_id, workspace_id, trace_id, event_type, event_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.tenantId,
      data.workspaceId || null,
      data.traceId || null,
      eventType,
      JSON.stringify(data.eventData || {}),
      new Date().toISOString()
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Query the audit log
   */
  query(options: AuditQueryOptions): AuditQueryResult {
    const db = getDatabase();
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    // Build WHERE clause
    const conditions: string[] = ['tenant_id = ?'];
    const params: unknown[] = [options.tenantId];

    if (options.workspaceId) {
      conditions.push('workspace_id = ?');
      params.push(options.workspaceId);
    }

    if (options.traceId) {
      conditions.push('trace_id = ?');
      params.push(options.traceId);
    }

    if (options.userId) {
      conditions.push("json_extract(event_data, '$.user_id') = ?");
      params.push(options.userId);
    }

    if (options.eventType) {
      conditions.push('event_type = ?');
      params.push(options.eventType);
    }

    if (options.eventTypes && options.eventTypes.length > 0) {
      const placeholders = options.eventTypes.map(() => '?').join(', ');
      conditions.push(`event_type IN (${placeholders})`);
      params.push(...options.eventTypes);
    }

    if (options.startDate) {
      conditions.push('created_at >= ?');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('created_at <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${whereClause}`)
      .get(...params) as { count: number };

    const total = countRow.count;

    // Get entries
    const rows = db
      .prepare(
        `
        SELECT * FROM audit_log
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as AuditRow[];

    const entries = rows.map((row) => this.rowToEntry(row));

    return {
      entries,
      total,
      hasMore: offset + entries.length < total,
    };
  }

  /**
   * Get entries for a specific trace
   */
  getByTrace(traceId: string): AuditEntry[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT * FROM audit_log
        WHERE trace_id = ?
        ORDER BY created_at ASC
      `
      )
      .all(traceId) as AuditRow[];

    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Get statistics for a tenant
   */
  getStats(tenantId: string, startDate?: string, endDate?: string): AuditStats {
    const db = getDatabase();

    const conditions: string[] = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${whereClause}`)
      .get(...params) as { count: number };

    // Get counts by type
    const typeRows = db
      .prepare(
        `
        SELECT event_type, COUNT(*) as count
        FROM audit_log
        WHERE ${whereClause}
        GROUP BY event_type
      `
      )
      .all(...params) as { event_type: string; count: number }[];

    const entriesByType: Record<string, number> = {};
    for (const row of typeRows) {
      entriesByType[row.event_type] = row.count;
    }

    // Get date range
    const rangeRow = db
      .prepare(
        `
        SELECT MIN(created_at) as oldest, MAX(created_at) as newest
        FROM audit_log
        WHERE ${whereClause}
      `
      )
      .get(...params) as { oldest: string | null; newest: string | null };

    return {
      totalEntries: countRow.count,
      entriesByType,
      oldestEntry: rangeRow.oldest || undefined,
      newestEntry: rangeRow.newest || undefined,
    };
  }

  /**
   * Purge old entries (for maintenance, use with caution)
   * Note: This is the only way to remove entries, and should only be
   * used for compliance-approved retention policies.
   */
  purgeOlderThan(date: string, tenantId?: string): number {
    const db = getDatabase();

    let stmt;
    if (tenantId) {
      stmt = db.prepare(
        'DELETE FROM audit_log WHERE created_at < ? AND tenant_id = ?'
      );
      return stmt.run(date, tenantId).changes;
    } else {
      stmt = db.prepare('DELETE FROM audit_log WHERE created_at < ?');
      return stmt.run(date).changes;
    }
  }

  /**
   * Convert database row to AuditEntry
   */
  private rowToEntry(row: AuditRow): AuditEntry {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id || undefined,
      traceId: row.trace_id || undefined,
      eventType: row.event_type as AuditEventType,
      eventData: JSON.parse(row.event_data),
      createdAt: row.created_at,
    };
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface AuditRow {
  id: number;
  tenant_id: string;
  workspace_id: string | null;
  trace_id: string | null;
  event_type: string;
  event_data: string;
  created_at: string;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let auditLogInstance: AuditLog | null = null;

/**
 * Get or create the AuditLog instance
 */
export function getAuditLog(): AuditLog {
  if (!auditLogInstance) {
    auditLogInstance = new AuditLog();
  }
  return auditLogInstance;
}

/**
 * Reset the audit log instance (for testing)
 */
export function resetAuditLog(): void {
  auditLogInstance = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick log function for common events
 */
export function auditLog(
  eventType: AuditEventType,
  data: {
    tenantId: string;
    workspaceId?: string;
    traceId?: string;
    userId?: string;
    eventData?: Record<string, unknown>;
  }
): void {
  getAuditLog().log(eventType, data);
}

/**
 * Log an agent execution start
 */
export function logAgentStart(
  tenantId: string,
  traceId: string,
  data: {
    workspaceId?: string;
    userId?: string;
    model?: string;
    agentRole?: string;
  }
): void {
  auditLog('agent_execution_started', {
    tenantId,
    traceId,
    workspaceId: data.workspaceId,
    eventData: {
      user_id: data.userId,
      model: data.model,
      agent_role: data.agentRole,
    },
  });
}

/**
 * Log an agent execution completion
 */
export function logAgentComplete(
  tenantId: string,
  traceId: string,
  data: {
    workspaceId?: string;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    toolCallCount?: number;
  }
): void {
  auditLog('agent_execution_completed', {
    tenantId,
    traceId,
    workspaceId: data.workspaceId,
    eventData: {
      duration_ms: data.durationMs,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      cost: data.cost,
      tool_call_count: data.toolCallCount,
    },
  });
}

/**
 * Log a tool call
 */
export function logToolCall(
  tenantId: string,
  traceId: string,
  data: {
    workspaceId?: string;
    toolName: string;
    success: boolean;
    durationMs?: number;
    error?: string;
  }
): void {
  const eventType = data.success ? 'tool_call_succeeded' : 'tool_call_failed';
  auditLog(eventType, {
    tenantId,
    traceId,
    workspaceId: data.workspaceId,
    eventData: {
      tool_name: data.toolName,
      duration_ms: data.durationMs,
      error: data.error,
    },
  });
}

/**
 * Log a permission denial
 */
export function logPermissionDenied(
  tenantId: string,
  traceId: string,
  data: {
    workspaceId?: string;
    toolName: string;
    reason: string;
    skillName?: string;
  }
): void {
  auditLog('tool_permission_denied', {
    tenantId,
    traceId,
    workspaceId: data.workspaceId,
    eventData: {
      tool_name: data.toolName,
      reason: data.reason,
      skill_name: data.skillName,
    },
  });
}

/**
 * Log a break-glass override usage.
 * Captures actor, role, action, and structured justification.
 */
export function logOverrideUsed(
  tenantId: string,
  data: {
    workspaceId?: string;
    actor: string;
    role: string;
    action: string;
    targetId: string;
    reasonCode: string;
    justification: string;
  }
): void {
  auditLog('ops_override_used', {
    tenantId,
    workspaceId: data.workspaceId,
    eventData: {
      actor: data.actor,
      role: data.role,
      action: data.action,
      target_id: data.targetId,
      reason_code: data.reasonCode,
      justification: data.justification,
      timestamp: new Date().toISOString(),
    },
  });
}
