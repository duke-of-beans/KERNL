-- KERNL MCP - brain.db Canonical Schema
-- Tenant: dk-001  |  Path: D:\Meta\brain.db
-- Source of truth: extracted from the LIVE brain.db (AUT-20260604-004).
--
-- This file documents the persistent intelligence substrate (the "brain"):
-- entities, observations (with FTS5 + ACT-R retrieval tracking), the typed
-- knowledge graph (brain_edges / relationships), community detection,
-- signals, sessions, intentions, gaps, and feedback.
--
-- NOTE ON FIDELITY: the DDL below is reproduced as it exists in the live
-- database. Several core tables (entities, observations, signals, brain_edges)
-- carry quoted identifiers because they were rebuilt via migration; the quotes
-- are cosmetic (none are reserved words) and are preserved here for an exact
-- canonical match. Legacy FK targets `entities_old` / `observations_old` are
-- documented inline — they are stale references left from the table rebuilds
-- and resolve to the current `entities` / `observations` tables in practice.
--
-- Replaying this file against an empty DB reproduces the logical schema. The
-- FTS5 shadow tables and the litestream/sqlite bookkeeping tables (appendix)
-- are runtime-managed and must NOT be created by hand.

-- ============================================================================
-- TENANTS  (multi-tenant root; single tenant 'dk-001')
-- ============================================================================
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,               -- 'dk-001'
  name        TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ENTITIES  (typed nodes in the knowledge graph)
-- CHECK: type is constrained to a fixed taxonomy.
-- embedding BLOB holds the vector representation used for semantic recall.
-- ============================================================================
CREATE TABLE "entities" (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type      TEXT NOT NULL CHECK(type IN (
              'project','person','work_chapter','intellectual','era','account',
              'session','research_subject'
            )),
  name      TEXT NOT NULL,
  slug      TEXT,
  status    TEXT NOT NULL DEFAULT 'active',
  metadata  TEXT NOT NULL DEFAULT '{}',        -- JSON
  embedding BLOB,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  aliases   TEXT DEFAULT '[]'                  -- JSON array
);

-- ============================================================================
-- OBSERVATIONS  (the core memory record)
-- CHECK: source is constrained to the full enum of write origins (sessions,
--   signals, throwbak_*, fpp_*, imprint_*, nightshift_*, whetstone_challenge,
--   dopamine_hit, sprint_abort, ...).
-- Cognitive-organism columns: content_hash (SHA-256 dedup on brain_remember),
--   last_accessed_at + access_count (ACT-R decay), grounding_tier,
--   quality_score, surprisal, compression_ratio, synthesis_depth.
-- FK: tenant_id -> tenants(id); entity_id -> entities(id); session_id -> sessions(id).
-- ============================================================================
CREATE TABLE "observations" (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  entity_id   TEXT REFERENCES entities(id),
  session_id  TEXT REFERENCES sessions(id),
  content     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
    'session','signal','manual','git','sms','import','markdown_index',
    'throwbak_era','throwbak_person','throwbak_wc','throwbak_intl',
    'throwbak_decision','throwbak_event','throwbak_thread',
    'throwbak_creative','throwbak_library',
    'greglite_scan','greglite_health',
    'fpp_synthesis','fpp_chapter','external_context','fpp_finding',
    'imprint_hypothesis','imprint_next_move','imprint_state',
    'imprint_delta','imprint_intention',
    'whetstone_challenge',
    'nightshift_lantern','nightshift_treg','nightshift_prometheus','nightshift_eos',
    'dopamine_hit','sprint_abort'
  )),
  tags        TEXT NOT NULL DEFAULT '[]',       -- JSON array
  embedding   BLOB,
  created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
  embedding_version INTEGER DEFAULT 1,
  status      TEXT DEFAULT 'active',            -- active | archived
  created_by  TEXT,
  source_segment_id TEXT,
  content_hash TEXT,                            -- SHA-256, dedup key
  synthesis_depth INTEGER DEFAULT 0,
  personal_context_id TEXT,
  last_accessed_at DATETIME,                    -- ACT-R retrieval tracking
  access_count INTEGER DEFAULT 0,               -- ACT-R retrieval tracking
  grounding_tier TEXT DEFAULT 'unknown',
  quality_score REAL DEFAULT NULL,
  surprisal REAL DEFAULT NULL,
  compression_ratio REAL DEFAULT NULL
);

