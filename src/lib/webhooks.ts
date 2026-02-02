/**
 * Webhook callbacks for agent completion events.
 * Sends POST requests to configured webhook URLs on completion.
 */

import { config } from "./config.js";
import type { TokenUsage } from "./openaiClient.js";
import type { CostBreakdown } from "./costs.js";

/**
 * Webhook payload sent on completion.
 */
export interface WebhookPayload {
  event: "agent.completed" | "agent.error";
  timestamp: string;
  task_id?: string;
  user_id?: string;
  role?: string;
  response?: string;
  usage?: TokenUsage;
  cost?: CostBreakdown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Webhook configuration from request.
 */
export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}

/**
 * Webhook result.
 */
export interface WebhookResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Send a webhook notification.
 * Runs async and doesn't block the response.
 */
export async function sendWebhook(
  webhookConfig: WebhookConfig,
  payload: WebhookPayload
): Promise<WebhookResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Wombat-Webhook/1.0",
      ...webhookConfig.headers
    };

    // Add signature if secret is provided
    if (webhookConfig.secret) {
      const signature = await signPayload(JSON.stringify(payload), webhookConfig.secret);
      headers["X-Wombat-Signature"] = signature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(webhookConfig.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    return {
      success: response.ok,
      statusCode: response.status
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Webhook failed"
    };
  }
}

/**
 * Sign a payload with HMAC-SHA256.
 */
async function signPayload(payload: string, secret: string): Promise<string> {
  // Use Web Crypto API for HMAC
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);

  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fire and forget webhook.
 * Logs errors but doesn't throw.
 */
export function fireWebhook(
  webhookConfig: WebhookConfig | undefined,
  payload: WebhookPayload,
  logger?: { error: (msg: string) => void }
): void {
  if (!webhookConfig?.url) {
    return;
  }

  // Fire async, don't await
  sendWebhook(webhookConfig, payload)
    .then((result) => {
      if (!result.success && logger) {
        logger.error(`Webhook failed: ${result.error || `Status ${result.statusCode}`}`);
      }
    })
    .catch((error) => {
      if (logger) {
        logger.error(`Webhook error: ${error}`);
      }
    });
}

/**
 * Build completion payload.
 */
export function buildCompletionPayload(params: {
  taskId?: string;
  userId?: string;
  role?: string;
  response: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  metadata?: Record<string, unknown>;
}): WebhookPayload {
  return {
    event: "agent.completed",
    timestamp: new Date().toISOString(),
    task_id: params.taskId,
    user_id: params.userId,
    role: params.role,
    response: params.response,
    usage: params.usage,
    cost: params.cost,
    metadata: params.metadata
  };
}

/**
 * Build error payload.
 */
export function buildErrorPayload(params: {
  taskId?: string;
  userId?: string;
  role?: string;
  error: string;
  metadata?: Record<string, unknown>;
}): WebhookPayload {
  return {
    event: "agent.error",
    timestamp: new Date().toISOString(),
    task_id: params.taskId,
    user_id: params.userId,
    role: params.role,
    error: params.error,
    metadata: params.metadata
  };
}
