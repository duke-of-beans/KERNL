# KERNL MCP

**Transform Claude from stateless assistant into persistent intelligence layer**

![Version](https://img.shields.io/badge/version-6.0.0-blue)
![Tools](https://img.shields.io/badge/tools-128-green)
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
- **Semantic Memory (brain.db)**: RRF hybrid search (vector + BM25 + semantic rerank), ACT-R decay, graph-enhanced recall across 7k+ edges, SHA-256 dedup
- **Cross-Project Learning**: Structural isomorphism detection, pattern transfer between codebases
- **YUMA Testing**: Multi-tier quality gates (static analysis, API contracts, terminology compliance, dependency graphs, evidence chain integrity)
- **WHETSTONE**: Adversarial engine via Anthropic API. Challenges positions with strongest counterargument. Code mutation testing identifies untested paths
- **IMPRINT**: Post-session reflection engine. Typed deltas, wound healing cascade, preference tracking
- **Chrome Automation**: 19 tools for browser-based workflows
- **128 Tools Across 19 Categories**: Session management, file operations, intelligence layer, process control, git integration, testing, brain/memory, adversarial, research, and more

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
      "args": ["/path/to/KERNL/dist/index.js"],
      "env": {
        "PROJECT_MIND_DB_PATH": "/path/to/KERNL/data/project-mind.db"
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

**Modular Tool Categories** - 19 categories with clear boundaries and independent operation. Cognitive systems (WHETSTONE, IMPRINT, brain.db) integrate with infrastructure tools (testing, git, process management) through shared state in brain.db.

**Protocol-Driven Quality** - Every tool has explicit input validation, comprehensive error handling, and typed interfaces. No mocks, no stubs, no placeholders—production-quality code or nothing.

## Tool Categories (128 Total)

- **Session Management** (5 tools): Checkpoints, recovery, state management
- **Project Operations** (6 tools): Register, list, update, delete, status
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
- **Git Tools** (3 tools): Smart commits, session packaging, staged versioning
- **Backlog** (5 tools): EPIC management, sprint tracking
- **Testing / YUMA** (12 tools): Test generation, contracts, chains, baselines, precommit, health scores
- **Brain / Memory** (7 tools): brain_briefing, brain_recall (RRF), brain_recall_graph, brain_remember, brain_status, brain_feedback, brain_invalidate
- **Adversarial / WHETSTONE** (1 tool): Epistemic challenge + code mutation testing via Anthropic API
- **Reflection / IMPRINT** (3 tools): Post-session reflection, intention tracking, intention resolution
- **Utilities** (12 tools): Helpers, formatters, converters, backup, disk usage
- **Research** (10 tools): Notes, search, tags, links, export, summary

## Current Status

**Production v6.0.0** - Active daily use across multiple development projects. 128 tools across 19 categories. Nine-system cognitive architecture operational (brain.db memory, WHETSTONE adversarial, IMPRINT reflection, YUMA testing, plus NIGHTSHIFT maintenance running 13 daily passes).

**YUMA Testing Subsystem** - Multi-tier quality gates deployed to production projects. Static analysis (route sync, voice compliance, security), behavioral contracts (API patterns, status codes), terminology compliance (legal risk scanning), dependency graphs, evidence chain integrity. Example: TRACE project runs 17 tests / 84 checks pre-deploy.

**brain.db v3.0** - Reciprocal Rank Fusion hybrid retrieval (vector + BM25 + semantic rerank). ACT-R decay modeling. 7k+ graph edges with structural isomorphism detection. SHA-256 dedup (97.7% noise reduction). Retrieval tracking feeds decay calculations.

**WHETSTONE** - Adversarial engine calling Anthropic API for heterogeneous counter-positions. Two modes: epistemic (challenge assumptions with strongest counterargument) and code (intelligent mutation testing that identifies untested paths). Optional calibration dataset matching.

**Rebuilt From Chat History** - The original 101-tool codebase was reconstructed from Claude conversation history alone after accidental deletion on January 14, 2026. Completed same day. Current 128-tool version evolved from that foundation.

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

[@duke-of-beans](https://github.com/duke-of-beans)

---

**Philosophy:** Build Intelligence, Not Plumbing  
**Reality Check:** If you can rebuild 101 tools from chat history in one day, you documented correctly.
