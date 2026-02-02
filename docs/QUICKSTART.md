# Quickstart

## Prerequisites

- Node.js 18+
- A Mission Control-compatible backend (e.g., zenvy-backend)
- OpenAI API key

## Local development

### 1. Install dependencies

```bash
npm install
cp .env.example .env
```

### 2. Create a workspace

Create a workspace folder with your agent configuration:

```bash
mkdir -p workspace/souls
```

Add at minimum an `AGENTS.md` with operating rules:

```markdown
# workspace/AGENTS.md

## Operating Rules

- Be helpful and accurate
- Keep responses concise
- Ask for clarification when needed
```

And a `SOUL.md` (or `souls/<role>.md` for multi-agent):

```markdown
# workspace/SOUL.md

# Agent Persona

You are a helpful assistant.

## Communication style
- Direct and clear
- Evidence-based answers
```

See [WORKSPACE.md](WORKSPACE.md) for the full specification.

### 3. Configure environment

Edit `.env` with your settings:

```bash
# Required
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=your-secret-matching-backend
OPENAI_API_KEY=sk-...

# Workspace path (default: ./workspace)
WOMBAT_WORKSPACE=./workspace

# Default task title (optional - for auto-creation)
WOMBAT_DEFAULT_TASK=My Agent Thread
```

### 4. Start the daemon

```bash
npm run dev
```

Default daemon URL: `http://localhost:8081`

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Common commands

```bash
# Build for production
npm run build

# Run tests
npm test

# Run dispatcher (deliver notifications to daemon)
npm run dispatcher

# Run heartbeat (set USER_ID and AGENT_ROLE)
USER_ID=... AGENT_ROLE=agent npm run heartbeat

# Run daily standup
STANDUP_TIMEZONE=UTC npm run standup
```

## Verify it's working

```bash
curl -X POST http://localhost:8081/health
# {"status":"ok"}
```

## Next steps

- [WORKSPACE.md](WORKSPACE.md) - Configure your agent personas
- [API.md](API.md) - API reference
- [INTEGRATION.md](INTEGRATION.md) - Backend integration guide
