# Control Plane Contract (v1)

This document defines the **minimum backend contract** required for Wombat to operate.
Any backend that implements this contract is considered **Mission Control v1 compatible**.

## Summary

Wombat is a stateless agent runtime. It depends on a backend control plane to:

- persist tasks, messages, and documents
- enforce tenant isolation by `user_id`
- support idempotent writes

Wombat integrates over HTTP. It does **not** require direct database access.

## Versioning + Compatibility

- **Contract versions** use `v1`, `v2`, etc.
- **Backward-compatible changes**: additive fields, additive endpoints, or optional features.
- **Breaking changes**: only allowed in a new major contract version (e.g. v2).
- **Deprecation**: deprecated endpoints must continue to work for a minimum of **12 months** and emit a `Warning` response header.

## Authentication (required)

All required endpoints **must** accept agent service tokens:

- Header: `X-Agent-Token: <jwt>`
- JWT must include:
  - `type: "agent"`
  - `user_id: <uuid>` (tenant scope)
  - `agent_role: <string>` (authorization scope)
  - optional `agent_id`

The backend must validate the token signature using the shared secret (`AGENT_JWT_SECRET`)
and reject invalid tokens with **401**.

## Tenancy rules (required)

- Every read/write is scoped by `user_id` from the agent token.
- Implementations must never allow cross-tenant reads or writes.

## Error model (required)

Use JSON errors with stable structure:

```json
{ "error": "Human-readable error message", "code": "optional_code", "details": {} }
```

Suggested status codes:

- `400` invalid payload
- `401` invalid or missing auth
- `403` not permitted
- `404` resource not found
- `409` idempotency conflict
- `429` rate limit
- `500` server error

## Idempotency (required)

Create endpoints **must** accept `idempotency_key` and treat retries as safe:

- Same request + same `idempotency_key` returns the original response.
- Different request + same key returns **409**.

## Capability discovery (required)

`GET /api/mission-control/capabilities`

Returns which optional features are supported.

Example response:

```json
{
  "contract_version": "v1",
  "features": {
    "tasks": true,
    "messages": true,
    "documents": true,
    "notifications_dispatch": false,
    "events_sse": false,
    "heartbeat": false,
    "standup": false,
    "tool_requests": false
  }
}
```

## Required endpoints (minimum surface)

### 1) List tasks

`GET /api/mission-control/tasks?limit=50`

Headers:
```
X-Agent-Token: <jwt>
```

Response:
```json
{
  "items": [
    { "id": "uuid", "title": "Task title", "status": "in_progress", "description": "optional" }
  ],
  "next_cursor": "optional"
}
```

Notes:
- `items` is required.
- `next_cursor` is optional (pagination).

### 2) Create task

`POST /api/mission-control/tasks`

Headers:
```
X-Agent-Token: <jwt>
Content-Type: application/json
```

Request:
```json
{
  "title": "Task title",
  "description": "optional",
  "status": "in_progress",
  "metadata": { "type": "agent_thread" },
  "idempotency_key": "optional"
}
```

Response:
```json
{ "id": "uuid", "title": "Task title", "status": "in_progress", "description": "optional" }
```

### 3) Post message

`POST /api/mission-control/messages`

Headers:
```
X-Agent-Token: <jwt>
Content-Type: application/json
```

Request:
```json
{
  "task_id": "uuid",
  "content": "Message content",
  "actor_type": "agent",
  "agent_role": "jarvis",
  "attachments": {},
  "idempotency_key": "optional"
}
```

Response:
```json
{ "id": "uuid", "task_id": "uuid", "content": "Message content" }
```

### 4) Post document

`POST /api/mission-control/documents`

Headers:
```
X-Agent-Token: <jwt>
Content-Type: application/json
```

Request:
```json
{
  "title": "Plan",
  "content": "Document content",
  "doc_type": "plan",
  "task_id": "uuid",
  "idempotency_key": "optional"
}
```

Response:
```json
{ "id": "uuid", "title": "Plan", "doc_type": "plan", "task_id": "uuid" }
```

## Optional endpoints (feature surface)

These are not required for baseline compatibility, but unlock extra features:

- Notifications dispatch:
  - `GET /api/mission-control/dispatch/undelivered`
  - `POST /api/mission-control/dispatch/notifications/{id}/deliver`
- Realtime events (SSE):
  - `GET /api/mission-control/events`
- Heartbeat + standup:
  - `POST /api/mission-control/heartbeat`
  - `POST /api/mission-control/standup`
- Tool approvals:
  - `POST/GET/PATCH /api/mission-control/tool-requests`

## References

- Wombat Integration Guide: `docs/INTEGRATION.md`
- Wombat API: `docs/API.md`
- OpenAPI: `docs/control-plane.openapi.yaml`
