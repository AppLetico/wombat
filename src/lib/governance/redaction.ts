/**
 * Data Redaction
 *
 * Redacts sensitive data from traces and logs.
 * Supports multiple strategies: mask, hash, drop, summarize.
 * Configurable patterns for PII detection.
 */

import { createHash } from 'crypto';
import { AgentTrace, TraceStep, ToolCallTrace } from '../tracing/trace.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Redaction strategy
 */
export type RedactionStrategy = 'mask' | 'hash' | 'drop' | 'summarize';

/**
 * A pattern for detecting sensitive data
 */
export interface RedactionPattern {
  name: string;
  regex: RegExp;
  strategy?: RedactionStrategy;
  replacement?: string;
}

/**
 * Configuration for redaction
 */
export interface RedactionConfig {
  patterns: RedactionPattern[];
  defaultStrategy: RedactionStrategy;
  hashSalt?: string;
}

/**
 * Information about a redaction that was performed
 */
export interface RedactionInfo {
  pattern: string;
  original: string;
  redacted: string;
  position: {
    start: number;
    end: number;
  };
}

/**
 * Result of redacting text
 */
export interface RedactionResult {
  redacted: string;
  redactions: RedactionInfo[];
  hasRedactions: boolean;
}

// ============================================================================
// Default Patterns
// ============================================================================

/**
 * Built-in patterns for common PII
 */
export const DEFAULT_PATTERNS: RedactionPattern[] = [
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    strategy: 'mask',
    replacement: '[EMAIL]',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    strategy: 'mask',
    replacement: '[SSN]',
  },
  {
    name: 'phone_us',
    regex: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    strategy: 'mask',
    replacement: '[PHONE]',
  },
  {
    name: 'credit_card',
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    strategy: 'mask',
    replacement: '[CREDIT_CARD]',
  },
  {
    name: 'ip_address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    strategy: 'mask',
    replacement: '[IP]',
  },
  {
    name: 'api_key',
    regex: /\b(?:sk-|pk-|api[_-]?key[=:]\s*)[A-Za-z0-9_-]{20,}\b/gi,
    strategy: 'mask',
    replacement: '[API_KEY]',
  },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
    strategy: 'mask',
    replacement: '[JWT]',
  },
  {
    name: 'password_field',
    regex: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']?[^\s"']+/gi,
    strategy: 'mask',
    replacement: '[PASSWORD_FIELD]',
  },
];

// ============================================================================
// Redactor Class
// ============================================================================

export class Redactor {
  private patterns: RedactionPattern[];
  private defaultStrategy: RedactionStrategy;
  private hashSalt: string;

  constructor(config?: Partial<RedactionConfig>) {
    this.patterns = config?.patterns || DEFAULT_PATTERNS;
    this.defaultStrategy = config?.defaultStrategy || 'mask';
    this.hashSalt = config?.hashSalt || 'clasper-redaction-salt';
  }

  /**
   * Redact sensitive data from text
   */
  redact(text: string): RedactionResult {
    if (!text || typeof text !== 'string') {
      return { redacted: text, redactions: [], hasRedactions: false };
    }

    let redacted = text;
    const redactions: RedactionInfo[] = [];
    let offset = 0;

    for (const pattern of this.patterns) {
      // Reset regex lastIndex for global patterns
      pattern.regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const original = match[0];
        const strategy = pattern.strategy || this.defaultStrategy;
        const redactedValue = this.applyStrategy(original, strategy, pattern);

        redactions.push({
          pattern: pattern.name,
          original,
          redacted: redactedValue,
          position: {
            start: match.index,
            end: match.index + original.length,
          },
        });

        // Apply redaction with offset adjustment
        const adjustedStart = match.index + offset;
        const adjustedEnd = adjustedStart + original.length;
        redacted =
          redacted.substring(0, adjustedStart) +
          redactedValue +
          redacted.substring(adjustedEnd);

        offset += redactedValue.length - original.length;
      }
    }

