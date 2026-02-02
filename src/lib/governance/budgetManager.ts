/**
 * Budget Manager
 *
 * Per-tenant budget controls for cost management.
 * Features:
 * - Budget allocation per tenant
 * - Spend tracking
 * - Hard/soft limits
 * - Alert thresholds
 * - Period-based budgets (monthly, etc.)
 */

import { getDatabase } from '../core/db.js';
import { auditLog } from './auditLog.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Tenant budget configuration
 */
export interface TenantBudget {
  tenantId: string;
  budgetUsd: number;
  spentUsd: number;
  periodStart: string;
  periodEnd: string;
  hardLimit: boolean;
  alertThreshold: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of checking budget
 */
export interface BudgetCheckResult {
  allowed: boolean;
  budget: TenantBudget | null;
  remaining: number;
  percentUsed: number;
  reason?: 'budget_exceeded' | 'no_budget_set' | 'period_expired';
  warning?: string;
}

/**
 * Options for creating/updating a budget
 */
export interface BudgetOptions {
  budgetUsd: number;
  periodStart?: string;
  periodEnd?: string;
  hardLimit?: boolean;
  alertThreshold?: number;
}

/**
 * Budget statistics
 */
export interface BudgetStats {
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  percentUsed: number;
  averageDailySpend: number;
  projectedMonthEnd: number;
  daysRemaining: number;
}

/**
 * Cost forecast request
 */
export interface CostForecastRequest {
  tenantId: string;
  promptSize: number; // Estimated input tokens
  maxOutputTokens?: number; // Estimated output tokens
  model: string;
  provider?: string;
}

/**
 * Cost forecast result
 */
export interface CostForecastResult {
  estimatedCost: number;
  inputCost: number;
  outputCost: number;
  budgetAllowed: boolean;
  budgetRemaining: number;
  wouldExceedBudget: boolean;
  warning?: string;
  details: {
    inputTokens: number;
    outputTokens: number;
    model: string;
    inputPricePerToken: number;
    outputPricePerToken: number;
  };
}

/**
 * Model pricing (per 1000 tokens)
 */
export const ModelPricing: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  // Anthropic
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  // Default fallback
  'default': { input: 0.01, output: 0.03 },
};

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when budget is exceeded with hard limit
 */
export class BudgetExceededError extends Error {
  public readonly forecast: CostForecastResult;

  constructor(message: string, forecast: CostForecastResult) {
    super(message);
    this.name = 'BudgetExceededError';
    this.forecast = forecast;
  }
}

// ============================================================================
// Budget Manager Class
// ============================================================================

