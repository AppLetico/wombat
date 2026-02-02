# Zenvy School Finder Example

This is an example workspace configuration for the Zenvy School Finder project.

## Overview

The Zenvy School Finder uses a multi-agent setup with three specialized agents:

- **Jarvis (Kookaburra)** - Squad Lead who coordinates the team
- **Scout (Bilby)** - Discovery Specialist who finds candidate schools
- **Analyst (Echidna)** - Matching Specialist who evaluates fit

## Files

```
zenvy/
├── AGENTS.md           # Shared operating rules for all agents
├── HEARTBEAT.md        # Heartbeat checklist
├── souls/
│   ├── jarvis.md       # Jarvis persona
│   ├── scout.md        # Scout persona
│   └── analyst.md      # Analyst persona
└── README.md           # This file
```

## Usage

To use this workspace with wombat:

```bash
# Copy to your workspace
cp -r docs/examples/zenvy workspace/

# Or set the path directly
WOMBAT_WORKSPACE=./docs/examples/zenvy
WOMBAT_DEFAULT_TASK="School Finder"
```

## Session Keys

Each agent uses a session key pattern:
- `user:{userId}:jarvis`
- `user:{userId}:scout`
- `user:{userId}:analyst`

## Integration

This workspace is designed to work with the Zenvy backend's Mission Control APIs.
See the zenvy-backend repository for the full integration details.
