# KERNL CONTINUATION PROMPT
## For New Session Bootstrap

**Copy everything below the line into a new Claude session:**

---

# KERNL - PRODUCTION SYSTEM

## CONTEXT
KERNL is a 101-tool persistent intelligence layer for AI systems. Provides crash recovery, semantic search, and system control for Claude Desktop.

**History:** Accidentally deleted January 14, 2026. Fully rebuilt from chat history in 8 hours. Currently in production use.

## CURRENT STATE
```yaml
location: "D:\Projects\Project Mind\kernl-mcp"
version: "5.0.1"
status: "PRODUCTION"
tools: 101
categories: 17
build: "✅ TypeScript Strict (0 errors)"
tests: "✅ All passing"
```

## BOOTSTRAP PROTOCOL

### Step 1: Load Instructions
```typescript
// Use KERNL tool if available:
KERNL:pm_read_file({ 
  project: "kernl", 
  path: "docs/CLAUDE_INSTRUCTIONS_PROJECT.md" 
})

// Or Desktop Commander:
Desktop Commander:read_file({ 
  path: "D:/Projects/Project Mind/kernl-mcp/docs/CLAUDE_INSTRUCTIONS_PROJECT.md" 
})
```

### Step 2: Get Session Context
```typescript
KERNL:get_session_context({ 
  project: "kernl", 
  mode: "auto"  // coding | architecture | debugging | auto
})
// Returns: needsResume, checkpoint, mode-specific context
```

### Step 3: Review Current Status
```typescript
// Check what needs doing:
KERNL:pm_read_file({ 
  project: "kernl", 
  path: "BACKLOG_OVERVIEW.md" 
})
```

## TOOL CATEGORIES (101 Total)

### Core Foundation (16 tools)
- Session Management (5): Checkpoints, recovery, state  
- Project Operations (5): Register, list, update projects
- File Operations (6): Read, write, search, batch ops

### Intelligence Layer (9 tools)
- Semantic Search (3): ONNX embeddings, concept search
- Pattern Recognition (3): Cross-project learning
- Parallel Gates (3): Five-gate verification

### System Control (20 tools)
- Process Management (7): Launch, monitor, control
- Streaming Search (4): Large-scale file search
- System Files (5): Advanced file ops
- Config & Meta (4): Version, status, config

### Chrome Automation (19 tools)
- Session, basic ops, data extraction, intelligence, workflows

### Advanced Features (37 tools)
- Shadow Docs (4), Git (2), Backlog (5), Testing (4)
- Utilities (12), Research (10)

## RECENT WORK (January 2026)

### January 14: The Rebuild
- **09:00** - Accidental deletion during drive reorg
- **10:00-18:00** - Complete rebuild from chat history
- **18:00** - All 101 tools operational

**Lesson:** Documentation quality = Recovery speed

### January 29: Repository Polish
- Updated README with authentic learning journey  
- Created DEVELOPMENT_JOURNEY.md (comprehensive rebuild story)
- Updated BACKLOG to show completion
- Cleaned outdated status indicators
- **Purpose:** Founder's Associate application (demonstrate systematic methodology)

## KEY DOCUMENTATION

```bash
README.md                    # Main overview, authentic story
DEVELOPMENT_JOURNEY.md       # Complete rebuild narrative  
BACKLOG_OVERVIEW.md          # Tool inventory, roadmap
docs/CLAUDE_INSTRUCTIONS_PROJECT.md  # Comprehensive usage
docs/TOOL_REFERENCE.md       # API documentation
CHANGELOG.md                 # Version history
```

## IMMEDIATE CONTEXT

**If working on KERNL itself:**
1. Load CLAUDE_INSTRUCTIONS_PROJECT.md
2. Check BACKLOG_OVERVIEW.md for priorities
3. Review recent git commits
4. TypeScript strict mode (zero tolerance for errors)

**If using KERNL for other projects:**
1. KERNL:get_session_context({ project: "<your_project>" })
2. Work normally
3. KERNL:auto_checkpoint every 2-3 tool calls
4. KERNL:mark_complete when done

## PHILOSOPHY

```yaml
build_intelligence_not_plumbing: "Focus on domain logic, not infrastructure"
option_b_perfection: "10x improvements, not 10%"
zero_technical_debt: "No mocks, stubs, placeholders, TODOs"
foundation_out: "Backend before surface"
aggressive_checkpointing: "Every 2-3 tool calls"
```

## SUCCESS METRICS

```yaml
time_saved: "10-15 hours/week"
crash_recovery: "Minutes instead of hours"
bootstrap: "30 seconds instead of 10 minutes"
cross_project_learning: "Operational"
rebuild_from_docs: "8 hours (proof of documentation quality)"
```

---

**For new sessions:** Just load CLAUDE_INSTRUCTIONS_PROJECT.md and get_session_context. The system handles the rest.

**Last Updated:** January 29, 2026
