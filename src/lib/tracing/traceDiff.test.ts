/**
 * Trace Diff Tests
 */

import { describe, it, expect } from 'vitest';
import { diffTraces, formatDiffSummary, type TraceDiff } from './traceDiff.js';
import type { AgentTrace } from './trace.js';

function createMockTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'trace-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agentRole: 'assistant',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:01.000Z',
    durationMs: 1000,
    workspaceHash: 'hash-abc123',
    skillVersions: { 'skill-a': '1.0.0' },
    model: 'gpt-4',
    provider: 'openai',
    input: {
      message: 'Hello',
      messageHistory: 0,
    },
    steps: [],
    output: {
      message: 'Hi there!',
      toolCalls: [],
    },
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalCost: 0.01,
    },
    ...overrides,
  };
}

describe('diffTraces', () => {
  it('should detect identical traces', () => {
    const trace1 = createMockTrace({ id: 'trace-1' });
    const trace2 = createMockTrace({ id: 'trace-2' });

    const diff = diffTraces(trace1, trace2);

    expect(diff.traceIds.base).toBe('trace-1');
    expect(diff.traceIds.compare).toBe('trace-2');
    expect(diff.context.sameTenant).toBe(true);
    expect(diff.context.sameWorkspace).toBe(true);
    expect(diff.model.changed).toBe(false);
    expect(diff.workspace.changed).toBe(false);
    expect(diff.output.messagesEqual).toBe(true);
    expect(diff.summary.totalDifferences).toBe(0);
  });

  it('should detect model changes', () => {
    const trace1 = createMockTrace({ id: 'trace-1', model: 'gpt-4' });
    const trace2 = createMockTrace({ id: 'trace-2', model: 'gpt-4-turbo' });

    const diff = diffTraces(trace1, trace2);

    expect(diff.model.changed).toBe(true);
    expect(diff.model.baseModel).toBe('gpt-4');
    expect(diff.model.compareModel).toBe('gpt-4-turbo');
    expect(diff.summary.significantChanges).toContain('Model changed');
  });

  it('should detect workspace changes', () => {
    const trace1 = createMockTrace({ id: 'trace-1', workspaceHash: 'hash-1' });
    const trace2 = createMockTrace({ id: 'trace-2', workspaceHash: 'hash-2' });

    const diff = diffTraces(trace1, trace2);

    expect(diff.workspace.changed).toBe(true);
    expect(diff.workspace.baseHash).toBe('hash-1');
    expect(diff.workspace.compareHash).toBe('hash-2');
    expect(diff.summary.significantChanges).toContain('Workspace changed');
  });

  it('should detect skill version changes', () => {
    const trace1 = createMockTrace({
      id: 'trace-1',
      skillVersions: { 'skill-a': '1.0.0', 'skill-b': '2.0.0' },
    });
    const trace2 = createMockTrace({
      id: 'trace-2',
      skillVersions: { 'skill-a': '1.1.0', 'skill-c': '1.0.0' },
    });

    const diff = diffTraces(trace1, trace2);

    expect(diff.skills.changed['skill-a']).toEqual({ base: '1.0.0', compare: '1.1.0' });
    expect(diff.skills.removed['skill-b']).toBe('2.0.0');
    expect(diff.skills.added['skill-c']).toBe('1.0.0');
    expect(diff.summary.significantChanges).toContain('Skill versions changed');
  });

  it('should calculate cost differences', () => {
    const trace1 = createMockTrace({
      id: 'trace-1',
      usage: { inputTokens: 100, outputTokens: 50, totalCost: 0.01 },
    });
    const trace2 = createMockTrace({
      id: 'trace-2',
      usage: { inputTokens: 200, outputTokens: 100, totalCost: 0.015 },
    });

    const diff = diffTraces(trace1, trace2);

    expect(diff.cost.baseCost).toBe(0.01);
    expect(diff.cost.compareCost).toBe(0.015);
    expect(diff.cost.delta).toBeCloseTo(0.005, 5);
    expect(diff.cost.percentChange).toBeCloseTo(50, 1);
    expect(diff.usage.inputTokenDelta).toBe(100);
    expect(diff.usage.outputTokenDelta).toBe(50);
  });

  it('should detect tool call changes', () => {
    const trace1 = createMockTrace({
      id: 'trace-1',
      output: {
        message: 'Done',
        toolCalls: [
          { id: 'tc-1', name: 'search', arguments: { q: 'test' }, result: { data: 'found' }, durationMs: 100, permitted: true, success: true },
        ],
      },
    });
    const trace2 = createMockTrace({
      id: 'trace-2',
      output: {
        message: 'Done',
        toolCalls: [
          { id: 'tc-2', name: 'search', arguments: { q: 'updated' }, result: { data: 'found' }, durationMs: 150, permitted: true, success: true },
          { id: 'tc-3', name: 'notify', arguments: {}, result: {}, durationMs: 50, permitted: true, success: true },
        ],
      },
    });

    const diff = diffTraces(trace1, trace2);

    expect(diff.toolCalls.baseCount).toBe(1);
    expect(diff.toolCalls.compareCount).toBe(2);
    expect(diff.toolCalls.added.length).toBe(1);
    expect(diff.toolCalls.added[0].name).toBe('notify');
    expect(diff.toolCalls.changed.length).toBe(1);
    expect(diff.toolCalls.changed[0].differences.argumentsChanged).toBe(true);
    expect(diff.summary.significantChanges).toContain('Tool calls differ');
  });

  it('should detect output message changes', () => {
    const trace1 = createMockTrace({
      id: 'trace-1',
      output: { message: 'Hello world', toolCalls: [] },
    });
    const trace2 = createMockTrace({
      id: 'trace-2',
      output: { message: 'Hello universe', toolCalls: [] },
    });

    const diff = diffTraces(trace1, trace2);

    expect(diff.output.messagesEqual).toBe(false);
    expect(diff.output.baseMessageLength).toBe(11);
    expect(diff.output.compareMessageLength).toBe(14);
    expect(diff.summary.significantChanges).toContain('Output message differs');
  });

  it('should detect error changes', () => {
    const trace1 = createMockTrace({ id: 'trace-1', error: undefined });
    const trace2 = createMockTrace({ id: 'trace-2', error: 'Something went wrong' });

    const diff = diffTraces(trace1, trace2);

    expect(diff.errors.baseHasError).toBe(false);
    expect(diff.errors.compareHasError).toBe(true);
    expect(diff.errors.compareError).toBe('Something went wrong');
    expect(diff.summary.significantChanges).toContain('Error status changed');
  });

  it('should handle null duration', () => {
    const trace1 = createMockTrace({ id: 'trace-1', durationMs: undefined });
    const trace2 = createMockTrace({ id: 'trace-2', durationMs: 500 });

    const diff = diffTraces(trace1, trace2);

    expect(diff.timing.baseDurationMs).toBe(null);
    expect(diff.timing.compareDurationMs).toBe(500);
    expect(diff.timing.deltaMs).toBe(null);
  });
});

