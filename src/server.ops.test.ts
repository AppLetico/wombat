import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth/opsAuth.js", () => ({
  requireOpsContextFromHeaders: vi.fn(async () => ({
    userId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "tenant-1",
    roles: ["admin"],
    role: "admin",
    allowedTenants: [],
    raw: {}
  })),
  canAccessTenant: vi.fn(() => true),
  canAccessWorkspace: vi.fn(() => true),
  requireRole: vi.fn(() => undefined),
  requirePermission: vi.fn(() => undefined),
  getContextPermissions: vi.fn(() => ["trace:view", "dashboard:view"]),
  PermissionError: class PermissionError extends Error {
    permission = "trace:view";
    requiredRoles = ["admin"];
  },
  OpsAuthError: class OpsAuthError extends Error {}
}));

let buildApp: () => any;

beforeAll(async () => {
  vi.resetModules();
  process.env.WOMBAT_TEST_MODE = "true";
  process.env.AGENT_JWT_SECRET = "test-secret";
  process.env.AGENT_DAEMON_API_KEY = "";
  process.env.BACKEND_URL = "http://localhost:8000";
  process.env.WOMBAT_WORKSPACE = "./test-workspace";
  const mod = await import("./server/index.js");
  buildApp = mod.buildApp;
});

describe("Ops console endpoints", () => {
  it("returns ops context from /ops/api/me", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/me",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user).toBeDefined();
    expect(body.permissions).toBeDefined();
    expect(body.scope).toBeDefined();
  });

  it("returns traces from /ops/api/traces", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/traces",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns cost dashboard from /ops/api/dashboards/cost", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/dashboards/cost",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns skill registry from /ops/api/skills/registry", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/skills/registry",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns audit log from /ops/api/audit", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ops/api/audit",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries).toBeDefined();
    expect(body.total).toBeDefined();
  });
});