export class BudgetManager {
  /**
   * Set or update a tenant's budget
   */
  setBudget(tenantId: string, options: BudgetOptions): TenantBudget {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Default period is current month
    const periodStart = options.periodStart || this.getMonthStart();
    const periodEnd = options.periodEnd || this.getMonthEnd();

    const stmt = db.prepare(`
      INSERT INTO tenant_budgets (
        tenant_id, budget_usd, spent_usd, period_start, period_end,
        hard_limit, alert_threshold, created_at, updated_at
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        budget_usd = excluded.budget_usd,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        hard_limit = excluded.hard_limit,
        alert_threshold = excluded.alert_threshold,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      tenantId,
      options.budgetUsd,
      periodStart,
      periodEnd,
      options.hardLimit !== false ? 1 : 0,
      options.alertThreshold ?? 0.8,
      now,
      now
    );

    return this.getBudget(tenantId)!;
  }

  /**
   * Get a tenant's budget
   */
  getBudget(tenantId: string): TenantBudget | null {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM tenant_budgets WHERE tenant_id = ?')
      .get(tenantId) as BudgetRow | undefined;

    if (!row) return null;

    return this.rowToBudget(row);
  }

  /**
   * Check if a request is within budget
   */
  checkBudget(tenantId: string, estimatedCost: number = 0): BudgetCheckResult {
    const budget = this.getBudget(tenantId);

    // No budget set - allow by default
    if (!budget) {
      return {
        allowed: true,
        budget: null,
        remaining: Infinity,
        percentUsed: 0,
        reason: 'no_budget_set',
      };
    }

    // Check if period is expired
    const now = new Date();
    const periodEnd = new Date(budget.periodEnd);
    if (now > periodEnd) {
      // Period expired - reset or deny based on policy
      return {
        allowed: !budget.hardLimit,
        budget,
        remaining: 0,
        percentUsed: 100,
        reason: 'period_expired',
        warning: 'Budget period has expired',
      };
    }

    const remaining = budget.budgetUsd - budget.spentUsd;
    const percentUsed = (budget.spentUsd / budget.budgetUsd) * 100;

    // Check if over budget
    if (budget.spentUsd + estimatedCost > budget.budgetUsd) {
      if (budget.hardLimit) {
        return {
          allowed: false,
          budget,
          remaining,
          percentUsed,
          reason: 'budget_exceeded',
        };
      }
      // Soft limit - allow but warn
      return {
        allowed: true,
        budget,
        remaining,
        percentUsed,
        warning: 'Budget exceeded - soft limit',
      };
    }

    // Check alert threshold
    let warning: string | undefined;
    if (percentUsed >= budget.alertThreshold * 100) {
      warning = `Budget usage at ${percentUsed.toFixed(1)}% - approaching limit`;
    }

    return {
      allowed: true,
      budget,
      remaining,
      percentUsed,
      warning,
    };
  }

  /**
   * Record spending for a tenant
   */
  recordSpend(
    tenantId: string,
    amount: number,
    metadata?: { traceId?: string; description?: string }
  ): BudgetCheckResult {
    const db = getDatabase();
    const now = new Date().toISOString();

    // Update spent amount
    const stmt = db.prepare(`
      UPDATE tenant_budgets
      SET spent_usd = spent_usd + ?, updated_at = ?
      WHERE tenant_id = ?
    `);

    const result = stmt.run(amount, now, tenantId);

    // If no budget exists, create one with unlimited budget
    if (result.changes === 0) {
      this.setBudget(tenantId, {
        budgetUsd: 1000000, // Effectively unlimited
        hardLimit: false,
      });
      db.prepare(`
        UPDATE tenant_budgets
        SET spent_usd = ?
        WHERE tenant_id = ?
      `).run(amount, tenantId);
    }

    // Check new status and log if needed
    const checkResult = this.checkBudget(tenantId, 0);

    if (checkResult.warning) {
      auditLog('budget_warning', {
        tenantId,
        traceId: metadata?.traceId,
        eventData: {
          percent_used: checkResult.percentUsed,
          remaining: checkResult.remaining,
          description: metadata?.description,
        },
      });
    }

    if (!checkResult.allowed) {
      auditLog('budget_exceeded', {
        tenantId,
        traceId: metadata?.traceId,
        eventData: {
          budget: checkResult.budget?.budgetUsd,
          spent: checkResult.budget?.spentUsd,
          description: metadata?.description,
        },
      });
    }

    return checkResult;
  }

  /**
   * Get budget statistics
   */
  getStats(tenantId: string): BudgetStats | null {
    const budget = this.getBudget(tenantId);
    if (!budget) return null;

    const remaining = budget.budgetUsd - budget.spentUsd;
    const percentUsed = (budget.spentUsd / budget.budgetUsd) * 100;

    // Calculate days in period and average daily spend
    const start = new Date(budget.periodStart);
    const end = new Date(budget.periodEnd);
    const now = new Date();

    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    const averageDailySpend = budget.spentUsd / elapsedDays;
    const projectedMonthEnd = budget.spentUsd + (averageDailySpend * daysRemaining);

    return {
      totalBudget: budget.budgetUsd,
      totalSpent: budget.spentUsd,
      remaining,
      percentUsed,
      averageDailySpend,
      projectedMonthEnd,
      daysRemaining,
    };
  }

  /**
   * Reset a tenant's spending (for new period)
   */
  resetSpend(tenantId: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE tenant_budgets
      SET spent_usd = 0, updated_at = ?
      WHERE tenant_id = ?
    `).run(now, tenantId);
  }

  /**
   * Delete a tenant's budget
   */
  deleteBudget(tenantId: string): boolean {
    const db = getDatabase();

    const result = db
      .prepare('DELETE FROM tenant_budgets WHERE tenant_id = ?')
      .run(tenantId);

    return result.changes > 0;
  }

