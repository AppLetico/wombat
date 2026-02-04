# Quickstart

This guide covers everything you need to run Clasper end-to-end.

## Prerequisites

- Node.js 18+
- OpenAI API key (or other LLM provider)

---

## Step 1: Install Clasper

```bash
git clone <repo-url>
cd clasper
npm install
cp .env.example .env
```

---

## Step 2: Set Up a Backend

Clasper is **stateless** — it needs a backend to store tasks, messages, and documents. Choose one option:

### Option A: Reference Implementation (for testing)

Run the in-memory reference backend:

```bash
export AGENT_JWT_SECRET=dev-secret-change-me
npx tsx examples/mission-control-lite/server.ts
```

This starts a backend at `http://localhost:9001` with all required endpoints.

### Option B: Use an Existing Backend

If you have a Mission Control-compatible backend, configure Clasper to point to it:

```bash
# In .env
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=<same-secret-as-backend>
```

See [INTEGRATION.md](INTEGRATION.md) for detailed integration patterns.

### Option C: Build Your Own Backend

Your backend must implement these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/mission-control/capabilities` | GET | Feature discovery |
| `/api/mission-control/tasks` | GET | List tasks for user |
| `/api/mission-control/tasks` | POST | Create a task |
| `/api/mission-control/messages` | POST | Post a message |
| `/api/mission-control/documents` | POST | Create a document |

**Requirements:**

1. **Shared secret** — Clasper and your backend must share the same `AGENT_JWT_SECRET`
2. **Agent token auth** — Accept `X-Agent-Token` header with JWT containing `type`, `user_id`, `agent_role`
3. **Tenant isolation** — Scope all reads/writes by `user_id` from the token
4. **Idempotency** — Create endpoints must accept `idempotency_key`

**Validate your implementation:**

```bash
export CONTROL_PLANE_URL=http://localhost:8000
export AGENT_TOKEN=<your-agent-jwt>
npm run conformance
```

See [CONTROL_PLANE_CONTRACT.md](CONTROL_PLANE_CONTRACT.md) for the full specification.

---

## Step 3: Create a Workspace

The workspace defines your agent's personality and behavior:

```bash
mkdir -p workspace/souls workspace/skills
```

**Required: `workspace/AGENTS.md`** — Operating rules:

```markdown
# Operating Rules

- Be helpful and accurate
- Keep responses concise
- Ask for clarification when needed
```

**Required: `workspace/SOUL.md`** — Agent persona (or `souls/<role>.md` for multi-agent):

```markdown
# Agent Persona

You are a helpful assistant.

## Communication style
- Direct and clear
- Evidence-based answers
```

**Optional files:**
- `IDENTITY.md` — Branding (name, tagline)
- `HEARTBEAT.md` — Checklist for autonomous health checks
- `skills/<name>/SKILL.md` — Skill definitions for tool use

See [WORKSPACE.md](WORKSPACE.md) for the full specification.

---

## Step 4: Configure Environment

Edit `.env`:

```bash
# Backend connection
BACKEND_URL=http://localhost:9001   # or your backend URL
AGENT_JWT_SECRET=dev-secret-change-me

# LLM provider
OPENAI_API_KEY=sk-...

# Workspace path (default: ./workspace)
CLASPER_WORKSPACE=./workspace

# Optional: auto-create task with this title
CLASPER_DEFAULT_TASK=My Agent Thread
```

---

## Step 5: Start the Daemon

```bash
npm run dev
```

Clasper starts at `http://localhost:8081`.

**Verify it's running:**

```bash
curl http://localhost:8081/health
# {"status":"ok"}
```

---

## Step 6: Send Your First Message

```bash
curl -X POST http://localhost:8081/api/agents/send \
  -H "Content-Type: application/json" \
  -H "X-Daemon-Key: <your-daemon-key>" \
  -d '{
    "user_id": "user-123",
    "agent_role": "default",
    "message": "Hello, what can you help me with?"
  }'
```

---

## Common Commands

```bash
# Development server
npm run dev

# Production build
npm run build && npm start

# Run dispatcher (delivers notifications from backend to daemon)
npm run dispatcher

# Run heartbeat check
USER_ID=user-123 AGENT_ROLE=default npm run heartbeat

# Run conformance tests against your backend
npm run conformance

# Run unit tests
npm test
```

---

## Docker

```bash
cp .env.example .env
# Edit .env with your settings
docker compose up --build
```

---

## Ops Console (Optional)

The Operations Console at `/ops` provides trace viewing, replay, and governance controls. It requires OIDC authentication:

```bash
OPS_OIDC_ISSUER=https://your-idp.com
OPS_OIDC_AUDIENCE=clasper-ops
OPS_OIDC_JWKS_URL=https://your-idp.com/.well-known/jwks.json
OPS_RBAC_CLAIM=roles
```

See [GOVERNANCE.md](GOVERNANCE.md) for RBAC configuration.

---

## Next Steps

| Document | Description |
|----------|-------------|
| [INTEGRATION.md](INTEGRATION.md) | Backend ↔ Clasper integration patterns |
| [WORKSPACE.md](WORKSPACE.md) | Full workspace specification |
| [API.md](API.md) | API reference |
| [CONTROL_PLANE_CONTRACT.md](CONTROL_PLANE_CONTRACT.md) | Backend contract specification |
| [OPERATIONS.md](OPERATIONS.md) | Tracing, replay, and skill lifecycle |
| [GOVERNANCE.md](GOVERNANCE.md) | RBAC, budgets, and audit |
