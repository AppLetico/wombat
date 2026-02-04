import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Set test database path before importing db module
const TEST_DB_DIR = join(process.cwd(), '.test-db');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');
process.env.CLASPER_DB_PATH = TEST_DB_PATH;

import { getDatabase, initDatabase, closeDatabase, getDatabaseStats } from './db.js';

describe('Database', () => {
  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + '-wal')) {
      unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (existsSync(TEST_DB_PATH + '-shm')) {
      unlinkSync(TEST_DB_PATH + '-shm');
    }
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + '-wal')) {
      unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (existsSync(TEST_DB_PATH + '-shm')) {
      unlinkSync(TEST_DB_PATH + '-shm');
    }
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  });

  describe('getDatabase', () => {
    it('should create database file', () => {
      getDatabase();
      expect(existsSync(TEST_DB_PATH)).toBe(true);
    });

    it('should return same instance on multiple calls', () => {
      const db1 = getDatabase();
      const db2 = getDatabase();
      expect(db1).toBe(db2);
    });
  });

  describe('initDatabase', () => {
    it('should create all required tables', () => {
      initDatabase();
      const db = getDatabase();

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('traces');
      expect(tableNames).toContain('audit_log');
      expect(tableNames).toContain('skill_registry');
      expect(tableNames).toContain('tenant_budgets');
      expect(tableNames).toContain('workspace_versions');
      expect(tableNames).toContain('eval_results');
    });

    it('should be idempotent', () => {
      initDatabase();
      initDatabase(); // Should not throw
      const db = getDatabase();

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all();

      expect(tables.length).toBeGreaterThan(0);
    });
  });

  describe('getDatabaseStats', () => {
    it('should return stats with table info', () => {
      initDatabase();
      const stats = getDatabaseStats();

      expect(stats.path).toBe(TEST_DB_PATH);
      expect(stats.tables).toBeDefined();
      expect(stats.tables.length).toBeGreaterThan(0);
    });

    it('should show row counts for tables', () => {
      initDatabase();
      const stats = getDatabaseStats();

      const tracesTable = stats.tables.find((t) => t.name === 'traces');
      expect(tracesTable).toBeDefined();
      expect(tracesTable?.rowCount).toBe(0);
    });
  });
});