    return {
      redacted,
      redactions,
      hasRedactions: redactions.length > 0,
    };
  }

  /**
   * Apply a redaction strategy to a value
   */
  private applyStrategy(
    value: string,
    strategy: RedactionStrategy,
    pattern: RedactionPattern
  ): string {
    switch (strategy) {
      case 'mask':
        return pattern.replacement || `[${pattern.name.toUpperCase()}]`;

      case 'hash':
        const hash = createHash('sha256')
          .update(this.hashSalt + value)
          .digest('hex')
          .substring(0, 8);
        return `[HASH:${hash}]`;

      case 'drop':
        return '';

      case 'summarize':
        // For summarize, we show partial info
        if (value.length <= 4) {
          return `[${pattern.name.toUpperCase()}]`;
        }
        return `${value.substring(0, 2)}..${value.substring(value.length - 2)}`;

      default:
        return `[REDACTED]`;
    }
  }

  /**
   * Redact an entire trace for storage
   */
  redactTrace(trace: AgentTrace): AgentTrace {
    const redacted: AgentTrace = JSON.parse(JSON.stringify(trace));

    // Redact input message
    if (redacted.input?.message) {
      const result = this.redact(redacted.input.message);
      redacted.input.message = result.redacted;
    }

    // Redact output message
    if (redacted.output?.message) {
      const result = this.redact(redacted.output.message);
      redacted.output.message = result.redacted;
    }

    // Redact tool calls
    if (redacted.output?.toolCalls) {
      redacted.output.toolCalls = redacted.output.toolCalls.map((tc) =>
        this.redactToolCall(tc)
      );
    }

    // Redact steps
    if (redacted.steps) {
      redacted.steps = redacted.steps.map((step) => this.redactStep(step));
    }

    // Redact prompt
    if (redacted.redactedPrompt) {
      const result = this.redact(redacted.redactedPrompt);
      redacted.redactedPrompt = result.redacted;
    }

    return redacted;
  }

  /**
   * Redact a tool call trace
   */
  private redactToolCall(tc: ToolCallTrace): ToolCallTrace {
    return {
      ...tc,
      arguments: this.redactObject(tc.arguments),
      result: this.redactObject(tc.result),
    };
  }

  /**
   * Redact a trace step
   */
  private redactStep(step: TraceStep): TraceStep {
    const redacted: TraceStep = { ...step };

    if (step.type === 'tool_call' || step.type === 'tool_result') {
      redacted.data = this.redactObject(step.data) as typeof step.data;
    }

    return redacted;
  }

  /**
   * Recursively redact an object's string values
   */
  redactObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redact(obj).redacted;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.redactObject(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Check if text contains any sensitive patterns
   */
  containsSensitiveData(text: string): boolean {
    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all patterns that match in the text
   */
  detectPatterns(text: string): string[] {
    const matched: string[] = [];

    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        matched.push(pattern.name);
      }
    }

    return matched;
  }

  /**
   * Add a custom pattern
   */
  addPattern(pattern: RedactionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Remove a pattern by name
   */
  removePattern(name: string): boolean {
    const index = this.patterns.findIndex((p) => p.name === name);
    if (index >= 0) {
      this.patterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all pattern names
   */
  getPatternNames(): string[] {
    return this.patterns.map((p) => p.name);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let redactorInstance: Redactor | null = null;

/**
 * Get or create the Redactor instance
 */
export function getRedactor(config?: Partial<RedactionConfig>): Redactor {
  if (!redactorInstance) {
    redactorInstance = new Redactor(config);
  }
  return redactorInstance;
}

/**
 * Reset the redactor instance (for testing)
 */
export function resetRedactor(): void {
  redactorInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick redact function using default redactor
 */
export function quickRedact(text: string): string {
  return getRedactor().redact(text).redacted;
}

/**
 * Check if text needs redaction
 */
export function needsRedaction(text: string): boolean {
  return getRedactor().containsSensitiveData(text);
}

/**
 * Create a redaction config from YAML
 */
export function parseRedactionConfig(yaml: {
  pii?: { patterns?: string[]; strategy?: RedactionStrategy };
  custom?: RedactionPattern[];
}): RedactionConfig {
  const patterns: RedactionPattern[] = [];

  // Add default patterns for specified PII types
  if (yaml.pii?.patterns) {
    for (const patternName of yaml.pii.patterns) {
      const defaultPattern = DEFAULT_PATTERNS.find((p) => p.name === patternName);
      if (defaultPattern) {
        patterns.push({
          ...defaultPattern,
          strategy: yaml.pii.strategy,
        });
      }
    }
  }

  // Add custom patterns
  if (yaml.custom) {
    patterns.push(...yaml.custom);
  }

  // If no patterns specified, use all defaults
  if (patterns.length === 0) {
    patterns.push(...DEFAULT_PATTERNS);
  }

  return {
    patterns,
    defaultStrategy: yaml.pii?.strategy || 'mask',
  };
}
