/**
 * SQLite Database Infrastructure
 *
 * Provides a single-file SQLite database for:
 * - Traces (agent execution traces)
 * - Audit log (immutable event log)
 * - Skill registry (versioned skills)
 * - Tenant budgets (cost controls)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Database singleton
let db: Database.Database | null = null;

/**
 * Get the database path from environment or default
 */
function getDbPath(): string {
  return process.env.WOMBAT_DB_PATH || './wombat.db';
}

/**
 * Get or create the database connection
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return db;
}

/**
 * Initialize all database tables
 */
export function initDatabase(): void {
  const db = getDatabase();

  // Traces table - stores agent execution traces
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      agent_role TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      model TEXT,
      provider TEXT,
      workspace_hash TEXT,
      input_message TEXT,
      input_message_count INTEGER DEFAULT 0,
      output_message TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      steps JSON,
      tool_calls JSON,
      skill_versions JSON,
      redacted_prompt TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_traces_tenant
      ON traces(tenant_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_traces_workspace
      ON traces(workspace_id, started_at DESC);
  `);

  // Audit log table - immutable event log
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT,
      trace_id TEXT,
      event_type TEXT NOT NULL,
      event_data JSON NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_tenant
      ON audit_log(tenant_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_type
      ON audit_log(event_type, created_at DESC);
  `);

  // Skill registry table - versioned skills
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_registry (
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT,
      manifest JSON NOT NULL,
      instructions TEXT NOT NULL,
      checksum TEXT,
      published_at TEXT DEFAULT (datetime('now')),
      published_by TEXT,
      PRIMARY KEY (name, version)
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name
      ON skill_registry(name, published_at DESC);
  `);

  // Tenant budgets table - cost controls
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_budgets (
      tenant_id TEXT PRIMARY KEY,
      budget_usd REAL NOT NULL,
      spent_usd REAL DEFAULT 0,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      hard_limit BOOLEAN DEFAULT 1,
      alert_threshold REAL DEFAULT 0.8,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Workspace versions table - for workspace versioning
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_versions (
      hash TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      files JSON NOT NULL,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_versions
      ON workspace_versions(workspace_id, created_at DESC);
  `);

  // Eval results table - for evaluation framework
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      dataset_name TEXT NOT NULL,
      skill_name TEXT,
      skill_version TEXT,
      model TEXT NOT NULL,
      scores JSON NOT NULL,
      cases JSON NOT NULL,
      drift JSON,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_eval_results
      ON eval_results(dataset_name, created_at DESC);
  `);

  // Trace annotations table - append-only metadata for traces
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_trace_annotations_trace
      ON trace_annotations(trace_id);

    CREATE INDEX IF NOT EXISTS idx_trace_annotations_key
      ON trace_annotations(key, created_at DESC);
  `);

  // Tenant retention policies table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_retention_policies (
      tenant_id TEXT PRIMARY KEY,
      retention_days INTEGER NOT NULL DEFAULT 90,
      sampling_strategy TEXT DEFAULT 'full',
      storage_mode TEXT DEFAULT 'full',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Workspace pins table - for pinning specific versions
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'default',
      version_hash TEXT NOT NULL,
      skill_pins JSON DEFAULT '{}',
      model_pin TEXT,
      provider_pin TEXT,
      pinned_at TEXT DEFAULT (datetime('now')),
      pinned_by TEXT,
      UNIQUE(workspace_id, environment)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_pins_workspace
      ON workspace_pins(workspace_id);
  `);

  // Workspace environments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      description TEXT,
      version_hash TEXT,
      is_default INTEGER DEFAULT 0,
      locked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(workspace_id, environment)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_envs
      ON workspace_environments(workspace_id);
  `);

  // Run migrations for existing databases
  runLabelsColumnMigration();
  runSkillStateColumnMigration();
  runTraceLinkingMigration();
  runV121IndexMigration();
}

/**
 * Migration to add v1.2.1 operational hardening indexes
 * - risk_level column (stored, not computed) for efficient filtering
 * - has_error computed index for error filtering
 * - trace_annotations key+value composite index
 */
