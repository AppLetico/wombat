/**
 * Trace Annotations
 *
 * Append-only metadata for traces. Annotations are immutable once created.
 * Use for tagging traces with labels like: baseline, incident, regression, approved.
 */

import { getDatabase } from '../core/db.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A single annotation on a trace
 */
export interface TraceAnnotation {
  id: number;
  traceId: string;
  key: string;
  value: string;
  createdAt: string;
  createdBy: string | null;
}

/**
 * Standard annotation keys
 */
export const StandardAnnotationKeys = {
  BASELINE: 'baseline',
  INCIDENT: 'incident',
  REGRESSION: 'regression',
  APPROVED: 'approved',
  REVIEWED: 'reviewed',
  NOTE: 'note',
  TAG: 'tag',
} as const;

// ============================================================================
// Trace Annotations Class
// ============================================================================

export class TraceAnnotations {
  /**
   * Add an annotation to a trace (append-only)
   */
  annotate(
    traceId: string,
    key: string,
    value: string,
    createdBy?: string
  ): TraceAnnotation {
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT INTO trace_annotations (trace_id, key, value, created_by)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(traceId, key, value, createdBy || null);

    return {
      id: result.lastInsertRowid as number,
      traceId,
      key,
      value,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    };
  }

  /**
   * Get all annotations for a trace
   */
  getForTrace(traceId: string): TraceAnnotation[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT * FROM trace_annotations 
        WHERE trace_id = ? 
        ORDER BY created_at ASC
      `
      )
      .all(traceId) as AnnotationRow[];

    return rows.map(this.rowToAnnotation);
  }

  /**
   * Get annotations by key (across all traces)
   */
  getByKey(key: string, limit: number = 100): TraceAnnotation[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT * FROM trace_annotations 
        WHERE key = ? 
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .all(key, limit) as AnnotationRow[];

    return rows.map(this.rowToAnnotation);
  }

  /**
   * Find traces with a specific annotation
   */
  findTraces(key: string, value?: string): string[] {
    const db = getDatabase();

    let stmt;
    let rows;

    if (value !== undefined) {
      stmt = db.prepare(`
        SELECT DISTINCT trace_id FROM trace_annotations 
        WHERE key = ? AND value = ?
      `);
      rows = stmt.all(key, value) as { trace_id: string }[];
    } else {
      stmt = db.prepare(`
        SELECT DISTINCT trace_id FROM trace_annotations 
        WHERE key = ?
      `);
      rows = stmt.all(key) as { trace_id: string }[];
    }

    return rows.map((r) => r.trace_id);
  }

  /**
   * Check if a trace has a specific annotation
   */
  hasAnnotation(traceId: string, key: string, value?: string): boolean {
    const db = getDatabase();

    let stmt;
    let result;

    if (value !== undefined) {
      stmt = db.prepare(`
        SELECT 1 FROM trace_annotations 
        WHERE trace_id = ? AND key = ? AND value = ?
        LIMIT 1
      `);
      result = stmt.get(traceId, key, value);
    } else {
      stmt = db.prepare(`
        SELECT 1 FROM trace_annotations 
        WHERE trace_id = ? AND key = ?
        LIMIT 1
      `);
      result = stmt.get(traceId, key);
    }

    return !!result;
  }

  /**
   * Get annotation counts by key
   */
  getStats(): { key: string; count: number }[] {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT key, COUNT(*) as count 
        FROM trace_annotations 
        GROUP BY key 
        ORDER BY count DESC
      `
      )
      .all() as { key: string; count: number }[];

    return rows;
  }

  /**
   * Convert database row to annotation
   */
  private rowToAnnotation(row: AnnotationRow): TraceAnnotation {
    return {
      id: row.id,
      traceId: row.trace_id,
      key: row.key,
      value: row.value,
      createdAt: row.created_at,
      createdBy: row.created_by,
    };
  }
}

// ============================================================================
// Types for Database Rows
// ============================================================================

interface AnnotationRow {
  id: number;
  trace_id: string;
  key: string;
  value: string;
  created_at: string;
  created_by: string | null;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: TraceAnnotations | null = null;

/**
 * Get the TraceAnnotations instance
 */
export function getTraceAnnotations(): TraceAnnotations {
  if (!instance) {
    instance = new TraceAnnotations();
  }
  return instance;
}

/**
 * Reset the instance (for testing)
 */
export function resetTraceAnnotations(): void {
  instance = null;
}
