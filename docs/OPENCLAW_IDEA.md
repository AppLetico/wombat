Perfect. This deserves a **serious, first-principles PRD**, because if this is done sloppily it destroys Clasper’s value — and if it’s done correctly, it becomes a **real moat**.

Below is a **full, end-to-end PRD** for **OpenClaw Integration as a Governed Execution Surface**.
This is written assuming **Clasper Ops v1.2.1 is the baseline** and nothing regresses.

---

# **Clasper Ops – Governed OpenClaw Integration PRD**

## Product Name

**Delegated Execution Surfaces (OpenClaw Adapter)**

## Version

**v2.0 (Foundational Integration)**

---

## Executive Summary

This PRD defines how **OpenClaw** can be integrated into **Clasper Ops** as a **high-risk, governed execution surface**, without compromising Clasper’s guarantees around safety, auditability, multi-tenancy, and operational control.

The core principle is:

> **OpenClaw executes. Clasper governs.**

OpenClaw is treated as a **tool**, not a peer system, and never becomes a source of truth.

---

## Goals

1. Allow Clasper-managed agents to perform **embodied actions** (browser, filesystem, OS, automation)
2. Preserve Clasper’s guarantees:

   * determinism
   * auditability
   * tenant isolation
   * RBAC
   * cost & risk control
3. Prevent OpenClaw autonomy from bypassing governance
4. Provide a clean migration path for OpenClaw users to production

---

## Non-Goals (Explicit)

* No persistent OpenClaw daemons per tenant
* No OpenClaw-managed identity
* No OpenClaw background autonomy (cron, heartbeats)
* No OpenClaw memory as source of truth
* No OpenClaw → Clasper callbacks
* No OpenClaw direct UI access

If any of the above are violated, the integration is **invalid**.

---

## Core Design Principle

> **OpenClaw is a high-risk delegated execution tool invoked explicitly and synchronously by Clasper.**

This is identical in philosophy to:

* `charge_credit_card`
* `deploy_to_prod`
* `run_data_migration`

Just with a much higher blast radius.

---

## System Architecture

```
┌────────────────────┐
│  Client / Ops UI   │
└────────┬───────────┘
         ↓
┌──────────────────────────────┐
│        Clasper Ops             │
│  (RBAC, Risk, Budget, Trace)  │
└────────┬─────────────────────┘
         ↓ (approved tool call)
┌────────────────────────────────────┐
│ Tool: delegated.openclaw.execute    │
│ (governed invocation wrapper)       │
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│        OpenClaw Execution API       │
│ (ephemeral session, bounded scope) │
└────────────────────────────────────┘
```

---

## Pillar 1: Execution Model

### 1.1 Execution Mode

OpenClaw must support **ephemeral, stateless execution**.

**Hard requirements:**

* No persistent sessions
* No cron / heartbeat
* No long-term memory
* Session is created, executed, destroyed per request

---

### 1.2 Execution Contract

**Tool name**

```
delegated.openclaw.execute
```

**Invocation shape**

```json
{
  "execution_id": "uuid",
  "requested_by": {
    "agent": "research_agent",
    "workspace_id": "ws_123",
    "tenant_id": "t_456"
  },
  "scope": {
    "tools": ["browser"],
    "filesystem": {
      "read": ["./sandbox"],
      "write": []
    },
    "network": ["https://example.com"],
    "shell": false
  },
  "limits": {
    "max_steps": 20,
    "max_seconds": 60,
    "max_cost_usd": 0.50
  },
  "instructions": "Visit the pricing page and summarize plans",
  "soul": "SOUL.md contents",
  "environment": "staging"
}
```

---

### 1.3 Output Contract

OpenClaw returns **structured output only**.

```json
{
  "status": "success | failed | aborted",
  "summary": "Human-readable description",
  "artifacts": [
    { "type": "text", "content": "..." },
    { "type": "screenshot", "url": "..." }
  ],
  "violations": [],
  "metrics": {
    "steps_used": 14,
    "duration_ms": 43210,
    "estimated_cost_usd": 0.31
  }
}
```

Raw logs are never surfaced directly to users.

---

## Pillar 2: Governance & Safety (Non-Negotiable)

### 2.1 Risk Classification

OpenClaw execution is **always high-risk by default**.

Risk score factors:

* OS / browser access
* filesystem scope
* duration
* autonomy level

Minimum classification: `high`

---

### 2.2 Approval Rules

