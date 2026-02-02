# Wombat

<p align="center">
  <img src="wombat-banner.png" alt="Wombat" width="100%" />
</p>

<h2 align="center">Personal AI assistant for multi-tenant backends</h2>

<p align="center">
  <b>SHIP IT. DIG DEEP.</b>
  <br />
  <i>Workspace-driven agents that dig into your app’s context — stateless, API-first, and multi-tenant.</i>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/built_with-TypeScript-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/status-Alpha-orange.svg" alt="Status">
</p>

---

**Stack & capabilities**

- **TypeScript** + **Fastify**
- **OpenAI** (and other providers via adapters)
- **Workspace-driven** prompts (personas, rules, memory, skills)
- **Streaming (SSE)** + **webhooks**
- **Usage/cost tracking** + **context compaction**

Inspired by [OpenClaw](https://openclaw.ai/)'s workspace pattern, Wombat brings many of the same best practices to backend SaaS products while staying **stateless**, **multi-tenant**, and **API-first**.

## What Wombat does

- Exposes `POST /api/agents/send` (and `POST /api/agents/stream`) for agent messages
- Builds system prompts from workspace files (personas, rules, memory, skills)
- Talks to your backend “control plane” (Mission Control): tasks/messages/docs/notifications
- Adds reliability + ops features: retries, model failover, health, usage/cost tracking, webhooks

## Quickstart

### 1) Install

```bash
npm install
cp .env.example .env
```

### 2) Create a workspace

```text
workspace/
├── AGENTS.md        # Operating rules
├── SOUL.md          # Default persona (or souls/<role>.md)
├── IDENTITY.md      # Optional: branding / names
├── HEARTBEAT.md     # Optional: heartbeat checklist
├── TOOLS.md         # Optional: tool usage notes
├── MEMORY.md        # Optional: long-term memory
├── BOOT.md          # Optional: one-time initialization instructions
├── memory/          # Optional: daily memory logs
└── skills/          # Optional: OpenClaw-compatible skills
    └── my-skill/
        └── SKILL.md
```

See [docs/WORKSPACE.md](docs/WORKSPACE.md) for the full spec.

### 3) Configure environment

```bash
# Required
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=your-secret

# LLM Provider (choose one or more)
LLM_PROVIDER=openai  # openai, anthropic, google, xai, groq, mistral, openrouter
LLM_MODEL_DEFAULT=gpt-4o-mini

# API Keys (set for providers you want to use)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# Workspace (default: ./workspace)
WOMBAT_WORKSPACE=./workspace

# Optional
WOMBAT_DEFAULT_TASK=My Agent Thread
```

### 4) Run

```bash
# Dev
npm run dev

# Prod
npm run build && npm start
```

## Control plane adoption checklist

Use this when integrating Wombat with a new backend.

- Implement the **Control Plane Contract v1** endpoints (tasks/messages/documents + capabilities)
- Ensure `X-Agent-Token` JWTs validate and enforce `user_id` scoping
- Support `idempotency_key` on create endpoints
- Run conformance: `npm run conformance`
- Optional: add notifications, SSE events, heartbeat/standup

Start with:

- [docs/CONTROL_PLANE_CONTRACT.md](docs/CONTROL_PLANE_CONTRACT.md)
- [docs/CONTROL_PLANE_QUICKSTART.md](docs/CONTROL_PLANE_QUICKSTART.md)
- [docs/control-plane.openapi.yaml](docs/control-plane.openapi.yaml)
- `examples/mission-control-lite/` (reference backend)

## API at a glance

| Endpoint | Purpose |
|----------|---------|
| `POST /api/agents/send` | Main request/response endpoint |
| `POST /api/agents/stream` | Streaming responses over SSE |
| `POST /compact` | Summarize conversation history (context management) |
| `POST /llm-task` | Structured JSON-only LLM tasks |
| `GET /health` | Component health |
| `GET /usage` | Aggregate token/cost usage |
| `GET /skills` | List loaded workspace skills |
| `GET /boot` | BOOT.md status |

Full details in [docs/API.md](docs/API.md).

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

### Quick Setup

```bash
# Use OpenAI (default)
LLM_PROVIDER=openai
LLM_MODEL_DEFAULT=gpt-4o-mini
OPENAI_API_KEY=sk-...

# Use Anthropic
LLM_PROVIDER=anthropic
LLM_MODEL_DEFAULT=claude-3-5-sonnet-20241022
ANTHROPIC_API_KEY=sk-ant-...

# Use Google Gemini
LLM_PROVIDER=google
LLM_MODEL_DEFAULT=gemini-2.0-flash
GEMINI_API_KEY=...
```

### Cross-Provider Failover

You can specify a fallback model from a different provider:

```bash
LLM_PROVIDER=anthropic
LLM_MODEL_DEFAULT=claude-3-5-sonnet-20241022
LLM_MODEL_FALLBACK=openai/gpt-4o-mini  # Falls back to OpenAI if Anthropic fails

ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Wombat vs OpenClaw (Quick Comparison)

| Feature | OpenClaw | Wombat |
|---------|----------|--------|
| **Deployment** | User's machine | Backend service |
| **User model** | Single user | Multi-tenant |
| **Interface** | Chat apps (WhatsApp, Telegram) | HTTP API |
| **Workspace config** | ✅ | ✅ |
| **Skills (SKILL.md)** | ✅ | ✅ (compatible!) |
| **Memory files** | ✅ | ✅ |
| **Cost tracking** | ✅ | ✅ |
| **Streaming** | ✅ | ✅ |
| **History compaction** | ✅ | ✅ |
| **Browser control** | ✅ | ❌ |
| **Shell access** | ✅ | ❌ |

**Use OpenClaw** for personal assistants with broad system access.  
**Use Wombat** for multi-user SaaS products with data isolation.

See the full comparison in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#wombat-vs-openclaw).

## CLI

```bash
npm run build
npm link
wombat serve        # Start the daemon server
wombat dispatcher   # Run notification dispatcher
wombat heartbeat    # Run heartbeat check
```

## OpenClaw skill compatibility

Wombat can use OpenClaw skills directly. Copy skill folders into your workspace:

```text
workspace/skills/
├── web-search/
│   └── SKILL.md
└── summarize/
    └── SKILL.md
```

Skills are automatically loaded and injected into the system prompt. Gate requirements (env vars, binaries) are respected.

## Documentation

- [docs/QUICKSTART.md](docs/QUICKSTART.md)
- [docs/CONTROL_PLANE_QUICKSTART.md](docs/CONTROL_PLANE_QUICKSTART.md)
- [docs/CONTROL_PLANE_CONTRACT.md](docs/CONTROL_PLANE_CONTRACT.md)
- [docs/WORKSPACE.md](docs/WORKSPACE.md)
- [docs/API.md](docs/API.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## License

MIT