function runV121IndexMigration(): void {
  const database = getDatabase();

  // Check if risk_level column exists
  const traceColumns = database
    .prepare("PRAGMA table_info(traces)")
    .all() as { name: string }[];

  const hasRiskLevel = traceColumns.some((c) => c.name === 'risk_level');

  if (!hasRiskLevel) {
    // Add risk_level column for stored risk levels
    database.exec(`
      ALTER TABLE traces ADD COLUMN risk_level TEXT DEFAULT 'low';
    `);
  }

  // Create indexes for common filter patterns (idempotent with IF NOT EXISTS)
  database.exec(`
    -- Index for risk level filtering
    CREATE INDEX IF NOT EXISTS idx_traces_risk_level
      ON traces(tenant_id, risk_level, started_at DESC);

    -- Index for error filtering (error IS NOT NULL)
    CREATE INDEX IF NOT EXISTS idx_traces_has_error
      ON traces(tenant_id, error, started_at DESC) WHERE error IS NOT NULL;

    -- Composite index for annotation key+value queries
    CREATE INDEX IF NOT EXISTS idx_trace_annotations_key_value
      ON trace_annotations(key, value, created_at DESC);

    -- Index for audit log by workspace
    CREATE INDEX IF NOT EXISTS idx_audit_workspace
      ON audit_log(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
  `);
}

/**
 * Migration to add labels column to traces table
 */
function runLabelsColumnMigration(): void {
  const database = getDatabase();

  // Check if labels column exists
  const columns = database
    .prepare("PRAGMA table_info(traces)")
    .all() as { name: string }[];

  const hasLabels = columns.some((c) => c.name === 'labels');

  if (!hasLabels) {
    database.exec(`
      ALTER TABLE traces ADD COLUMN labels JSON DEFAULT '{}';
    `);
  }
}

/**
 * Migration to add state column to skill_registry table
 */
function runSkillStateColumnMigration(): void {
  const database = getDatabase();

  // Check if state column exists
  const columns = database
    .prepare("PRAGMA table_info(skill_registry)")
    .all() as { name: string }[];

  const hasState = columns.some((c) => c.name === 'state');

  if (!hasState) {
    // Add state column with default 'active' for existing skills
    database.exec(`
      ALTER TABLE skill_registry ADD COLUMN state TEXT DEFAULT 'active';
    `);

    // Create index for state queries
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_skills_state
        ON skill_registry(state, name);
    `);
  }
}

/**
 * Migration to add trace linking columns
 */
function runTraceLinkingMigration(): void {
  const database = getDatabase();

  // Check if columns exist
  const columns = database
    .prepare("PRAGMA table_info(traces)")
    .all() as { name: string }[];

  const hasTaskId = columns.some((c) => c.name === 'task_id');
  const hasDocumentId = columns.some((c) => c.name === 'document_id');
  const hasMessageId = columns.some((c) => c.name === 'message_id');

  if (!hasTaskId) {
    database.exec(`ALTER TABLE traces ADD COLUMN task_id TEXT;`);
  }
  if (!hasDocumentId) {
    database.exec(`ALTER TABLE traces ADD COLUMN document_id TEXT;`);
  }
  if (!hasMessageId) {
    database.exec(`ALTER TABLE traces ADD COLUMN message_id TEXT;`);
  }

  // Create indexes for lookup
  if (!hasTaskId) {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_traces_task ON traces(task_id);`);
  }
  if (!hasDocumentId) {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_traces_document ON traces(document_id);`);
  }
  if (!hasMessageId) {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_traces_message ON traces(message_id);`);
  }
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a database migration (for future schema changes)
 */
export function runMigration(version: number, sql: string): void {
  const db = getDatabase();

  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Check if migration already applied
  const applied = db
    .prepare('SELECT version FROM migrations WHERE version = ?')
    .get(version);

  if (!applied) {
    db.exec(sql);
    db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
  }
}

/**
 * Get database stats for health checks
 */
export function getDatabaseStats(): {
  path: string;
  sizeBytes: number;
  tables: { name: string; rowCount: number }[];
} {
  const db = getDatabase();
  const dbPath = getDbPath();

  // Get table row counts
  const tables = db
    .prepare(
      `
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `
    )
    .all() as { name: string }[];

  const tableStats = tables.map((t) => {
    const count = db
      .prepare(`SELECT COUNT(*) as count FROM "${t.name}"`)
      .get() as { count: number };
    return { name: t.name, rowCount: count.count };
  });

  // Get file size
  let sizeBytes = 0;
  try {
    const { statSync } = require('fs');
    const stats = statSync(dbPath);
    sizeBytes = stats.size;
  } catch {
    // File might not exist yet
  }

  return {
    path: dbPath,
    sizeBytes,
    tables: tableStats,
  };
}

export { db };
