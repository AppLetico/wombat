import { config, requireEnv } from "../lib/config.js";

const AGENT_DAEMON_URL = process.env.AGENT_DAEMON_URL || "http://localhost:8081";
const internalToken = process.env.INTERNAL_TOKEN || "";
const daemonKey = config.daemonKey;

requireEnv("BACKEND_URL", config.backendUrl);
requireEnv("INTERNAL_TOKEN", internalToken);

const limitUsers = Number(process.env.DISPATCH_LIMIT_USERS || 25);
const limitNotifications = Number(process.env.DISPATCH_LIMIT_NOTIFICATIONS || 25);
const minInterval = Number(process.env.DISPATCH_MIN_INTERVAL_SEC || 2);
const maxInterval = Number(process.env.DISPATCH_MAX_INTERVAL_SEC || 30);

async function postAgentMessage(payload: Record<string, any>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (daemonKey) headers["X-Agent-Daemon-Key"] = daemonKey;
  const resp = await fetch(`${AGENT_DAEMON_URL}/api/agents/send`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  return resp.ok;
}

async function main() {
  let backoff = minInterval;
  while (true) {
    const start = Date.now();
    let deliveries: any[] = [];
    try {
      const resp = await fetch(
        `${config.backendUrl}/api/mission-control/dispatch/undelivered?limit_users=${limitUsers}&limit_notifications=${limitNotifications}`,
        { headers: { "X-Internal-Token": internalToken } }
      );
      if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
      const payload = await resp.json();
      deliveries = payload.deliveries || [];
    } catch (err) {
      console.error("dispatcher_error", err);
      await new Promise((r) => setTimeout(r, Math.min(backoff, maxInterval) * 1000));
      backoff = Math.min(maxInterval, backoff * 2);
      continue;
    }

    let delivered = 0;
    let failed = 0;
    for (const item of deliveries) {
      if (!item.session_key || !item.user_id || !item.notification_id) {
        failed += 1;
        continue;
      }
      const ok = await postAgentMessage({
        user_id: item.user_id,
        session_key: item.session_key,
        message: item.content,
        metadata: {
          type: "mc.notification",
          notification_id: item.notification_id
        }
      });
      if (!ok) {
        failed += 1;
        continue;
      }
      try {
        const ack = await fetch(
          `${config.backendUrl}/api/mission-control/dispatch/notifications/${item.notification_id}/deliver?user_id=${item.user_id}`,
          { method: "POST", headers: { "X-Internal-Token": internalToken } }
        );
        if (!ack.ok) throw new Error(`ack failed ${ack.status}`);
        delivered += 1;
      } catch {
        failed += 1;
      }
    }

    const durationSec = (Date.now() - start) / 1000;
    console.log(
      JSON.stringify({
        event: "dispatcher_tick",
        deliveries: deliveries.length,
        delivered,
        failed,
        duration_sec: Number(durationSec.toFixed(2))
      })
    );

    backoff = deliveries.length ? minInterval : Math.min(maxInterval, backoff * 2);
    await new Promise((r) => setTimeout(r, backoff * 1000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
