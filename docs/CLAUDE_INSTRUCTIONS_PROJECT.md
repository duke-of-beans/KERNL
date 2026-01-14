# KERNL MCP - COMPREHENSIVE PROJECT INSTRUCTIONS
**Version:** 5.0.1 (Rebuild from Chat History)  
**Updated:** January 14, 2026  
**Tools:** 16 (Phase 1 Foundation - Growing)  
**Status:** Rebuilding from chat history after accidental deletion

---

## §1 PROJECT IDENTITY

```yaml
name: "KERNL"
full_name: "The Core Intelligence Layer for AI Systems"
formerly: "Project Mind MCP"
philosophy: "Build Intelligence, Not Plumbing"

mission: |
  Transform Claude from a stateless assistant into a persistent 
  intelligence layer with crash recovery, semantic search, and 
  system control capabilities.

problems_solved:
  - "8-minute death": Claude crashes during long operations
  - "Bootstrap tax": 5-10 minutes lost restoring context each session
  - "Isolated learning": Solutions not transferred across projects

target_tools: 101  # From v5.0.1 before deletion
current_tools: 16  # Phase 1 foundation rebuilt
```

---

## §2 BOOTSTRAP PROTOCOL (Every Session)

```typescript
// MANDATORY at session start:
KERNL:get_session_context({ project: "kernl", mode: "auto" })
// Returns: needsResume, checkpoint data, suggestions

// During work (every 5-10 tool calls):
KERNL:auto_checkpoint({ 
  project: "kernl", 
  operation: "current task",
  progress: 0.5  // 0.0 to 1.0
})

// When task complete:
KERNL:mark_complete({ project: "kernl", summary: "what was done" })
```

---

## §3 CURRENT TOOL INVENTORY (Phase 1)

### Session Management (5 tools)
```yaml
get_session_context: "Mega-bootstrap with mode detection"
check_resume_needed: "Check for incomplete work"
auto_checkpoint: "Crash recovery checkpoint"
mark_complete: "Clear checkpoint state"
get_session_state: "Get current session"
save_session_state: "Manual session save"
```

### Project Operations (5 tools)
```yaml
pm_register_project: "Register new project"
pm_list_projects: "List all projects"
pm_get_project: "Get project details"
pm_update_project: "Update project config"
pm_delete_project: "Remove from registry"
```

### File Operations (6 tools)
```yaml
pm_read_file: "Read file from project"
pm_write_file: "Write file to project"
pm_search_files: "Search files by pattern"
pm_list_files: "List directory contents"
pm_batch_read: "Read multiple files"
pm_get_file_info: "Get file metadata"
```

---

## §4 REBUILD ROADMAP

### Phase 1: Foundation ✅ COMPLETE
- [x] Project structure
- [x] Database schema (core + chrome)
- [x] Types definitions
- [x] Database access layer
- [x] Session management tools (5)
- [x] Project operations tools (5)
- [x] File operations tools (6)
- [x] MCP server registration
- [x] Build passing

### Phase 2: Intelligence Layer
- [ ] ONNX embeddings integration
- [ ] Semantic search (search_semantic)
- [ ] File indexing (pm_index_files, pm_index_file)
- [ ] Pattern system (suggest_patterns)
- [ ] Five-gate check (five_gate_check)

### Phase 3: Desktop Commander Parity
- [ ] Process management (7 tools)
- [ ] Streaming search (4 tools)  
- [ ] System files (5 tools)
- [ ] Config & meta (4 tools)

### Phase 4: Chrome Automation
- [ ] Session manager with Puppeteer
- [ ] Basic Chrome tools (9 tools)
- [ ] Intelligence tools (5 tools)
- [ ] Workflow recording (5 tools)

### Phase 5: Advanced Features
- [ ] Shadow documentation (4 tools)
- [ ] Git integration (2 tools)
- [ ] Backlog management (4 tools)
- [ ] Research tools (2 tools)
- [ ] Export tools (7 tools)

### Phase 6: Testing & Polish
- [ ] Testing tools (4 tools)
- [ ] Integration tools (3 tools)
- [ ] Documentation sync
- [ ] Build verification

---

## §5 DEVELOPMENT STANDARDS

```yaml
typescript: "Strict mode, zero errors always"
commits: "Conventional format (feat/fix/docs/refactor)"
testing: "npm run build must pass before commit"
documentation: "Update with code changes (4-pillar sync)"

build_commands:
  check: "npx tsc --noEmit"
  build: "npm run build"
  start: "node dist/index.js"
```

---

## §6 4-PILLAR DOCUMENTATION SYNC

```yaml
# These files MUST stay synchronized
pillars:
  1: "docs/CLAUDE_INSTRUCTIONS_PROJECT.md"  # This file
  2: "docs/TOOL_REFERENCE.md"               # Tool documentation
  3: "CHANGELOG.md"                          # Version history
  4: "BACKLOG_OVERVIEW.md"                   # Epic/backlog status

synchronized_fields:
  - tool_count
  - version
  - categories
  - current_status

rule: "Never update one pillar without updating all four"
```

---

## §7 FILE STRUCTURE

```
kernl-mcp/
├── src/
│   ├── index.ts                    # Entry point
│   ├── types/
│   │   ├── index.ts                # Type definitions
│   │   └── declarations.d.ts       # Module declarations
│   ├── server/
│   │   └── mcp-server.ts           # MCP server
│   ├── storage/
│   │   ├── database.ts             # SQLite access
│   │   ├── schema.sql              # Core schema
│   │   └── chrome-schema.sql       # Chrome tables
│   └── tools/
│       ├── state-management.ts     # Session tools
│       ├── project-operations.ts   # Project tools
│       └── file-operations.ts      # File tools
├── dist/                           # Compiled JS
├── data/                           # SQLite database
├── docs/                           # Documentation
├── package.json
└── tsconfig.json
```

---

## §8 RECOVERY CONTEXT

This rebuild is from chat history after the KERNL project was accidentally deleted during D:\ drive reorganization on January 14, 2026.

**Recovery source:** Claude Desktop KERNL project chat history
**Original state:** v5.0.1 with 101 tools, 17 categories
**Recovery approach:** Systematic rebuild using conversation_search

---

**Path:** D:\Projects\Project Mind\kernl-mcp  
**Database:** D:\Projects\Project Mind\kernl-mcp\data\project-mind.db
