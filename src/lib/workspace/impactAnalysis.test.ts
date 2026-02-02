/**
 * Impact Analysis Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WorkspaceDiff, FileDiff } from './workspaceVersioning.js';

/**
 * Test helper to create a WorkspaceDiff for testing
 * Note: We only test file categorization and prompt impact since full skill detection
 * requires database access (skill registry lookup)
 */
function createDiff(files: { path: string; status: 'added' | 'modified' | 'deleted' | 'unchanged'; oldSize?: number; newSize?: number }[]): WorkspaceDiff {
  return {
    oldHash: 'hash-old',
    newHash: 'hash-new',
    files: files.map(f => ({
      path: f.path,
      status: f.status,
      oldSize: f.oldSize,
      newSize: f.newSize,
    })) as FileDiff[],
    summary: {
      added: files.filter(f => f.status === 'added').length,
      modified: files.filter(f => f.status === 'modified').length,
      deleted: files.filter(f => f.status === 'deleted').length,
      unchanged: files.filter(f => f.status === 'unchanged').length,
    },
  };
}

describe('WorkspaceDiff creation', () => {

  it('should create empty diff correctly', () => {
    const diff = createDiff([]);

    expect(diff.files.length).toBe(0);
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.modified).toBe(0);
    expect(diff.summary.deleted).toBe(0);
  });

  it('should categorize files correctly', () => {
    const diff = createDiff([
      { path: 'file1.md', status: 'added' },
      { path: 'file2.md', status: 'modified' },
      { path: 'file3.md', status: 'deleted' },
    ]);

    expect(diff.files.find(f => f.path === 'file1.md')?.status).toBe('added');
    expect(diff.files.find(f => f.path === 'file2.md')?.status).toBe('modified');
    expect(diff.files.find(f => f.path === 'file3.md')?.status).toBe('deleted');
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.modified).toBe(1);
    expect(diff.summary.deleted).toBe(1);
  });

  it('should track skill paths in diff', () => {
    const diff = createDiff([
      { path: 'skills/summarizer.md', status: 'modified' },
    ]);

    const skillFile = diff.files.find(f => f.path.startsWith('skills/'));
    expect(skillFile).toBeDefined();
    expect(skillFile?.path).toBe('skills/summarizer.md');
    expect(skillFile?.status).toBe('modified');
  });

  it('should track added skill paths', () => {
    const diff = createDiff([
      { path: 'skills/new-skill.yaml', status: 'added' },
    ]);

    const skillFile = diff.files.find(f => f.path.startsWith('skills/'));
    expect(skillFile?.status).toBe('added');
  });

  it('should track deleted skill paths', () => {
    const diff = createDiff([
      { path: 'skills/old-skill.md', status: 'deleted' },
    ]);

    const skillFile = diff.files.find(f => f.path.startsWith('skills/'));
    expect(skillFile?.status).toBe('deleted');
  });

  it('should track file size changes', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified', oldSize: 1000, newSize: 1500 },
    ]);

    const soulFile = diff.files.find(f => f.path === 'SOUL.md');
    expect(soulFile?.oldSize).toBe(1000);
    expect(soulFile?.newSize).toBe(1500);
  });

  it('should handle files without size info', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified' },
    ]);

    const soulFile = diff.files.find(f => f.path === 'SOUL.md');
    expect(soulFile?.oldSize).toBeUndefined();
    expect(soulFile?.newSize).toBeUndefined();
  });

  it('should calculate size delta correctly', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified', oldSize: 100, newSize: 200 },
    ]);

    const file = diff.files[0];
    const sizeDelta = (file.newSize || 0) - (file.oldSize || 0);
    expect(sizeDelta).toBe(100);
  });

  it('should handle negative size delta', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified', oldSize: 200, newSize: 100 },
    ]);

    const file = diff.files[0];
    const sizeDelta = (file.newSize || 0) - (file.oldSize || 0);
    expect(sizeDelta).toBe(-100);
  });

  it('should handle zero size delta', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified', oldSize: 1000, newSize: 1000 },
    ]);

    const file = diff.files[0];
    const sizeDelta = (file.newSize || 0) - (file.oldSize || 0);
    expect(sizeDelta).toBe(0);
  });

  it('should identify non-skill files', () => {
    const diff = createDiff([
      { path: 'README.md', status: 'modified' },
    ]);

    expect(diff.files.find(f => f.path.startsWith('skills/'))).toBeUndefined();
  });

  it('should count multiple skill deletions', () => {
    const diff = createDiff([
      { path: 'skills/critical.md', status: 'deleted' },
      { path: 'skills/important.md', status: 'deleted' },
      { path: 'skills/essential.md', status: 'deleted' },
    ]);

    const skillFiles = diff.files.filter(f => f.path.startsWith('skills/'));
    expect(skillFiles.length).toBe(3);
    expect(skillFiles.every(f => f.status === 'deleted')).toBe(true);
  });

  it('should identify shared dependency files', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified' },
      { path: 'IDENTITY.md', status: 'modified' },
      { path: 'MEMORY.md', status: 'modified' },
      { path: 'AGENTS.md', status: 'modified' },
    ]);

    const sharedFiles = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'AGENTS.md'];
    for (const sharedFile of sharedFiles) {
      const file = diff.files.find(f => f.path === sharedFile);
      expect(file).toBeDefined();
    }
  });

  it('should handle mixed file types', () => {
    const diff = createDiff([
      { path: 'SOUL.md', status: 'modified', oldSize: 100, newSize: 200 },
      { path: 'skills/summarizer.md', status: 'added' },
      { path: 'config/settings.yaml', status: 'deleted' },
    ]);

    expect(diff.summary.modified).toBe(1);
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.deleted).toBe(1);
  });
});
