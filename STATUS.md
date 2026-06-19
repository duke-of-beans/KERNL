# KERNL — STATUS

**Status:** production
**Version:** 3.0.0 (KERNL-BRAIN-02 v3.0 + Cognitive Organism)
**Last Updated: 2026-06-05 (auto — YUMA: replace hardcoded freshness=70 with consecutive-pass-s)
**Yuma Health:** 65/100 ORANGE (30 specs, 9 pass) (auto — Yuma)
**Code Health:** 18/100 (26 critical, 359 warnings) (auto — EoS)
**Completion:** 87% (auto — 26 done, 4 pending)
**Tests:** 2/2 passing (auto)

---

## Current State

KERNL is the cognitive infrastructure MCP server — session management, brain.db intelligence,
workspace tools, and the foundation for the nine-system cognitive organism. It runs as a local
server integrated with Claude Desktop. Tier 0 infrastructure — always on, never shelved.

Path: `D:\Projects\Project Mind\kernl-mcp`
GitHub: https://github.com/duke-of-beans/KERNL

## Operational Tools (11/11 verified 2026-05-28)

- [x] brain_briefing — live portfolio delta, P0 items, changed signals
- [x] brain_recall — RRF hybrid search (v3.0: Reciprocal Rank Fusion, k=60)
- [x] brain_recall_graph — graph-enhanced recall via 7k+ brain_edges + structural isomorphisms
- [x] brain_recall_spread — PROMETHEUS-W2 spreading-activation recall with session warmth
- [x] brain_remember — write observation (SHA-256 dedup guard, auto-embedded)
- [x] brain_feedback — reinforcement loop (helpful/unhelpful/critical)
- [x] brain_status — entity details + recent observations + latest signal
- [x] whetstone_challenge — adversarial testing via Anthropic API
- [x] imprint_reflect — post-session reflection, typed deltas
- [x] Session management (checkpoint, load, save, recover, handoff)
- [x] Project management (register, list, read, write, search, index)

## Completed Milestones

- [x] KERNL-BRAIN-01: brain.db MCP integration — briefing, recall, remember, status (2026-04-23)
- [x] KERNL-BRAIN-02 v2.0: Schema v7, SHA-256 dedup (97.7% noise reduction: 66k→1.5k), RRF retrieval, ACT-R tracking (2026-05-16)
- [x] KERNL-BRAIN-02 v2.1: FTS keyword matching fix (2026-04-24)
- [x] KERNL-BRAIN-02 v3.0: Brain tools v3.0 — retrieval tracking, dedup guard, content_hash (2026-05-16)
- [x] Cognitive Organism Phase 1: brain.db fortification — schema v7, RRF, dedup, ACT-R (2026-05-16)
- [x] Cognitive Organism Phase 3: WHETSTONE + IMPRINT as KERNL tools (2026-05-17)
- [x] NIGHTSHIFT v3.0: 13 passes — co-occurrence, ACT-R decay, synthesis, lifecycle, EoS, benchmark, LIFELOG sync, FPP sync, backup, structural isomorphism, TREG, LANTERN, PROMETHEUS
- [x] Signal watcher: Windows service (anthropic, vercel, github, godaddy, supabase)
- [x] Litestream backup: brain.db → Cloudflare R2
- [x] PROMETHEUS-W3: IMPRINT delta-I (forward intention) tracking -- intentions table, imprint_set_intention + imprint_resolve_intention tools, brain_briefing surfacing, imprint_reflect lifecycle (2026-05-23)
- [x] PROMETHEUS-W1: Observation quality engine -- computeQualityScore, write-time quality, RRF quality re-weight (2026-05-28)
- [x] PROMETHEUS-W2: Spreading-activation recall -- in-memory session activation map (0.2 boost/recall, 0.3/status, 0.05 decay/call), spreadActivation BFS through brain_edges with structural_isomorphism 1.2x boost, brain_recall_spread tool with quality-aware spread_score (2026-05-28)
- [x] PROMETHEUS-W4: Community detection -- label propagation clustering, community-scoped recall, community-aware brain_recall_community tool (2026-05-28)
- [x] PROMETHEUS-CLEANUP: Tech debt -- expanded observations.source CHECK (11 new subsystem values), hardened all vec_distance_cosine queries with typeof/length guards, FTS5 rebuild (2026-05-29)
- [x] AUTONOMIC Phase 1.3: queue_sprint + preflight_check tools (src/tools/autonomic-tools.ts), Phase 9 server registration -- staged sprint queueing with inline confidence scoring + pre-flight validation (AUT-20260603-001, 2026-06-04)

## Open Work

- [ ] Verify GitHub remote is current and all commits pushed
- [ ] Create CHANGELOG.md documenting version history
- [ ] Semantic search indexing (search_semantic tool)
- [ ] Context-aware retrieval (PROMETHEUS proposal — proactive surfacing based on session context)

## Key Metrics

| Metric | Value |
|--------|-------|
| Active observations | ~1,537 (post-dedup) |
| Graph edges | 7,563+ |
| Entities | 155+ |
| Embedding model | nomic-embed-text (768-dim) |
| Recall quality | 88% (50-query benchmark) |
| NIGHTSHIFT passes | 13 |
| Signal sources | 5 (anthropic, vercel, github, godaddy, supabase) |
