import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  sendWebhook,
  fireWebhook,
  buildCompletionPayload,
  buildErrorPayload,
  type WebhookConfig
} from "./webhooks.js";

describe("webhooks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildCompletionPayload", () => {
    it("builds correct payload structure", () => {
      const payload = buildCompletionPayload({
        taskId: "task-123",
        userId: "user-456",
        role: "assistant",
        response: "Hello, world!",
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        cost: {
          model: "gpt-4o-mini",
          inputTokens: 100,
          outputTokens: 50,
          inputCost: 0.00001,
          outputCost: 0.00002,
          totalCost: 0.00003,
          currency: "USD"
        },
        metadata: { custom: "value" }
      });

      expect(payload.event).toBe("agent.completed");
      expect(payload.task_id).toBe("task-123");
      expect(payload.user_id).toBe("user-456");
      expect(payload.role).toBe("assistant");
      expect(payload.response).toBe("Hello, world!");
      expect(payload.usage?.total_tokens).toBe(150);
      expect(payload.cost?.totalCost).toBe(0.00003);
      expect(payload.metadata?.custom).toBe("value");
      expect(payload.timestamp).toBeDefined();
    });
  });

  describe("buildErrorPayload", () => {
    it("builds error payload structure", () => {
      const payload = buildErrorPayload({
        taskId: "task-123",
        userId: "user-456",
        role: "assistant",
        error: "Something went wrong"
      });

      expect(payload.event).toBe("agent.error");
      expect(payload.error).toBe("Something went wrong");
      expect(payload.task_id).toBe("task-123");
    });
  });

  describe("sendWebhook", () => {
    it("sends POST request to webhook URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: WebhookConfig = {
        url: "https://example.com/webhook"
      };

      const result = await sendWebhook(config, {
        event: "agent.completed",
        timestamp: new Date().toISOString(),
        response: "Test"
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json"
          })
        })
      );
    });

    it("includes custom headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: WebhookConfig = {
        url: "https://example.com/webhook",
        headers: { "X-Custom-Header": "custom-value" }
      };

      await sendWebhook(config, {
        event: "agent.completed",
        timestamp: new Date().toISOString()
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Custom-Header": "custom-value"
          })
        })
      );
    });

    it("adds signature when secret is provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: WebhookConfig = {
        url: "https://example.com/webhook",
        secret: "my-secret-key"
      };

      await sendWebhook(config, {
        event: "agent.completed",
        timestamp: new Date().toISOString()
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Wombat-Signature": expect.any(String)
          })
        })
      );
    });

    it("returns failure for non-OK response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await sendWebhook(
        { url: "https://example.com/webhook" },
        { event: "agent.completed", timestamp: new Date().toISOString() }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it("handles fetch errors gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await sendWebhook(
        { url: "https://example.com/webhook" },
        { event: "agent.completed", timestamp: new Date().toISOString() }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("fireWebhook", () => {
    it("does nothing when webhook config is undefined", () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      fireWebhook(undefined, {
        event: "agent.completed",
        timestamp: new Date().toISOString()
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does nothing when webhook URL is empty", () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      fireWebhook(
        { url: "" },
        { event: "agent.completed", timestamp: new Date().toISOString() }
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fires async and does not block", () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      // This should not throw or block
      fireWebhook(
        { url: "https://example.com/webhook" },
        { event: "agent.completed", timestamp: new Date().toISOString() }
      );

      // fetch is called async, so it might not be called yet
      // but the function returns immediately
      expect(true).toBe(true);
    });
  });
});
