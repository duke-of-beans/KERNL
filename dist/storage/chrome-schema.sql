-- ============================================================================
-- CHROME BROWSER AUTOMATION TABLES
-- Intelligent browser automation with learning
-- ============================================================================

-- ----------------------------------------------------------------------------
-- WORKFLOW RECORDINGS
-- Store recorded browser workflows for replay
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT,
  steps TEXT NOT NULL,              -- JSON array of WorkflowStep
  duration INTEGER NOT NULL,        -- Duration in ms
  metadata TEXT NOT NULL DEFAULT '{}',  -- JSON
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chrome_workflows_project ON chrome_workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_chrome_workflows_name ON chrome_workflows(name);

-- ----------------------------------------------------------------------------
-- PAGE PATTERNS
-- Learned page structures for intelligent recognition
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_page_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_pattern TEXT NOT NULL,
  page_type TEXT NOT NULL,          -- article, form, dashboard, search, etc.
  structure TEXT NOT NULL,          -- JSON: PageStructure
  forms TEXT,                       -- JSON: FormInfo[]
  interactive_elements TEXT,        -- JSON: InteractiveElement[]
  confidence REAL NOT NULL,         -- 0.0 to 1.0
  observed_count INTEGER DEFAULT 1,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chrome_patterns_url ON chrome_page_patterns(url_pattern);
CREATE INDEX IF NOT EXISTS idx_chrome_patterns_type ON chrome_page_patterns(page_type);

-- ----------------------------------------------------------------------------
-- ERROR RECOVERY STRATEGIES
-- Learn which recovery strategies work for specific errors
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_recovery_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_type TEXT NOT NULL,
  url_pattern TEXT,
  selector_pattern TEXT,
  strategy TEXT NOT NULL,           -- JSON: RecoveryStrategy config
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0.0,
  last_success TEXT,
  last_failure TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chrome_recovery_error ON chrome_recovery_strategies(error_type);

-- ----------------------------------------------------------------------------
-- PAGE CHECKPOINTS
-- Save complete page state for restoration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,              -- JSON: complete page state
  size INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chrome_checkpoints_session ON chrome_checkpoints(session_id);

-- ----------------------------------------------------------------------------
-- FIELD MAPPINGS
-- Learned mappings between data keys and form fields
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_field_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_pattern TEXT NOT NULL,
  data_key TEXT NOT NULL,           -- e.g., "firstName", "email"
  selector TEXT NOT NULL,           -- CSS selector that works
  field_type TEXT,                  -- text, email, password, select, etc.
  confidence REAL NOT NULL DEFAULT 1.0,
  success_count INTEGER DEFAULT 1,
  failure_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(url_pattern, data_key)
);

CREATE INDEX IF NOT EXISTS idx_chrome_field_url ON chrome_field_mappings(url_pattern);

-- ----------------------------------------------------------------------------
-- VISUAL ELEMENT CACHE
-- Cache visual descriptions of elements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_visual_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_pattern TEXT NOT NULL,
  description TEXT NOT NULL,        -- Natural language description
  selector TEXT NOT NULL,
  element_type TEXT,
  bounding_box TEXT,                -- JSON
  screenshot_hash TEXT,
  confidence REAL NOT NULL,
  last_verified TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chrome_visual_url ON chrome_visual_cache(url_pattern);
CREATE INDEX IF NOT EXISTS idx_chrome_visual_desc ON chrome_visual_cache(description);

-- ----------------------------------------------------------------------------
-- NETWORK LOGS
-- Store network request/response data
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_network_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER,
  response_time INTEGER,            -- ms
  request_size INTEGER,
  response_size INTEGER,
  headers TEXT,                     -- JSON
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chrome_network_session ON chrome_network_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_chrome_network_url ON chrome_network_logs(url);

-- ----------------------------------------------------------------------------
-- SESSION METADATA
-- Track Chrome session usage and performance
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_session_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  pages_opened INTEGER DEFAULT 0,
  actions_performed INTEGER DEFAULT 0,
  errors_encountered INTEGER DEFAULT 0,
  memory_peak INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chrome_session_meta_project ON chrome_session_metadata(project_id);

-- ----------------------------------------------------------------------------
-- WORKFLOW TEMPLATES
-- Pre-built workflow patterns
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chrome_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,               -- login, search, monitor, extract
  description TEXT,
  parameters TEXT NOT NULL,         -- JSON: parameter schema
  implementation TEXT NOT NULL,     -- JSON: workflow steps
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chrome_templates_type ON chrome_templates(type);
