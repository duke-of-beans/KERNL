# KERNL MCP

**The Core Intelligence Layer for AI Systems**

Transform Claude from a stateless assistant into a persistent intelligence layer with crash recovery, semantic search, and system control.

![Version](https://img.shields.io/badge/version-5.0.1--rebuild-blue)
![Tools](https://img.shields.io/badge/tools-16%20(rebuilding%20to%20101)-green)
![Build](https://img.shields.io/badge/build-passing-brightgreen)

## What is KERNL?

KERNL solves three critical problems with AI assistants:

1. **The 8-Minute Death** - Claude crashes during long operations, losing all context
2. **The Bootstrap Tax** - 5-10 minutes lost restoring context each session
3. **Isolated Learning** - Solutions aren't transferred across projects

## Installation

```bash
# Clone the repository
git clone https://github.com/duke-of-beans/KERNL.git
cd kernl-mcp

# Install dependencies
npm install

# Build
npm run build
```

## Claude Desktop Configuration

Add to `claude_desktop_config.json`:

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

## Quick Start

```typescript
// Start of every session
KERNL:get_session_context({ project: "my-project", mode: "auto" })

// During work (every 5-10 tool calls)
KERNL:auto_checkpoint({ 
  project: "my-project", 
  operation: "current task",
  progress: 0.5 
})

// When done
KERNL:mark_complete({ project: "my-project" })
```

## Current Status: Rebuilding

KERNL was accidentally deleted during drive reorganization on January 14, 2026. Currently rebuilding from chat history.

**Phase 1 Complete:** 16 tools (Session, Project, File operations)  
**Target:** 101 tools across 17 categories

## Documentation

- [Comprehensive Instructions](docs/CLAUDE_INSTRUCTIONS_PROJECT.md)
- [Tool Reference](docs/TOOL_REFERENCE.md)
- [Changelog](CHANGELOG.md)
- [Backlog](BACKLOG_OVERVIEW.md)

## License

MIT
