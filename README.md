# AOS Dashboard

AOS Dashboard is a **beautiful, reliable** visual panel for the OpenClaw **Agent Orchestration System (AOS)**.

It provides:
- Task queue visualization (states, lanes, SLA age)
- Agent collaboration view (dispatches/results per role)
- Operational health signals (snapshot/lock/log status)

## Product Constraints

- **Read-only until v1.0** (no control-plane actions)
- **Local-first until v1.0** (runs on the same machine as the AOS workspace)

## MVP Scope

- Read-only dashboard
- Local file-backed data source (reads AOS `workflow-events.jsonl` + `.aos/*`)
- API server + Web UI

See:
- `docs/requirements.md`
- `docs/design.md`
- `docs/roadmap.md`

## Quickstart

Prereqs: Node.js 20+

```bash
npm install
npm run dev
```

Then open:
- Web: http://localhost:5173
- API: http://localhost:8787/api/health

### Configure AOS workspace path

By default, the API reads from:

- `~/.openclaw/workspace-god`

Override with:

```bash
export AOS_WORKSPACE_ROOT="$HOME/.openclaw/workspace-god"
```

## License

MIT
