/**
 * Trace Annotations Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TraceAnnotations, getTraceAnnotations, resetTraceAnnotations, StandardAnnotationKeys } from './traceAnnotations.js';
import { initDatabase, closeDatabase, getDatabase } from '../core/db.js';

describe('TraceAnnotations', () => {
  let annotations: TraceAnnotations;

  beforeEach(() => {
    // Use in-memory database for tests
    process.env.WOMBAT_DB_PATH = ':memory:';
    initDatabase();
    annotations = getTraceAnnotations();

    // Create a mock trace for testing
    const db = getDatabase();
    db.prepare(`
      INSERT INTO traces (id, tenant_id, workspace_id, started_at, model, provider, input_message, input_message_count, input_tokens, output_tokens, total_cost, steps, tool_calls, skill_versions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('trace-1', 'tenant-1', 'workspace-1', new Date().toISOString(), 'gpt-4', 'openai', 'Hello', 0, 100, 50, 0.01, '[]', '[]', '{}');
  });

  afterEach(() => {
    resetTraceAnnotations();
    closeDatabase();
    delete process.env.WOMBAT_DB_PATH;
  });

  describe('annotate', () => {
    it('should add an annotation to a trace', () => {
      const annotation = annotations.annotate('trace-1', 'baseline', 'true');

      expect(annotation.traceId).toBe('trace-1');
      expect(annotation.key).toBe('baseline');
      expect(annotation.value).toBe('true');
      expect(annotation.id).toBeGreaterThan(0);
    });

    it('should record creator', () => {
      const annotation = annotations.annotate('trace-1', 'note', 'Important', 'user@example.com');

      expect(annotation.createdBy).toBe('user@example.com');
    });

    it('should allow multiple annotations on the same trace', () => {
      annotations.annotate('trace-1', 'baseline', 'true');
      annotations.annotate('trace-1', 'reviewed', 'true');
      annotations.annotate('trace-1', 'note', 'Looks good');

      const traceAnnotations = annotations.getForTrace('trace-1');
      expect(traceAnnotations.length).toBe(3);
    });
  });

  describe('getForTrace', () => {
    it('should return all annotations for a trace in order', () => {
      annotations.annotate('trace-1', 'baseline', 'true');
      annotations.annotate('trace-1', 'reviewed', 'true');

      const result = annotations.getForTrace('trace-1');

      expect(result.length).toBe(2);
      expect(result[0].key).toBe('baseline');
      expect(result[1].key).toBe('reviewed');
    });

    it('should return empty array for trace with no annotations', () => {
      const result = annotations.getForTrace('trace-nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('getByKey', () => {
    it('should return annotations by key across traces', () => {
      // Create another trace
      const db = getDatabase();
      db.prepare(`
        INSERT INTO traces (id, tenant_id, workspace_id, started_at, model, provider, input_message, input_message_count, input_tokens, output_tokens, total_cost, steps, tool_calls, skill_versions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('trace-2', 'tenant-1', 'workspace-1', new Date().toISOString(), 'gpt-4', 'openai', 'Hello', 0, 100, 50, 0.01, '[]', '[]', '{}');

      annotations.annotate('trace-1', 'baseline', 'true');
      annotations.annotate('trace-2', 'baseline', 'false');

      const result = annotations.getByKey('baseline');

      expect(result.length).toBe(2);
    });
  });

  describe('findTraces', () => {
    it('should find traces with specific annotation key', () => {
      annotations.annotate('trace-1', 'incident', 'INC-123');

      const result = annotations.findTraces('incident');

      expect(result).toContain('trace-1');
    });

    it('should find traces with specific key and value', () => {
      annotations.annotate('trace-1', 'status', 'approved');

      const approved = annotations.findTraces('status', 'approved');
      const pending = annotations.findTraces('status', 'pending');

      expect(approved).toContain('trace-1');
      expect(pending).not.toContain('trace-1');
    });
  });

  describe('hasAnnotation', () => {
    it('should return true if annotation exists', () => {
      annotations.annotate('trace-1', 'baseline', 'true');

      expect(annotations.hasAnnotation('trace-1', 'baseline')).toBe(true);
      expect(annotations.hasAnnotation('trace-1', 'other')).toBe(false);
    });

    it('should check value when provided', () => {
      annotations.annotate('trace-1', 'status', 'approved');

      expect(annotations.hasAnnotation('trace-1', 'status', 'approved')).toBe(true);
      expect(annotations.hasAnnotation('trace-1', 'status', 'rejected')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return annotation counts by key', () => {
      annotations.annotate('trace-1', 'baseline', 'true');
      annotations.annotate('trace-1', 'note', 'First note');
      annotations.annotate('trace-1', 'note', 'Second note');

      const stats = annotations.getStats();

      expect(stats.find(s => s.key === 'note')?.count).toBe(2);
      expect(stats.find(s => s.key === 'baseline')?.count).toBe(1);
    });
  });

  describe('StandardAnnotationKeys', () => {
    it('should have expected keys', () => {
      expect(StandardAnnotationKeys.BASELINE).toBe('baseline');
      expect(StandardAnnotationKeys.INCIDENT).toBe('incident');
      expect(StandardAnnotationKeys.REGRESSION).toBe('regression');
      expect(StandardAnnotationKeys.APPROVED).toBe('approved');
    });
  });
});
