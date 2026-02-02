# Operations & Observability

Wombat Ops provides comprehensive operational tooling for running AI agents in production. This document covers tracing, replay, evaluation framework, workspace versioning, and the skill registry.

---

## Tracing

Every agent execution produces a detailed trace for debugging and analysis.

### Trace Structure

```typescript
interface AgentTrace {
  id: string;                    // UUID v7 (time-ordered)
  tenantId: string;
  workspaceId: string;
  agentRole?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  workspaceHash?: string;        // SHA256 of workspace at execution time
  skillVersions: Record<string, string>;
  model: string;
  provider: string;
  input: {
    message: string;
    messageHistory: number;
  };
  steps: TraceStep[];
  output?: {
    message: string;
    toolCalls: ToolCallTrace[];
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
  redactedPrompt?: string;
  error?: string;
  labels?: Record<string, string>;
  taskId?: string;
  documentId?: string;
  messageId?: string;
}
```

### Trace Steps

Traces record every significant step:

```typescript
type TraceStep = LLMCallStep | ToolCallStep | ToolResultStep | ErrorStep;

interface LLMCallStep {
  type: 'llm_call';
  timestamp: string;
  durationMs: number;
  data: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    hasToolCalls: boolean;
    finishReason?: string;
  };
}

interface ToolCallStep {
  type: 'tool_call';
  timestamp: string;
  durationMs: number;
  data: {
    toolCallId: string;
    toolName: string;
    arguments: unknown;  // Redacted
    permitted: boolean;
    permissionReason?: string;
  };
}

interface ToolResultStep {
  type: 'tool_result';
  timestamp: string;
  durationMs: number;
  data: {
    toolCallId: string;
    toolName: string;
    success: boolean;
    result?: unknown;  // Redacted
    error?: string;
  };
}

interface ErrorStep {
  type: 'error';
  timestamp: string;
  durationMs: number;
  data: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}
```

### Correlation IDs

Every request receives a trace ID that:

- Is returned in the response (`trace_id` field)
- Is included in the `X-Trace-Id` response header
- Can be passed in via `X-Trace-Id` request header for correlation
- Links all audit log entries for the request

### Building Traces

Use the `TraceBuilder` for constructing traces:

```typescript
import { TraceBuilder } from './lib/tracing/trace.js';

const trace = new TraceBuilder({
  tenantId: "tenant-123",
  workspaceId: "workspace-123",
  model: "gpt-4o-mini",
  provider: "openai",
  agentRole: "jarvis",
  inputMessage: "Find the fastest route"
});

trace.addLLMCall({
  model: "gpt-4o-mini",
  provider: "openai",
  inputTokens: 1200,
  outputTokens: 300,
  cost: 0.00025,
  hasToolCalls: true
}, 2000);

trace.addToolCall({
  toolCallId: "call-1",
  toolName: "search",
  arguments: { query: "test" },
  permitted: true
}, 50);

trace.addToolResult({
  toolCallId: "call-1",
  toolName: "search",
  success: true,
  result: { hits: 3 }
}, 450);

trace.setOutput("Here is the result", []);
const finalTrace = trace.complete();
```

### Querying Traces

```bash
# List recent traces
GET /traces?limit=50

# Filter by tenant
GET /traces?tenant_id=tenant-123

# Filter by status
GET /traces?status=error

# Get full trace
GET /traces/0194c8f0-7e1a-7000-8000-000000000001
```

---

## Operations Console (v1.2)

The human-facing Operations Console is served at `/ops` and provides trace explorer, diff, promotion, rollback, skill ops, and cost/risk dashboards.

Ops API endpoints are under `/ops/api/*` and require `Authorization: Bearer <OIDC JWT>`.

---

## Replay & Diff

Traces can be replayed for debugging and comparison.

### Replay Context

Get everything needed to replay a trace:

```bash
GET /traces/:id/replay
```

Returns:

```json
{
  "trace_id": "...",
  "original_request": {
    "message": "...",
    "messages": [...],
    "metadata": {...}
  },
  "workspace_snapshot": {
    "hash": "abc123...",
    "files": {
      "AGENTS.md": "...",
      "SOUL.md": "..."
    }
  },
  "skill_versions": {
    "summarize": "1.2.0"
  }
}
```

### Diff Scenarios

Use replay for:

1. **Model comparison** - Run same input with different model
2. **Skill regression** - Test new skill version against baseline
3. **Workspace changes** - Compare behavior after prompt updates
4. **Debugging** - Reproduce issues with exact context

### Programmatic Replay

```typescript
const traceStore = getTraceStore();

// Get replay context
const context = traceStore.getReplayContext(traceId);

// Modify and re-run
const result = await agent.run({
  ...context.original_request,
  model: 'gpt-4o',  // Try different model
});

// Compare outputs
const diff = compareOutputs(context.original_response, result.response);
```

