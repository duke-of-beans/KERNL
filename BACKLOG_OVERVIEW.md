# KERNL MCP - BACKLOG OVERVIEW
**Version:** 5.0.1-rebuild  
**Status:** Recovering from accidental deletion  
**Updated:** January 14, 2026

---

## Current State

```yaml
phase: "Rebuild Phase 1"
tools_rebuilt: 16
tools_target: 101
categories_rebuilt: 3
categories_target: 17
build_status: "✅ Passing"
```

---

## Active Work: REBUILD

### Phase 1: Foundation ✅ COMPLETE
- [x] Project structure and package.json
- [x] TypeScript configuration
- [x] Database schema (schema.sql)
- [x] Chrome schema (chrome-schema.sql)
- [x] Types (types/index.ts)
- [x] Database layer (storage/database.ts)
- [x] Session management tools (5)
- [x] Project operations tools (5)
- [x] File operations tools (6)
- [x] MCP server registration
- [x] Build passing

### Phase 2: Intelligence Layer 🔄 NEXT
- [ ] ONNX embeddings (embeddings.ts)
- [ ] search_semantic tool
- [ ] pm_index_files tool
- [ ] pm_index_file tool
- [ ] suggest_patterns tool
- [ ] five_gate_check tool

### Phase 3: Desktop Commander Parity
- [ ] Process management (7 tools)
- [ ] Streaming search (4 tools)
- [ ] System files (5 tools)
- [ ] Config & meta (4 tools)

### Phase 4: Chrome Automation
- [ ] Chrome session manager
- [ ] Basic Chrome tools (9)
- [ ] Intelligence tools (5)
- [ ] Workflow tools (5)

### Phase 5: Advanced Features
- [ ] Shadow docs (4 tools)
- [ ] Git integration (2 tools)
- [ ] Backlog management (4 tools)
- [ ] Research tools (2 tools)
- [ ] Export tools (7 tools)

### Phase 6: Testing & Polish
- [ ] Testing tools (4)
- [ ] Integration tools (3)
- [ ] Final documentation sync

---

## Historical EPICs (Pre-Deletion)

### P0: Git Operations Unified ✅
- smart_commit tool replacing 4-step manual workflow
- Saved 20-30 min/day

### P1a: Bootstrap Mode Detection ✅
- get_session_context with auto/coding/architecture/debugging modes
- Zero ramp-up time

### P1b: Shadow Documentation ✅
- 4 tools for non-blocking doc updates
- shadow_doc_update, list_pending, cancel, apply

### P2a: Parallel 5-Gate Checks ✅
- five_gate_check replacing 5 sequential searches
- 45s → 10s verification time

### P2b: Auto Semantic Indexing ✅
- pm_index_file with incremental indexing
- 30s → 1s index updates

---

## Metrics

```yaml
# Current (Rebuild)
tools: 16
categories: 3
build: passing

# Target (Full Recovery)
tools: 101
categories: 17
time_savings: "62-83 min/day"
```

---

**Recovery Strategy:** Chat history mining via conversation_search
