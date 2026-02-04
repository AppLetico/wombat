/**
 * Retention Policies Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RetentionPolicies, getRetentionPolicies, resetRetentionPolicies, DefaultPolicy } from './retentionPolicies.js';
import { initDatabase, closeDatabase, getDatabase } from '../core/db.js';
import { TraceStore, getTraceStore, resetTraceStore } from './traceStore.js';

describe('RetentionPolicies', () => {
  let policies: RetentionPolicies;

  beforeEach(() => {
    process.env.CLASPER_DB_PATH = ':memory:';
    initDatabase();
    policies = getRetentionPolicies();
  });

  afterEach(() => {
    resetRetentionPolicies();
    resetTraceStore();
    closeDatabase();
    delete process.env.CLASPER_DB_PATH;
  });

  describe('setPolicy', () => {
    it('should create a new policy', () => {
      const policy = policies.setPolicy('tenant-1', {
        retentionDays: 30,
        samplingStrategy: 'full',
        storageMode: 'full',
      });

      expect(policy.tenantId).toBe('tenant-1');
      expect(policy.retentionDays).toBe(30);
      expect(policy.samplingStrategy).toBe('full');
    });

    it('should use defaults for unspecified fields', () => {
      const policy = policies.setPolicy('tenant-1', {});

      expect(policy.retentionDays).toBe(DefaultPolicy.retentionDays);
      expect(policy.samplingStrategy).toBe(DefaultPolicy.samplingStrategy);
      expect(policy.storageMode).toBe(DefaultPolicy.storageMode);
    });

    it('should update existing policy', () => {
      policies.setPolicy('tenant-1', { retentionDays: 30 });
      const updated = policies.setPolicy('tenant-1', { retentionDays: 60 });

      expect(updated.retentionDays).toBe(60);
    });
  });

  describe('getPolicy', () => {
    it('should return policy if exists', () => {
      policies.setPolicy('tenant-1', { retentionDays: 45 });

      const policy = policies.getPolicy('tenant-1');

      expect(policy).not.toBeNull();
      expect(policy?.retentionDays).toBe(45);
    });

    it('should return null if not exists', () => {
      const policy = policies.getPolicy('nonexistent');
      expect(policy).toBeNull();
    });
  });

  describe('getPolicyOrDefault', () => {
    it('should return policy if exists', () => {
      policies.setPolicy('tenant-1', { retentionDays: 45 });

      const policy = policies.getPolicyOrDefault('tenant-1');

      expect(policy.retentionDays).toBe(45);
    });

    it('should return default policy if not exists', () => {
      const policy = policies.getPolicyOrDefault('nonexistent');

      expect(policy.tenantId).toBe('nonexistent');
      expect(policy.retentionDays).toBe(DefaultPolicy.retentionDays);
    });
  });

  describe('deletePolicy', () => {
    it('should delete existing policy', () => {
      policies.setPolicy('tenant-1', { retentionDays: 30 });

      const deleted = policies.deletePolicy('tenant-1');

      expect(deleted).toBe(true);
      expect(policies.getPolicy('tenant-1')).toBeNull();
    });

    it('should return false for nonexistent policy', () => {
      const deleted = policies.deletePolicy('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('listPolicies', () => {
    it('should return all policies', () => {
      policies.setPolicy('tenant-1', { retentionDays: 30 });
      policies.setPolicy('tenant-2', { retentionDays: 60 });

      const list = policies.listPolicies();

      expect(list.length).toBe(2);
    });
  });

  describe('enforcePolicy', () => {
    it('should delete traces older than retention period', () => {
      // Create policy
      policies.setPolicy('tenant-1', { retentionDays: 30 });

      // Create old trace
      const db = getDatabase();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);

      db.prepare(`
        INSERT INTO traces (id, tenant_id, workspace_id, started_at, model, provider, input_message, input_message_count, input_tokens, output_tokens, total_cost, steps, tool_calls, skill_versions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('old-trace', 'tenant-1', 'workspace-1', oldDate.toISOString(), 'gpt-4', 'openai', 'Hello', 0, 100, 50, 0.01, '[]', '[]', '{}');

      // Create new trace
      db.prepare(`
        INSERT INTO traces (id, tenant_id, workspace_id, started_at, model, provider, input_message, input_message_count, input_tokens, output_tokens, total_cost, steps, tool_calls, skill_versions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('new-trace', 'tenant-1', 'workspace-1', new Date().toISOString(), 'gpt-4', 'openai', 'Hello', 0, 100, 50, 0.01, '[]', '[]', '{}');

      const result = policies.enforcePolicy('tenant-1');

      expect(result.tracesDeleted).toBe(1);
      expect(result.tenantId).toBe('tenant-1');

      // Verify old trace is deleted
      const traceStore = getTraceStore();
      expect(traceStore.get('old-trace')).toBeNull();
      expect(traceStore.get('new-trace')).not.toBeNull();
    });
  });

  describe('shouldRetainTrace', () => {
    it('should always retain with full strategy', () => {
      policies.setPolicy('tenant-1', { samplingStrategy: 'full' });

      expect(policies.shouldRetainTrace('tenant-1', false)).toBe(true);
      expect(policies.shouldRetainTrace('tenant-1', true)).toBe(true);
    });

    it('should only retain errors with errors_only strategy', () => {
      policies.setPolicy('tenant-1', { samplingStrategy: 'errors_only' });

      expect(policies.shouldRetainTrace('tenant-1', false)).toBe(false);
      expect(policies.shouldRetainTrace('tenant-1', true)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return retention stats', () => {
      policies.setPolicy('tenant-1', { retentionDays: 30 });
      policies.setPolicy('tenant-2', { retentionDays: 60 });

      const stats = policies.getStats();

      expect(stats.totalPolicies).toBe(2);
      expect(stats.avgRetentionDays).toBe(45);
    });
  });
});
