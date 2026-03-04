# Roadmap

## v0.1 (MVP)

- [x] Requirements + design docs
- [x] API server (Fastify)
- [x] Web UI (Vite + React + Tailwind)
- [x] Core library + basic unit tests
- [ ] CI pipeline (build/test)

## v0.2 (Reliability & Fidelity)

- [x] Snapshot+offset incremental parsing (match AOS skill semantics; read-only)
- [x] Partial-line safe parsing (ignore partial trailing JSONL line)
- [x] Collaboration metrics (per-role load + recent dispatch/complete + avg cycle time)

## v0.3 (Collaboration)

- [x] Agent collaboration view (current+recent)
- [x] Event timeline visualization (tail)
- [ ] Lane view & bottleneck detection (deeper)

## v1.0

- Stable contracts
- **Read-only guarantee (no mutations / no control-plane actions)**
- **Local-first deployment** (runs on the same machine as the AOS workspace)
- Full test coverage for projection semantics
