/**
 * Workspace Environments Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceEnvironments, getWorkspaceEnvironments, resetWorkspaceEnvironments, type StandardEnvironment } from './workspaceEnvironments.js';
import { initDatabase, closeDatabase } from '../core/db.js';
import { resetWorkspacePins } from './workspacePins.js';

describe('WorkspaceEnvironments', () => {
  let envs: WorkspaceEnvironments;

  beforeEach(() => {
    process.env.WOMBAT_DB_PATH = ':memory:';
    initDatabase();
    envs = getWorkspaceEnvironments();
  });

  afterEach(() => {
    resetWorkspaceEnvironments();
    resetWorkspacePins();
    closeDatabase();
    delete process.env.WOMBAT_DB_PATH;
  });

  describe('upsertEnvironment', () => {
    it('should create a new environment', () => {
      const env = envs.upsertEnvironment('workspace-1', 'dev', {
        description: 'Development environment',
      });

      expect(env.workspaceId).toBe('workspace-1');
      expect(env.environment).toBe('dev');
      expect(env.description).toBe('Development environment');
    });

    it('should update existing environment', () => {
      envs.upsertEnvironment('workspace-1', 'dev', { description: 'Old' });
      const updated = envs.upsertEnvironment('workspace-1', 'dev', { description: 'New' });

      expect(updated.description).toBe('New');
    });

    it('should set version hash', () => {
      const env = envs.upsertEnvironment('workspace-1', 'dev', {
        versionHash: 'abc123',
      });

      expect(env.versionHash).toBe('abc123');
    });
  });

  describe('getEnvironment', () => {
    it('should return environment if exists', () => {
      envs.upsertEnvironment('workspace-1', 'prod', { description: 'Production' });

      const env = envs.getEnvironment('workspace-1', 'prod');

      expect(env).not.toBeNull();
      expect(env?.description).toBe('Production');
    });

    it('should return null if not exists', () => {
      const env = envs.getEnvironment('nonexistent', 'prod');
      expect(env).toBeNull();
    });
  });

  describe('listEnvironments', () => {
    it('should return all environments for workspace', () => {
      envs.upsertEnvironment('workspace-1', 'dev');
      envs.upsertEnvironment('workspace-1', 'staging');
      envs.upsertEnvironment('workspace-1', 'prod');

      const list = envs.listEnvironments('workspace-1');

      expect(list.length).toBe(3);
    });

    it('should not include environments from other workspaces', () => {
      envs.upsertEnvironment('workspace-1', 'dev');
      envs.upsertEnvironment('workspace-2', 'dev');

      const list = envs.listEnvironments('workspace-1');

      expect(list.length).toBe(1);
    });
  });

  describe('setDefaultEnvironment', () => {
    it('should set environment as default', () => {
      envs.upsertEnvironment('workspace-1', 'dev');
      envs.upsertEnvironment('workspace-1', 'prod');

      envs.setDefaultEnvironment('workspace-1', 'prod');

      const defaultEnv = envs.getDefaultEnvironment('workspace-1');
      expect(defaultEnv?.environment).toBe('prod');
    });

    it('should unset previous default', () => {
      envs.upsertEnvironment('workspace-1', 'dev');
      envs.upsertEnvironment('workspace-1', 'prod');

      envs.setDefaultEnvironment('workspace-1', 'dev');
      envs.setDefaultEnvironment('workspace-1', 'prod');

      const devEnv = envs.getEnvironment('workspace-1', 'dev');
      expect(devEnv?.isDefault).toBe(false);
    });
  });

  describe('lockEnvironment', () => {
    it('should lock environment', () => {
      envs.upsertEnvironment('workspace-1', 'prod');

      const locked = envs.lockEnvironment('workspace-1', 'prod');

      expect(locked).toBe(true);
      expect(envs.getEnvironment('workspace-1', 'prod')?.locked).toBe(true);
    });

    it('should return false for nonexistent environment', () => {
      const locked = envs.lockEnvironment('nonexistent', 'prod');
      expect(locked).toBe(false);
    });
  });

  describe('unlockEnvironment', () => {
    it('should unlock environment', () => {
      envs.upsertEnvironment('workspace-1', 'prod');
      envs.lockEnvironment('workspace-1', 'prod');

      const unlocked = envs.unlockEnvironment('workspace-1', 'prod');

      expect(unlocked).toBe(true);
      expect(envs.getEnvironment('workspace-1', 'prod')?.locked).toBe(false);
    });
  });

  describe('promote', () => {
    it('should copy version from source to target', () => {
      envs.upsertEnvironment('workspace-1', 'staging', { versionHash: 'abc123' });
      envs.upsertEnvironment('workspace-1', 'prod');

      const result = envs.promote('workspace-1', 'staging', 'prod');

      expect(result.success).toBe(true);
      expect(envs.getEnvironment('workspace-1', 'prod')?.versionHash).toBe('abc123');
    });

    it('should fail if source not found', () => {
      envs.upsertEnvironment('workspace-1', 'prod');

      const result = envs.promote('workspace-1', 'staging', 'prod');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if target is locked', () => {
      envs.upsertEnvironment('workspace-1', 'staging', { versionHash: 'abc123' });
      envs.upsertEnvironment('workspace-1', 'prod');
      envs.lockEnvironment('workspace-1', 'prod');

      const result = envs.promote('workspace-1', 'staging', 'prod');

      expect(result.success).toBe(false);
      expect(result.error).toContain('locked');
    });

    it('should create target if not exists', () => {
      envs.upsertEnvironment('workspace-1', 'staging', { versionHash: 'abc123' });

      const result = envs.promote('workspace-1', 'staging', 'prod');

      expect(result.success).toBe(true);
      expect(envs.getEnvironment('workspace-1', 'prod')).not.toBeNull();
    });
  });

  describe('initializeStandardEnvironments', () => {
    it('should create dev, staging, prod environments', () => {
      const created = envs.initializeStandardEnvironments('workspace-1');

      expect(created.length).toBe(3);
      expect(created.map(e => e.environment).sort()).toEqual(['dev', 'prod', 'staging']);
    });

    it('should set dev as default', () => {
      envs.initializeStandardEnvironments('workspace-1');

      const defaultEnv = envs.getDefaultEnvironment('workspace-1');
      expect(defaultEnv?.environment).toBe('dev');
    });

    it('should lock prod by default', () => {
      envs.initializeStandardEnvironments('workspace-1');

      const prod = envs.getEnvironment('workspace-1', 'prod');
      expect(prod?.locked).toBe(true);
    });
  });

  describe('deleteEnvironment', () => {
    it('should delete environment', () => {
      envs.upsertEnvironment('workspace-1', 'dev');

      const deleted = envs.deleteEnvironment('workspace-1', 'dev');

      expect(deleted).toBe(true);
      expect(envs.getEnvironment('workspace-1', 'dev')).toBeNull();
    });

    it('should return false for nonexistent', () => {
      const deleted = envs.deleteEnvironment('nonexistent', 'dev');
      expect(deleted).toBe(false);
    });

    it('should not delete locked environments', () => {
      envs.upsertEnvironment('workspace-1', 'prod');
      envs.lockEnvironment('workspace-1', 'prod');

      const deleted = envs.deleteEnvironment('workspace-1', 'prod');

      expect(deleted).toBe(false);
      expect(envs.getEnvironment('workspace-1', 'prod')).not.toBeNull();
    });
  });

  describe('StandardEnvironment type', () => {
    it('should accept standard environment values', () => {
      const env: StandardEnvironment = 'dev';
      expect(env).toBe('dev');

      const staging: StandardEnvironment = 'staging';
      expect(staging).toBe('staging');

      const prod: StandardEnvironment = 'prod';
      expect(prod).toBe('prod');
    });
  });
});
