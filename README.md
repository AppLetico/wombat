# Clasper Ops

<p align="center">
  <img src="clasper-banner.png" alt="Clasper" width="100%" />
</p>

<h2 align="center">Production Agent Runtime with Governance & Observability</h2>

<p align="center">
  <b>SHIP IT. DIG DEEP.</b>
  <br />
  <i>Safe, explainable, and shippable AI agents for multi-tenant SaaS backends.</i>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-1.2.1-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/built_with-TypeScript-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/status-Beta-yellow.svg" alt="Status">
</p>

---

**Clasper** is an API-first, stateless agent execution platform designed for **production SaaS integration**. It enables workspace-driven agents with **traceable behavior, governance controls, role-based access, cost/risk guards, and operational visibility** — suitable for multi-tenant backends and audit-intensive environments.

Inspired by [OpenClaw](https://openclaw.ai/)'s workspace pattern, Clasper adapts these ideas into a **multi-tenant, stateless, API-first orchestration and governance platform** for backend agents.

> *"AI agents are not demos. They are production systems."*
> Read the [Clasper Ops Manifesto](docs/MANIFESTO.md)

---

## What Clasper Is

- **Stateless HTTP runtime** for agent executions
- **Workspace-driven prompt config** (SOUL.md, AGENTS.md, HEARTBEAT.md, skills)
- **Multi-tenant context isolation** with per-user scoping
- **Skill registry** with versioning, lifecycle states, and testing
- **Observable and explainable traces** with diff, replay, and annotations
- **Operational guardrails** (RBAC, budgets, risk scoring, audit logs)
- **Control Plane Contract** for portable backend integration

## What Clasper Is Not

- A daemon for OS/browser automation (no shell access, no file system)
- A personal agent chatbot (designed for backend integration, not direct chat)
- A general automation framework like OpenClaw (stateless, no persistent sessions)
- A replacement for your backend (your system remains the source of truth)

---

## How Clasper Works With Your Backend

Clasper has a **bidirectional relationship** with your SaaS backend:

```
┌─────────────┐                              ┌─────────────┐
│   Your      │ ────── (1) send message ───▶ │   Clasper    │ ──▶ OpenAI
│   Backend   │                              │   Daemon    │
│             │ ◀── (2) agent calls APIs ─── │             │
└─────────────┘                              └─────────────┘
     │                                              │
     │  Source of truth:                            │  Stateless:
     │  • Users, auth                               │  • Loads workspace config
     │  • Tasks, messages                           │  • Builds prompts
     │  • Conversations                             │  • Routes LLM calls
     │  • Documents                                 │  • Mints agent JWTs
     └──────────────────────────────────────────────┘
```

1. **Your backend sends messages** to Clasper (`POST /api/agents/send`)
2. **Clasper calls an LLM** with workspace-configured prompts (personas, rules, skills)
3. **The agent response may call your APIs** to create tasks, post messages, etc.
4. **Your backend remains the source of truth** — Clasper is stateless

This means you can run multiple Clasper instances behind a load balancer with no sticky sessions.

See [INTEGRATION.md](docs/INTEGRATION.md) for the full integration guide.

---

## Core Pillars

| Pillar | Description |
|--------|-------------|
| **Agent Observability** | Full execution traces with replay, diff, annotations & retention policies |
| **Skill Runtime** | Versioned YAML manifests with lifecycle states and testing |
| **Governance & Safety** | Tenant isolation, permissions, audit logs, redaction, risk scoring |
| **Provider Abstraction** | Normalized interface across LLM providers |
| **Operational Tooling** | Budget controls, cost forecasting, workspace pinning, environments, impact analysis |

**Stack**: TypeScript + Fastify + SQLite | Multi-provider LLM | Full tracing | Budget controls | Risk scoring

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client / UI                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                     Clasper Ops API                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Agent API   │  │ Ops Console │  │ Governance              │  │
│  │ /api/agents │  │ /ops        │  │ RBAC, Budgets, Risk     │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         │                │                      │               │
│  ┌──────▼────────────────▼──────────────────────▼────────────┐  │
│  │                    Trace Store                            │  │
│  │           (SQLite: traces, audit, retention)              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Control Plane Contract (HTTP)
┌─────────────────────────────▼───────────────────────────────────┐
│                      Your Backend                               │
│              (Tasks, Documents, Notifications)                  │
└─────────────────────────────────────────────────────────────────┘
```

Clasper integrates with your backend via the **Control Plane Contract** — a standardized HTTP API for tasks, messages, and documents. Your backend remains the source of truth; Clasper handles reasoning, execution, and governance.

---

## Execution Modes

| Mode | Endpoint | Description |
|------|----------|-------------|
| **Request/Response** | `POST /api/agents/send` | Synchronous agent execution |
| **Streaming (SSE)** | `POST /api/agents/stream` | Real-time streaming responses |
| **LLM Task** | `POST /llm-task` | Structured JSON-only output |
| **Trace Replay** | `GET /traces/:id/replay` | Reproduce past executions |
| **Ops Console** | `/ops/*` | OIDC-protected operational UI |

---

## Operational Features

These are first-class capabilities, not afterthoughts:

### Execution Traces
- Full trace model with LLM calls, tool calls, costs, timing
- Trace diff API for debugging regressions
- Labels & annotations for trace organization
- Entity linking (task → trace → document)
- Per-tenant retention policies

### Role-Based Access Control (RBAC)
- Action-level permissions with enforced scopes
- Resolved permissions at `/ops/api/me`
- Tenant isolation via JWT claims
- Non-admin users never receive raw prompt/tool payloads

### Override Model
- Structured overrides with `reason_code` + `justification`
- All overrides audited as `ops_override_used`
- Break-glass workflow for emergency access

### Cost & Risk Controls
- Per-tenant budget controls (hard/soft limits)
- Pre-execution cost forecasting
- Risk scoring based on tool breadth, skill maturity, temperature, data sensitivity
- Dashboards with coverage metadata

### Environment & Promotion
- Workspace versioning with rollback
- Workspace pinning per environment (dev/staging/prod)
- Environment promotion flows with impact analysis
- Safe promotions with pre-flight checks

### Audit & Compliance
- Immutable audit logs for all actions
- PII redaction with configurable patterns
- Retention enforcement with cleanup
- Audit API with pagination (`GET /ops/api/audit`)

---

## Quickstart

### Fastest Start (One Command)

```bash
make setup
# Then edit .env (BACKEND_URL, AGENT_JWT_SECRET, LLM API keys) and run: make dev
```

`make setup` installs dependencies, copies `.env.example` to `.env` if missing, and scaffolds a workspace from the built-in template.

### Step-by-Step

#### 1) Install

```bash
npm install
cp .env.example .env
```

#### 2) Create a Workspace

Scaffold a workspace from the built-in template:

```bash
npm run init-workspace
# or: make workspace
# or: npx clasper init
```

#### 3) Configure Environment

```bash
# Required
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=your-secret

# LLM Provider
LLM_PROVIDER=openai  # openai, anthropic, google, xai, groq, mistral, openrouter
LLM_MODEL_DEFAULT=gpt-4o-mini

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# Workspace
CLASPER_WORKSPACE=./workspace

# Database (optional, defaults to ./clasper.db)
CLASPER_DB_PATH=./clasper.db
```

#### 4) Run

```bash
# Dev
npm run dev

# Prod
npm run build && npm start
```

#### 5) Configure Ops Console (Optional)

The Operations Console is served at `/ops` and is protected by OIDC + RBAC.

Required env vars:

```
OPS_OIDC_ISSUER=
OPS_OIDC_AUDIENCE=
OPS_OIDC_JWKS_URL=
OPS_RBAC_CLAIM=roles
OPS_TENANT_CLAIM=tenant_id
OPS_WORKSPACE_CLAIM=workspace_id
OPS_ALLOWED_TENANTS_CLAIM=allowed_tenants
```

Optional env vars:

```
# Deep link templates (use {id} placeholder)
DEEP_LINK_TASK_TEMPLATE=
DEEP_LINK_DOC_TEMPLATE=
DEEP_LINK_MSG_TEMPLATE=
```

---

## Clasper vs OpenClaw

Clasper was inspired by OpenClaw's workspace pattern but evolved for a different context: **multi-tenant SaaS backends** with **production governance requirements**.

| Feature | OpenClaw | Clasper |
|---------|----------|--------|
| **Deployment** | Persistent daemon | Stateless HTTP service |
| **Target context** | Single user / personal assistant | Multi-tenant SaaS backends |
| **Tools access** | High-privilege (shell, browser, filesystem) | API-scoped, safe tools via Control Plane |
| **Traceability** | Log history | Full trace model + replay + diff |
| **Governance** | Optional / user-controlled | Core enforced (RBAC, budgets, audit) |
| **RBAC** | Not natively supported | Built-in action-level permissions |
| **Cost controls** | Manual | Forecast + budgets + hard limits |
| **Risk visibility** | N/A | Risk scoring + dashboards |
| **Memory** | Local filesystem | Backend database via Control Plane |
| **Suitability** | Personal assistants | Production backend integrations |

### What Clasper Adopts from OpenClaw

| Pattern | Description |
|---------|-------------|
| `AGENTS.md` | Operating rules and safety guidelines |
| `SOUL.md` / `souls/<role>.md` | Agent personas (single or multi-agent) |
| `HEARTBEAT.md` | Periodic check-in checklist |
| `IDENTITY.md` | Agent branding and identity |
| `TOOLS.md` | Tool usage notes |
| `skills/*/SKILL.md` | OpenClaw-compatible skill format |
| `HEARTBEAT_OK` contract | Silent acknowledgment pattern |

### What Clasper Does Differently

| Pattern | OpenClaw | Clasper |
|---------|----------|--------|
| `memory/` directory | Local filesystem | Backend database |
| Session persistence | Persistent daemon state | Stateless (no sessions) |
| Self-modifying prompts | Agent can edit workspace | Workspace is read-only |
| Shell/browser access | Full system access | API-only via Control Plane |
| Cron jobs | Built-in scheduler | Backend handles scheduling |

---

## Control Plane Integration

Clasper integrates with your backend via the **Control Plane Contract v1** — a standardized HTTP API.

### Adoption Checklist

When integrating Clasper with a new backend:

- [ ] Implement the **Control Plane Contract v1** endpoints
- [ ] Ensure `X-Agent-Token` JWTs validate and enforce `user_id` scoping
- [ ] Support `idempotency_key` on create endpoints
- [ ] Run conformance: `npm run conformance`
- [ ] Optional: add notifications, SSE events, heartbeat/standup

### Required Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/mission-control/capabilities` | Feature discovery |
| `GET /api/mission-control/tasks` | List tasks |
| `POST /api/mission-control/tasks` | Create task |
| `POST /api/mission-control/messages` | Post message |
| `POST /api/mission-control/documents` | Create document |

### Optional Endpoints

| Feature | Endpoints |
|---------|-----------|
| Notifications | `GET /dispatch/undelivered`, `POST /dispatch/.../deliver` |
| Realtime (SSE) | `GET /events` |
| Heartbeat/Standup | `POST /heartbeat`, `POST /standup` |
| Tool approvals | `POST/GET/PATCH /tool-requests` |

See:
- [docs/CONTROL_PLANE_CONTRACT.md](docs/CONTROL_PLANE_CONTRACT.md)
- [docs/CONTROL_PLANE_QUICKSTART.md](docs/CONTROL_PLANE_QUICKSTART.md)
- [examples/mission-control-lite/](examples/mission-control-lite/)

---

## API Reference

### Core Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/agents/send` | Main request/response endpoint |
| `POST /api/agents/stream` | Streaming responses over SSE |
| `POST /compact` | Summarize conversation history |
| `POST /llm-task` | Structured JSON-only LLM tasks |
| `GET /health` | Component health + database status |

### Tracing & Observability

| Endpoint | Purpose |
|----------|---------|
| `GET /traces` | List traces with filtering |
| `GET /traces/:id` | Get full trace details |
| `GET /traces/:id/replay` | Get replay context for a trace |
| `GET /traces/stats` | Trace statistics |
| `POST /traces/diff` | Compare two traces |
| `POST /traces/:id/label` | Add labels to traces |
| `POST /traces/:id/annotate` | Add annotations |
| `GET /traces/by-label` | Find traces by label |
| `GET /traces/by-entity` | Find traces by entity link |

### Skills & Registry

| Endpoint | Purpose |
|----------|---------|
| `POST /skills/publish` | Publish a skill to the registry |
| `GET /skills/registry/:name` | Get skill from registry |
| `GET /skills/registry/:name/versions` | List all versions of a skill |
| `POST /skills/registry/:name/test` | Run skill tests |
| `GET /skills` | List loaded workspace skills |
| `POST /skills/:name/:version/promote` | Promote skill lifecycle state |
| `GET /skills/:name/:version/state` | Get skill state |
| `GET /skills/by-state` | List skills by state |

### Governance

| Endpoint | Purpose |
|----------|---------|
| `GET /audit` | Query audit logs |
| `GET /audit/stats` | Audit statistics |
| `GET /ops/api/audit` | Ops audit log (OIDC + RBAC) |
| `GET /budget` | Get tenant budget |
| `POST /budget` | Set tenant budget |
| `POST /budget/check` | Check if spend is within budget |
| `POST /cost/forecast` | Pre-execution cost estimate |
| `POST /risk/score` | Calculate execution risk score |

### Retention

| Endpoint | Purpose |
|----------|---------|
| `POST /retention/policy` | Set tenant retention policy |
| `GET /retention/policy` | Get retention policy |
| `POST /retention/enforce` | Enforce retention (cleanup old traces) |
| `GET /retention/stats` | Retention statistics |

### Workspace

| Endpoint | Purpose |
|----------|---------|
| `POST /workspace/pin` | Pin workspace version |
| `GET /workspace/pin` | Get workspace pin |
| `GET /workspace/:id/pins` | List all pins for workspace |
| `POST /workspace/envs` | Create/update environment |
| `GET /workspace/envs` | List environments |
| `POST /workspace/envs/promote` | Promote between environments |
| `POST /workspace/envs/init` | Initialize standard environments |
| `POST /workspace/impact` | Analyze change impact |

### Evaluations

| Endpoint | Purpose |
|----------|---------|
| `POST /evals/run` | Run an evaluation dataset |
| `GET /evals/:id` | Get evaluation result |
| `GET /evals` | List evaluation results |

Full details in [docs/API.md](docs/API.md).

---

## Multi-Provider LLM Support

Clasper supports multiple LLM providers via [pi-ai](https://github.com/badlogic/pi-mono):

| Provider | Models | API Key Env Var |
|----------|--------|-----------------|
| **OpenAI** | GPT-4o, GPT-4.1, etc. | `OPENAI_API_KEY` |
| **Anthropic** | Claude 4, Claude 3.5, etc. | `ANTHROPIC_API_KEY` |
| **Google** | Gemini 2.5, Gemini 2.0, etc. | `GEMINI_API_KEY` |
| **xAI** | Grok 2, Grok 2 Mini | `XAI_API_KEY` |
| **Groq** | Llama 3.3, Mixtral | `GROQ_API_KEY` |
| **Mistral** | Mistral Large, Codestral | `MISTRAL_API_KEY` |
| **OpenRouter** | Multiple providers | `OPENROUTER_API_KEY` |

---

## Library Structure

```
src/lib/
├── core/           # Database, config
├── auth/           # Authentication, tenant context
├── tracing/        # Trace model, store, diff, annotations, retention
├── skills/         # Skill manifest, registry, testing, lifecycle
├── tools/          # Tool proxy, permissions
├── governance/     # Audit logs, redaction, budgets, risk scoring
├── providers/      # LLM providers, contracts
├── workspace/      # Workspace mgmt, versioning, pins, environments, impact
├── evals/          # Evaluation framework
└── integrations/   # Control Plane client, webhooks, costs
```

---

## CLI

```bash
npm run build
npm link
clasper init [dir]     # Create workspace from template
clasper serve          # Start the daemon server
clasper dispatcher     # Run notification dispatcher
clasper heartbeat      # Run heartbeat check
```

A **Makefile** is provided for common tasks: `make setup`, `make dev`, `make test`, `make conformance`.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | **Complete getting started guide** |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Backend ↔ Clasper integration patterns |
| [docs/CONTROL_PLANE_CONTRACT.md](docs/CONTROL_PLANE_CONTRACT.md) | Backend API contract specification |
| [docs/WORKSPACE.md](docs/WORKSPACE.md) | Workspace specification (SOUL, AGENTS, skills) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Tracing, evals, versioning, ops console |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | Audit, redaction, budgets, RBAC |
| [docs/API.md](docs/API.md) | Full API reference |
| [docs/MANIFESTO.md](docs/MANIFESTO.md) | Our philosophy and principles |

---

## License

MIT