-- ============================================================================
-- OBSERVATIONS FULL-TEXT SEARCH  (FTS5, external-content)
-- ----------------------------------------------------------------------------
-- observations_fts is an FTS5 virtual table in EXTERNAL-CONTENT mode:
--   content=observations, content_rowid=rowid
-- It stores NO copy of the text itself — it indexes the `content` column of the
-- observations table, addressing rows by observations.rowid. This keeps the
-- index lean but means the index must be kept in sync by triggers (below),
-- because external-content FTS5 does not auto-track the base table.
--
-- Recall uses FTS5 with EXPLICIT `OR` between tokens (FTS5 defaults to AND);
-- this is one of the three RRF signals (FTS + embedding + MiniLM re-rank).
--
-- The observations_fts_{config,data,docsize,idx} shadow tables are created and
-- managed automatically by SQLite when this virtual table is created. They are
-- documented in the appendix and must NOT be created manually.
-- ============================================================================
CREATE VIRTUAL TABLE observations_fts USING fts5(
  content,
  content=observations,
  content_rowid=rowid
);

-- Triggers that keep the external-content FTS5 index synchronized with the
-- observations base table. 'delete' rows are pushed into the FTS index using
-- the special command-row syntax before re-inserting on update.
CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO observations_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- ============================================================================
-- SIGNALS  (polled external signals: github commits, credits, health, ...)
-- FK: tenant_id -> tenants(id); entity_id -> entities(id).
-- ============================================================================
CREATE TABLE "signals" (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  source         TEXT NOT NULL,
  entity_id      TEXT REFERENCES entities(id),
  value          TEXT NOT NULL DEFAULT '{}',     -- JSON snapshot
  previous_value TEXT NOT NULL DEFAULT '{}',     -- JSON snapshot (delta source)
  changed_at     DATETIME,
  polled_at      DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- SESSIONS  (persistent session state / crash recovery)
-- FK: tenant_id -> tenants(id).
-- ============================================================================
CREATE TABLE sessions (
  id               TEXT PRIMARY KEY,            -- ulid
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  started_at       DATETIME NOT NULL DEFAULT (datetime('now')),
  ended_at         DATETIME,
  projects_touched TEXT NOT NULL DEFAULT '[]',  -- JSON array of entity IDs
  decisions_made   TEXT NOT NULL DEFAULT '[]',  -- JSON array of observation IDs
  summary          TEXT,
  token_count      INTEGER DEFAULT 0
);

-- ============================================================================
-- INTENTIONS  (IMPRINT: active metacognitive intentions, 72h TTL)
-- CHECK: metacognitive_state in (flow, stuck, exploring, converging, wrapping_up).
-- ============================================================================
CREATE TABLE intentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  intention TEXT NOT NULL,
  metacognitive_state TEXT CHECK(metacognitive_state IN ('flow', 'stuck', 'exploring', 'converging', 'wrapping_up')) DEFAULT 'exploring',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT (datetime('now', '+72 hours')),
  refreshed_at TEXT DEFAULT NULL,
  resolved_at TEXT DEFAULT NULL,
  session_id TEXT DEFAULT NULL,
  context TEXT DEFAULT NULL
);

-- ============================================================================
-- GAPS  (open questions; maps to Throwbak GAP IDs)
-- CHECK: status in (open, answered, superseded, deferred).
-- FK note: answered_by references "observations_old"(id) and tenant_id
--   references tenants(id). `observations_old` is a stale migration target
--   (the observations table was rebuilt); the column still holds observation
--   IDs that resolve against the current `observations` table.
-- ============================================================================
CREATE TABLE gaps (
  id             TEXT PRIMARY KEY,            -- ulid (maps to Throwbak GAP IDs)
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  throwbak_id    TEXT,                        -- original GAP-xxx identifier
  question       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','superseded','deferred')),
  answered_by    TEXT REFERENCES "observations_old"(id),  -- nullable; see note above
  era            TEXT,                        -- ERA-01 .. ERA-XX
  created_at     DATETIME NOT NULL DEFAULT (datetime('now')),
  resolved_at    DATETIME,
  topic_fingerprint BLOB                      -- S2: sqlite-vec F32_BLOB(768)
);

-- ============================================================================
-- FEEDBACK_LOG  (brain_feedback reinforcement loop)
-- CHECK: rating in (helpful, unhelpful, critical). weight_delta applied to the
--   referenced observation's effective weight (+0.15 / -0.10 / +0.35).
-- ============================================================================
CREATE TABLE feedback_log (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('helpful','unhelpful','critical')),
  weight_delta REAL NOT NULL,
  context TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- BRAIN_EDGES  (weighted, time-valid knowledge-graph edges)
