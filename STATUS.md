# KERNL — STATUS

**Status:** production
**Version:** 3.0.0 (KERNL-BRAIN-02 v3.0 + Cognitive Organism)
**Last Updated: 2026-05-23 (auto — docs(brain): PROMETHEUS-W3 sync -- STATUS + MORNING_BRIEFING)
**Yuma Health:** 65/100 ORANGE (30 specs, 9 pass) (auto — Yuma)
**Code Health:** 12/100 (23 critical, 358 warnings) (auto — EoS)
**Completion:** 83% (auto — 20 done, 4 pending)
**Tests:** failing (exit 1)

---

## Current State

KERNL is the cognitive infrastructure MCP server — session management, brain.db intelligence,
workspace tools, and the foundation for the nine-system cognitive organism. It runs as a local
server integrated with Claude Desktop. Tier 0 infrastructure — always on, never shelved.

Path: `D:\Projects\Project Mind\kernl-mcp`
GitHub: https://github.com/duke-of-beans/KERNL

## Operational Tools (10/10 verified 2026-05-17)

- [x] brain_briefing — live portfolio delta, P0 items, changed signals
- [x] brain_recall — RRF hybrid search (v3.0: Reciprocal Rank Fusion, k=60)
- [x] brain_recall_graph — graph-enhanced recall via 7k+ brain_edges + structural isomorphisms
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
