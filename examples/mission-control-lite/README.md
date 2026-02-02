# Mission Control Lite (Reference Backend)

Minimal reference implementation of the Wombat Control Plane Contract (v1).

## Features

- Required endpoints: tasks, messages, documents
- Capability discovery endpoint
- Idempotency handling
- In-memory storage (no database)

## Run

```bash
export AGENT_JWT_SECRET=your-secret
export MC_LITE_PORT=9001

npx tsx examples/mission-control-lite/server.ts
```

Health check: `http://localhost:9001/health`

## Generate an agent token

The contract requires `X-Agent-Token` with `type=agent`, `user_id`, and `agent_role`.

If you already have a backend that can mint agent tokens, use that token.
Otherwise, you can mint a token with the same secret using any JWT tool.

Example payload:

```json
{ "type": "agent", "user_id": "user-123", "agent_role": "jarvis" }
```

## Run conformance

```bash
export CONTROL_PLANE_URL=http://localhost:9001
export AGENT_TOKEN=your-agent-jwt
export CONFORMANCE_REPORT_DIR=./conformance-results

npm run conformance
```
