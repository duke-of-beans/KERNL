---
name: KERNL
description: Persistent intelligence layer for AI assistants — 101 tools for session management, crash recovery, semantic search, cross-project learning, and Chrome automation via MCP.
author: duke-of-beans
homepage: https://github.com/duke-of-beans/KERNL
license: MIT
---

# KERNL Skills

## Session Persistence & Crash Recovery

Automatically checkpoint session state every 2-3 tool calls. When Claude Desktop
crashes or hits token limits, recover exact state — active files, architectural
decisions, progress percentage, and next steps — losing minutes instead of hours.
Detects unclean shutdowns and prompts recovery on the next session start.

## Cross-Project Semantic Search

Search for solutions, patterns, and decisions across all registered projects using
natural language queries. ONNX-powered local embeddings (all-MiniLM-L6-v2) match
by concept, not keyword. Patterns learned in one codebase transfer to others.

## Workspace & Project Management

Register and track multiple projects with their own state, backlog, and decision
history. Mode-aware bootstrapping (coding / architecture / debugging / auto) loads
only the context relevant to the current task.

## Chrome Automation

19 tools for browser-based workflows — navigation, interaction, scraping, and
automated testing. Built into the same MCP server, no separate setup needed.

---

## Prompts

- "Start a new session and restore my last checkpoint"
- "Checkpoint my current progress on this task"
- "Search all my projects for how I solved X before"
- "What architectural decisions have been made in this project?"
- "Mark this task complete and clear the checkpoint"
- "Recover from the last crash and tell me where I was"
- "Show me patterns from other projects relevant to what I'm building"
- "Register a new project called X"

---

## Resources

- `project-mind.db` — SQLite database storing all session state, checkpoints, and project metadata
- `data/` — Runtime data directory for embeddings and indices
- `docs/CLAUDE_INSTRUCTIONS_PROJECT.md` — Full usage guide
- `docs/TOOL_REFERENCE.md` — Complete API documentation for all 101 tools