---

## Evaluation Framework

Run evaluations to detect regressions and measure agent performance.

### Evaluation Dataset

```typescript
interface EvalDataset {
  name: string;
  description?: string;
  cases: EvalCase[];
}

interface EvalCase {
  id: string;
  name?: string;
  input: Record<string, unknown>;
  expectedOutput?: Record<string, unknown>;
  expectedBehavior?: string;  // For subjective evals
  tags?: string[];
}
```

### Running Evaluations

```bash
POST /evals/run
{
  "name": "ticket-summarizer-v1.2",
  "cases": [
    {
      "id": "case-1",
      "name": "Happy path",
      "input": { "ticket_id": "T-123" },
      "expected_output": { "sentiment": "positive" }
    },
    {
      "id": "case-2",
      "name": "Error handling",
      "input": { "ticket_id": "invalid" },
      "expected_output": { "error": true }
    }
  ],
  "options": {
    "skill": "ticket_summarizer",
    "skill_version": "1.2.0",
    "model": "gpt-4o-mini",
    "parallel": 3
  }
}
```

### Evaluation Results

```typescript
interface EvalResult {
  id: string;
  datasetName: string;
  startedAt: Date;
  completedAt: Date;
  results: CaseResult[];
  summary: EvalSummary;
  config: EvalOptions;
}

interface CaseResult {
  caseId: string;
  status: 'passed' | 'failed' | 'error';
  actualOutput: unknown;
  expectedOutput: unknown;
  score: number;  // 0-1
  durationMs: number;
  traceId: string;  // Link to full trace
}

interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  avgScore: number;
  totalDurationMs: number;
  totalCost: number;
}
```

### Drift Detection

Compare evaluations over time:

```typescript
const evalRunner = getEvalRunner();

// Run current evaluation
const current = await evalRunner.run(dataset, options);

// Get baseline (previous run)
const baseline = evalRunner.getResult(baselineId);

// Compare
const drift = evalRunner.compareToBaseline(current, baseline);

console.log(drift);
// {
//   overallDrift: 0.05,  // 5% regression
//   improvedCases: ['case-3'],
//   regressedCases: ['case-1', 'case-2'],
//   newFailures: ['case-2'],
//   recommendations: ['Review case-2 for regression']
// }
```

### Golden Datasets

Maintain golden datasets for critical paths:

```typescript
// Store golden dataset
const dataset: EvalDataset = {
  name: 'ticket-summarizer-golden',
  cases: loadGoldenCases('./evals/ticket-summarizer.json')
};

// Run and compare to baseline
const result = await evalRunner.run(dataset, { skill: 'ticket_summarizer' });
const drift = evalRunner.compareToBaseline(result, lastGoldenRun);

if (drift.overallDrift > 0.1) {
  throw new Error('Regression detected: 10%+ drift from baseline');
}
```

---

## Workspace Versioning

Track workspace changes with content-addressable storage.

### Snapshots

Create a snapshot of the current workspace:

```bash
# Programmatic
const versioning = getWorkspaceVersioning();
const version = versioning.snapshot(workspaceId, 'Updated AGENTS.md');
```

Returns:

```typescript
interface WorkspaceVersion {
  hash: string;           // SHA256 content hash
  workspaceId: string;
  createdAt: Date;
  message?: string;
  files: Record<string, FileSnapshot>;
}

interface FileSnapshot {
  path: string;
  hash: string;
  size: number;
  content: string;
}
```

### Version History

```typescript
// List versions
const versions = versioning.listVersions(workspaceId, { limit: 10 });

// Get specific version
const version = versioning.getVersion(hash);

// Get latest
const latest = versioning.getLatestVersion(workspaceId);
```

### Diffing

```typescript
// Diff between two versions
const diff = versioning.diff(oldHash, newHash);

console.log(diff);
// {
//   added: ['skills/new-skill/SKILL.md'],
//   removed: [],
//   modified: ['AGENTS.md'],
//   unchanged: ['SOUL.md', 'IDENTITY.md'],
//   changes: {
//     'AGENTS.md': {
//       oldHash: 'abc...',
//       newHash: 'def...',
//       oldContent: '...',
//       newContent: '...'
//     }
//   }
// }

// Diff from current state
const pendingChanges = versioning.diffFromCurrent(lastVersionHash);
```

### Rollback

```typescript
// Rollback to a previous version
versioning.rollback(previousVersionHash);

// This:
// 1. Restores all files to that version's state
// 2. Creates an audit log entry
// 3. Does NOT delete the old version (versions are immutable)
```

### Best Practices

1. **Snapshot before changes** - Always capture baseline
2. **Include messages** - Document why changes were made
3. **Link to traces** - Record workspace hash in traces
4. **Prune old versions** - Keep recent + tagged versions

---

## Skill Registry

Versioned, immutable storage for skill manifests.

