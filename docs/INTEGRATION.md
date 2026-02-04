# Integration Guide

Clasper is an **agent runtime** that works alongside your backend SaaS application. It doesn't replace your backend — it extends it with AI agent capabilities while your backend remains the source of truth for all data.

**The core idea**: Your backend sends messages to Clasper, Clasper calls an LLM, and the agent's response may include API calls back to your backend to read/write data. This bidirectional relationship is what makes agents useful.

## System Architecture

A typical deployment runs 5 processes that work together:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INFRASTRUCTURE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐       │
│   │   Frontend   │         │   Database   │         │    Redis     │       │
│   │  (SvelteKit) │         │ (PostgreSQL) │         │   (Queue)    │       │
│   └──────┬───────┘         └──────▲───────┘         └──────▲───────┘       │
│          │                        │                        │               │
│          │ HTTP                   │ SQL                    │ Jobs          │
│          ▼                        │                        │               │
│   ┌──────────────────────────────┴────────────────────────┴──────┐         │
│   │                         Backend API                          │         │
│   │                      (FastAPI :8000)                         │         │
│   │  • REST endpoints    • Mission Control    • Auth/Sessions    │         │
│   └──────────────────────────────┬───────────────────────────────┘         │
│                                  │                                          │
│          ┌───────────────────────┼───────────────────────┐                 │
│          │                       │                       │                 │
│          ▼                       ▼                       ▼                 │
│   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐         │
│   │   Worker    │         │   Clasper    │◀────────│ Dispatcher  │         │
│   │ (Celery)    │         │   Daemon    │         │  (Poller)   │         │
│   │             │         │   (:8081)   │         │             │         │
│   │ • Async     │         │             │         │ • Polls     │         │
│   │   tasks     │         │ • Agent     │         │   undelivered│        │
│   │ • School    │         │   runtime   │         │   notifs    │         │
│   │   analysis  │         │ • LLM calls │         │ • Forwards  │         │
│   └─────────────┘         │ • Skills    │         │   to daemon │         │
│                           └──────┬──────┘         └─────────────┘         │
│                                  │                                          │
│                                  │ API calls                               │
│                                  ▼                                          │
│                           ┌─────────────┐                                  │
│                           │   OpenAI    │                                  │
│                           │  (LLM API)  │                                  │
│                           └─────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Process summary:**

| Process | Port | Command | Purpose |
|---------|------|---------|---------|
| Backend API | 8000 | `make dev` | REST API, Mission Control, auth |
| Worker | - | `make dev-worker` | Async tasks (Celery) |
| Frontend | 5173 | `npm run dev` | Web UI |
| Clasper Daemon | 8081 | `make dev` | Agent runtime, LLM orchestration |
| Dispatcher | - | `npm run dispatcher` | Notification delivery loop |

## The Backend ↔ Clasper Relationship

This is the key concept to understand: **Clasper and your backend have a bidirectional relationship**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ┌─────────────┐                              ┌─────────────┐          │
│   │    Your     │ ────── (1) sends message ──▶ │   Clasper    │          │
│   │   Backend   │                              │   Daemon    │          │
│   │             │ ◀─ (2) agent calls APIs ──── │             │          │
│   │             │                              │             │          │
│   │  • Database │                              │  • Stateless│          │
│   │  • Users    │ ◀─ (3) dispatcher polls ──── │  • LLM calls│          │
│   │  • Tasks    │                              │  • Skills   │          │
│   │  • Notifs   │                              │             │          │
│   └─────────────┘                              └─────────────┘          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### How it works

1. **Backend → Clasper**: Your backend sends user messages to Clasper via `POST /api/agents/send`. The payload includes `user_id`, `session_key`, and the message.

2. **Clasper → OpenAI → Backend**: Clasper loads the workspace config (AGENTS.md, souls, skills), builds a system prompt, calls OpenAI, and the agent's response may include API calls back to your backend (Mission Control).

3. **Clasper → Backend (writes)**: The agent can create tasks, post messages, create documents, etc. by calling your backend's Mission Control APIs. Clasper mints a short-lived JWT for these calls.

4. **Backend → Clasper (dispatcher)**: The dispatcher polls your backend for undelivered notifications and forwards them to the Clasper daemon, triggering agent responses.

### Key insight: Clasper is stateless

Clasper doesn't store user data, conversation history, or tasks. **Your backend is the source of truth**:

| What | Where it lives |
|------|----------------|
| User accounts, sessions | Backend database |
| Conversation history | Backend database (or passed in `messages[]`) |
| Tasks, documents, activity | Backend (Mission Control tables) |
| Agent personas, rules | Workspace files (in your backend repo) |
| LLM execution | Clasper (stateless, just routes requests) |

This means:
- You can run **multiple Clasper instances** behind a load balancer
- No sticky sessions needed
- If Clasper restarts, nothing is lost (state is in your backend)

### What your backend needs to implement

