# API

## Ops Console (v1.2)

All Ops Console endpoints require `Authorization: Bearer <OIDC JWT>`.

| Endpoint | Purpose |
|----------|---------|
| `GET /ops` | Operations Console UI |
| `GET /ops/api/me` | Current user and RBAC context |
| `GET /ops/api/traces` | Trace list (view-model) |
| `GET /ops/api/traces/:id` | Trace detail (view-model) |
| `POST /ops/api/traces/diff` | Trace diff (summary + highlights) |
| `POST /ops/api/workspaces/:workspaceId/promotions/check` | Promotion pre-checks |
| `POST /ops/api/workspaces/:workspaceId/promotions/execute` | Execute promotion (annotation required) |
| `GET /ops/api/workspaces/:workspaceId/versions` | Workspace version history |
| `POST /ops/api/workspaces/:workspaceId/rollback` | Rollback workspace (annotation required) |
| `GET /ops/api/skills/registry` | Skill ops view (usage + permissions) |
| `POST /ops/api/skills/:name/:version/promote` | Promote skill lifecycle state |
| `GET /ops/api/dashboards/cost` | Cost dashboard aggregates |
| `GET /ops/api/dashboards/risk` | Risk dashboard aggregates |

## POST /api/agents/send

Send a message to an agent session. The daemon generates a response and writes it to Mission Control.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Agent-Daemon-Key` | Only if `AGENT_DAEMON_API_KEY` is set | Authentication key for daemon access |

### Request Body

```json
{
  "user_id": "uuid",
  "session_key": "user:{userId}:agent",
  "message": "Your message to the agent",
  "messages": [
    { "role": "user", "content": "Previous user message" },
    { "role": "assistant", "content": "Previous assistant reply" }
  ],
  "task_id": "existing-task-uuid",
  "task_title": "Task Title for Find/Create",
  "task_description": "Optional task description",
  "task_metadata": {},
  "metadata": {
    "system_prompt": "Optional prompt override",
    "kickoff_plan": true,
    "kickoff_note": "Optional note for plans"
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `user_id` | Yes | User ID (must match session_key) |
| `session_key` | Yes | Format: `user:{userId}:{role}` |
| `message` | Yes | The user message to process |
| `messages` | No | Conversation history (for multi-turn context) |
| `task_id` | No | Existing task ID (backend-owned creation) |
| `task_title` | No | Task title for find-or-create |
| `task_description` | No | Description when creating new task |
| `task_metadata` | No | Additional metadata for new task |
| `metadata` | No | Request-level options (see below) |
| `stream` | No | If `true`, returns SSE stream instead of JSON |
| `webhook` | No | Webhook config for completion callback (see below) |

### Webhook Configuration

Optional webhook to receive completion notifications:

```json
{
  "webhook": {
    "url": "https://your-server.com/callback",
    "secret": "optional-hmac-secret",
    "headers": { "X-Custom-Header": "value" }
  }
}
```

Webhook payload on completion:

```json
{
  "event": "agent.completed",
  "timestamp": "2026-02-01T19:20:00.000Z",
  "task_id": "uuid",
  "user_id": "user-id",
  "role": "agent-role",
  "response": "Agent reply text",
  "usage": { ... },
  "cost": { ... }
}
```

If `secret` is provided, the payload is signed with HMAC-SHA256 and included in `X-Clasper-Signature` header.

### Conversation History

The `messages` array allows backends to inject prior conversation turns. This enables multi-turn conversations without Clasper storing state.

**Message format:**

```json
{
  "role": "user" | "assistant" | "system",
  "content": "Message content"
}
```

**Example with history:**

```json
{
  "user_id": "user-123",
  "session_key": "user:user-123:assistant",
  "message": "What was the third item?",
  "messages": [
    { "role": "user", "content": "Give me a list of 5 ideas" },
    { "role": "assistant", "content": "1. Build a dashboard\n2. Add auth\n3. Create API\n4. Write tests\n5. Deploy" }
  ],
  "task_title": "Project Ideas"
}
```

### Metadata Options

| Field | Description |
|-------|-------------|
| `system_prompt` | Override workspace-loaded system prompt |
| `kickoff_plan` | If true, also creates a plan document |
| `kickoff_note` | Note text included in plan document |

### Task Resolution

Tasks are resolved in priority order:

1. **`task_id`** - Use this specific task directly
2. **`task_title`** - Find existing task by title, or create new one
3. **`CLASPER_DEFAULT_TASK`** - Environment variable fallback
4. **Error** - Returns 400 if no task can be resolved

### Response

```json
{
  "status": "ok",
  "task_id": "uuid",
  "trace_id": "0194c8f0-7e1a-7000-8000-000000000001",
  "response": "Agent reply text",
  "usage": {
    "prompt_tokens": 1250,
    "completion_tokens": 150,
    "total_tokens": 1400
  },
  "cost": {
    "model": "gpt-4o-mini",
    "inputTokens": 1250,
    "outputTokens": 150,
    "inputCost": 0.0001875,
    "outputCost": 0.00009,
    "totalCost": 0.0002775,
    "currency": "USD"
  },
  "context_warning": "Context usage is 78.5% of 128000 tokens. Consider compacting history."
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| `status` | Always "ok" on success |
| `task_id` | The task ID used for this message |
| `trace_id` | Unique trace ID for observability (UUID v7) |
| `response` | The agent's reply text |
| `usage` | Token usage statistics (prompt, completion, total) |
| `cost` | Cost breakdown for this request |
| `context_warning` | Present when context usage exceeds threshold (default 75%) |

### Error Response

```json
{
  "error": "Error message"
}
```

### Examples

**Basic message with task_title:**

```json
{
  "user_id": "user-123",
  "session_key": "user:user-123:assistant",
  "message": "Help me with my project",
  "task_title": "Project Assistance"
}
```

**Using existing task (backend-owned):**

```json
{
  "user_id": "user-123",
  "session_key": "user:user-123:assistant",
  "message": "Continue from where we left off",
  "task_id": "existing-task-abc123"
}
```

**With system prompt override:**

```json
{
  "user_id": "user-123",
  "session_key": "user:user-123:specialist",
  "message": "Analyze this data",
  "task_title": "Data Analysis",
  "metadata": {
    "system_prompt": "You are a data analysis specialist. Focus on statistical insights."
  }
}
```

**Kickoff plan document:**

```json
{
  "user_id": "user-123",
  "session_key": "user:user-123:planner",
  "message": "Create a project plan",
  "task_title": "Project Planning",
  "metadata": {
    "kickoff_plan": true,
    "kickoff_note": "Draft a 3-step implementation plan"
  }
}
```

## POST /llm-task

Execute a structured LLM task that returns JSON. Following OpenClaw's llm-task pattern for workflow engines.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Agent-Daemon-Key` | Only if `AGENT_DAEMON_API_KEY` is set | Authentication key for daemon access |

### Request Body

```json
{
  "prompt": "Extract the intent and key entities from this email",
  "input": {
    "subject": "Meeting Request",
    "body": "Can we schedule a meeting next Tuesday at 2pm?"
  },
  "schema": {
    "type": "object",
    "properties": {
      "intent": { "type": "string" },
      "entities": { "type": "array" }
    },
    "required": ["intent"]
  },
  "model": "gpt-4o-mini",
  "temperature": 0.3
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | Yes | Instructions for the LLM task |
| `input` | No | Structured input data (any JSON) |
| `schema` | No | JSON Schema for output validation |
| `model` | No | Model to use (defaults to configured default) |
| `temperature` | No | Temperature (0-2, default: 0.3) |
| `max_tokens` | No | Maximum tokens for response |

### Response

```json
{
  "status": "ok",
  "output": {
    "intent": "schedule_meeting",
    "entities": ["meeting", "Tuesday", "2pm"]
  },
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 50,
    "total_tokens": 200
  },
  "cost": {
    "model": "gpt-4o-mini",
    "inputCost": 0.0000225,
    "outputCost": 0.00003,
    "totalCost": 0.0000525,
    "currency": "USD"
  },
  "validated": true
}
```

### Use Cases

- **Workflow engines**: Add LLM steps without custom code
- **Data extraction**: Parse unstructured text into structured JSON
- **Classification**: Categorize content with structured output
- **Transformation**: Convert between formats with LLM assistance

---

## GET /usage

Get aggregate usage statistics and costs for the current daemon session.

### Response

```json
{
  "requestCount": 42,
  "totalInputTokens": 125000,
  "totalOutputTokens": 35000,
  "totalTokens": 160000,
  "totalCost": 0.0485,
  "currency": "USD"
}
```

---

## GET /skills

List all available skills in the workspace.

### Response

```json
{
  "enabled": 3,
  "total": 5,
  "skills": [
    {
      "name": "web-search",
      "description": "Search the web for information",
      "enabled": true,
      "location": "/path/to/workspace/skills/web-search",
      "metadata": {
        "openclaw": {
          "emoji": "🔍",
          "requires": { "env": ["SEARCH_API_KEY"] }
        }
      }
    }
  ]
}
```

---

## GET /boot

Check BOOT.md initialization status.

### Response

```json
{
  "hasBoot": true,
  "isComplete": false,
  "content": "## First Run Setup\n\nInstructions for first run..."
}
```

---

## POST /boot/complete

Mark BOOT.md as complete (creates `.boot-complete` marker).

### Response

```json
{
  "status": "ok"
}
```

---

## POST /api/agents/stream

Streaming version of `/api/agents/send`. Returns Server-Sent Events (SSE).

### Request Body

Same as `/api/agents/send` (except `stream` and `webhook` fields are not used).

### Response (SSE Events)

```
event: start
data: {"type":"start"}

event: chunk
data: {"type":"chunk","data":"Hello"}

event: chunk
data: {"type":"chunk","data":", world!"}

event: done
data: {"type":"done","usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150},"cost":{"model":"gpt-4o-mini","totalCost":0.0001}}
```

### Error Event

```
event: error
data: {"type":"error","error":"Error message"}
```

---

## POST /compact

Compact (summarize) conversation history to reduce token usage. Following OpenClaw's compaction pattern.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Agent-Daemon-Key` | Only if `AGENT_DAEMON_API_KEY` is set | Authentication key for daemon access |

### Request Body

```json
{
  "messages": [
    { "role": "user", "content": "First message" },
    { "role": "assistant", "content": "First response" },
    { "role": "user", "content": "Second message" },
    { "role": "assistant", "content": "Second response" },
    { "role": "user", "content": "Third message" },
    { "role": "assistant", "content": "Third response" }
  ],
  "instructions": "Focus on decisions and open questions",
  "keep_recent": 2
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `messages` | Yes | Conversation history to compact |
| `instructions` | No | Custom instructions for summarization |
| `keep_recent` | No | Number of recent messages to preserve (default: 2) |

### Response

```json
{
  "status": "ok",
  "compacted_messages": [
    { "role": "system", "content": "[Previous conversation summary]\nUser discussed project ideas..." },
    { "role": "user", "content": "Third message" },
    { "role": "assistant", "content": "Third response" }
  ],
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 100,
    "total_tokens": 600
  },
  "original_count": 6,
  "compacted_count": 3
}
```

### How Compaction Works

1. Older messages are summarized into a single system message
2. Recent messages (specified by `keep_recent`) are preserved verbatim
3. The summarized history can be passed back in subsequent `/api/agents/send` requests

### When to Compact

- When `context_warning` appears in responses
- When conversation history exceeds ~50 messages
- Periodically to keep sessions responsive

---

## GET /health

Enhanced health check endpoint with component status.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `deep` | Set to `true` to probe backend connectivity (adds latency) |

### Response

```json
{
  "status": "ok",
  "workspace": {
    "path": "/path/to/workspace",
    "status": "ok",
    "maxCharsPerFile": 20000
  },
  "backend": {
    "url": "http://localhost:8000",
    "status": "unchecked"
  },
  "database": {
    "path": "./clasper.db",
    "status": "ok",
    "tables": {
      "traces": 1250,
      "audit_log": 15000,
      "skill_registry": 25
    }
  },
  "config": {
    "port": 8081,
    "defaultTask": "My Agent Thread",
    "model": "gpt-4o-mini",
    "fallbackModel": "gpt-4o-mini"
  }
}
```

### Status Values

| Component | Status | Description |
|-----------|--------|-------------|
| `status` | `ok` | All components healthy |
| `status` | `degraded` | One or more components have issues |
| `workspace.status` | `ok` | Workspace path exists and is accessible |
| `workspace.status` | `missing` | Workspace path does not exist |
| `backend.status` | `ok` | Backend /health returned 200 |
| `backend.status` | `error` | Backend unreachable or returned error |
| `backend.status` | `unchecked` | Backend not probed (use `?deep=true`) |
| `database.status` | `ok` | Database initialized and accessible |
| `database.status` | `error` | Database initialization failed |

## GET /context

Context stats endpoint for prompt size visibility. Following OpenClaw's `/context` pattern.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `role` | Optional agent role for soul file lookup |

### Response

```json
{
  "workspacePath": "/path/to/workspace",
  "maxCharsPerFile": 20000,
  "files": [
    {
      "name": "AGENTS.md",
      "exists": true,
      "rawChars": 1500,
      "injectedChars": 1500,
      "truncated": false,
      "estimatedTokens": 375
    },
    {
      "name": "SOUL.md",
      "exists": true,
      "rawChars": 25000,
      "injectedChars": 20000,
      "truncated": true,
      "estimatedTokens": 5000
    }
  ],
  "totalBootstrapChars": 21500,
  "systemPromptChars": 22000,
  "estimatedSystemPromptTokens": 5500
}
```

### File Stats

| Field | Description |
|-------|-------------|
| `name` | Bootstrap file name |
| `exists` | Whether the file exists in workspace |
| `rawChars` | Original file size in characters |
| `injectedChars` | Size after truncation (if any) |
| `truncated` | Whether file was truncated |
| `estimatedTokens` | Rough token estimate (~4 chars/token) |

---

# Observability & Tracing

## GET /traces

List traces with optional filtering.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `tenant_id` | Filter by tenant ID |
| `agent_id` | Filter by agent ID |
| `status` | Filter by status (`success`, `error`, `timeout`) |
| `label` | Filter by label key |
| `label_value` | Filter by label value (requires `label`) |
| `limit` | Maximum results (default: 50, max: 100) |
| `offset` | Pagination offset |

### Response

```json
{
  "traces": [
    {
      "id": "0194c8f0-7e1a-7000-8000-000000000001",
      "tenant_id": "tenant-123",
      "agent_id": "jarvis",
      "status": "success",
      "start_time": "2026-02-01T19:30:00.000Z",
      "end_time": "2026-02-01T19:30:02.500Z",
      "duration_ms": 2500,
      "total_tokens": 1500,
      "total_cost": 0.00025,
      "labels": { "baseline": "true" }
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

---

## GET /traces/:id

Get full trace details including all steps.

### Response

```json
{
  "id": "0194c8f0-7e1a-7000-8000-000000000001",
  "tenant_id": "tenant-123",
  "agent_id": "jarvis",
  "workspace_hash": "abc123...",
  "skill_versions": { "summarize": "1.2.0" },
  "status": "success",
  "start_time": "2026-02-01T19:30:00.000Z",
  "end_time": "2026-02-01T19:30:02.500Z",
  "duration_ms": 2500,
  "labels": { "baseline": "true" },
  "task_id": "task-456",
  "document_id": "doc-789",
  "message_id": "msg-012",
  "steps": [
    {
      "type": "llm_call",
      "model": "gpt-4o-mini",
      "prompt_tokens": 1200,
      "completion_tokens": 300,
      "duration_ms": 2000,
      "timestamp": "2026-02-01T19:30:00.500Z"
    },
    {
      "type": "tool_call",
      "tool_name": "search",
      "input": { "query": "..." },
      "output": { "results": [...] },
      "duration_ms": 500,
      "timestamp": "2026-02-01T19:30:02.000Z"
    }
  ],
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 300,
    "total_tokens": 1500
  },
  "cost": {
    "model": "gpt-4o-mini",
    "totalCost": 0.00025,
    "currency": "USD"
  }
}
```

---

## POST /traces/diff (v1.1)

Compare two traces and return differences.

### Request Body

```json
{
  "base_trace_id": "trace-id-1",
  "compare_trace_id": "trace-id-2",
  "include_summary": true
}
```

### Response

```json
{
  "diff": {
    "traceIds": { "base": "trace-id-1", "compare": "trace-id-2" },
    "model": { "changed": true, "baseModel": "gpt-4", "compareModel": "gpt-4o-mini" },
    "cost": { "baseCost": 0.05, "compareCost": 0.01, "delta": -0.04, "percentChange": -80 },
    "skills": { "added": {}, "removed": {}, "changed": { "summarize": { "base": "1.0.0", "compare": "1.1.0" } } },
    "toolCalls": { "baseCount": 3, "compareCount": 2 },
    "summary": { "totalDifferences": 4, "significantChanges": ["model", "cost", "skills"] }
  },
  "summary_text": "Compared traces trace-id-1 vs trace-id-2: Model changed (gpt-4 → gpt-4o-mini), cost decreased by 80%..."
}
```

---

## POST /traces/:id/label (v1.1)

Add or update labels on a trace.

### Request Body

```json
{
  "labels": {
    "baseline": "true",
    "reviewed": "approved"
  }
}
```

### Response

```json
{
  "status": "ok",
  "trace_id": "trace-id",
  "labels": { "baseline": "true", "reviewed": "approved" }
}
```

---

## POST /traces/:id/annotate (v1.1)

Add an annotation to a trace (append-only).

### Request Body

```json
{
  "key": "incident",
  "value": "INC-123",
  "created_by": "user@example.com"
}
```

### Response

```json
{
  "status": "ok",
  "annotation": {
    "id": 1,
    "traceId": "trace-id",
    "key": "incident",
    "value": "INC-123",
    "createdAt": "2026-02-01T19:30:00.000Z",
    "createdBy": "user@example.com"
  }
}
```

---

## GET /traces/:id/annotations (v1.1)

Get all annotations for a trace.

### Response

```json
{
  "annotations": [
    { "id": 1, "key": "incident", "value": "INC-123", "createdAt": "..." },
    { "id": 2, "key": "reviewed", "value": "true", "createdAt": "..." }
  ]
}
```

---

## GET /traces/by-label (v1.1)

Find traces by label.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `label` | Label key to search for |
| `value` | Optional label value to match |
| `limit` | Maximum results |

### Response

```json
{
  "traces": ["trace-id-1", "trace-id-2"],
  "total": 2
}
```

---

## GET /traces/by-entity (v1.1)

Find traces linked to a specific entity (task, document, message).

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `task_id` | Find traces for this task |
| `document_id` | Find traces for this document |
| `message_id` | Find traces for this message |
| `limit` | Maximum results |

### Response

```json
{
  "traces": [...],
  "total": 5
}
```

---

## GET /traces/:id/replay

Get context needed to replay a trace with different parameters.

### Response

```json
{
  "trace_id": "0194c8f0-7e1a-7000-8000-000000000001",
  "original_request": { ... },
  "workspace_snapshot": { ... },
  "skill_versions": { "summarize": "1.2.0" }
}
```

---

## GET /traces/stats

Get trace statistics.

### Response

```json
{
  "total_traces": 1250,
  "traces_by_status": {
    "success": 1200,
    "error": 45,
    "timeout": 5
  },
  "avg_duration_ms": 1850,
  "total_tokens": 2500000,
  "total_cost": 0.42
}
```

---

# Retention Policies (v1.1)

## POST /retention/policy

Set or update retention policy for a tenant.

### Request Body

```json
{
  "tenant_id": "tenant-123",
  "retention_days": 30,
  "sampling_strategy": "full",
  "storage_mode": "full"
}
```

### Sampling Strategies

| Strategy | Description |
|----------|-------------|
| `full` | Retain all traces |
| `errors_only` | Only retain traces with errors |
| `sampled` | Retain a percentage of traces |

### Response

```json
{
  "status": "ok",
  "policy": { ... }
}
```

---

## GET /retention/policy

Get retention policy for a tenant.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `tenant_id` | Tenant ID to query |

### Response

```json
{
  "policy": {
    "tenantId": "tenant-123",
    "retentionDays": 30,
    "samplingStrategy": "full",
    "storageMode": "full"
  }
}
```

---

## POST /retention/enforce

Enforce retention policy (delete expired traces).

### Request Body

```json
{
  "tenant_id": "tenant-123"
}
```

### Response

```json
{
  "status": "ok",
  "result": {
    "tenantId": "tenant-123",
    "tracesDeleted": 150,
    "oldestRemainingTrace": "2026-01-15T00:00:00.000Z"
  }
}
```

---

## GET /retention/stats

Get retention statistics.

### Response

```json
{
  "totalPolicies": 10,
  "avgRetentionDays": 45,
  "tenantsByStrategy": {
    "full": 7,
    "errors_only": 2,
    "sampled": 1
  }
}
```

---

# Skill Registry

## POST /skills/publish

Publish a skill to the registry.

### Request Body

```yaml
name: ticket_summarizer
version: 1.2.0
description: Summarizes support tickets
inputs:
  ticket_id:
    type: string
    description: The ticket ID to summarize
    required: true
outputs:
  summary:
    type: string
    description: Summary of the ticket
  sentiment:
    type: string
    enum: [positive, neutral, negative]
permissions:
  tools:
    - read_ticket
    - get_user
gates:
  env:
    - TICKET_API_KEY
tests:
  - name: happy_path
    input: { ticket_id: "T-123" }
    expected_output: { sentiment: "positive" }
instructions: |
  When summarizing a ticket:
  1. Read the full ticket content
  2. Extract key issues and resolution
  3. Determine overall sentiment
```

### Response

```json
{
  "status": "ok",
  "skill": {
    "name": "ticket_summarizer",
    "version": "1.2.0",
    "state": "draft",
    "checksum": "sha256:abc123...",
    "published_at": "2026-02-01T19:30:00.000Z",
    "published_by": "user-123"
  }
}
```

---

## GET /skills/registry/:name

Get a skill from the registry.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `version` | Specific version (default: latest) |

### Response

```json
{
  "name": "ticket_summarizer",
  "version": "1.2.0",
  "state": "active",
  "description": "Summarizes support tickets",
  "checksum": "sha256:abc123...",
  "published_at": "2026-02-01T19:30:00.000Z",
  "manifest": { ... }
}
```

---

## GET /skills/registry/:name/versions

List all versions of a skill.

### Response

```json
{
  "name": "ticket_summarizer",
  "versions": [
    { "version": "1.2.0", "state": "active", "published_at": "2026-02-01T19:30:00.000Z" },
    { "version": "1.1.0", "state": "deprecated", "published_at": "2026-01-15T10:00:00.000Z" },
    { "version": "1.0.0", "state": "deprecated", "published_at": "2026-01-01T12:00:00.000Z" }
  ]
}
```

---

## POST /skills/:name/:version/promote (v1.1)

Promote a skill through lifecycle states.

### Request Body

```json
{
  "target_state": "active"
}
```

### Skill States

| State | Description |
|-------|-------------|
| `draft` | Initial state, not executable |
| `tested` | Tests have passed |
| `approved` | Manually approved |
| `active` | Executable in production |
| `deprecated` | Still executable but warns |

### State Transitions

- `draft` → `tested` (tests must pass)
- `tested` → `approved` (optional approval step)
- `tested` → `active` (direct promotion)
- `approved` → `active`
- `active` → `deprecated`

### Response

```json
{
  "status": "ok",
  "skill": {
    "name": "ticket_summarizer",
    "version": "1.2.0",
    "state": "active",
    "previousState": "tested"
  }
}
```

---

## GET /skills/:name/:version/state (v1.1)

Get the current state of a skill.

### Response

```json
{
  "name": "ticket_summarizer",
  "version": "1.2.0",
  "state": "active",
  "updatedAt": "2026-02-01T19:30:00.000Z"
}
```

---

## GET /skills/by-state (v1.1)

List skills by state.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `state` | State to filter by |

### Response

```json
{
  "skills": [
    { "name": "ticket_summarizer", "version": "1.2.0", "state": "active" },
    { "name": "email_parser", "version": "2.0.0", "state": "active" }
  ]
}
```

---

## POST /skills/registry/:name/test

Run tests defined in a skill manifest.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `version` | Specific version (default: latest) |

### Response

```json
{
  "skill": "ticket_summarizer",
  "version": "1.2.0",
  "results": [
    {
      "name": "happy_path",
      "status": "passed",
      "duration_ms": 1500
    },
    {
      "name": "error_handling",
      "status": "failed",
      "error": "Expected error message not found",
      "duration_ms": 800
    }
  ],
  "summary": {
    "total": 2,
    "passed": 1,
    "failed": 1
  }
}
```

---

# Governance

## GET /audit

Query the audit log.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `tenant_id` | Filter by tenant ID |
| `event_type` | Filter by event type |
| `trace_id` | Filter by trace ID |
| `start_time` | Start of time range (ISO 8601) |
| `end_time` | End of time range (ISO 8601) |
| `limit` | Maximum results (default: 100) |
| `offset` | Pagination offset |

### Event Types

- `agent.start`, `agent.complete`, `agent.error`
- `tool.call`, `tool.denied`
- `skill.publish`, `skill.test`, `skill_state_changed`, `skill_deprecated_used`
- `budget.exceeded`, `budget.warning`
- `permission.denied`
- `workspace.snapshot`, `workspace.rollback`

### Response

```json
{
  "entries": [
    {
      "id": 12345,
      "timestamp": "2026-02-01T19:30:00.000Z",
      "event_type": "tool.denied",
      "tenant_id": "tenant-123",
      "trace_id": "0194c8f0-7e1a-7000-8000-000000000001",
      "actor": "agent:jarvis",
      "details": {
        "tool": "delete_user",
        "reason": "Not in skill permissions"
      }
    }
  ],
  "total": 500,
  "limit": 100,
  "offset": 0
}
```

---

## GET /audit/stats

Get audit log statistics.

### Response

```json
{
  "total_entries": 15000,
  "entries_by_type": {
    "agent.complete": 5000,
    "tool.call": 8000,
    "tool.denied": 150,
    "permission.denied": 50
  },
  "entries_last_24h": 250,
  "oldest_entry": "2026-01-01T00:00:00.000Z"
}
```

---

## GET /budget

Get budget for a tenant.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `tenant_id` | Tenant ID (required) |

### Response

```json
{
  "tenant_id": "tenant-123",
  "budget": {
    "limit": 100.00,
    "spent": 42.50,
    "remaining": 57.50,
    "period": "monthly",
    "period_start": "2026-02-01T00:00:00.000Z",
    "period_end": "2026-02-28T23:59:59.999Z"
  },
  "alerts": {
    "soft_limit": 75.00,
    "hard_limit": 100.00
  }
}
```

---

## POST /budget

Set or update budget for a tenant.

### Request Body

```json
{
  "tenant_id": "tenant-123",
  "limit": 100.00,
  "period": "monthly",
  "soft_limit": 75.00,
  "hard_limit": 100.00
}
```

### Response

```json
{
  "status": "ok",
  "budget": { ... }
}
```

---

## POST /budget/check

Check if a spend amount is within budget.

### Request Body

```json
{
  "tenant_id": "tenant-123",
  "amount": 5.00
}
```

### Response

```json
{
  "allowed": true,
  "remaining_after": 52.50,
  "warnings": []
}
```

Or if over budget:

```json
{
  "allowed": false,
  "remaining": 2.50,
  "requested": 5.00,
  "error": "Exceeds hard limit"
}
```

---

## POST /cost/forecast (v1.1)

Estimate cost before execution.

### Request Body

```json
{
  "tenant_id": "tenant-123",
  "model": "gpt-4",
  "estimated_input_tokens": 5000,
  "estimated_output_tokens": 1000
}
```

### Response

```json
{
  "status": "ok",
  "forecast": {
    "estimatedCost": 0.21,
    "budgetRemaining": 57.50,
    "wouldExceedBudget": false,
    "recommendation": "ok"
  }
}
```

---

## POST /risk/score (v1.1)

Calculate risk score for an execution.

### Request Body

```json
{
  "tool_count": 5,
  "tool_names": ["search", "execute_code"],
  "skill_state": "draft",
  "temperature": 1.0,
  "data_sensitivity": "pii"
}
```

### Response

```json
{
  "status": "ok",
  "risk": {
    "score": 72,
    "level": "high",
    "factors": {
      "toolBreadth": 60,
      "skillMaturity": 60,
      "modelVolatility": 50,
      "dataSensitivity": 100
    },
    "riskFactors": [
      "Skill is in draft state",
      "High temperature (1.0) increases variability",
      "PII data is being processed"
    ],
    "recommendations": [
      "Promote skill to tested or active state",
      "Consider lowering temperature for more consistent output",
      "Enable PII redaction"
    ]
  }
}
```

---

# Workspace (v1.1)

## POST /workspace/pin (v1.1)

Pin a workspace version for an environment.

### Request Body

```json
{
  "workspace_id": "workspace-123",
  "environment": "prod",
  "version_hash": "abc123...",
  "skill_pins": {
    "summarizer": "1.2.0"
  },
  "model_pin": "gpt-4",
  "provider_pin": "openai",
  "pinned_by": "user@example.com"
}
```

### Response

```json
{
  "status": "ok",
  "pin": {
    "workspaceId": "workspace-123",
    "environment": "prod",
    "versionHash": "abc123...",
    "skillPins": { "summarizer": "1.2.0" },
    "modelPin": "gpt-4",
    "providerPin": "openai",
    "pinnedAt": "2026-02-01T19:30:00.000Z"
  }
}
```

---

## GET /workspace/pin (v1.1)

Get pin for a workspace/environment.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `workspace_id` | Workspace ID |
| `environment` | Environment (default: `default`) |

### Response

```json
{
  "pin": { ... }
}
```

---

## GET /workspace/:id/pins (v1.1)

List all pins for a workspace.

### Response

```json
{
  "pins": [
    { "environment": "dev", "versionHash": "...", ... },
    { "environment": "staging", "versionHash": "...", ... },
    { "environment": "prod", "versionHash": "...", ... }
  ]
}
```

---

## DELETE /workspace/pin (v1.1)

Remove a workspace pin.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `workspace_id` | Workspace ID |
| `environment` | Environment |

### Response

```json
{
  "status": "ok",
  "deleted": true
}
```

---

## POST /workspace/envs (v1.1)

Create or update a workspace environment.

### Request Body

```json
{
  "workspace_id": "workspace-123",
  "environment": "staging",
  "description": "Staging environment",
  "version_hash": "abc123...",
  "is_default": false,
  "locked": false
}
```

### Response

```json
{
  "status": "ok",
  "environment": { ... }
}
```

---

## GET /workspace/envs (v1.1)

List environments for a workspace.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `workspace_id` | Workspace ID |

### Response

```json
{
  "environments": [
    { "environment": "dev", "isDefault": true, "locked": false, ... },
    { "environment": "staging", "isDefault": false, "locked": false, ... },
    { "environment": "prod", "isDefault": false, "locked": true, ... }
  ]
}
```

---

## POST /workspace/envs/promote (v1.1)

Promote from one environment to another.

### Request Body

```json
{
  "workspace_id": "workspace-123",
  "source_env": "staging",
  "target_env": "prod"
}
```

### Response

```json
{
  "status": "ok",
  "result": {
    "success": true,
    "sourceEnv": "staging",
    "targetEnv": "prod",
    "versionHash": "abc123..."
  }
}
```

---

## POST /workspace/envs/init (v1.1)

Initialize standard environments (dev, staging, prod).

### Request Body

```json
{
  "workspace_id": "workspace-123",
  "default_env": "dev"
}
```

### Response

```json
{
  "status": "ok",
  "environments": [
    { "environment": "dev", "isDefault": true, "locked": false },
    { "environment": "staging", "isDefault": false, "locked": false },
    { "environment": "prod", "isDefault": false, "locked": true }
  ]
}
```

---

## POST /workspace/impact (v1.1)

Analyze impact of workspace changes.

### Request Body

```json
{
  "workspace_path": "/path/to/workspace",
  "old_hash": "abc123...",
  "new_hash": "def456..."
}
```

### Response

```json
{
  "status": "ok",
  "analysis": {
    "summary": {
      "totalFilesChanged": 5,
      "skillsAffected": 2,
      "permissionsChanged": 1,
      "estimatedCostImpact": "increase"
    },
    "fileChanges": {
      "added": ["skills/new-skill.md"],
      "modified": ["SOUL.md"],
      "deleted": []
    },
    "affectedSkills": [
      { "name": "summarizer", "changeType": "modified" }
    ],
    "recommendations": [
      "Run skill tests before deployment",
      "Review permission changes"
    ],
    "risk": {
      "level": "medium",
      "factors": ["Permission changes (1)"]
    }
  }
}
```

---

# Control Plane (v1.1)

## GET /api/version (v1.1)

Get Clasper version and capabilities.

### Response

```json
{
  "version": "1.1.0",
  "contractVersion": "1.1.0",
  "features": [
    "trace_diff",
    "trace_annotations",
    "trace_retention",
    "skill_lifecycle",
    "workspace_pinning",
    "workspace_environments",
    "cost_forecasting",
    "risk_scoring",
    "control_plane_versioning",
    "trace_linking",
    "impact_analysis"
  ]
}
```

---

## GET /api/compatibility (v1.1)

Check compatibility with control plane.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `control_plane_url` | URL of control plane to check |

### Response

```json
{
  "compatible": true,
  "clasperContractVersion": "1.1.0",
  "controlPlaneContractVersion": "1.1.0",
  "warnings": [],
  "missingFeatures": []
}
```

---

# Evaluations

## POST /evals/run

Run an evaluation dataset against an agent.

### Request Body

```json
{
  "name": "ticket-summarizer-eval",
  "cases": [
    {
      "id": "case-1",
      "input": { "ticket_id": "T-123" },
      "expected_output": { "sentiment": "positive" }
    },
    {
      "id": "case-2", 
      "input": { "ticket_id": "T-456" },
      "expected_output": { "sentiment": "negative" }
    }
  ],
  "options": {
    "skill": "ticket_summarizer",
    "skill_version": "1.2.0",
    "model": "gpt-4o-mini"
  }
}
```

### Response

```json
{
  "id": "eval-0194c8f0-7e1a-7000-8000-000000000001",
  "status": "completed",
  "started_at": "2026-02-01T19:30:00.000Z",
  "completed_at": "2026-02-01T19:30:15.000Z",
  "results": [
    {
      "case_id": "case-1",
      "status": "passed",
      "actual_output": { "sentiment": "positive" },
      "score": 1.0
    },
    {
      "case_id": "case-2",
      "status": "failed",
      "actual_output": { "sentiment": "neutral" },
      "expected_output": { "sentiment": "negative" },
      "score": 0.0
    }
  ],
  "summary": {
    "total": 2,
    "passed": 1,
    "failed": 1,
    "avg_score": 0.5
  }
}
```

---

## GET /evals/:id

Get evaluation result by ID.

### Response

Same as POST /evals/run response.

---

## GET /evals

List evaluation results.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `skill` | Filter by skill name |
| `limit` | Maximum results (default: 50) |
| `offset` | Pagination offset |

### Response

```json
{
  "evaluations": [
    {
      "id": "eval-...",
      "name": "ticket-summarizer-eval",
      "skill": "ticket_summarizer",
      "completed_at": "2026-02-01T19:30:15.000Z",
      "summary": { "total": 2, "passed": 1, "failed": 1, "avg_score": 0.5 }
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

---

# Database

## GET /db/stats

Get database statistics.

### Response

```json
{
  "path": "./clasper.db",
  "size_bytes": 1048576,
  "tables": {
    "traces": 1250,
    "trace_annotations": 500,
    "audit_log": 15000,
    "skill_registry": 25,
    "tenant_budgets": 10,
    "tenant_retention_policies": 5,
    "workspace_versions": 50,
    "workspace_pins": 15,
    "workspace_environments": 30,
    "eval_results": 100
  }
}
```