| Condition            | Requirement             |
| -------------------- | ----------------------- |
| Browser access       | Operator approval       |
| Shell access         | Admin approval          |
| Filesystem write     | Admin + override        |
| Long duration (>60s) | Override required       |
| Cost > threshold     | Budget check + override |

---

### 2.3 Break-Glass Overrides

All OpenClaw executions that exceed baseline risk require:

* Operator/Admin role
* structured reason code
* justification
* audit entry `delegated.execution.override`

---

## Pillar 3: Traceability & Audit

### 3.1 Trace Wrapping

OpenClaw execution appears as **a single governed step** inside the Clasper trace:

```
[ Agent Step ]
   ↓
[ delegated.openclaw.execute ]
   ↓
[ OpenClaw Execution Summary ]
```

Clasper records:

* why it was invoked
* what scope was granted
* who approved it
* what it returned
* whether limits were exceeded

---

### 3.2 Audit Events

Mandatory audit events:

* `delegated.execution.requested`
* `delegated.execution.approved`
* `delegated.execution.override`
* `delegated.execution.completed`
* `delegated.execution.violation`

---

## Pillar 4: Identity & Multi-Tenancy

### 4.1 Identity Ownership

* **Clasper owns identity**
* OpenClaw receives only an execution token
* No tenant credentials ever shared

---

### 4.2 Tenant Isolation

* One OpenClaw execution per tenant per request
* No shared filesystem
* No shared network state
* No shared memory

---

## Pillar 5: Cost & Budget Enforcement

### 5.1 Pre-Execution Forecast

Before invocation:

* estimate cost
* validate against tenant budget
* block or warn accordingly

---

### 5.2 Runtime Enforcement

If OpenClaw exceeds:

* time
* steps
* cost

Execution is **terminated**, not allowed to continue.

---

## Pillar 6: OpenClaw Changes (Minimal)

### Required OpenClaw Additions

* Stateless HTTP execution endpoint
* Ephemeral session profile
* Hard limits enforcement
* Structured output mode
* No self-scheduling

No rewrite. No governance logic added to OpenClaw.

---

## Pillar 7: Ops Console UX

### 7.1 Execution Approval UI

* Clear warning banner
* Scope visualization (what it can do)
* Cost + risk summary
* Approve / deny / override

---

### 7.2 Execution Detail View

* Linked trace
* Output artifacts
* Violations (if any)
* Audit trail

---

## Pillar 8: Failure & Violation Handling

### Failure Modes

* Execution timeout
* Scope violation
* Budget exceeded
* Tool misuse

### Behavior

* Execution aborted
* Trace marked failed
* Audit logged
* Operator notified (via webhook)

---

## Out of Scope (Explicit)

* Background OpenClaw autonomy
* Scheduled OpenClaw agents
* Long-running stateful workflows
* OpenClaw UI embedding
* Agent-to-agent OS collaboration

---

## Success Metrics

| Metric                   | Target |
| ------------------------ | ------ |
| Unauthorized executions  | 0      |
| Violations without audit | 0      |
| Execution replayability  | 100%   |
| Operator understanding   | High   |
| Production incidents     | None   |

---

## Final Positioning Statement

> **Clasper Ops governs agent behavior.
> OpenClaw executes high-risk actions under strict control.**

This preserves:

* Clasper’s trust guarantees
* OpenClaw’s strengths
* A clean separation of concerns

---

## Final Warning (important)

If OpenClaw is ever allowed to:

* wake itself
* remember across runs
* act without approval
* bypass Clasper tracing

**The integration must be considered a failure.**

---

If you want next, I can:

* write the **OpenClaw execution API spec**
* design the **Ops UI approval screens**
* create a **risk scoring rubric**
* or help decide whether this ships as OSS, plugin, or enterprise feature

This is the kind of integration that defines a platform’s future — and this PRD keeps it safe.

---

Great question — **where it runs is the whole ballgame** for keeping Clasper trustworthy.

Here’s the clear, correct answer, then the trade-offs.

---

## The short, correct answer

> **OpenClaw agents must run *outside* of Clasper, in a separate execution environment, invoked ephemerally per request.**

**Never inside the Clasper process.
Never as a long-lived peer.
Never with shared state.**

Clasper stays a **governor**.
OpenClaw stays an **executor**.

---

## The only architecture that preserves Clasper’s guarantees

### Canonical model (recommended)

