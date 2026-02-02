# Wombat Ops

<p align="center">
  <img src="wombat-banner.png" alt="Wombat" width="100%" />
</p>

<h2 align="center">Agent Operations & Governance Platform</h2>

<p align="center">
  <b>SHIP IT. DIG DEEP.</b>
  <br />
  <i>Safe, explainable, and shippable AI agents for multi-tenant SaaS products.</i>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-1.2.1-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/built_with-TypeScript-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/status-Beta-yellow.svg" alt="Status">
</p>

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

Inspired by [OpenClaw](https://openclaw.ai/)'s workspace pattern, Wombat Ops brings operational guarantees, governance, and observability to AI agents in production.

> *"AI agents are not demos. They are production systems."*  
> Read the [Wombat Ops Manifesto](docs/MANIFESTO.md)

---

## What Wombat Ops Does

**Agent Runtime**
- HTTP API for agent messages (`/api/agents/send`, `/api/agents/stream`)
- Workspace-driven prompts (personas, rules, memory, skills)
- Mission Control integration for tasks/messages/documents

**Observability**
- Every request gets a trace ID for correlation
- Full traces: LLM calls, tool calls, costs, timing
- Trace diff API for debugging regressions
- Labels & annotations for trace organization
- Per-tenant retention policies
- Entity linking (task, document, message)
- Operations Console at `/ops` (OIDC + RBAC)

**Governance**
- Per-tenant budget controls with hard/soft limits
- Cost forecasting before execution
- Risk scoring based on tool breadth, skill maturity, temperature, and data sensitivity
- Tool permission system with skill declarations
- Immutable audit logs for compliance
- PII redaction with configurable patterns

**Skills & Versioning**
- Structured YAML skill manifests
- Skill registry with immutable versions
- Skill lifecycle states (draft → tested → approved → active → deprecated)
- Built-in test harness
- Workspace versioning with rollback
- Workspace pinning per environment (dev/staging/prod)
- Environment promotion flows
- Impact analysis before changes

---

## Quickstart

**Fastest start (one command):**

```bash
make setup
# Then edit .env (BACKEND_URL, AGENT_JWT_SECRET, LLM API keys) and run: make dev
```

`make setup` installs dependencies, copies `.env.example` to `.env` if missing, and scaffolds a workspace from the built-in template.

---

### 1) Install

```bash
npm install
cp .env.example .env
```

### 2) Create a workspace

Scaffold a workspace from the built-in template:

```bash
npm run init-workspace
# or: make workspace
# or: npx wombat init
```

### 3) Configure environment

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
WOMBAT_WORKSPACE=./workspace

# Database (optional, defaults to ./wombat.db)
WOMBAT_DB_PATH=./wombat.db
```

### 4) Run

```bash
# Dev
npm run dev

# Prod
npm run build && npm start
```

### Ops Console (v1.2.1)

The Operations Console is served from the same daemon at `/ops` and is protected by OIDC + RBAC.

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

Optional Ops Console env vars:

```
# Deep link templates (use {id} placeholder)
DEEP_LINK_TASK_TEMPLATE=
DEEP_LINK_DOC_TEMPLATE=
DEEP_LINK_MSG_TEMPLATE=
```

v1.2.1 hardening highlights:
- Action-level RBAC with resolved permissions at `/ops/api/me`
- Break-glass overrides require reason_code + justification, audited as `ops_override_used`
- Dashboards include retention/sampling coverage metadata
- Non-admin users never receive raw prompt/tool payloads in trace detail
- New audit API: `GET /ops/api/audit` with pagination

---

## API at a Glance

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
| `POST /traces/diff` | Compare two traces (v1.1) |
| `POST /traces/:id/label` | Add labels to traces (v1.1) |
| `POST /traces/:id/annotate` | Add annotations (v1.1) |
| `GET /traces/by-label` | Find traces by label (v1.1) |
| `GET /traces/by-entity` | Find traces by entity link (v1.1) |

### Skills & Registry

| Endpoint | Purpose |
|----------|---------|
| `POST /skills/publish` | Publish a skill to the registry |
| `GET /skills/registry/:name` | Get skill from registry |
| `GET /skills/registry/:name/versions` | List all versions of a skill |
| `POST /skills/registry/:name/test` | Run skill tests |
| `GET /skills` | List loaded workspace skills |
| `POST /skills/:name/:version/promote` | Promote skill lifecycle state (v1.1) |
| `GET /skills/:name/:version/state` | Get skill state (v1.1) |
| `GET /skills/by-state` | List skills by state (v1.1) |

### Governance

| Endpoint | Purpose |
|----------|---------|
| `GET /audit` | Query audit logs |
| `GET /audit/stats` | Audit statistics |
| `GET /ops/api/audit` | Ops audit log (OIDC + RBAC, v1.2.1) |
| `GET /budget` | Get tenant budget |
| `POST /budget` | Set tenant budget |
| `POST /budget/check` | Check if spend is within budget |
| `POST /cost/forecast` | Pre-execution cost estimate (v1.1) |
| `POST /risk/score` | Calculate execution risk score (v1.1) |

### Retention (v1.1)

| Endpoint | Purpose |
|----------|---------|
| `POST /retention/policy` | Set tenant retention policy |
| `GET /retention/policy` | Get retention policy |
| `POST /retention/enforce` | Enforce retention (cleanup old traces) |
| `GET /retention/stats` | Retention statistics |

### Workspace (v1.1)

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

### Control Plane (v1.1)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/version` | Wombat version and features |
| `GET /api/compatibility` | Check control plane compatibility |

### Evaluations

| Endpoint | Purpose |
|----------|---------|
| `POST /evals/run` | Run an evaluation dataset |
| `GET /evals/:id` | Get evaluation result |
| `GET /evals` | List evaluation results |

Full details in [docs/API.md](docs/API.md).

---

## Multi-Provider LLM Support

Wombat supports multiple LLM providers via [pi-ai](https://github.com/badlogic/pi-mono):

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

The library is organized into logical modules:

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
└── integrations/   # Mission Control, webhooks, costs, control plane version
```

---

## Documentation

- [docs/MANIFESTO.md](docs/MANIFESTO.md) - Our philosophy and principles
- [docs/QUICKSTART.md](docs/QUICKSTART.md) - Getting started
- [docs/API.md](docs/API.md) - Full API reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture
- [docs/GOVERNANCE.md](docs/GOVERNANCE.md) - Audit, redaction, budgets
- [docs/OPERATIONS.md](docs/OPERATIONS.md) - Tracing, evals, versioning
- [docs/WORKSPACE.md](docs/WORKSPACE.md) - Workspace specification
- [docs/CONTROL_PLANE_CONTRACT.md](docs/CONTROL_PLANE_CONTRACT.md) - Backend integration

---

## CLI

```bash
npm run build
npm link
wombat init [dir]     # Create workspace from template
wombat serve          # Start the daemon server
wombat dispatcher     # Run notification dispatcher
wombat heartbeat      # Run heartbeat check
```

A **Makefile** is provided for common tasks: `make setup`, `make dev`, `make test`, `make conformance`.

---

## Control Plane Adoption Checklist

When integrating Wombat with a new backend:

- [ ] Implement the **Control Plane Contract v1** endpoints
- [ ] Ensure `X-Agent-Token` JWTs validate and enforce `user_id` scoping
- [ ] Support `idempotency_key` on create endpoints
- [ ] Run conformance: `npm run conformance`
- [ ] Optional: add notifications, SSE events, heartbeat/standup

See:
- [docs/CONTROL_PLANE_CONTRACT.md](docs/CONTROL_PLANE_CONTRACT.md)
- [docs/CONTROL_PLANE_QUICKSTART.md](docs/CONTROL_PLANE_QUICKSTART.md)
- [examples/mission-control-lite/](examples/mission-control-lite/)

---

## License

MIT
