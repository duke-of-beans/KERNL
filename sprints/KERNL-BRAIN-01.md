# KERNL-BRAIN-01: Brain Tools Sprint
**Sprint:** KERNL-BRAIN-01
**Created:** 2026-04-23
**Priority:** P1
**Scope:** Add brain.db tools to KERNL MCP server with graph-enhanced recall
**Estimated:** 1 Cowork session

---

## Context

CLAUDE_INSTRUCTIONS.md §1.2 calls `brain/briefing()` at session start, but KERNL
has no brain tools. This means every Claude Desktop session has been bootstrapping
without live portfolio delta — the briefing always returns empty. GREG-FIX-01 in
GregLite BACKLOG.md is the symptom: "morning briefing reports 0 open items."

BRAIN-GRAPH-01 (2026-04-23) built the graph layer on brain.db and added
`callRecallWithGraph` to GregLite's sidecar. That gives GregLite graph-enhanced
recall. This sprint ports all of it to KERNL so Claude Desktop sessions also
get live brain context + graph expansion.

---

## What Gets Built

New file: `D:\Projects\Project Mind\kernl-mcp\src\tools\brain-tools.ts`

Five tools:

### brain_briefing
Live portfolio delta from brain.db — P0 items, changed signals, recent
observations, open gaps, session note. 800-token cap enforced.
Called at session start as replacement for the currently-broken `brain/briefing()`.

### brain_recall
Hybrid vector + BM25 search across observations. Same 70/30 fusion as
GregLite sidecar. Scope filters: `project:name`, `era:name`, `person:name`.
Requires Ollama running for vector component; degrades to BM25-only if unavailable.

### brain_recall_graph
Graph-enhanced recall. Runs brain_recall for seeds, then walks brain_edges
1-hop to surface contextually related observations from neighbor entities.
Returns: seed results + graph_neighbors + graph_observations + graph_summary
(compact text block for system prompt injection).

This is the new capability. When you ask about HIRM, it also surfaces
ConsciousnessBridge and DAI because the graph knows they're connected.

### brain_remember
Write a new observation to brain.db with optional entity linkage.
Generates embedding via Ollama if available.

### brain_status
Get entity + recent observations + latest signal for a named project/entity.

---

## Architecture

Brain tools in KERNL read brain.db directly via better-sqlite3 — no HTTP,
no subprocess, no sidecar dependency. Same pattern as GregLite's brain-client.ts.

Graph traversal logic (getNeighborEntities, getObservationsForEntities,
buildGraphSummary) is extracted into a shared module so it works in both
KERNL and GregLite contexts.

Ollama embedding calls are optional and fail-open: if Ollama isn't running,
recall degrades to BM25-only with a warning in the response. Never blocks.

---

## Files to Create/Modify

### New: `src/tools/brain-tools.ts`
Full implementation of the 5 tools above. Reads brain.db at
`D:\Meta\brain.db`. Uses better-sqlite3. Uses sqlite-vec if available.

### New: `src/tools/brain-graph.ts`
Graph traversal helpers extracted from GregLite's graph-client.ts:
- `getNeighborEntities(db, entityIds, maxPerSeed)`
- `getObservationsForEntities(db, entityIds, limitPerEntity, edgeWeightMap)`
- `buildGraphSummary(seedNames, neighbors, neighborObs)`

### Modify: `src/server/mcp-server.ts`
Register brain tools alongside existing KERNL tools.

### Modify: `src/index.ts` (if needed)
Export brain tool handlers.

---

## Acceptance Criteria

- [ ] `brain_briefing` returns live P0 items from brain.db
- [ ] `brain_recall` returns hybrid results for "HIRM consciousness"
- [ ] `brain_recall_graph` returns HIRM neighbors (ConsciousnessBridge, DAI)
- [ ] `brain_remember` writes a test observation visible in brain_recall
- [ ] `brain_status` returns entity + observations for "GregLite"
- [ ] All tools degrade gracefully if brain.db unavailable
- [ ] All tools degrade gracefully if Ollama unavailable (BM25-only fallback)
- [ ] TSC: 0 new errors
- [ ] KERNL rebuilt and restarted
- [ ] Claude Desktop session test: brain_briefing returns real P0 items

---

## Key Implementation Notes

**better-sqlite3:** Check KERNL package.json. If missing: `npm install better-sqlite3`

**sqlite-vec:** Optional. Load from GregLite sidecar node_modules if present.
If unavailable, vector search degrades to BM25-only — that's fine.

**Ollama embedding:** POST http://localhost:11434/api/embeddings
model: nomic-embed-text. Wrap in try/catch, fail-open always.

**Graph traversal — both directions:**
```sql
-- Outbound
SELECT be.target_entity_id as neighbor_id, be.relationship, be.weight,
       e.name, e.type
FROM brain_edges be JOIN entities e ON e.id = be.target_entity_id
WHERE be.source_entity_id = ?
  AND (be.valid_to IS NULL OR be.valid_to > datetime('now'))
ORDER BY be.weight DESC LIMIT ?

-- Inbound (same query, swap source/target)
```

**CLAUDE_INSTRUCTIONS.md update (post-sprint):**
Update §1.2 to call `brain_briefing` by its KERNL tool name.
Remove the aspirational `brain/briefing()` reference.

---

## Reference Files

- `D:\Projects\GregLite\sidecar\src\brain-client.ts` — recall + briefing to port
- `D:\Projects\GregLite\sidecar\src\graph-client.ts` — graph traversal to port
- `D:\Meta\brain.db` — the database (155 entities, 46k obs, 47 edges, backfill running)
- `D:\Projects\Project Mind\kernl-mcp\src\tools\semantic-search.ts` — embedding pattern
- `D:\Projects\Project Mind\kernl-mcp\src\server\mcp-server.ts` — tool registration
