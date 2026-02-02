# Integration Guide

## Backend Configuration

Wombat requires a Mission Control-compatible backend. Configure the connection:

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

Point wombat to your project's workspace folder:

```bash
# Relative or absolute path
WOMBAT_WORKSPACE=./workspace
WOMBAT_WORKSPACE=/path/to/project/agent-config

# Default task title (optional)
WOMBAT_DEFAULT_TASK=Agent Thread
```

See [WORKSPACE.md](WORKSPACE.md) for workspace file specifications.

## Dispatcher

The dispatcher polls the backend for undelivered notifications and forwards them to the daemon:

```bash
# Must match backend INTERNAL_API_TOKEN
INTERNAL_TOKEN=your-internal-token

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
3. **`WOMBAT_DEFAULT_TASK`** env var - Fallback default

This enables flexible patterns:
- **Backend-owned**: Backend creates tasks, passes `task_id` to wombat
- **Wombat-owned**: Wombat auto-creates tasks with `task_title` or default

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
│ Backend │────▶│ Wombat  │────▶│ OpenAI  │
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
     │         │  wombat)    │
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

1. Clone wombat to your dev environment
2. Create a workspace folder in your project repo:
   ```
   your-project/
   └── agent-config/
       ├── AGENTS.md
       ├── SOUL.md
       └── souls/
           └── specialist.md
   ```
3. Configure wombat:
   ```bash
   WOMBAT_WORKSPACE=/path/to/your-project/agent-config
   WOMBAT_DEFAULT_TASK=Your Project Task
   BACKEND_URL=http://your-backend:8000
   ```
4. Start wombat: `npm run dev`