-- The primary graph layer used by brain_recall_graph (edge-walk + isomorphisms).
-- weight feeds RRF/spread; valid_from/valid_to give bitemporal validity.
-- ============================================================================
CREATE TABLE "brain_edges" (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  valid_from DATETIME NOT NULL DEFAULT (datetime('now')),
  valid_to DATETIME,
  source TEXT NOT NULL DEFAULT 'manual',
  metadata TEXT NOT NULL DEFAULT '{}',         -- JSON
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  manually_seeded INTEGER DEFAULT 0
);

-- ============================================================================
-- RELATIONSHIPS  (typed, validated relationships — legacy graph layer)
-- CHECK: type in (depends_on, blocks, resolves, owns, works_at, part_of,
--   competes_with, enables).
-- FK note: from_entity_id / to_entity_id reference "entities_old"(id), a stale
--   migration target (entities table was rebuilt); IDs resolve against the
--   current `entities` table.
-- ============================================================================
CREATE TABLE relationships (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  from_entity_id TEXT NOT NULL REFERENCES "entities_old"(id),
  to_entity_id   TEXT NOT NULL REFERENCES "entities_old"(id),
  type           TEXT NOT NULL CHECK (type IN (
                   'depends_on','blocks','resolves','owns',
                   'works_at','part_of','competes_with','enables'
                 )),
  metadata       TEXT NOT NULL DEFAULT '{}',  -- JSON: weight, confidence, notes
  created_at     DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ENTITY_COMMUNITIES  (Louvain-style community assignment per entity)
-- consecutive_assignments + stable track convergence across NIGHTSHIFT passes.
-- ============================================================================
CREATE TABLE entity_communities (
  entity_id TEXT PRIMARY KEY,
  community_id INTEGER NOT NULL,
  confidence REAL DEFAULT 0.0,
  consecutive_assignments INTEGER DEFAULT 1,
  last_computed_at TEXT DEFAULT (datetime('now')),
  stable INTEGER DEFAULT 0
);

-- ============================================================================
-- COMMUNITY_METADATA  (per-community label + density)
-- ============================================================================
CREATE TABLE community_metadata (
  community_id INTEGER PRIMARY KEY,
  label TEXT DEFAULT NULL,
  member_count INTEGER DEFAULT 0,
  density REAL DEFAULT 0.0,
  computed_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- SCHEMA_VERSION  (migration ledger)
-- ============================================================================
CREATE TABLE schema_version (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_brain_edges_rel    ON brain_edges(relationship);
CREATE INDEX idx_brain_edges_source ON brain_edges(source_entity_id);
CREATE INDEX idx_brain_edges_target ON brain_edges(target_entity_id);
CREATE INDEX idx_brain_edges_weight ON brain_edges(weight);

CREATE INDEX idx_community_id     ON entity_communities(community_id);
CREATE INDEX idx_community_stable ON entity_communities(stable);

CREATE INDEX idx_gaps_era    ON gaps(tenant_id, era);
CREATE INDEX idx_gaps_status ON gaps(tenant_id, status);
CREATE INDEX idx_gaps_tenant ON gaps(tenant_id);

CREATE INDEX idx_intentions_active ON intentions(expires_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_intentions_entity ON intentions(entity);

CREATE INDEX idx_obs_access_count ON observations(access_count);
CREATE INDEX idx_obs_content_hash ON observations(content_hash);
CREATE INDEX idx_obs_grounding    ON observations(grounding_tier);
CREATE INDEX idx_obs_last_accessed ON observations(last_accessed_at);
CREATE INDEX idx_obs_quality      ON observations(quality_score) WHERE status = 'active';

CREATE INDEX idx_relationships_from   ON relationships(from_entity_id);
CREATE INDEX idx_relationships_tenant ON relationships(tenant_id);
CREATE INDEX idx_relationships_to     ON relationships(to_entity_id);
CREATE INDEX idx_relationships_type   ON relationships(tenant_id, type);

CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_tenant  ON sessions(tenant_id);

-- ============================================================================
-- APPENDIX — RUNTIME-MANAGED OBJECTS (DO NOT CREATE MANUALLY)
-- ----------------------------------------------------------------------------
-- FTS5 shadow tables, auto-created with the observations_fts virtual table:
--   CREATE TABLE 'observations_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;
--   CREATE TABLE 'observations_fts_data'(id INTEGER PRIMARY KEY, block BLOB);
--   CREATE TABLE 'observations_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
--   CREATE TABLE 'observations_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
--
-- Litestream replication bookkeeping (created by the litestream backup agent):
--   CREATE TABLE _litestream_lock (id INTEGER);
--   CREATE TABLE _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER);
--
-- SQLite internal (created automatically for AUTOINCREMENT):
--   CREATE TABLE sqlite_sequence(name, seq);
-- ============================================================================
