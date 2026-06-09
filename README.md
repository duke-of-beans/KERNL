# KERNL MCP

**Transform Claude from stateless assistant into persistent intelligence layer**

![Version](https://img.shields.io/badge/version-6.0.0-blue)
![Tools](https://img.shields.io/badge/tools-128-green)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## The Problem

MCP-based development suffers from three catastrophic failure modes that cost hours of lost work:

**The 8-Minute Death** - Long-running sessions crash during complex operations (efficiency mode throttling, memory limits), losing all architectural decisions and context built up over the session.

**The Bootstrap Tax** - Every new session requires 5-10 minutes manually restoring context. This happens dozens of times per day across multiple projects.

**Isolated Learning** - Solutions discovered in one project stay trapped there. The same problem gets solved independently across different codebases because there's no transfer mechanism.

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

Long-running MCP sessions accumulate significant state: architectural decisions, active file contexts, progress markers, and reasoning chains. When that state is lost to crashes, efficiency throttling, or session rotation, the recovery cost is measured in hours per incident.

KERNL was built to solve this systematically. What started as a checkpoint/recovery system evolved into a full intelligence layer as each friction point was addressed: session persistence led to semantic search, which led to cross-project pattern transfer, which led to adversarial testing and reflection engines. Each tool exists because the problem was encountered and the solution was validated in production.

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

## Design Decisions

### Session Management
State management isn't just "save state." It's understanding what state matters — architectural decisions outweigh file changes — and how to capture it without interrupting flow. Checkpoint frequency is aggressive (every 2-3 tool calls) because state loss compounds faster than checkpoint overhead.

### Crash Recovery
Detection is non-intrusive (silent background check), recovery prompts feel natural, and the system gracefully handles partial state. Race conditions in concurrent checkpointing are solved with queue-based writes.

### Semantic Search
Keyword matching fails for conceptual queries across large codebases. ONNX embeddings (all-MiniLM-L6-v2) with cosine similarity enable meaning-based search — local inference, no API calls, instant results.

### Resilience
The entire tool suite has been rebuilt from documentation after an accidental drive wipe. The architecture survived because every decision was recorded as it happened. This validates the documentation-first approach that KERNL enforces.

## Architecture

**MCP Protocol Foundation** - Exposes tools to any MCP client (Claude Desktop, custom clients). Clean separation between tool interface and implementation.

**SQLite State Persistence** - All session state, project metadata, and semantic indices in better-sqlite3 for transaction safety and zero-config deployment.

**ONNX Embeddings** - Local transformer model (all-MiniLM-L6-v2) for semantic search. No API calls, instant results, works offline.

**Modular Tool Categories** - 19 categories with clear boundaries and independent operation. Cognitive systems (WHETSTONE, IMPRINT, brain.db) integrate with infrastructure tools (testing, git, process management) through shared state in brain.db.

**Protocol-Driven Quality** - Every tool has explicit input validation, comprehensive error handling, and typed interfaces. No mocks, no stubs, no placeholders—production-quality code or nothing.

## Tool Categories (134 Total)

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
- **AUTONOMIC** (6 tools): Sprint queue, scoring, pre-flight, validation, abort analysis, backlog conversion — enhanced backends for the [AUTONOMIC protocol](https://github.com/duke-of-beans/autonomic)
- **Testing / YUMA** (12 tools): Test generation, contracts, chains, baselines, precommit, health scores
- **Brain / Memory** (7 tools): brain_briefing, brain_recall (RRF), brain_recall_graph, brain_remember, brain_status, brain_feedback, brain_invalidate
- **Adversarial / WHETSTONE** (1 tool): Epistemic challenge + code mutation testing via Anthropic API
- **Reflection / IMPRINT** (3 tools): Post-session reflection, intention tracking, intention resolution
- **Utilities** (12 tools): Helpers, formatters, converters, backup, disk usage
- **Research** (10 tools): Notes, search, tags, links, export, summary

## Current Status

**Production v6.0.0** - Active daily use across multiple development projects. 134 tools across 20 categories. Eleven-system cognitive architecture operational (including [AUTONOMIC](https://github.com/duke-of-beans/autonomic) sprint execution) (brain.db memory, WHETSTONE adversarial, IMPRINT reflection, YUMA testing, plus NIGHTSHIFT maintenance running 13 daily passes).

**YUMA Testing Subsystem** - Multi-tier quality gates deployed to production projects. Static analysis (route sync, voice compliance, security), behavioral contracts (API patterns, status codes), terminology compliance (legal risk scanning), dependency graphs, evidence chain integrity. Example: TRACE project runs 17 tests / 84 checks pre-deploy.

**brain.db v3.0** - Reciprocal Rank Fusion hybrid retrieval (vector + BM25 + semantic rerank). ACT-R decay modeling. 7k+ graph edges with structural isomorphism detection. SHA-256 dedup (97.7% noise reduction). Retrieval tracking feeds decay calculations.

**WHETSTONE** - Adversarial engine calling Anthropic API for heterogeneous counter-positions. Two modes: epistemic (challenge assumptions with strongest counterargument) and code (intelligent mutation testing that identifies untested paths). Optional calibration dataset matching.

**Resilience Tested** - The full tool suite has been rebuilt from documentation after catastrophic data loss, validating the system's own documentation-first methodology.

## Documentation

- [Comprehensive Instructions](docs/CLAUDE_INSTRUCTIONS_PROJECT.md) - Full usage guide
- [Tool Reference](docs/TOOL_REFERENCE.md) - Complete API documentation  
- [Architecture](docs/ARCHITECTURE.md) - Technical design decisions
- [Changelog](CHANGELOG.md) - Version history and updates
- [Backlog](BACKLOG_OVERVIEW.md) - Planned improvements

## Contributing

Standards:

1. **Quality Gates** - TypeScript strict mode, zero errors before commit
2. **No Technical Debt** - No mocks, stubs, or TODOs without tickets
3. **Documentation Sync** - Every architectural decision documented inline
4. **Aggressive Checkpointing** - State preserved every 2-3 operations
5. **Protocol-Driven** - Explicit interfaces, comprehensive error handling

Pull requests welcome that maintain these standards.

## License

MIT - See [LICENSE](LICENSE) for details

## Author

[@duke-of-beans](https://github.com/duke-of-beans)

---

**Philosophy:** Build intelligence, not plumbing.
