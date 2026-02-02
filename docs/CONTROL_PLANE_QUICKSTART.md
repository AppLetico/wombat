# Control Plane Quickstart

This is a one‑page guide for integrating a backend with Wombat’s **Control Plane Contract v1**.

## 1) Choose a shared secret

Wombat and your backend must share the same `AGENT_JWT_SECRET`.

## 2) Implement the required endpoints

Minimum required endpoints:

- `GET /api/mission-control/capabilities`
- `GET /api/mission-control/tasks`
- `POST /api/mission-control/tasks`
- `POST /api/mission-control/messages`
- `POST /api/mission-control/documents`

See the full contract:
`docs/CONTROL_PLANE_CONTRACT.md`

## 3) Enforce tenant isolation

Every request must be scoped by `user_id` in the agent token.

## 4) Add idempotency

Create endpoints must accept `idempotency_key` and:
- return the original response on retry
- return `409` if the same key is reused with a different payload

## 5) Run conformance

```bash
export CONTROL_PLANE_URL=http://localhost:8000
export AGENT_TOKEN=your-agent-jwt

npm run conformance
```

Reports are written to `./conformance-results` by default.

## 6) Optional features (can be added later)

- Notifications dispatch
- SSE events
- Heartbeat and standup endpoints
- Tool request approvals

## Reference implementation

Run the minimal backend:

```bash
export AGENT_JWT_SECRET=your-secret
npx tsx examples/mission-control-lite/server.ts
```

## OpenAPI spec

Use the OpenAPI file for client generation or validation:

`docs/control-plane.openapi.yaml`
