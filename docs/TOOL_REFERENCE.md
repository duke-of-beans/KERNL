# KERNL MCP - TOOL REFERENCE
**Version:** 5.0.1 (Rebuild)  
**Tools:** 16 (Phase 1 - Growing to 101)  
**Updated:** January 14, 2026

---

## Session Management (5 tools)

### `get_session_context`
**Purpose:** Mega-bootstrap with intelligent mode detection  
**When:** Start of EVERY session

```typescript
KERNL:get_session_context({
  project: "kernl",
  mode: "auto"  // auto | coding | architecture | debugging
})

// Returns:
{
  needsResume: boolean,
  checkpoint: { operation, progress, decisions, nextSteps },
  project: { id, name, path },
  suggestions: []
}
```

### `check_resume_needed`
**Purpose:** Check if previous session needs resumption

```typescript
KERNL:check_resume_needed({ project: "kernl" })
// Returns: { needsResume: boolean, checkpoint?: {...} }
```

### `auto_checkpoint`
**Purpose:** Save crash recovery checkpoint  
**When:** Every 5-10 tool calls during active work

```typescript
KERNL:auto_checkpoint({
  project: "kernl",
  operation: "implementing feature X",
  progress: 0.5,
  decisions: ["chose approach A"],
  nextSteps: ["complete step 2"],
  activeFiles: ["src/tools/feature.ts"],
  currentStep: "writing handlers"
})
```

### `mark_complete`
**Purpose:** Clear checkpoint state when done

```typescript
KERNL:mark_complete({
  project: "kernl",
  summary: "Completed feature X implementation"
})
```

### `get_session_state` / `save_session_state`
**Purpose:** Manual session state management

---

## Project Operations (5 tools)

### `pm_register_project`
**Purpose:** Register a new project with KERNL

```typescript
KERNL:pm_register_project({
  id: "my-project",      // kebab-case
  name: "My Project",    // Display name
  path: "D:/path/to/project",
  config: { gitEnabled: true },
  group: "work"          // Optional workspace group
})
```

### `pm_list_projects`
**Purpose:** List all registered projects

```typescript
KERNL:pm_list_projects({
  group: "work",           // Optional filter
  visibility: "active"     // active | archived | hidden
})
```

### `pm_get_project`
**Purpose:** Get details of specific project

```typescript
KERNL:pm_get_project({ project: "kernl" })
```

### `pm_update_project`
**Purpose:** Update project configuration

```typescript
KERNL:pm_update_project({
  project: "kernl",
  name: "New Name",
  visibility: "archived",
  notes: "Project notes"
})
```

### `pm_delete_project`
**Purpose:** Remove project from registry (doesn't delete files)

```typescript
KERNL:pm_delete_project({ project: "old-project" })
```

---

## File Operations (6 tools)

### `pm_read_file`
**Purpose:** Read file contents from project

```typescript
KERNL:pm_read_file({
  project: "kernl",
  path: "src/index.ts",   // Relative to project or absolute
  offset: 0,              // Optional: start line
  length: 100             // Optional: number of lines
})

// Returns: { content, totalLines?, range? }
```

### `pm_write_file`
**Purpose:** Write content to project file

```typescript
KERNL:pm_write_file({
  project: "kernl",
  path: "src/new-file.ts",
  content: "// File content here",
  mode: "rewrite"  // rewrite | append
})
```

### `pm_search_files`
**Purpose:** Search files by pattern

```typescript
KERNL:pm_search_files({
  project: "kernl",
  pattern: "*.ts",
  contentSearch: "export function",  // Optional
  maxResults: 50
})

// Returns: { count, results: [{ path, name, size }] }
```

### `pm_list_files`
**Purpose:** List directory contents

```typescript
KERNL:pm_list_files({
  project: "kernl",
  path: "src/tools",      // Optional subdirectory
  recursive: true,
  extensions: [".ts"]     // Optional filter
})
```

### `pm_batch_read`
**Purpose:** Read multiple files at once

```typescript
KERNL:pm_batch_read({
  project: "kernl",
  paths: ["src/index.ts", "src/types/index.ts", "package.json"]
})

// Returns: { results: { [path]: { content } | { error } } }
```

### `pm_get_file_info`
**Purpose:** Get file metadata

```typescript
KERNL:pm_get_file_info({
  project: "kernl",
  path: "src/index.ts"
})

// Returns: { path, name, size, isDirectory, modifiedAt, createdAt }
```

---

## Tools Coming in Future Phases

### Intelligence (Phase 2)
- `search_semantic` - Meaning-based search with ONNX embeddings
- `pm_index_files` - Index project for semantic search
- `pm_index_file` - Index single file
- `suggest_patterns` - Cross-project pattern suggestions
- `five_gate_check` - Parallel verification

### Process Control (Phase 3)
- `sys_start_process` - Start terminal/REPL
- `sys_interact_with_process` - Send input to process
- `sys_read_process_output` - Read process output
- And more...

### Chrome Automation (Phase 4)
- `sys_chrome_launch` - Launch Chrome session
- `sys_chrome_smart_fill_form` - AI-powered form filling
- `sys_chrome_visual_find` - Find elements by description
- And more...

---

**Full 101-tool inventory will be rebuilt as phases complete.**
