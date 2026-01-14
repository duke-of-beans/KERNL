# KERNL CONTINUATION PROMPT
## For Seamless Session Handoff

**Copy everything below the line into a new Claude session:**

---

# KERNL REBUILD - CONTINUE FROM PHASE 1 COMPLETE

## CONTEXT
KERNL (formerly Project Mind) was accidentally deleted during D:\ drive reorganization on January 14, 2026. We're rebuilding from chat history. Phase 1 Foundation is COMPLETE.

## CURRENT STATE
```yaml
location: "D:\Projects\Project Mind\kernl-mcp"
version: "5.0.1-rebuild"
tools_rebuilt: 16
tools_target: 101
build_status: "✅ Passing"
git_status: "Clean, committed"
```

## PHASE 1 COMPLETE ✅
- Session Management (5 tools): get_session_context, check_resume_needed, auto_checkpoint, mark_complete, get/save_session_state
- Project Operations (5 tools): pm_register/list/get/update/delete_project  
- File Operations (6 tools): pm_read/write/search/list/batch_read/get_file_info
- Database: 17 tables (8 core + 9 chrome)
- Types, MCP server, build system all working

## IMMEDIATE NEXT: PHASE 2 - INTELLIGENCE LAYER

Build these tools:
1. **Embeddings module** (src/intelligence/embeddings.ts)
   - ONNX runtime with @xenova/transformers
   - all-MiniLM-L6-v2 model for 384-dim vectors
   - Vector serialization for SQLite BLOB storage

2. **search_semantic** - Meaning-based code search
3. **pm_index_files** - Full project indexing with progress
4. **pm_index_file** - Single file incremental indexing
5. **suggest_patterns** - Cross-project pattern suggestions
6. **five_gate_check** - Parallel 5-gate verification

## KEY FILES TO READ FIRST
```bash
# Comprehensive instructions
KERNL:pm_read_file({ project: "kernl", path: "docs/CLAUDE_INSTRUCTIONS_PROJECT.md" })

# Or use Desktop Commander:
Desktop Commander:read_file({ path: "D:/Projects/Project Mind/kernl-mcp/docs/CLAUDE_INSTRUCTIONS_PROJECT.md" })

# Reconstruction roadmap (in D:\Dev)
Desktop Commander:read_file({ path: "D:/Dev/KERNL_RECONSTRUCTION_PLAN.md" })
```

## CHAT HISTORY MINING QUERIES
Use conversation_search to recover implementation details:
```
"ONNX embeddings pipeline transformers xenova"
"search_semantic cosine similarity vector"
"five_gate_check parallel verification gates"
"pm_index_files indexing progress callback"
```

## STANDARDS
- TypeScript strict mode, zero errors
- Conventional commits (feat/fix/docs)
- Build must pass before commit: `npx tsc --noEmit`
- 4-pillar doc sync (instructions, tool ref, changelog, backlog)

## START SESSION WITH
```typescript
// Verify build still passes
Desktop Commander:start_process({
  command: "cd 'D:\\Projects\\Project Mind\\kernl-mcp'; npx tsc --noEmit",
  timeout_ms: 60000
})

// Then begin Phase 2 implementation
```

---

**Philosophy:** Build Intelligence, Not Plumbing
**Target:** 101 tools, 17 categories, 62-83 min/day time savings
