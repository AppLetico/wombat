# Multi-Agent Example

This example demonstrates a multi-agent workspace with specialized roles.

## Overview

This workspace uses three specialized agents:

- **Lead** - Coordinator who manages the team and user interactions
- **Researcher** - Specialist who gathers and analyzes information
- **Writer** - Specialist who creates content and documentation

## Files

```
multi-agent/
├── AGENTS.md           # Shared operating rules for all agents
├── HEARTBEAT.md        # Heartbeat checklist
├── IDENTITY.md         # Agent names, emojis, branding
├── souls/              # Per-agent personalities
│   ├── lead.md         # 🎯 Lead - Coordinator
│   ├── researcher.md   # 🔍 Researcher - Information Specialist
│   └── writer.md       # ✍️ Writer - Content Specialist
├── skills/             # API usage instructions for agents
│   └── task-management/SKILL.md
└── README.md           # This file
```

## Usage

```bash
# Copy to your workspace
cp -r docs/examples/multi-agent workspace/

# Or set the path directly
CLASPER_WORKSPACE=./docs/examples/multi-agent make dev
```

## Session Keys

Each agent uses a session key pattern:
- `user:{userId}:lead`
- `user:{userId}:researcher`
- `user:{userId}:writer`

## Project Integration Pattern

For production, keep workspace config in your backend repo:

```
your-backend/
├── app/                    # Backend code
├── agent-config/           # Clasper workspace config
│   ├── workspace/          # ← Set CLASPER_WORKSPACE to this
│   │   ├── AGENTS.md
│   │   ├── souls/
│   │   └── skills/
│   └── README.md
└── ...
```

This keeps agent behavior version-controlled with your backend APIs.

See [INTEGRATION.md](../../INTEGRATION.md) for the full architecture.