### Publishing Skills

```typescript
const registry = getSkillRegistry();

const manifest: SkillManifest = {
  name: 'ticket_summarizer',
  version: '1.2.0',
  description: 'Summarizes support tickets',
  inputs: {
    ticket_id: { type: 'string', required: true }
  },
  outputs: {
    summary: { type: 'string' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] }
  },
  permissions: {
    tools: ['read_ticket', 'get_user']
  },
  instructions: '...'
};

const published = registry.publish(manifest, 'user-123');
// { name, version, checksum, publishedAt, publishedBy }
```

### Version Immutability

Once published, a version cannot be modified:

```typescript
// This will throw an error
registry.publish({ name: 'my-skill', version: '1.0.0', ... });
// Error: Version 1.0.0 already exists
```

### Querying Skills

```typescript
// Get latest version
const skill = registry.get('ticket_summarizer');

// Get specific version
const v1 = registry.get('ticket_summarizer', '1.0.0');

// List all versions
const versions = registry.listVersions('ticket_summarizer');

// Search skills
const results = registry.search('ticket', { limit: 10 });
```

### Skill Manifest Format (YAML)

```yaml
name: ticket_summarizer
version: 1.2.0
description: Summarizes support tickets with sentiment analysis

inputs:
  ticket_id:
    type: string
    description: The ticket ID to summarize
    required: true
  include_history:
    type: boolean
    description: Whether to include ticket history
    default: false

outputs:
  summary:
    type: string
    description: Summary of the ticket
  sentiment:
    type: string
    enum: [positive, neutral, negative]
    description: Overall sentiment
  key_issues:
    type: array
    items: { type: string }
    description: List of key issues identified

permissions:
  tools:
    - read_ticket
    - get_user_info
  models:
    - gpt-4o
    - gpt-4o-mini

gates:
  env:
    - TICKET_API_KEY
  
redaction:
  patterns:
    - email
    - phone
  strategy: mask

tests:
  - name: happy_path
    input:
      ticket_id: "T-123"
    expected_output:
      sentiment: positive
  - name: negative_sentiment
    input:
      ticket_id: "T-456"
    expected_output:
      sentiment: negative

instructions: |
  When summarizing a ticket:
  
  1. Fetch the ticket using read_ticket(ticket_id)
  2. Analyze the content for key issues
  3. Determine overall sentiment
  4. Return structured summary
  
  Keep summaries concise (2-3 sentences).
```

### Skill Testing

Run tests defined in skill manifests:

```bash
POST /skills/registry/ticket_summarizer/test
```

Or programmatically:

```typescript
const tester = getSkillTester();

const skill = registry.get('ticket_summarizer', '1.2.0');
const results = await tester.runTests(skill.manifest);

console.log(results);
// {
//   skill: 'ticket_summarizer',
//   version: '1.2.0',
//   results: [
//     { name: 'happy_path', status: 'passed', durationMs: 1500 },
//     { name: 'negative_sentiment', status: 'failed', error: '...' }
//   ],
//   summary: { total: 2, passed: 1, failed: 1 }
// }
```

---

## Database

All operational data is stored in SQLite.

### Tables

| Table | Purpose |
|-------|---------|
| `traces` | Agent execution traces |
| `audit_log` | Immutable audit log |
| `skill_registry` | Versioned skill manifests |
| `tenant_budgets` | Per-tenant budget tracking |
| `workspace_versions` | Workspace snapshots |
| `eval_results` | Evaluation results |

### Database Path

Configure via environment:

```bash
WOMBAT_DB_PATH=./wombat.db  # Default
```

### Database Stats

```bash
GET /db/stats
```

Returns:

```json
{
  "path": "./wombat.db",
  "size_bytes": 1048576,
  "tables": {
    "traces": 1250,
    "audit_log": 15000,
    "skill_registry": 25,
    "tenant_budgets": 10,
    "workspace_versions": 50,
    "eval_results": 100
  }
}
```

### Initialization

Database is automatically initialized on startup:

```typescript
import { initDatabase } from './lib/core/db.js';

// Called automatically by server
initDatabase();
```

### WAL Mode

SQLite uses WAL (Write-Ahead Logging) for better concurrent access:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

---

## Library Structure

Operations code is organized into modules:

```
src/lib/
├── core/
│   ├── config.ts       # Configuration
│   └── db.ts           # Database initialization
├── tracing/
│   ├── trace.ts        # Trace model & builder
│   └── traceStore.ts   # Trace storage
├── skills/
│   ├── skillManifest.ts   # YAML manifest parsing
│   ├── skillRegistry.ts   # Version registry
│   └── skillTester.ts     # Test runner
├── workspace/
│   ├── workspace.ts          # Workspace loader
│   └── workspaceVersioning.ts # Versioning
└── evals/
    └── evals.ts        # Evaluation framework
```
