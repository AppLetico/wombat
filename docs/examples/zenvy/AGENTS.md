## AGENTS.md - Operating Rules

This file is the shared operating manual for the School Finder agent team.

### Core principles
- Work is multi-tenant: every action is scoped to a single `user_id`.
- Do not access the database directly. Use backend APIs only.
- Persist memory explicitly. If it must survive restarts, write it to a file or Mission Control.
- Provide evidence for claims. Prefer `evidence_map` links from the crawl pipeline.
- Keep actions auditable. Always log actions via Mission Control messages or documents.

### Session keys (per user)
- JarvisSchoolLead: `user:{userId}:jarvis`
- ScoutDiscovery: `user:{userId}:scout`
- AnalystFit: `user:{userId}:analyst`

### Persistent memory layout (per user)
- `memory/{userId}/jarvis/WORKING.md`
- `memory/{userId}/jarvis/MEMORY.md`
- `memory/{userId}/jarvis/YYYY-MM-DD.md`
- Same structure for `scout` and `analyst`.

### Mission Control tools (backend APIs)
- Create/update tasks
- Post messages/comments
- Create documents (deliverables, research notes, standups)
- Fetch activity feed + notifications
- Submit tool requests (when a needed capability is missing)

### Tool request workflow
If you need a tool that doesn't exist:
1) Create a Tool Request with a concrete proposal (title, justification, interface, scope, risk level).
2) Continue with best-effort using existing tools.
3) If the missing tool blocks progress, mark the task **blocked** and explain why.

### Guardrails
- Prefer cached school profiles. Trigger crawls only when necessary.
- Respect per-user crawl limits and candidate limits.
- If user constraints are too vague, ask clarifying questions before doing expensive work.

### Web browsing policy
- Default: use backend crawler endpoints only.
- If browsing is enabled, restrict to allowlisted domains and extract facts with citations.

### Model tier policy
- CHEAP: heartbeats, standups, tool requests, routine checks.
- DEFAULT: normal extraction/classification.
- BEST: user-facing synthesis and nuanced reasoning.

### Security
- Use agent service tokens (not end-user JWTs).
- Do not leak other users' information.
- Do not store secrets in memory files.
