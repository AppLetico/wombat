/**
 * Workspace Pins Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspacePins, getWorkspacePins, resetWorkspacePins } from './workspacePins.js';
import { initDatabase, closeDatabase } from '../core/db.js';

describe('WorkspacePins', () => {
  let pins: WorkspacePins;

  beforeEach(() => {
    process.env.CLASPER_DB_PATH = ':memory:';
    initDatabase();
    pins = getWorkspacePins();
  });

  afterEach(() => {
    resetWorkspacePins();
    closeDatabase();
    delete process.env.CLASPER_DB_PATH;
  });

  describe('pin', () => {
    it('should create a new pin', () => {
      const pin = pins.pin({
        workspaceId: 'workspace-1',
        versionHash: 'abc123',
        environment: 'prod',
        pinnedBy: 'user@example.com',
      });

      expect(pin.workspaceId).toBe('workspace-1');
      expect(pin.versionHash).toBe('abc123');
      expect(pin.environment).toBe('prod');
      expect(pin.pinnedBy).toBe('user@example.com');
    });

    it('should default to "default" environment', () => {
      const pin = pins.pin({
        workspaceId: 'workspace-1',
        versionHash: 'abc123',
      });

      expect(pin.environment).toBe('default');
    });

    it('should update existing pin for same workspace+env', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });
      const updated = pins.pin({ workspaceId: 'workspace-1', versionHash: 'def456', environment: 'prod' });

      expect(updated.versionHash).toBe('def456');
    });

    it('should allow different pins per environment', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'dev' });
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'def456', environment: 'prod' });

      const devPin = pins.get('workspace-1', 'dev');
      const prodPin = pins.get('workspace-1', 'prod');

      expect(devPin?.versionHash).toBe('abc123');
      expect(prodPin?.versionHash).toBe('def456');
    });
  });

  describe('get', () => {
    it('should return pin if exists', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });

      const pin = pins.get('workspace-1', 'prod');

      expect(pin).not.toBeNull();
      expect(pin?.versionHash).toBe('abc123');
    });

    it('should return null if not pinned', () => {
      const pin = pins.get('nonexistent', 'prod');
      expect(pin).toBeNull();
    });
  });

  describe('listForWorkspace', () => {
    it('should return all pins for a workspace', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'dev' });
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'def456', environment: 'staging' });
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'ghi789', environment: 'prod' });

      const list = pins.listForWorkspace('workspace-1');

      expect(list.length).toBe(3);
    });

    it('should return empty array if no pins', () => {
      const list = pins.listForWorkspace('nonexistent');
      expect(list).toEqual([]);
    });
  });

  describe('pinSkill', () => {
    it('should add skill pin to existing workspace pin', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });

      const success = pins.pinSkill('workspace-1', 'my-skill', '1.2.0', 'prod');

      expect(success).toBe(true);
      const pin = pins.get('workspace-1', 'prod');
      expect(pin?.skillPins['my-skill']).toBe('1.2.0');
    });

    it('should return false if no pin exists', () => {
      const success = pins.pinSkill('nonexistent', 'my-skill', '1.2.0', 'prod');
      expect(success).toBe(false);
    });

    it('should add multiple skill pins', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });
      pins.pinSkill('workspace-1', 'skill-a', '1.0.0', 'prod');
      pins.pinSkill('workspace-1', 'skill-b', '2.0.0', 'prod');

      const pin = pins.get('workspace-1', 'prod');

      expect(pin?.skillPins['skill-a']).toBe('1.0.0');
      expect(pin?.skillPins['skill-b']).toBe('2.0.0');
    });
  });

  describe('unpinSkill', () => {
    it('should remove skill pin', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod', skillPins: { 'my-skill': '1.2.0' } });

      const success = pins.unpinSkill('workspace-1', 'my-skill', 'prod');

      expect(success).toBe(true);
      const pin = pins.get('workspace-1', 'prod');
      expect(pin?.skillPins['my-skill']).toBeUndefined();
    });

    it('should return false if no pin exists', () => {
      const result = pins.unpinSkill('nonexistent', 'my-skill', 'prod');
      expect(result).toBe(false);
    });
  });

  describe('pinModel', () => {
    it('should set model pin', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });

      const success = pins.pinModel('workspace-1', 'gpt-4', 'openai', 'prod');

      expect(success).toBe(true);
      const pin = pins.get('workspace-1', 'prod');
      expect(pin?.modelPin).toBe('gpt-4');
      expect(pin?.providerPin).toBe('openai');
    });
  });

  describe('unpinModel', () => {
    it('should clear model pin', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod', modelPin: 'gpt-4', providerPin: 'openai' });

      const success = pins.unpinModel('workspace-1', 'prod');

      expect(success).toBe(true);
      const pin = pins.get('workspace-1', 'prod');
      expect(pin?.modelPin).toBeUndefined();
      expect(pin?.providerPin).toBeUndefined();
    });
  });

  describe('unpin', () => {
    it('should remove pin', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });

      const deleted = pins.unpin('workspace-1', 'prod');

      expect(deleted).toBe(true);
      expect(pins.get('workspace-1', 'prod')).toBeNull();
    });

    it('should return false if not pinned', () => {
      const deleted = pins.unpin('nonexistent', 'prod');
      expect(deleted).toBe(false);
    });
  });

  describe('isPinned', () => {
    it('should return true if pinned', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });

      expect(pins.isPinned('workspace-1', 'prod')).toBe(true);
    });

    it('should return false if not pinned', () => {
      expect(pins.isPinned('nonexistent', 'prod')).toBe(false);
    });
  });

  describe('getPinnedSkillVersion', () => {
    it('should return pinned skill version', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod', skillPins: { 'my-skill': '1.2.0' } });

      const version = pins.getPinnedSkillVersion('workspace-1', 'my-skill', 'prod');

      expect(version).toBe('1.2.0');
    });

    it('should return null if skill not pinned', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'prod' });

      const version = pins.getPinnedSkillVersion('workspace-1', 'my-skill', 'prod');

      expect(version).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return pin statistics', () => {
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'abc123', environment: 'dev' });
      pins.pin({ workspaceId: 'workspace-1', versionHash: 'def456', environment: 'prod' });

      const stats = pins.getStats();

      expect(stats.totalPins).toBe(2);
      expect(stats.workspacesWithPins).toBe(1);
    });
  });
});
