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
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/built_with-TypeScript-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/status-Beta-yellow.svg" alt="Status">
</p>

---

## Core Pillars

| Pillar | Description |
|--------|-------------|
| **Agent Observability** | Full execution traces with replay & diff |
| **Skill Runtime** | Versioned YAML manifests with testing |
| **Governance & Safety** | Tenant isolation, permissions, audit logs, redaction |
| **Provider Abstraction** | Normalized interface across LLM providers |
| **Operational Tooling** | Budget controls, workspace versioning, evaluations |

**Stack**: TypeScript + Fastify + SQLite | Multi-provider LLM | Full tracing | Budget controls

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
- Replay and diff for debugging

**Governance**
- Per-tenant budget controls with hard/soft limits
- Tool permission system with skill declarations
- Immutable audit logs for compliance
- PII redaction with configurable patterns

**Skills & Versioning**
- Structured YAML skill manifests
- Skill registry with immutable versions
- Built-in test harness
- Workspace versioning with rollback

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

### Skills & Registry

| Endpoint | Purpose |
|----------|---------|
| `POST /skills/publish` | Publish a skill to the registry |
| `GET /skills/registry/:name` | Get skill from registry |
| `GET /skills/registry/:name/versions` | List all versions of a skill |
| `POST /skills/registry/:name/test` | Run skill tests |
| `GET /skills` | List loaded workspace skills |

### Governance

| Endpoint | Purpose |
|----------|---------|
| `GET /audit` | Query audit logs |
| `GET /audit/stats` | Audit statistics |
| `GET /budget` | Get tenant budget |
| `POST /budget` | Set tenant budget |
| `POST /budget/check` | Check if spend is within budget |

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
├── tracing/        # Trace model, trace store
├── skills/         # Skill manifest, registry, testing
├── tools/          # Tool proxy, permissions
├── governance/     # Audit logs, redaction, budgets
├── providers/      # LLM providers, contracts
├── workspace/      # Workspace management, versioning
├── evals/          # Evaluation framework
└── integrations/   # Mission Control, webhooks, costs
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
