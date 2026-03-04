# Requirements (AOS Dashboard)

## Goals

Build a long-lived, open-source project that provides a **beautiful, reliable dashboard** for the OpenClaw **Agent Orchestration System (AOS)**.

## Users

- Primary: system owner/operator (Boss)
- Secondary: contributors running AOS in their own OpenClaw workspaces

## MVP Requirements (P0)

### Functional

1. **Task Queue View**
   - Display tasks grouped or filterable by state: Ready / In Progress / Review / Failed / Done / Inbox
   - Show lane (`execution` vs `ops`), roleHint, SLA minutes, InProgress age

2. **Metrics (Reliable)**
   - Counts by state
   - Counts by lane
   - SLA breach detection (age > SLA)

3. **Recent Events (Audit Trail)**
   - Read last N events from `workflow-events.jsonl`

4. **Health Signals**
   - Autopilot mutex status: `.aos/autopilot.lock` (exists, age, stale)

### Non-Functional

- **Reliability > fancy**: never crash on partial lines / malformed JSON; degrade gracefully.
- **Read-only until v1.0** (no destructive actions).
- **Local-first deployment** until v1.0 (runs on the same machine as the AOS workspace).
- **Low coupling**: point to an AOS workspace via env var.
- **Pretty UI**: modern layout, clear typography, charts.

## Iteration 1 (P1)

- Snapshot+offset incremental parsing (match AOS skill semantics)
- Agent collaboration panels:
  - dispatch/results per agent
  - throughput and latency
- Event timeline visualization
- Export: JSON/CSV for tasks & metrics

## Iteration 2 (P2)

- Live updates via SSE/WebSocket
- Multi-workspace support
- Pluggable data sources (file, HTTP, remote agent)
- Auth (optional) for remote hosting
