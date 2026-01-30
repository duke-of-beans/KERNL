# KERNL MCP

**Transform Claude from stateless assistant into persistent intelligence layer**

![Version](https://img.shields.io/badge/version-5.0.1-blue)
![Tools](https://img.shields.io/badge/tools-101-green)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## The Problem

AI-assisted development suffers from three catastrophic failure modes that cost hours of lost work:

**The 8-Minute Death** - Claude Desktop crashes during long operations (efficiency mode throttling, memory limits), losing all architectural decisions and context built up over the session. You're left staring at a blank chat trying to remember what you discussed.

**The Bootstrap Tax** - Every new session requires 5-10 minutes manually restoring context: "We were working on X, decided Y because Z, next we need to..." This happens dozens of times per day.

**Isolated Learning** - Solutions discovered in one project stay trapped there. You solve the same problem three times across different codebases because there's no transfer mechanism.

## The Solution

KERNL provides aggressive session state management with automatic checkpointing every 2-3 tool calls. When crashes happen (and they do), recovery restores exact state—active files, architectural decisions, progress, next steps—losing minutes instead of hours.

**Core Capabilities:**
- **Crash Recovery**: Automatic checkpoints with 1-click resume
- **Semantic Search**: Find solutions across all projects by concept, not keyword
- **Cross-Project Learning**: Patterns learned in one codebase transfer to others  
- **Chrome Automation**: 19 tools for browser-based workflows
- **101 Tools Across 17 Categories**: Session management, file operations, intelligence layer, process control, git integration, and more

## Why This Exists

**The Progression:**

**Week 1-2:** Hit ceiling during complex refactors—Claude Desktop would crash 45 minutes in, losing all architectural discussions. Manual workaround: frantically copy-paste decisions into markdown files (forgot constantly, lost work anyway).

**Week 3-4:** Built basic checkpoint save/restore. Crashed immediately—learned about race conditions the hard way. Added recovery detection with careful prompt engineering for natural UX.

**Week 5-8:** Realized checkpointing wasn't enough—needed workspace management, semantic search, cross-project patterns. Expanded to 101 tools systematically.

**January 14, 2026:** Accidentally deleted entire codebase during D:/ drive reorganization. Zero panic—had complete chat history with Claude documenting every decision.

**January 14, 2026 (same day):** Rebuilt all 101 tools from chat history alone in 8 hours. This is the repository you're looking at. The fact that you're reading this README proves the system works.

## Installation

```bash
# Clone the repository  
git clone https://github.com/duke-of-beans/KERNL.git
cd KERNL

# Install dependencies
npm install

# Build
npm run build
```

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kernl": {
      "command": "node",
      "args": ["D:/Projects/Project Mind/kernl-mcp/dist/index.js"],
      "env": {
        "PROJECT_MIND_DB_PATH": "D:/Projects/Project Mind/kernl-mcp/data/project-mind.db"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see KERNL tools available immediately.

## Quick Start

```typescript
// Start of EVERY session - mega-bootstrap with mode detection
KERNL:get_session_context({ 
  project: "my-project", 
  mode: "auto"  // coding | architecture | debugging | auto
})

// During work - aggressive checkpointing (every 2-3 tool calls)
KERNL:auto_checkpoint({ 
  project: "my-project", 
  operation: "Implementing Z3 solver integration",
  progress: 0.65,
  currentStep: "Writing constraint translation layer",
  decisions: ["Using Z3 Python API instead of SMT-LIB2", "Caching solver instances"],
  nextSteps: ["Test constraint generation", "Add error handling", "Document API"],
  activeFiles: ["src/solver/z3-wrapper.ts", "tests/solver.test.ts"]
})

// Task complete - clear checkpoint state
KERNL:mark_complete({ 
  project: "my-project", 
  summary: "Z3 integration complete, 12 tests passing" 
})
```

## Development Journey

**Built with zero traditional coding background using systematic AI-native development methodology.**

### Key Learnings

**Session Management Isn't Just "Save State"** - It's understanding WHAT state matters (architectural decisions > file changes) and HOW to capture it without interrupting flow. Wrong checkpoint = worse than no checkpoint.

**Crash Recovery Design** - After three false starts: detection must be non-intrusive (silent background check), recovery prompt must feel natural (not "ERROR: RESUME?"), and checkpoint frequency must be aggressive (every 2-3 tool calls, not "when convenient").

**The Rebuild Test** - The ultimate validation of a system's design quality is whether you can rebuild it from documentation alone. KERNL passed this test literally—101 tools reconstructed from chat history in 8 hours because every decision was documented as it happened.

### Challenges Faced

**Race Conditions in Checkpointing** - Initial implementation would crash trying to save state during tool execution. Solution: separate checkpoint thread with queue-based writes.

**Bootstrap Complexity** - Loading 101 tools worth of context every session is expensive. Solution: intelligent mode detection (coding vs architecture vs debugging) loads only relevant context.

**Semantic Search Accuracy** - Keyword matching failed for conceptual queries. Solution: ONNX embeddings with cosine similarity for meaning-based search.

## Architecture

**MCP Protocol Foundation** - Exposes tools to any MCP client (Claude Desktop, custom clients). Clean separation between tool interface and implementation.

**SQLite State Persistence** - All session state, project metadata, and semantic indices in better-sqlite3 for transaction safety and zero-config deployment.

**ONNX Embeddings** - Local transformer model (all-MiniLM-L6-v2) for semantic search. No API calls, instant results, works offline.

**Modular Tool Categories** - 17 categories (session, project, file, intelligence, chrome, git, backlog, testing, utilities, research, etc.) with clear boundaries and independent operation.

**Protocol-Driven Quality** - Every tool has explicit input validation, comprehensive error handling, and typed interfaces. No mocks, no stubs, no placeholders—production-quality code or nothing.

## Tool Categories (101 Total)

- **Session Management** (5 tools): Checkpoints, recovery, state management
- **Project Operations** (5 tools): Register, list, update, delete projects
- **File Operations** (6 tools): Read, write, search, batch operations  
- **Semantic Search** (3 tools): Concept-based search, indexing, patterns
- **Pattern Recognition** (3 tools): Cross-project learning, suggest solutions
- **Parallel Gates** (1 tool): Five-gate verification (git/code/ui/backlog/patterns)
- **Process Management** (7 tools): Launch, monitor, control system processes
- **Streaming Search** (4 tools): Large-scale file/content search
- **System Files** (5 tools): Advanced file operations, metadata
- **Config & Meta** (4 tools): Version, status, configuration management
- **Chrome Automation** (19 tools): Browser control, scraping, interaction
- **Shadow Docs** (4 tools): Parallel documentation system
- **Git Tools** (2 tools): Smart commits, session packaging
- **Backlog** (5 tools): EPIC management, sprint tracking
- **Testing** (4 tools): Test generation, coverage, CI integration
- **Utilities** (12 tools): Helpers, formatters, converters
- **Research** (10 tools): Paper indexing, citation management, analysis

## Current Status

**Production** - Active daily use across multiple development projects. Prevents estimated 10-15 hours/week of context loss from crashes and bootstrap overhead.

**Rebuilt From Chat History** - This entire codebase (101 tools, 17 categories, full test coverage) was reconstructed from Claude conversation history alone after accidental deletion on January 14, 2026. Completed same day.

**Continuous Evolution** - New tools added as friction points emerge. Current focus: enhanced Chrome automation for job application workflows.

## Documentation

- [Comprehensive Instructions](docs/CLAUDE_INSTRUCTIONS_PROJECT.md) - Full usage guide
- [Tool Reference](docs/TOOL_REFERENCE.md) - Complete API documentation  
- [Architecture](docs/ARCHITECTURE.md) - Technical design decisions
- [Changelog](CHANGELOG.md) - Version history and updates
- [Backlog](BACKLOG_OVERVIEW.md) - Planned improvements

## Contributing

This project demonstrates systematic AI-native development methodology:

1. **Quality Gates** - TypeScript strict mode, zero errors before commit
2. **No Technical Debt** - No mocks, stubs, placeholders, or TODOs without tickets
3. **Documentation Sync** - Every decision documented as it happens
4. **Aggressive Checkpointing** - Every 2-3 tool calls, crash recovery built-in
5. **Protocol-Driven** - Explicit interfaces, comprehensive error handling

Pull requests welcome that maintain these standards.

## License

MIT - See [LICENSE](LICENSE) for details

## Author

**David Kirsch** - Operations executive and entrepreneur with advanced AI-native development skills. Built this system to eliminate friction in AI-assisted development workflows.

Zero traditional coding background—systematic methodology over credentials.

---

**Philosophy:** Build Intelligence, Not Plumbing  
**Reality Check:** If you can rebuild 101 tools from chat history in one day, you documented correctly.
