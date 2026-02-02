import fs from "node:fs";
import path from "node:path";

type TestResult = {
  name: string;
  status: "passed" | "failed";
  error?: string;
};

const baseUrl = process.env.CONTROL_PLANE_URL || "http://localhost:8000";
const agentToken = process.env.AGENT_TOKEN;
const reportDir = process.env.CONFORMANCE_REPORT_DIR || "./conformance-results";

if (!agentToken) {
  console.error("Missing AGENT_TOKEN environment variable.");
  process.exit(1);
}

function makeUrl(endpoint: string) {
  return `${baseUrl}${endpoint}`;
}

async function requestJson(endpoint: string, init?: RequestInit) {
  const resp = await fetch(makeUrl(endpoint), init);
  const text = await resp.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { resp, payload, text };
}

function ensure(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const results: TestResult[] = [];
  let taskId: string | null = null;
  const idempotencyKey = `conformance-${Date.now()}`;

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [
    {
      name: "capabilities endpoint",
      fn: async () => {
        const { resp, payload } = await requestJson("/api/mission-control/capabilities", {
          headers: { "X-Agent-Token": agentToken }
        });
        ensure(resp.status === 200, `expected 200, got ${resp.status}`);
        ensure(payload?.contract_version === "v1", "expected contract_version=v1");
      }
    },
    {
      name: "create task with idempotency",
      fn: async () => {
        const { resp, payload } = await requestJson("/api/mission-control/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Token": agentToken
          },
          body: JSON.stringify({
            title: "Conformance Task",
            status: "in_progress",
            metadata: { source: "conformance" },
            idempotency_key: idempotencyKey
          })
        });
        ensure(resp.status === 200, `expected 200, got ${resp.status}`);
        ensure(typeof payload?.id === "string", "expected task id");
        taskId = payload.id;
      }
    },
    {
      name: "idempotency repeat create",
      fn: async () => {
        ensure(taskId !== null, "taskId not set");
        const { resp, payload } = await requestJson("/api/mission-control/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Token": agentToken
          },
          body: JSON.stringify({
            title: "Conformance Task",
            status: "in_progress",
            metadata: { source: "conformance" },
            idempotency_key: idempotencyKey
          })
        });
        ensure(resp.status === 200, `expected 200, got ${resp.status}`);
        ensure(payload?.id === taskId, "expected same task id for idempotent request");
      }
    },
    {
      name: "list tasks",
      fn: async () => {
        ensure(taskId !== null, "taskId not set");
        const { resp, payload } = await requestJson("/api/mission-control/tasks?limit=50", {
          headers: { "X-Agent-Token": agentToken }
        });
        ensure(resp.status === 200, `expected 200, got ${resp.status}`);
        ensure(Array.isArray(payload?.items), "expected items array");
        const found = payload.items.find((t: any) => t.id === taskId);
        ensure(!!found, "created task not found in list");
      }
    },
    {
      name: "post message",
      fn: async () => {
        ensure(taskId !== null, "taskId not set");
        const { resp, payload } = await requestJson("/api/mission-control/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Token": agentToken
          },
          body: JSON.stringify({
            task_id: taskId,
            content: "Conformance message",
            actor_type: "agent",
            agent_role: "jarvis"
          })
        });
        ensure(resp.status === 200, `expected 200, got ${resp.status}`);
        ensure(typeof payload?.id === "string", "expected message id");
      }
    },
    {
      name: "post document",
      fn: async () => {
        ensure(taskId !== null, "taskId not set");
        const { resp, payload } = await requestJson("/api/mission-control/documents", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Token": agentToken
          },
          body: JSON.stringify({
            title: "Conformance Doc",
            content: "Conformance document content",
            doc_type: "plan",
            task_id: taskId
          })
        });
        ensure(resp.status === 200, `expected 200, got ${resp.status}`);
        ensure(typeof payload?.id === "string", "expected document id");
      }
    }
  ];

  for (const test of tests) {
    try {
      await test.fn();
      results.push({ name: test.name, status: "passed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: test.name, status: "failed", error: message });
    }
  }

  const failures = results.filter((r) => r.status === "failed").length;
  const report = {
    baseUrl,
    passed: results.length - failures,
    failed: failures,
    results
  };

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "conformance.json"), JSON.stringify(report, null, 2));

  const junit = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuite name="wombat-control-plane" tests="${results.length}" failures="${failures}">`,
    ...results.map((r) => {
      if (r.status === "passed") {
        return `  <testcase name="${r.name}"></testcase>`;
      }
      const escaped = (r.error || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `  <testcase name="${r.name}"><failure message="${escaped}">${escaped}</failure></testcase>`;
    }),
    `</testsuite>`
  ].join("\n");

  fs.writeFileSync(path.join(reportDir, "junit.xml"), junit);

  if (failures > 0) {
    console.error(`Conformance failed: ${failures} test(s) failed`);
    process.exit(1);
  }

  console.log(`Conformance passed: ${results.length} test(s)`);
}

run().catch((err) => {
  console.error("Conformance run failed:", err);
  process.exit(1);
});