To integrate with Clasper, your backend needs **Mission Control APIs**:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/mission-control/tasks` | Create tasks |
| `GET /api/mission-control/tasks` | List tasks |
| `POST /api/mission-control/messages` | Post messages |
| `POST /api/mission-control/documents` | Create documents |
| `GET /api/mission-control/notifications` | Get notifications |
| `POST /api/mission-control/dispatch/undelivered` | For dispatcher |

See [CONTROL_PLANE_CONTRACT.md](CONTROL_PLANE_CONTRACT.md) for the full API spec.

## Backend Configuration

Clasper requires a Mission Control-compatible backend. Configure the connection:

```bash
# Required
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=your-secret-matching-backend
AGENT_JWT_ALGORITHM=HS256  # default
```

The daemon posts to these Mission Control endpoints:
- `POST /api/mission-control/messages` - Agent messages
- `POST /api/mission-control/documents` - Agent documents (plans, reports)
- `GET /api/mission-control/tasks` - Task lookup
- `POST /api/mission-control/tasks` - Task creation

## Workspace Configuration

Point clasper to your project's workspace folder:

```bash
# Relative or absolute path
CLASPER_WORKSPACE=./workspace
CLASPER_WORKSPACE=/path/to/project/agent-config

# Default task title (optional)
CLASPER_DEFAULT_TASK=Agent Thread
```

### Project Integration Pattern

For production projects, keep the workspace config **in your backend repo** (not in clasper). This keeps agent behavior version-controlled with the APIs the agents call.

**Example directory structure:**

```
your-backend/
├── app/                        # Backend code
├── agent-config/               # Clasper workspace config
│   ├── workspace/              # ← Set CLASPER_WORKSPACE to this
│   │   ├── AGENTS.md           # Operating rules
│   │   ├── IDENTITY.md         # Agent names/branding
│   │   ├── HEARTBEAT.md        # Heartbeat checklist
│   │   ├── souls/              # Per-agent personalities
│   │   │   ├── lead.md
│   │   │   ├── researcher.md
│   │   │   └── writer.md
│   │   └── skills/             # API usage instructions
│   │       └── task-management/SKILL.md
│   └── README.md
└── ...
```

**Running clasper for a project:**

```bash
# From clasper directory
CLASPER_WORKSPACE=/path/to/your-backend/agent-config/workspace make dev
```

See [docs/examples/multi-agent/](examples/multi-agent/) for a complete example workspace.

See [WORKSPACE.md](WORKSPACE.md) for workspace file specifications.

## Dispatcher

The dispatcher polls the backend for undelivered notifications and forwards them to the daemon:

```bash
# Must match backend INTERNAL_API_TOKEN
INTERNAL_API_TOKEN=your-internal-token

# Daemon URL (where dispatcher sends notifications)
AGENT_DAEMON_URL=http://localhost:8081

# Optional daemon auth key
AGENT_DAEMON_API_KEY=
```

Run the dispatcher:

```bash
npm run dispatcher
```

## Task Resolution

The daemon resolves tasks in priority order:

1. **`task_id`** in request - Use this specific task (backend-owned)
2. **`task_title`** in request - Find or create task with this title
3. **`CLASPER_DEFAULT_TASK`** env var - Fallback default

This enables flexible patterns:
- **Backend-owned**: Backend creates tasks, passes `task_id` to clasper
- **Clasper-owned**: Clasper auto-creates tasks with `task_title` or default

## API Example

`POST /api/agents/send`

```json
{
  "user_id": "uuid",
  "session_key": "user:{userId}:agent",
  "message": "Generate a plan for the project.",
  "task_title": "Project Planning",
  "metadata": {
    "kickoff_plan": true,
    "kickoff_note": "Draft a concise 3-step plan."
  }
}
```

With backend-owned task:

```json
{
  "user_id": "uuid",
  "session_key": "user:{userId}:agent",
  "message": "Continue working on this task.",
  "task_id": "existing-task-uuid"
}
```

## Authentication Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Backend │────▶│ Clasper  │────▶│ OpenAI  │
│         │     │ Daemon  │     │         │
└─────────┘     └─────────┘     └─────────┘
     │                │
     │ X-Internal-Token (dispatcher)
     │ X-Agent-Daemon-Key (optional)
     │                │
     │                ▼
     │         ┌─────────────┐
     │◀────────│ Agent JWT   │──── X-Agent-Token
     │         │ (minted by  │
     │         │  clasper)    │
     │         └─────────────┘
```

## Utilities

### Heartbeat

```bash
USER_ID=user-uuid AGENT_ROLE=agent npm run heartbeat
```

### Daily Standup

```bash
STANDUP_TIMEZONE=UTC npm run standup
```

## Example: Using with a New Project

1. Clone clasper to your dev environment
2. Create a workspace folder in your project repo:
   ```
   your-project/
   └── agent-config/
       ├── AGENTS.md
       ├── SOUL.md
       └── souls/
           └── specialist.md
   ```
3. Configure clasper:
   ```bash
   CLASPER_WORKSPACE=/path/to/your-project/agent-config
   CLASPER_DEFAULT_TASK=Your Project Task
   BACKEND_URL=http://your-backend:8000
   ```
4. Start clasper: `npm run dev`