describe('formatDiffSummary', () => {
  it('should format a diff with no changes', () => {
    const trace1 = createMockTrace({ id: 'trace-1' });
    const trace2 = createMockTrace({ id: 'trace-2' });
    const diff = diffTraces(trace1, trace2);

    const summary = formatDiffSummary(diff);

    expect(summary).toContain('Trace Diff: trace-1 vs trace-2');
    expect(summary).toContain('No significant changes detected');
  });

  it('should format a diff with model change', () => {
    const trace1 = createMockTrace({ id: 'trace-1', model: 'gpt-4' });
    const trace2 = createMockTrace({ id: 'trace-2', model: 'gpt-4-turbo' });
    const diff = diffTraces(trace1, trace2);

    const summary = formatDiffSummary(diff);

    expect(summary).toContain('Model: gpt-4 -> gpt-4-turbo');
    expect(summary).toContain('Model changed');
  });

  it('should format cost changes', () => {
    const trace1 = createMockTrace({
      id: 'trace-1',
      usage: { inputTokens: 100, outputTokens: 50, totalCost: 0.01 },
    });
    const trace2 = createMockTrace({
      id: 'trace-2',
      usage: { inputTokens: 200, outputTokens: 100, totalCost: 0.02 },
    });
    const diff = diffTraces(trace1, trace2);

    const summary = formatDiffSummary(diff);

    expect(summary).toContain('Cost: $0.0100 -> $0.0200');
    expect(summary).toContain('+100.0%');
  });
});