  /**
   * List all budgets (admin)
   */
  listBudgets(options?: {
    limit?: number;
    offset?: number;
  }): { budgets: TenantBudget[]; total: number } {
    const db = getDatabase();
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const countRow = db
      .prepare('SELECT COUNT(*) as count FROM tenant_budgets')
      .get() as { count: number };

    const rows = db
      .prepare(`
        SELECT * FROM tenant_budgets
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(limit, offset) as BudgetRow[];

    return {
      budgets: rows.map((row) => this.rowToBudget(row)),
      total: countRow.count,
    };
  }

  /**
   * Get tenants that are over budget
   */
  getOverBudgetTenants(): TenantBudget[] {
    const db = getDatabase();

    const rows = db
      .prepare(`
        SELECT * FROM tenant_budgets
        WHERE spent_usd >= budget_usd AND hard_limit = 1
        ORDER BY (spent_usd - budget_usd) DESC
      `)
      .all() as BudgetRow[];

    return rows.map((row) => this.rowToBudget(row));
  }

  /**
   * Get tenants approaching budget limit
   */
  getApproachingLimitTenants(threshold: number = 0.8): TenantBudget[] {
    const db = getDatabase();

    const rows = db
      .prepare(`
        SELECT * FROM tenant_budgets
        WHERE (spent_usd / budget_usd) >= ? AND spent_usd < budget_usd
        ORDER BY (spent_usd / budget_usd) DESC
      `)
      .all(threshold) as BudgetRow[];

    return rows.map((row) => this.rowToBudget(row));
  }

  /**
   * Forecast cost before execution
   * Returns estimated cost and whether the budget allows it
   */
  forecastCost(request: CostForecastRequest): CostForecastResult {
    const { tenantId, promptSize, maxOutputTokens = 1000, model } = request;

    // Get pricing for the model
    const pricing = ModelPricing[model] || ModelPricing['default'];
    const inputPricePerToken = pricing.input / 1000;
    const outputPricePerToken = pricing.output / 1000;

    // Calculate estimated cost
    const inputCost = promptSize * inputPricePerToken;
    const outputCost = maxOutputTokens * outputPricePerToken;
    const estimatedCost = inputCost + outputCost;

    // Check budget
    const budget = this.getBudget(tenantId);
    let budgetAllowed = true;
    let budgetRemaining = Infinity;
    let wouldExceedBudget = false;
    let warning: string | undefined;

    if (budget) {
      budgetRemaining = budget.budgetUsd - budget.spentUsd;
      wouldExceedBudget = estimatedCost > budgetRemaining;

      if (wouldExceedBudget) {
        if (budget.hardLimit) {
          budgetAllowed = false;
        } else {
          warning = `Estimated cost ($${estimatedCost.toFixed(4)}) exceeds remaining budget ($${budgetRemaining.toFixed(4)})`;
        }
      } else if (budget.spentUsd + estimatedCost > budget.budgetUsd * budget.alertThreshold) {
        warning = `This request will bring budget usage above ${(budget.alertThreshold * 100).toFixed(0)}% threshold`;
      }
    }

    return {
      estimatedCost,
      inputCost,
      outputCost,
      budgetAllowed,
      budgetRemaining,
      wouldExceedBudget,
      warning,
      details: {
        inputTokens: promptSize,
        outputTokens: maxOutputTokens,
        model,
        inputPricePerToken,
        outputPricePerToken,
      },
    };
  }

  /**
   * Fail-fast check before execution
   * Throws an error if budget would be exceeded with hard limit
   */
  checkBeforeExecution(request: CostForecastRequest): CostForecastResult {
    const forecast = this.forecastCost(request);

    if (!forecast.budgetAllowed) {
      throw new BudgetExceededError(
        `Budget exceeded: estimated cost $${forecast.estimatedCost.toFixed(4)}, remaining $${forecast.budgetRemaining.toFixed(4)}`,
        forecast
      );
    }

    return forecast;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private rowToBudget(row: BudgetRow): TenantBudget {
    return {
      tenantId: row.tenant_id,
      budgetUsd: row.budget_usd,
      spentUsd: row.spent_usd,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      hardLimit: row.hard_limit === 1,
      alertThreshold: row.alert_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getMonthStart(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  private getMonthEnd(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  }
}

// ============================================================================
// Database Row Type
// ============================================================================

interface BudgetRow {
  tenant_id: string;
  budget_usd: number;
  spent_usd: number;
  period_start: string;
  period_end: string;
  hard_limit: number;
  alert_threshold: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let budgetManagerInstance: BudgetManager | null = null;

/**
 * Get or create the BudgetManager instance
 */
export function getBudgetManager(): BudgetManager {
  if (!budgetManagerInstance) {
    budgetManagerInstance = new BudgetManager();
  }
  return budgetManagerInstance;
}

/**
 * Reset the budget manager instance (for testing)
 */
export function resetBudgetManager(): void {
  budgetManagerInstance = null;
}
