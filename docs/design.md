# System Design (MVP)

## Overview

AOS Dashboard is split into:

1) **API service** (`apps/api`): reads AOS files from a workspace root and exposes JSON endpoints.
2) **Web UI** (`apps/web`): fetches the API and renders a dashboard.
3) **Core library** (`packages/aos-core`): parsing + projection + metrics.

## Data Sources

From the target workspace root:

- `workflow-events.jsonl` (source of truth)
- `.aos/autopilot.lock` (mutex health)

MVP reads the event log **fully** for correctness. Iteration-1 will implement snapshot+offset incremental parsing.

## Contracts

- **Events**: each line is JSON; must handle partial trailing lines.
- **Projection**: reduce events into a task map.
- **Metrics**: derived from projected tasks.

## API Endpoints (MVP)

- `GET /api/health`
- `GET /api/tasks`
- `GET /api/metrics`
- `GET /api/events?limit=200`

## UI Pages (MVP)

Single page:

- KPI cards (Total/Ready/In Progress/SLA breaches)
- State bar chart
- Queue table
- SLA breach list

## Reliability Notes

- Always tolerate malformed JSON lines (skip + continue)
- Keep the dashboard read-only
