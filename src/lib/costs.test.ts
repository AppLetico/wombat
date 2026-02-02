import { describe, expect, it, beforeEach } from "vitest";
import {
  calculateCost,
  formatCost,
  UsageTracker,
  getUsageTracker,
  resetUsageTracker,
  MODEL_PRICING
} from "./costs.js";

describe("costs", () => {
  describe("calculateCost", () => {
    it("calculates cost for known model", () => {
      const usage = {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500
      };

      const cost = calculateCost(usage, "gpt-4o-mini");

      // gpt-4o-mini: $0.15/1M input, $0.60/1M output
      // Input: 1000 tokens = 1000/1M * 0.15 = 0.00015
      // Output: 500 tokens = 500/1M * 0.60 = 0.0003
      expect(cost.model).toBe("gpt-4o-mini");
      expect(cost.inputTokens).toBe(1000);
      expect(cost.outputTokens).toBe(500);
      expect(cost.inputCost).toBeCloseTo(0.00015, 6);
      expect(cost.outputCost).toBeCloseTo(0.0003, 6);
      expect(cost.totalCost).toBeCloseTo(0.00045, 6);
      expect(cost.currency).toBe("USD");
    });

    it("returns zero cost for unknown model", () => {
      const usage = {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500
      };

      const cost = calculateCost(usage, "unknown-model");

      expect(cost.model).toBe("unknown-model");
      expect(cost.inputCost).toBe(0);
      expect(cost.outputCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });

    it("handles large token counts", () => {
      const usage = {
        prompt_tokens: 100000,
        completion_tokens: 50000,
        total_tokens: 150000
      };

      const cost = calculateCost(usage, "gpt-4o");

      // gpt-4o: $2.50/1M input, $10.00/1M output
      // Input: 100000/1M * 2.50 = 0.25
      // Output: 50000/1M * 10.00 = 0.50
      expect(cost.inputCost).toBeCloseTo(0.25, 6);
      expect(cost.outputCost).toBeCloseTo(0.5, 6);
      expect(cost.totalCost).toBeCloseTo(0.75, 6);
    });
  });

  describe("formatCost", () => {
    it("formats small costs in cents", () => {
      expect(formatCost(0.0005)).toMatch(/¢/);
    });

    it("formats larger costs in dollars", () => {
      const formatted = formatCost(0.05);
      expect(formatted).toMatch(/\$/);
    });
  });

  describe("UsageTracker", () => {
    let tracker: UsageTracker;

    beforeEach(() => {
      tracker = new UsageTracker();
    });

    it("tracks multiple requests", () => {
      tracker.track({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, "gpt-4o-mini");
      tracker.track({ prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }, "gpt-4o-mini");

      const stats = tracker.getStats();

      expect(stats.requestCount).toBe(2);
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.totalTokens).toBe(450);
      expect(stats.totalCost).toBeGreaterThan(0);
    });

    it("clears tracked requests", () => {
      tracker.track({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, "gpt-4o-mini");
      tracker.clear();

      const stats = tracker.getStats();

      expect(stats.requestCount).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });

    it("returns cost breakdown from track", () => {
      const cost = tracker.track(
        { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        "gpt-4o-mini"
      );

      expect(cost.model).toBe("gpt-4o-mini");
      expect(cost.inputTokens).toBe(100);
      expect(cost.outputTokens).toBe(50);
    });
  });

  describe("global tracker", () => {
    beforeEach(() => {
      resetUsageTracker();
    });

    it("provides singleton tracker", () => {
      const tracker1 = getUsageTracker();
      const tracker2 = getUsageTracker();

      expect(tracker1).toBe(tracker2);
    });

    it("resets global tracker", () => {
      const tracker1 = getUsageTracker();
      resetUsageTracker();
      const tracker2 = getUsageTracker();

      expect(tracker1).not.toBe(tracker2);
    });
  });

  describe("MODEL_PRICING", () => {
    it("has pricing for common models", () => {
      expect(MODEL_PRICING["gpt-4o"]).toBeDefined();
      expect(MODEL_PRICING["gpt-4o-mini"]).toBeDefined();
      expect(MODEL_PRICING["gpt-4.1"]).toBeDefined();
      expect(MODEL_PRICING["gpt-4.1-mini"]).toBeDefined();
      expect(MODEL_PRICING["gpt-3.5-turbo"]).toBeDefined();
    });

    it("has valid pricing structure", () => {
      for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
        expect(pricing.inputPer1M).toBeGreaterThan(0);
        expect(pricing.outputPer1M).toBeGreaterThan(0);
        // Output is typically more expensive
        expect(pricing.outputPer1M).toBeGreaterThanOrEqual(pricing.inputPer1M);
      }
    });
  });
});
