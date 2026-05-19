-- KERNL MCP - Database Schema
-- Version: 5.0.1
-- Persistent Intelligence Layer for AI Systems

-- ============================================================================
-- PROJECTS TABLE
-- Multi-tenant project registry
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL DEFAULT '{}',  -- JSON
  workspace_group TEXT,  -- Foreign key to workspace_groups
  visibility TEXT DEFAULT 'active',  -- active, archived, hidden
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_group);

-- ============================================================================
-- WORKSPACE GROUPS TABLE
-- Logical grouping of projects
-- ============================================================================
CREATE TABLE IF NOT EXISTS workspace_groups (
  id TEXT PRIMARY KEY,
  description TEXT,
  visibility TEXT DEFAULT 'expanded',  -- expanded, collapsed
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- SESSIONS TABLE
-- Persistent session state for crash recovery
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL,  -- JSON: CurrentTask + SessionContext
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

-- ============================================================================
-- CHECKPOINTS TABLE
-- Auto-checkpoint data for crash recovery
-- ============================================================================
CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  session_id TEXT,
  operation TEXT,
  progress REAL DEFAULT 0,
  decisions TEXT,  -- JSON array
  next_steps TEXT,  -- JSON array
  active_files TEXT,  -- JSON array
  current_step TEXT,
  data TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at DESC);

-- ============================================================================
-- FILE INDEX TABLE
-- For semantic search with embeddings
-- ============================================================================
CREATE TABLE IF NOT EXISTS file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  file_type TEXT,
  size INTEGER,
  content_hash TEXT,
  metadata TEXT,  -- JSON
  content_preview TEXT,  -- First 1000 chars
  embedding BLOB,  -- 384-dim float32 vector
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_project_path ON file_index(project_id, path);
CREATE INDEX IF NOT EXISTS idx_file_type ON file_index(file_type);

-- ============================================================================
-- PATTERNS TABLE
-- Cross-project learning and knowledge graph
-- ============================================================================
CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  implementation TEXT,
  metrics TEXT,  -- JSON
  problem_embedding BLOB,  -- For semantic similarity
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patterns_project ON patterns(project_id);

-- ============================================================================
-- JOBS TABLE
-- Async job queue for long-running operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  parameters TEXT,  -- JSON
  status TEXT NOT NULL DEFAULT 'queued',  -- queued, running, complete, failed, cancelled
  progress REAL NOT NULL DEFAULT 0,  -- 0.0 to 1.0
  current_step TEXT,
  result TEXT,  -- JSON
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- ============================================================================
-- ACTIVITY LOG TABLE
-- Audit trail of all operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  action TEXT NOT NULL,
  details TEXT,  -- JSON
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC);

-- ============================================================================
-- EPICS TABLE
-- Backlog management
-- ============================================================================
CREATE TABLE IF NOT EXISTS epics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',  -- backlog, in_progress, complete, blocked
  priority TEXT DEFAULT 'P2',  -- P0, P1, P2, P3
  estimated_hours REAL,
  actual_hours REAL,
  tags TEXT,  -- JSON array
  dependencies TEXT,  -- JSON array
  acceptance_criteria TEXT,
  spec_location TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);
CREATE INDEX IF NOT EXISTS idx_epics_status ON epics(status);

-- ============================================================================
-- GIT COMMITS TABLE
-- Track commits made through smart_commit
-- ============================================================================
CREATE TABLE IF NOT EXISTS git_commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  session_id TEXT,
  commit_hash TEXT NOT NULL,
  message TEXT NOT NULL,
  files_changed TEXT,  -- JSON array
  stats TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_git_commits_project ON git_commits(project_id);

-- ============================================================================
-- RESEARCH TABLE
-- Store research findings
-- ============================================================================
CREATE TABLE IF NOT EXISTS research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  query TEXT NOT NULL,
  findings TEXT NOT NULL,  -- JSON
  sources TEXT,  -- JSON array
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_project ON research(project_id);

-- ============================================================================
-- SHADOW DOCS TABLE
-- Pending documentation updates
-- ============================================================================
CREATE TABLE IF NOT EXISTS shadow_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  commit_with TEXT DEFAULT 'next_code_commit',
  status TEXT DEFAULT 'pending',  -- pending, applied, cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shadow_docs_project ON shadow_docs(project_id);
CREATE INDEX IF NOT EXISTS idx_shadow_docs_status ON shadow_docs(status);


-- ============================================================================
-- YUMA — Test Specifications
-- "If it survives Yuma, it survives anything."
-- ============================================================================
CREATE TABLE IF NOT EXISTS test_specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  type TEXT NOT NULL,
  spec TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run TEXT,
  last_result TEXT,
  run_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  consecutive_passes INTEGER DEFAULT 0,
  source_file TEXT,
  tags TEXT,
  origin_commit TEXT,
  origin_issue TEXT,
  generated_by TEXT DEFAULT 'human',
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_test_specs_project ON test_specs(project_id);
CREATE INDEX IF NOT EXISTS idx_test_specs_tier ON test_specs(tier);
CREATE INDEX IF NOT EXISTS idx_test_specs_result ON test_specs(last_result);
-- ============================================================================
-- YUMA — Test Run History
-- ============================================================================
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  tier_filter TEXT,
  started_at TEXT,
  completed_at TEXT,
  total INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  results TEXT,
  health_score REAL,
  prophecies TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_test_runs_project ON test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_started ON test_runs(started_at DESC);

-- ============================================================================
-- YUMA — Test Worlds (fixture definitions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS test_worlds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,  fixtures TEXT NOT NULL,
  setup_command TEXT,
  teardown_command TEXT,
  isolation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_test_worlds_project ON test_worlds(project_id);

-- ============================================================================
-- YUMA — Mutation Testing Results
-- ============================================================================
CREATE TABLE IF NOT EXISTS mutation_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  test_file TEXT NOT NULL,
  mutations_generated INTEGER DEFAULT 0,
  mutations_caught INTEGER DEFAULT 0,
  mutations_missed INTEGER DEFAULT 0,
  coverage_score REAL,
  risk_level TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mutation_project ON mutation_results(project_id);
-- ============================================================================
-- YUMA — Test Baselines (benchmark reference points)
-- ============================================================================
CREATE TABLE IF NOT EXISTS test_baselines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  tolerance REAL DEFAULT 1.2,
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_baselines_project ON test_baselines(project_id);
