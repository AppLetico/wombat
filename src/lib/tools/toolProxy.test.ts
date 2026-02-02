import { beforeAll, describe, it, expect } from 'vitest';
import {
  ToolProxy,
  parseToolCalls,
  formatToolResultsForLLM,
  type ToolCall,
  type ToolResult,
} from './toolProxy.js';

describe('ToolProxy', () => {
  beforeAll(() => {
    process.env.WOMBAT_TEST_MODE = 'true';
  });
  describe('getOpenAIFormat', () => {
    it('should convert tool definitions to OpenAI format', () => {
      const proxy = new ToolProxy({ backendUrl: 'http://localhost:3000' });
      const tools = [
        {
          name: 'search',
          description: 'Search for items',
          parameters: {
            type: 'object' as const,
            properties: {
              query: { type: 'string' as const },
            },
            required: ['query'],
          },
        },
      ];

      const openaiTools = proxy.getOpenAIFormat(tools);

      expect(openaiTools.length).toBe(1);
      expect(openaiTools[0].type).toBe('function');
      expect(openaiTools[0].function.name).toBe('search');
      expect(openaiTools[0].function.description).toBe('Search for items');
    });
  });

  describe('parseToolCalls', () => {
    it('should parse OpenAI format tool calls', () => {
      const response = {
        tool_calls: [
          {
            id: 'call_123',
            function: {
              name: 'search',
              arguments: '{"query": "test"}',
            },
          },
        ],
      };

      const calls = parseToolCalls(response);

      expect(calls.length).toBe(1);
      expect(calls[0].id).toBe('call_123');
      expect(calls[0].name).toBe('search');
      expect(calls[0].arguments).toEqual({ query: 'test' });
    });

    it('should parse Anthropic format tool calls', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'search',
            input: { query: 'test' },
          },
        ],
      };

      const calls = parseToolCalls(response);

      expect(calls.length).toBe(1);
      expect(calls[0].id).toBe('tool_123');
      expect(calls[0].name).toBe('search');
      expect(calls[0].arguments).toEqual({ query: 'test' });
    });

    it('should return empty array for invalid response', () => {
      expect(parseToolCalls(null)).toEqual([]);
      expect(parseToolCalls(undefined)).toEqual([]);
      expect(parseToolCalls({})).toEqual([]);
      expect(parseToolCalls('string')).toEqual([]);
    });

    it('should skip tool calls with invalid JSON arguments', () => {
      const response = {
        tool_calls: [
          {
            id: 'call_123',
            function: {
              name: 'search',
              arguments: 'not valid json',
            },
          },
        ],
      };

      const calls = parseToolCalls(response);
      expect(calls.length).toBe(0);
    });
  });

  describe('formatToolResultsForLLM', () => {
    it('should format successful results', () => {
      const results: ToolResult[] = [
        {
          toolCallId: 'call_123',
          success: true,
          result: { items: [1, 2, 3] },
          durationMs: 100,
        },
      ];

      const formatted = formatToolResultsForLLM(results);

      expect(formatted.length).toBe(1);
      expect(formatted[0].role).toBe('tool');
      expect(formatted[0].tool_call_id).toBe('call_123');
      expect(JSON.parse(formatted[0].content)).toEqual({ items: [1, 2, 3] });
    });

    it('should format error results', () => {
      const results: ToolResult[] = [
        {
          toolCallId: 'call_123',
          success: false,
          error: 'Tool failed',
          durationMs: 100,
        },
      ];

      const formatted = formatToolResultsForLLM(results);

      expect(formatted.length).toBe(1);
      expect(JSON.parse(formatted[0].content)).toEqual({ error: 'Tool failed' });
    });
  });
});
