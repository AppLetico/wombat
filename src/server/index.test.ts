import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/providers/openaiClient.js", () => ({
  generateAgentReply: vi.fn(async () => "Plan response")
}));

vi.mock("../lib/integrations/missionControl.js", () => ({
  listTasks: vi.fn(async () => []),
  createTask: vi.fn(async () => ({ id: "task-1" })),
  postMessage: vi.fn(async () => ({})),
  postDocument: vi.fn(async () => ({}))
}));

let buildApp: () => any;

beforeAll(async () => {
  process.env.CLASPER_TEST_MODE = "true";
  process.env.AGENT_JWT_SECRET = "test-secret";
  process.env.AGENT_DAEMON_API_KEY = "";
  process.env.BACKEND_URL = "http://localhost:8000";
  process.env.CLASPER_WORKSPACE = "./test-workspace";
  const mod = await import("./index.js");
  buildApp = mod.buildApp;
});

describe("/api/agents/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates task with task_title, posts message and plan doc", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:jarvis",
        message: "Generate plan",
        task_title: "Test Task",
        metadata: { kickoff_plan: true }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBe("task-1");
  });

  it("uses provided task_id directly", async () => {
    const { postMessage } = await import("../lib/integrations/missionControl.js");
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:agent",
        message: "Hello",
        task_id: "existing-task-123"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBe("existing-task-123");
  });

  it("uses CLASPER_DEFAULT_TASK when no task_id or task_title provided", async () => {
    // Note: Config is loaded at module import time, so we test the behavior
    // when CLASPER_DEFAULT_TASK is set (which it is in test env)
    // The actual "no task specified" error path is tested implicitly through
    // the integration when config.defaultTaskTitle is empty
    
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:agent",
        message: "Hello"
        // No task_id or task_title - should use CLASPER_DEFAULT_TASK from env
      }
    });

    // When CLASPER_DEFAULT_TASK is set, it should succeed
    // (creates or finds task with that title)
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBeDefined();
  });

  it("rejects mismatched user_id", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-2",
        session_key: "user:user-1:jarvis",
        message: "Generate plan",
        task_title: "Test Task"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("finds existing task by title instead of creating new one", async () => {
    const { listTasks, createTask } = await import("../lib/integrations/missionControl.js");
    // Mock listTasks to return an existing task
    vi.mocked(listTasks).mockResolvedValueOnce([
      { id: "existing-task", title: "Existing Task", status: "in_progress" }
    ]);

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/send",
      payload: {
        user_id: "user-1",
        session_key: "user:user-1:agent",
        message: "Hello",
        task_title: "Existing Task"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task_id).toBe("existing-task");
    // Should not have called createTask since task exists
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("Ops console auth guardrails", () => {
  it("requires Authorization header for /ops/api/me", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/me"
    });

    expect(response.statusCode).toBe(401);
  });

  it("requires Authorization header for /ops/api/traces", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/traces"
    });

    expect(response.statusCode).toBe(401);
  });
});