```
┌──────────────┐
│  Clasper Ops  │
│ (stateless)  │
└──────┬───────┘
       │  governed tool call
       ▼
┌──────────────────────────┐
│ OpenClaw Execution API   │
│ (isolated service)       │
└──────┬───────────────────┘
       │ ephemeral session
       ▼
┌──────────────────────────┐
│ Sandbox (container/VM)   │
│ browser / OS / FS        │
└──────────────────────────┘
```

**Key properties**

* Clasper **never hosts** OpenClaw
* Clasper **never trusts** OpenClaw state
* Each execution:

  * starts fresh
  * has strict limits
  * is destroyed afterward

This preserves:

* tenant isolation
* auditability
* blast-radius control
* deterministic reasoning at the Clasper layer

---

## Where OpenClaw actually lives (options)

### Option A — Dedicated OpenClaw execution service (best)

**What it is**

* A separate service (containerized)
* Exposes `POST /execute`
* Spins up ephemeral OpenClaw sessions
* Enforces limits internally

**Where**

* Kubernetes Job
* ECS task
* Nomad job
* On-demand VM
* Serverless container (if browser allowed)

**Why this is ideal**

* Strong isolation
* Horizontal scaling
* Clean failure modes
* Easy to kill

**This is the recommended default.**

---

### Option B — Per-execution sandbox (maximum safety)

**What it is**

* Each OpenClaw run = fresh container/VM
* Nothing survives the run

**Where**

* Firecracker microVM
* gVisor sandbox
* Docker with seccomp/apparmor
* Cloud browser provider

**Pros**

* Maximum security
* Zero cross-run leakage

**Cons**

* Slower startup
* Higher cost

**Use this for:**
Shell access, filesystem writes, sensitive tenants.

---

### Option C — Developer-local OpenClaw (allowed only for dev)

**What it is**

* OpenClaw runs on a developer machine
* Clasper points to it as a delegated executor

**Rules**

* Dev environment only
* No prod tenants
* Explicit config flag (`OPENCLAW_UNSAFE_LOCAL=true`)
* UI warnings everywhere

**This is acceptable for iteration, not production.**

---

## Where OpenClaw must **not** run

These are hard NOs:

### ❌ Inside the Clasper process

* Breaks statelessness
* Destroys trust boundary
* Impossible to reason about failures

### ❌ As a long-lived daemon per tenant

* Memory leaks across executions
* Hidden autonomy
* Impossible to audit cleanly

### ❌ With shared filesystem or credentials

* Cross-tenant leakage
* Unbounded blast radius

### ❌ With cron / heartbeats enabled

* Autonomous behavior bypasses approval
* Cost + risk become uncontrollable

---

## Who controls lifecycle (important)

| Responsibility | Owner                    |
| -------------- | ------------------------ |
| Identity       | **Clasper**               |
| Authorization  | **Clasper**               |
| Risk scoring   | **Clasper**               |
| Approval       | **Human via Clasper Ops** |
| Execution      | **OpenClaw**             |
| Sandbox        | **Infra layer**          |
| Termination    | **Clasper + Infra**       |
| Audit          | **Clasper**               |

OpenClaw **never decides to run**.
It is only ever **invoked**.

---

## How Clasper sees OpenClaw

From Clasper’s perspective:

```ts
{
  type: "tool_call",
  tool: "delegated.openclaw.execute",
  risk: "high",
  approved: true,
  output: {
    summary: "...",
    artifacts: [...]
  }
}
```

Clasper does **not** care:

* how OpenClaw thinks
* how many steps it took
* what internal tools it used

It only cares about:

* what was allowed
* what was returned
* whether limits were respected

---

## Why this separation is non-negotiable

If OpenClaw runs inside Clasper:

* Clasper becomes un-auditable
* A single bug compromises all tenants
* You lose your platform’s core value

If OpenClaw runs outside Clasper:

* You can reason about failures
* You can say “no”
* You can prove what happened
* You can shut it off instantly

That’s the difference between:

> *“AI assistant”*
> and
> **“production system”**

---

## The one-sentence answer you can reuse

> **OpenClaw agents run in isolated, ephemeral execution environments outside of Clasper, and are invoked only through Clasper’s governed tool interface.**

That sentence protects your architecture.

If you want next, I can:

* diagram the infra options
* specify sandbox policies (seccomp, network rules)
* define the OpenClaw execution SLA
* or help you write the README section explaining this cleanly

This is exactly the right question to ask at this stage.
