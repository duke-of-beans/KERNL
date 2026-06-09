/**
 * brain-tools.ts — KERNL-BRAIN-01 + KERNL-BRAIN-02 + KERNL-SEMANTIC-01
 *
 * v3.1: KERNL-SEMANTIC-01 — 3-signal RRF recall
 *       Added MiniLM (all-MiniLM-L6-v2, 384-dim ONNX) as 3rd RRF signal
 *       Lazy-loaded re-ranker: query-time semantic diversity via different model
 *       Graceful fallback to 2-signal RRF if MiniLM unavailable
 *
 * v3.0: COGNITIVE-ORGANISM-PHASE-1 fortification
 *       RRF hybrid retrieval (replaces weighted average)
 *       Retrieval tracking (last_accessed_at, access_count) for ACT-R decay
 *       SHA-256 dedup on brain_remember
 *       Status-aware queries (skip archived observations)
 *
 * v2.2: FTS5 explicit OR between keyword tokens (FTS5 default is AND, not OR)
 *       nomic task-specific prefixes, brain_feedback reinforcement loop
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  getNeighborEntities,
  getObservationsForEntities,
  buildGraphSummary,
} from './brain-graph.js';

const _require = createRequire(import.meta.url);

const BRAIN_DB_PATH  = 'D:\\Meta\\brain.db';
const TENANT_ID      = 'dk-001';
const OLLAMA_HOST    = 'http://localhost:11434';
const EMBED_MODEL    = 'nomic-embed-text';
const CHAR_CAP       = 3200;
const CALIBRATION_PATH = 'D:\\Projects\\treg-mcp\\calibration\\reference_cases.json';

// Anthropic API for WHETSTONE + IMPRINT
let _apiKey = '';
try { const env = fs.readFileSync('D:\\Meta\\.env', 'utf8'); const m = env.match(/ANTHROPIC_API_KEY=(.+)/); if (m) _apiKey = m[1].trim(); } catch { /**/ }

function callClaudeAPI(prompt: string, systemPrompt: string, maxTokens = 1024): Promise<string | null> {
  if (!_apiKey) return Promise.resolve(null);
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': _apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body).toString() }
    }, (res) => {
      let raw = '';
      res.on('data', (c: Buffer) => raw += c);
      res.on('end', () => {
        try { const d = JSON.parse(raw); resolve(d.content?.[0]?.text ?? null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

interface PreparedStmt {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown | undefined;
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}
interface BrainDB {
  pragma(cmd: string): unknown;
  prepare(sql: string): PreparedStmt;
  close(): void;
}

let _db: BrainDB | null = null;
let _vecLoaded = false;

function getBrainDb(): BrainDB | null {
  if (_db) return _db;
  try {
    const Database = _require('better-sqlite3') as new (p: string, o?: object) => BrainDB; // eslint-disable-line @typescript-eslint/no-explicit-any
    _db = new Database(BRAIN_DB_PATH, { readonly: false });
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = OFF');
    if (!_vecLoaded) {
      try {
        const sqliteVec = _require(
          'D:\\Projects\\GregLite\\sidecar\\node_modules\\sqlite-vec'
        ) as { load: (db: BrainDB) => void };
        sqliteVec.load(_db);
        _vecLoaded = true;
      } catch { /* BM25-only */ }
    }
    return _db;
  } catch (e) {
    console.error('[brain-tools] Failed to open brain.db:', (e as Error).message);
    return null;
  }
}

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(): string {
  const now = Date.now(); let str = '', mod = now;
  for (let i = 9; i >= 0; i--) { str = (ENC[mod % 32] ?? '0') + str; mod = Math.floor(mod / 32); }
  for (let i = 0; i < 16; i++) str += ENC[Math.floor(Math.random() * 32)] ?? '0';
  return str;
}

function generateEmbedding(text: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${OLLAMA_HOST}/api/embeddings`);
    const body = JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 4000) });
    const req = http.request({
      hostname: url.hostname, port: parseInt(url.port || '11434'),
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const p = JSON.parse(raw);
          if (!p.embedding) return reject(new Error('No embedding in response'));
          resolve(new Float32Array(p.embedding as number[]));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Ollama timeout')); });
    req.write(body); req.end();
  });
}

function normalizeScores(scores: Map<string, number>): Map<string, number> {
  if (scores.size === 0) return scores;
  const vals = Array.from(scores.values());
  const min = Math.min(...vals); const max = Math.max(...vals); const range = max - min;
  const result = new Map<string, number>();
  for (const [id, score] of scores) result.set(id, range === 0 ? 1 : (score - min) / range);
  return result;
}

// --- MiniLM Semantic Re-Ranker (lazy-loaded ONNX) ---
// all-MiniLM-L6-v2 (384-dim) provides a different semantic space than nomic-embed-text (768-dim).
// Used as 3rd RRF signal: genuine model diversity, not just a second vector search.
type MiniLmModule = {
  embed: (text: string) => Promise<Float32Array>;
  cosineSimilarity: (a: Float32Array, b: Float32Array) => number;
};
let _miniLm: MiniLmModule | null = null;
let _miniLmFailed = false;

async function getMiniLm(): Promise<MiniLmModule | null> {
  if (_miniLmFailed) return null;
  if (_miniLm) return _miniLm;
  try {
    const mod = await import('../intelligence/embeddings.js');
    await mod.preload();
    _miniLm = { embed: mod.embed, cosineSimilarity: mod.cosineSimilarity };
    return _miniLm;
  } catch {
    _miniLmFailed = true;
    return null;
  }
}

/** Build FTS5 keyword query — OR between tokens with prefix wildcard.
 *  FTS5 default between tokens is AND, which is too restrictive for natural language queries.
 *  Explicit OR means any matching token qualifies, ranked by BM25. */
function buildFtsQuery(query: string): string {
  const STOP = new Set(['the','and','for','with','that','this','from','about','what','how','why','when','where','who','are','was','did','does']);
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .map(w => w + '*');
  return tokens.length > 0 ? tokens.join(' OR ') : query.replace(/"/g, '');
}

// ─── PROMETHEUS-W1: Observation Quality Scoring ─────────────────────────────
// Quality determines retrieval salience, never existence. No observation is
// ever deleted or archived based on quality (National Razor: non-use is not
// evidence of invalidity). Function is pure given (db, input): caller-controlled
// side effects only. Used at brain_remember write time and by NIGHTSHIFT Pass 15.

interface QualityInput {
  content: string;
  source: string;
  grounding_tier: string;
  embedding: Float32Array | null;
  entity_id: string | null;
  exclude_id?: string | null;
}

interface QualityFactors {
  surprisal: number;
  grounding_weight: number;
  source_weight: number;
  compression_ratio: number;
  prediction_error: number;
}

interface QualityResult {
  quality_score: number;
  surprisal: number;
  compression_ratio: number;
  factors: QualityFactors;
}

const SOURCE_WEIGHTS: Record<string, number> = {
  session: 1.00,
  treg_scan: 0.95,
  imprint: 0.90,
  markdown_index: 0.85,
  lantern_synthesis: 0.70,
  greglite_scan: 0.50,
};

const GROUNDING_WEIGHTS: Record<string, number> = {
  empirical: 1.00,
  verified: 1.00,
  theoretical: 0.75,
  partial: 0.75,
  speculative: 0.50,
  weak: 0.50,
  unknown: 0.50,
};

/** Compute quality score for an observation. Returns 0-1 quality, surprisal,
 *  compression ratio, plus factor breakdown for diagnostics. Weighted sum of
 *  five normalized factors: surprisal (k=5 NN distance), grounding tier weight,
 *  source weight, compression ratio (structural density), prediction error
 *  (divergence from same-entity priors). Equal weighting to start; tune later.
 */
export function computeQualityScore(db: BrainDB, input: QualityInput): QualityResult {
  // --- 1. Surprisal: avg cosine distance to k=5 global NN ---
  let surprisal = 0.5;
  if (input.embedding && _vecLoaded) {
    try {
      const queryJson = JSON.stringify(Array.from(input.embedding));
      const rows = db.prepare(
        `SELECT vec_distance_cosine(embedding, vec_f32(?)) AS dist
         FROM observations
         WHERE tenant_id=? AND embedding IS NOT NULL AND status='active'
           AND typeof(embedding)='blob' AND length(embedding)=3072
           AND id != COALESCE(?, '')
         ORDER BY dist ASC LIMIT 5`
      ).all(queryJson, TENANT_ID, input.exclude_id ?? '') as { dist: number }[];
      if (rows.length > 0) {
        const avg = rows.reduce((s, r) => s + r.dist, 0) / rows.length;
        // Cosine distance is 0 (identical) to 2 (opposite). Map to 0-1.
        surprisal = Math.min(1, Math.max(0, avg / 2));
      }
    } catch { /* neutral */ }
  }

  // --- 2. Grounding tier weight (default neutral) ---
  const groundingWeight = GROUNDING_WEIGHTS[(input.grounding_tier ?? 'unknown').toLowerCase()] ?? 0.5;

  // --- 3. Source weight (default 0.6 for unknown sources) ---
  const sourceWeight = SOURCE_WEIGHTS[(input.source ?? '').toLowerCase()] ?? 0.6;

  // --- 4. Compression ratio: structural density per token ---
  const tokens = input.content.split(/\s+/).filter(Boolean);
  const tokenCount = Math.max(1, tokens.length);
  const pathMatches = (input.content.match(/[A-Za-z]:\\[^\s]+|\/[A-Za-z0-9_./\-]+(?:\.[a-z]+)?/g) ?? []).length;
  const versionMatches = (input.content.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) ?? []).length;
  const entityLike = new Set<string>();
  for (const t of tokens) {
    if (/^[A-Z][a-z]+[A-Z][A-Za-z]+$/.test(t)) entityLike.add(t.toLowerCase()); // CamelCase
    else if (/^[A-Z]{3,}$/.test(t)) entityLike.add(t.toLowerCase());            // 3+ char ACRONYM
  }
  const rawRatio = (entityLike.size + pathMatches + versionMatches) / tokenCount;
  // Typical observations cluster 0.0-0.3 raw. ×3 then clamp gives usable 0-1.
  const compressionRatio = Math.min(1, rawRatio * 3);

  // --- 5. Prediction error: divergence from same-entity prior beliefs ---
  let predictionError = 0.5;
  if (input.entity_id && input.embedding && _vecLoaded) {
    try {
      const queryJson = JSON.stringify(Array.from(input.embedding));
      const rows = db.prepare(
        `SELECT vec_distance_cosine(embedding, vec_f32(?)) AS dist
         FROM observations
         WHERE tenant_id=? AND entity_id=? AND embedding IS NOT NULL
           AND status='active' AND typeof(embedding)='blob' AND length(embedding)=3072
           AND id != COALESCE(?, '')
         ORDER BY dist ASC LIMIT 3`
      ).all(queryJson, TENANT_ID, input.entity_id, input.exclude_id ?? '') as { dist: number }[];
      if (rows.length > 0) {
        const avg = rows.reduce((s, r) => s + r.dist, 0) / rows.length;
        predictionError = Math.min(1, Math.max(0, avg / 2));
      } else {
        predictionError = 0.3; // first observation for this entity — modest novelty
      }
    } catch { /* neutral */ }
  }

  const factors: QualityFactors = {
    surprisal,
    grounding_weight: groundingWeight,
    source_weight: sourceWeight,
    compression_ratio: compressionRatio,
    prediction_error: predictionError,
  };
  const quality = (surprisal + groundingWeight + sourceWeight + compressionRatio + predictionError) / 5;

  const round4 = (x: number) => Math.round(x * 10000) / 10000;
  return {
    quality_score: round4(quality),
    surprisal: round4(surprisal),
    compression_ratio: round4(compressionRatio),
    factors,
  };
}

/** PROMETHEUS-W3: ensure the IMPRINT intentions table exists (idempotent).
 *  Mirrors the lazy-create pattern used for feedback_log. Intentions are
 *  forward-intention deltas (what David is working toward) with a 72h expiry.
 *  Private to brain.db; never surfaced to external systems. */
function ensureIntentionsTable(db: BrainDB): void {
  db.prepare(`CREATE TABLE IF NOT EXISTS intentions (
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
)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_intentions_entity ON intentions(entity)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_intentions_active ON intentions(expires_at) WHERE resolved_at IS NULL`).run();
}

/** PROMETHEUS-W3: best-effort lookup of the current (recent, still-open)
 *  brain.db session id, used to stamp new intentions. Returns null when no
 *  recent session is available -- intentions never block on this. */
function getCurrentSessionId(db: BrainDB): string | null {
  try {
    const row = db.prepare(
      "SELECT id FROM sessions WHERE tenant_id=? AND ended_at IS NULL AND started_at > datetime('now','-1 day') ORDER BY started_at DESC LIMIT 1"
    ).get(TENANT_ID) as { id: string } | undefined;
    return row?.id ?? null;
  } catch { return null; }
}

/** PROMETHEUS-W3: format a future SQLite/ISO datetime as a short relative
 *  string (in 5m / in 8h / in 3d). Used to show intention expiry. */
function relativeTime(iso: string): string {
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const ts = Date.parse(norm);
  if (isNaN(ts)) return 'unknown';
  const diff = ts - Date.now();
  if (diff <= 0) return 'expired';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(diff / 3600000);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(diff / 86400000)}d`;
}

// ─── PROMETHEUS-W2: Session Activation + Spreading Activation ───────────
// In-memory activation map. No schema change, no persistence. Lives for the
// MCP server process lifetime = one session. Decays per tool call. Keyed by
// entity_id. brain_recall_spread propagates activation through brain_edges
// so the session warms to topics related to recent queries.

const sessionActivation = new Map<string, number>();
const SESSION_BOOST_RECALL = 0.2;
const SESSION_BOOST_STATUS = 0.3;
const SESSION_DECAY = 0.05;
const ACTIVATION_MAX = 1.0;

function tickActivation(): void {
  if (sessionActivation.size === 0) return;
  for (const [id, level] of sessionActivation) {
    const next = level - SESSION_DECAY;
    if (next <= 0) sessionActivation.delete(id);
    else sessionActivation.set(id, next);
  }
}

function boostActivation(entityId: string | null | undefined, amount: number): void {
  if (!entityId) return;
  const current = sessionActivation.get(entityId) ?? 0;
  sessionActivation.set(entityId, Math.min(ACTIVATION_MAX, current + amount));
}

function spreadActivation(
  db: BrainDB,
  seedEntityIds: string[],
  depth = 2,
  dampening = 0.5
): Map<string, number> {
  const activations = new Map<string, number>();
  for (const seed of seedEntityIds) activations.set(seed, 1.0);
  let frontier = new Map<string, number>(activations);

  for (let d = 0; d < depth; d++) {
    if (frontier.size === 0) break;
    const next = new Map<string, number>();
    for (const [entId, parentAct] of frontier) {
      try {
        const edges = db.prepare(
          `SELECT target_entity_id AS nb, relationship, weight FROM brain_edges
             WHERE source_entity_id = ? AND (valid_to IS NULL OR valid_to > datetime('now'))
           UNION ALL
           SELECT source_entity_id AS nb, relationship, weight FROM brain_edges
             WHERE target_entity_id = ? AND (valid_to IS NULL OR valid_to > datetime('now'))`
        ).all(entId, entId) as { nb: string; relationship: string; weight: number }[];
        for (const e of edges) {
          if (!e.nb) continue;
          const normWeight = Math.min(1, Math.max(0, e.weight));
          const relMultiplier = e.relationship === 'structural_isomorphism' ? 1.2 : 1.0;
          const contribution = parentAct * normWeight * relMultiplier * dampening;
          if (contribution < 0.01) continue;
          const existing = next.get(e.nb) ?? 0;
          next.set(e.nb, Math.min(1, existing + contribution));
        }
      } catch { /* edge query failed for this entity — skip */ }
    }
    for (const [k, v] of next) {
      const prev = activations.get(k) ?? 0;
      activations.set(k, Math.max(prev, v));
    }
    frontier = next;
  }

  for (const [k, v] of sessionActivation) {
    const prev = activations.get(k) ?? 0;
    activations.set(k, Math.max(prev, v));
  }

  // PROMETHEUS-W4: Community glow — weakly activate all entities in the same
  // stable community as each activated entity. activation × 0.3.
  // Graceful skip if entity_communities table doesn't exist.
  try {
    const hasCommunityTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entity_communities'"
    ).all().length > 0;
    if (hasCommunityTable) {
      const getCommunity = db.prepare(
        'SELECT community_id FROM entity_communities WHERE entity_id = ? AND stable = 1'
      );
      const getCommunityMembers = db.prepare(
        'SELECT entity_id FROM entity_communities WHERE community_id = ? AND stable = 1'
      );
      const communityGlow = new Map<string, number>();
      for (const [entId, activation] of activations) {
        const row = getCommunity.get(entId) as { community_id: number } | undefined;
        if (!row) continue;
        const members = getCommunityMembers.all(row.community_id) as { entity_id: string }[];
        const glowLevel = activation * 0.3;
        if (glowLevel < 0.01) continue;
        for (const m of members) {
          if (m.entity_id === entId) continue; // skip self
          const existing = communityGlow.get(m.entity_id) ?? 0;
          communityGlow.set(m.entity_id, Math.max(existing, glowLevel));
        }
      }
      for (const [k, v] of communityGlow) {
        const prev = activations.get(k) ?? 0;
        activations.set(k, Math.min(1, Math.max(prev, v)));
      }
    }
  } catch { /* community table missing or error — skip gracefully */ }

  return activations;
}

export const brainTools: Tool[] = [
  {
    name: 'brain_briefing',
    description: 'Live portfolio delta from brain.db — P0 items, changed signals, recent observations, open gaps, active intentions. Call at session start for live context.',
    inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'ISO datetime to delta from (optional)' } } },
  },
  {
    name: 'brain_recall',
    description: '3-signal RRF recall across brain.db observations. Fuses nomic-embed-text vector cosine + BM25 keyword + MiniLM semantic re-ranking, then re-weights by observation quality (0.7-1.0 multiplier). Finds relevant memories by meaning, ranked by information value.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        scope: { type: 'string', description: 'Optional scope: project:name, era:name, person:name' },
        limit: { type: 'number', description: 'Max results (default 8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'brain_recall_graph',
    description: 'Graph-enhanced recall. Seeds via hybrid search then walks brain_edges to surface observations from connected entities.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        scope: { type: 'string', description: 'Optional scope: project:name, era:name, person:name' },
        limit: { type: 'number', description: 'Max seed results (default 8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'brain_remember',
    description: 'Write a new observation to brain.db. Captures decisions, discoveries, friction points, anything worth persisting across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remember' },
        entity: { type: 'string', description: 'Entity name to associate with' },
        source: { type: 'string', description: 'Source tag (default: session)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'brain_status',
    description: 'Get entity details + recent observations + latest signal for a named project or entity.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project or entity name to look up' } },
      required: ['project'],
    },
  },
  {
    name: 'brain_feedback',
    description: 'Rate the usefulness of a recalled observation. Drives reinforcement — helpful/critical strengthens graph paths, unhelpful weakens them.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: { type: 'string', description: 'ID of the observation to rate (from brain_recall results)' },
        rating: { type: 'string', enum: ['helpful', 'unhelpful', 'critical'], description: 'helpful=+0.15, unhelpful=-0.10, critical=+0.35 edge weight delta' },
        context: { type: 'string', description: 'Optional: what query or task this recall was for' },
      },
      required: ['observation_id', 'rating'],
    },
  },
  {
    name: 'whetstone_challenge',
    description: 'WHETSTONE adversarial engine. Two modes: (1) epistemic — challenges positions with strongest counterargument. (2) code — intelligent mutation testing. Reads source + test files, generates targeted mutations that SHOULD break behavior, reports which are caught by existing tests. Uses Anthropic API.',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', description: 'The conclusion, claim, or position to challenge (epistemic mode)' },
        context: { type: 'string', description: 'Optional context about how the position was reached' },
        calibration: { type: 'boolean', description: 'If true, also check against TREG calibration dataset' },
        mode: { type: 'string', enum: ['epistemic', 'code'], description: 'Challenge mode: epistemic (default) or code (mutation testing)' },
        source_file: { type: 'string', description: 'Path to source file (code mode)' },
        test_file: { type: 'string', description: 'Path to test file (code mode)' },
        mutation_count: { type: 'number', description: 'Number of mutations to generate (code mode, default: 5)' },
      },
      required: ['position'],
    },
  },
  {
    name: 'brain_invalidate',
    description: 'Mark an observation as invalid (proven wrong, contradicted, superseded). Does NOT archive by staleness — only by proven invalidity. National Razor: non-use ≠ invalidity.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: { type: 'string', description: 'ID of the observation to invalidate' },
        reason: { type: 'string', description: 'Why this observation is invalid (contradiction, superseded, factually wrong)' },
      },
      required: ['observation_id', 'reason'],
    },
  },
  {
    name: 'imprint_reflect',
    description: 'IMPRINT reflection engine. Generates post-session self-evaluation with typed deltas. Analyzes what worked, what failed, what should change. Proposes ΔK = (ΔS, ΔU, ΔT, ΔI) over system prompt, user model, tool config, and forward intentions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_summary: { type: 'string', description: 'Summary of what happened this session' },
        outcomes: { type: 'string', description: 'What worked and what did not' },
        corrections: { type: 'string', description: 'Any corrections David made to Claude output' },
      },
      required: ['session_summary'],
    },
  },
  {
    name: 'imprint_set_intention',
    description: 'IMPRINT intention delta -- record what David is working toward for an entity, plus metacognitive state. Persists to brain.db, surfaces in brain_briefing, expires after 72h unless refreshed. Re-setting the active intention for an entity updates it in place rather than duplicating.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity or project this intention is about' },
        intention: { type: 'string', description: 'What is being worked toward or planned next' },
        metacognitive_state: { type: 'string', enum: ['flow', 'stuck', 'exploring', 'converging', 'wrapping_up'], description: 'Current cognitive state (default: exploring)' },
        context: { type: 'string', description: 'Optional extra context for the intention' },
      },
      required: ['entity', 'intention'],
    },
  },
  {
    name: 'imprint_resolve_intention',
    description: 'IMPRINT intention delta -- mark an intention resolved when its work is finished or abandoned. Resolve by entity (the most recent active intention for that entity) or by specific id. Resolved intentions no longer surface in brain_briefing.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity whose most recent active intention to resolve' },
        id: { type: 'number', description: 'Specific intention id to resolve (overrides entity when provided)' },
      },
    },
  },
  {
    name: 'brain_recall_spread',
    description: 'PROMETHEUS-W2 spreading-activation recall over brain_edges. Seeds entity activation from a standard recall, propagates through the graph weighted by edge strength, runs a second recall scoped to activated entities, and re-ranks by spread_score = rrf × quality × activation. Session warmth accumulates across calls and decays per call. Use for deep contextual queries; prefer brain_recall for fast simple lookups.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        depth: { type: 'number', description: 'Spread depth in graph hops (default 2, range 1-4)' },
        dampening: { type: 'number', description: 'Per-hop dampening factor 0.1-0.9 (default 0.5)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'brain_recall_community',
    description: 'PROMETHEUS-W4 community-scoped recall. Looks up an entity\'s stable community (from label propagation clustering), finds all entities in that community, returns their observations sorted by recency. A structural discovery tool — "what\'s related to X at the graph level?"',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity name to find community for' },
        limit: { type: 'number', description: 'Max observations to return (default 20)' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'project_context_scan',
    description: 'Cross-pollinator: scan the portfolio for tools, patterns, and APIs relevant to the current project. ' +
      'Queries brain.db graph neighbors, finds cross-project patterns, checks D:\\Meta\\ for available API keys. ' +
      'Call at session start when working on any project, or when building a new feature.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name or entity (e.g., "TRACE", "Oktyv")' },
        task: { type: 'string', description: 'Optional: what you are about to build, for pattern matching' },
      },
      required: ['project'],
    },
  },
];

async function handleBriefing(input: { since?: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable', p0_items: [], session_note: 'brain.db offline' };
  try {
    const lastSession = db.prepare(
      'SELECT ended_at FROM sessions WHERE tenant_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1'
    ).get(TENANT_ID) as { ended_at: string } | undefined;
    const deltaSince = input.since ?? lastSession?.ended_at ?? new Date(0).toISOString();
    const p0Items = (db.prepare(`SELECT name, type, metadata FROM entities WHERE tenant_id = ? AND status = 'active' AND json_extract(metadata,'$.priority') = 'P0' ORDER BY updated_at DESC LIMIT 10`).all(TENANT_ID) as { name: string; type: string; metadata: string }[]).map(e => {
      let desc = ''; try { const m = JSON.parse(e.metadata); desc = m.description ?? m.phase ?? m.status ?? ''; } catch { /**/ }
      return { entity: e.name, type: e.type, description: desc };
    });
    const changedSignals = (db.prepare(`SELECT s.source, e.name AS entity, s.previous_value, s.value AS current_value, s.changed_at FROM signals s LEFT JOIN entities e ON s.entity_id = e.id WHERE s.tenant_id = ? AND s.changed_at > ? ORDER BY s.changed_at DESC LIMIT 10`).all(TENANT_ID, deltaSince) as { source: string; entity: string | null; previous_value: string; current_value: string; changed_at: string }[]).map(s => ({
      source: s.source, entity: s.entity ?? 'unknown',
      from: (() => { try { return JSON.parse(s.previous_value); } catch { return s.previous_value; } })(),
      to: (() => { try { return JSON.parse(s.current_value); } catch { return s.current_value; } })(),
    }));
    const recentObs = db.prepare(`SELECT o.content, e.name AS entity_name, o.source, o.created_at FROM observations o LEFT JOIN entities e ON o.entity_id = e.id WHERE o.tenant_id = ? AND o.created_at > ? ORDER BY o.created_at DESC LIMIT 8`).all(TENANT_ID, deltaSince) as { content: string; entity_name: string | null; source: string; created_at: string }[];
    const openGaps = (db.prepare("SELECT COUNT(*) as n FROM gaps WHERE tenant_id = ? AND status = 'open'").get(TENANT_ID) as { n: number }).n;
    const projectCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE tenant_id = ? AND type = 'project' AND status = 'active'").get(TENANT_ID) as { n: number }).n;

    // --- Dopamine Hits: surface inspiring autonomous findings ---
    const dopamineHits = (() => {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const hits = db.prepare(`
          SELECT o.content, o.source, o.created_at, e.name AS entity_name
          FROM observations o LEFT JOIN entities e ON o.entity_id = e.id
          WHERE o.tenant_id = ? AND o.status = 'active'
            AND o.created_at > ?
            AND (o.source IN ('prometheus_assessment','lantern_synthesis','treg_scan','whetstone_challenge','imprint_hypothesis')
                 OR o.tags LIKE '%whetstone%' OR o.tags LIKE '%lantern%' OR o.tags LIKE '%prometheus%' OR o.tags LIKE '%treg%'
                 OR o.content LIKE 'PROMETHEUS %' OR o.content LIKE 'WHETSTONE %' OR o.content LIKE 'LANTERN %')
          ORDER BY o.created_at DESC LIMIT 3
        `).all(TENANT_ID, sevenDaysAgo) as { content: string; source: string; created_at: string; entity_name: string | null }[];
        return hits.map(h => ({
          content: h.content.length > 250 ? h.content.slice(0, 250) + '…' : h.content,
          source: h.source, entity: h.entity_name, created_at: h.created_at,
        }));
      } catch { return []; }
    })();

    // --- Active Intentions (PROMETHEUS-W3) ---
    const activeIntentions = (() => {
      try {
        ensureIntentionsTable(db);
        const rows = db.prepare(
          "SELECT entity, intention, metacognitive_state, expires_at FROM intentions WHERE resolved_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 5"
        ).all() as { entity: string; intention: string; metacognitive_state: string; expires_at: string }[];
        return rows.map(r => ({
          entity: r.entity,
          intention: r.intention,
          metacognitive_state: r.metacognitive_state,
          expires: relativeTime(r.expires_at),
          display: `[${r.entity}] ${r.intention} (state: ${r.metacognitive_state}, expires: ${relativeTime(r.expires_at)})`,
        }));
      } catch { return []; }
    })();

    const result = {
      delta_since: deltaSince, p0_items: p0Items, changed_signals: changedSignals,
      recent_observations: recentObs.map(o => ({ content: o.content.length > 200 ? o.content.slice(0, 200) + '…' : o.content, entity: o.entity_name, source: o.source, created_at: o.created_at })),
      dopamine_hits: dopamineHits,
      ...(activeIntentions.length > 0 ? { active_intentions: activeIntentions } : {}),
      open_gaps: openGaps,
      session_note: `${recentObs.length} new observations since last session. ${projectCount} active projects. ${openGaps} open gaps.${dopamineHits.length > 0 ? ` ${dopamineHits.length} dopamine hits.` : ''}`,
    };
    let serialized = JSON.stringify(result);
    while (serialized.length > CHAR_CAP && result.recent_observations.length > 0) { result.recent_observations.pop(); serialized = JSON.stringify(result); }
    return result;
  } catch (e) { return { error: (e as Error).message, p0_items: [], session_note: 'briefing failed' }; }
}

async function handleRecall(input: { query: string; scope?: string; limit?: number }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { query: input.query, results: [], error: 'brain.db unavailable' };
  const _limit = input.limit ?? 8;
  const seedLimit = _limit * 3;
  const _scope = input.scope ?? 'all';
  let scopeType: 'all' | 'project' | 'era' | 'person' = 'all'; let scopeValue = '';
  if (_scope.startsWith('project:')) { scopeType = 'project'; scopeValue = _scope.slice(8); }
  else if (_scope.startsWith('era:')) { scopeType = 'era'; scopeValue = _scope.slice(4); }
  else if (_scope.startsWith('person:')) { scopeType = 'person'; scopeValue = _scope.slice(7); }

  // --- RRF Hybrid Retrieval (v3.0) ---
  // Reciprocal Rank Fusion: score(d) = Σ 1/(k + rank_i(d)), k=60
  // Rank-based fusion is robust to score distribution differences between vector and BM25.
  const RRF_K = 60;

  type VRow = { id: string; content: string; entity_id: string | null; source: string; created_at: string; similarity: number };
  let vectorRows: VRow[] = [];
  let bm25Rows: { id: string; bm25_raw: number }[] = [];
  const vectorMeta = new Map<string, VRow>();

  if (_vecLoaded) {
    try {
      const emb = await generateEmbedding('search_query: ' + input.query);
      const queryJson = JSON.stringify(Array.from(emb));
      let sql = `SELECT o.id, o.content, o.entity_id, o.source, o.created_at, (1.0-(vec_distance_cosine(o.embedding,vec_f32(?))/2.0)) AS similarity FROM observations o WHERE o.tenant_id=? AND o.embedding IS NOT NULL AND o.status='active'`;
      const params: unknown[] = [queryJson, TENANT_ID];
      if (scopeType === 'project') { sql += ` AND o.entity_id=(SELECT id FROM entities WHERE tenant_id=? AND (slug=? OR name LIKE ?) LIMIT 1)`; params.push(TENANT_ID, scopeValue, `%${scopeValue}%`); }
      sql += ` ORDER BY similarity DESC LIMIT ?`; params.push(seedLimit);
      vectorRows = db.prepare(sql).all(...params) as VRow[];
      vectorRows.forEach(r => vectorMeta.set(r.id, r));
    } catch { /* fall through to BM25 */ }
  }

  try {
    const ftsQuery = buildFtsQuery(input.query);
    bm25Rows = db.prepare(`SELECT o.id, (-fts.rank) AS bm25_raw FROM observations o JOIN observations_fts fts ON o.rowid=fts.rowid WHERE o.tenant_id=? AND o.status='active' AND observations_fts MATCH ? ORDER BY fts.rank LIMIT ?`).all(TENANT_ID, ftsQuery, seedLimit) as { id: string; bm25_raw: number }[];
  } catch { /* ignore FTS error */ }

  // Build rank maps (1-indexed: rank 1 = best)
  const vectorRank = new Map<string, number>();
  vectorRows.forEach((r, i) => vectorRank.set(r.id, i + 1));
  const bm25Rank = new Map<string, number>();
  bm25Rows.forEach((r, i) => bm25Rank.set(r.id, i + 1));

  // RRF fusion
  const allIds = new Set([...vectorRank.keys(), ...bm25Rank.keys()]);

  // --- Quality-weighted RRF (PROMETHEUS-W1) ---
  // Batch-fetch quality_score for all candidates. NULL → 0.5 (neutral).
  // Quality applies a 0.7–1.0 multiplier on the RRF score: high quality boosts
  // ranking by up to 30%, low quality preserves natural RRF rank. Quality
  // never excludes — only re-ranks. National Razor enforced.
  const qualityMap = new Map<string, number | null>();
  if (allIds.size > 0) {
    try {
      const qIds = [...allIds];
      const placeholders = qIds.map(() => '?').join(',');
      const qrows = db.prepare(`SELECT id, quality_score FROM observations WHERE id IN (${placeholders})`).all(...qIds) as { id: string; quality_score: number | null }[];
      for (const r of qrows) qualityMap.set(r.id, r.quality_score);
    } catch { /* quality lookup best-effort */ }
  }

  const results: { id: string; content: string; entity_id: string | null; entity_name: string | null; source: string; created_at: string; score: number; quality_score: number | null; rank: number }[] = [];
  for (const id of allIds) {
    const rrfScore = (vectorRank.has(id) ? 1 / (RRF_K + vectorRank.get(id)!) : 0)
                   + (bm25Rank.has(id) ? 1 / (RRF_K + bm25Rank.get(id)!) : 0);
    const q = qualityMap.get(id);
    const qWeight = 0.7 + 0.3 * (q ?? 0.5);
    const weighted = rrfScore * qWeight;
    let meta = vectorMeta.get(id);
    if (!meta) { const row = db.prepare("SELECT id,content,entity_id,source,created_at FROM observations WHERE id=? AND status='active'").get(id) as VRow | null; if (!row) continue; meta = { ...row, similarity: 0 }; }
    const ent = meta.entity_id ? (db.prepare('SELECT name FROM entities WHERE id=?').get(meta.entity_id) as { name: string } | null) : null;
    results.push({ id, content: meta.content, entity_id: meta.entity_id, entity_name: ent?.name ?? null, source: meta.source, created_at: meta.created_at, score: parseFloat(weighted.toFixed(6)), quality_score: q ?? null, rank: 0 });
  }
  results.sort((a, b) => b.score - a.score);

  // --- Semantic Re-Rank (3rd signal: MiniLM all-MiniLM-L6-v2, 384-dim ONNX) ---
  // Different model = different semantic space than nomic-embed-text (768-dim).
  // Re-ranks top candidates, then 3-signal RRF fusion for final ordering.
  // Graceful: if MiniLM unavailable, falls back to 2-signal RRF (no regression).
  let semanticRerank = false;
  const miniLm = await getMiniLm();
  if (miniLm && results.length > 1) {
    try {
      const reRankCap = Math.min(results.length, _limit * 3);
      const reRankPool = results.slice(0, reRankCap);
      const queryEmb = await miniLm.embed(input.query);
      const candidateEmbs = await Promise.all(
        reRankPool.map(r => miniLm.embed(r.content.slice(0, 500)))
      );
      const semanticScored = reRankPool.map((r, i) => ({
        id: r.id,
        sim: miniLm.cosineSimilarity(queryEmb, candidateEmbs[i]!)
      }));
      semanticScored.sort((a, b) => b.sim - a.sim);
      const semanticRank = new Map<string, number>();
      semanticScored.forEach((s, i) => semanticRank.set(s.id, i + 1));

      // Recompute RRF with 3 signals for re-ranked pool, preserving quality weight
      for (const r of reRankPool) {
        const vr = vectorRank.has(r.id) ? 1 / (RRF_K + vectorRank.get(r.id)!) : 0;
        const br = bm25Rank.has(r.id) ? 1 / (RRF_K + bm25Rank.get(r.id)!) : 0;
        const sr = semanticRank.has(r.id) ? 1 / (RRF_K + semanticRank.get(r.id)!) : 0;
        const qw = 0.7 + 0.3 * (qualityMap.get(r.id) ?? 0.5);
        r.score = parseFloat(((vr + br + sr) * qw).toFixed(6));
      }
      reRankPool.sort((a, b) => b.score - a.score);
      // Splice re-ranked candidates back in
      const reRankedIds = new Set(reRankPool.map(r => r.id));
      const remaining = results.filter(r => !reRankedIds.has(r.id));
      results.length = 0;
      results.push(...reRankPool, ...remaining);
      semanticRerank = true;
    } catch { /* MiniLM failed — 2-signal results used as-is */ }
  }

  const final = results.slice(0, _limit);
  final.forEach((r, i) => { r.rank = i + 1; });

  // --- Retrieval Tracking (ACT-R feed) ---
  // Update last_accessed_at and access_count for returned observations
  try {
    const trackStmt = db.prepare("UPDATE observations SET last_accessed_at=datetime('now'), access_count=COALESCE(access_count,0)+1 WHERE id=?");
    for (const r of final) { trackStmt.run(r.id); }
  } catch { /* tracking is best-effort, don't fail recall */ }

  // PROMETHEUS-W2: warm session activation for returned entities.
  for (const r of final) boostActivation(r.entity_id, SESSION_BOOST_RECALL);

  return { query: input.query, scope: _scope, results: final, total_candidates: allIds.size, vector_search: _vecLoaded, semantic_rerank: semanticRerank };
}

async function handleRecallGraph(input: { query: string; scope?: string; limit?: number }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { query: input.query, results: [], graph_neighbors: [], error: 'brain.db unavailable' };
  const seedResult = await handleRecall(input) as { results: { id: string; content: string; entity_id: string | null; entity_name: string | null; score: number; quality_score: number | null; rank: number; source: string; created_at: string }[]; total_candidates: number; scope: string; vector_search: boolean; semantic_rerank: boolean; };
  const seedEntityIds = [...new Set(seedResult.results.map(r => r.entity_id).filter((id): id is string => !!id))].slice(0, 6);
  let graphNeighbors: object[] = [], graphObs: object[] = [], graphSummary = '';
  try {
    const neighbors = getNeighborEntities(db, seedEntityIds, 5);
    graphNeighbors = neighbors.map(n => ({ entity_name: n.entity_name, entity_type: n.entity_type, relationship: n.edge_relationship, weight: n.edge_weight }));
    const edgeWeightMap = new Map(neighbors.map(n => [n.entity_id, n.edge_weight]));
    const neighborObs = getObservationsForEntities(db, neighbors.slice(0, 5).map(n => n.entity_id), 3, edgeWeightMap);
    graphObs = neighborObs.map(o => ({ content: o.content.length > 200 ? o.content.slice(0, 200) + '…' : o.content, entity_name: o.entity_name, via_entity: o.via_entity, graph_boost: o.graph_boost }));
    graphSummary = buildGraphSummary(seedResult.results.slice(0, 3).map(s => s.entity_name ?? '').filter(Boolean), neighbors, neighborObs);
  } catch { /* degrade */ }
  return { ...seedResult, graph_neighbors: graphNeighbors, graph_observations: graphObs, graph_summary: graphSummary };
}

async function handleRemember(input: { content: string; entity?: string; source?: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  try {
    const now = new Date().toISOString(); const _source = input.source ?? 'session';

    // --- SHA-256 Dedup (v3.0) ---
    // Compute content hash and check for recent duplicates (5 min window)
    const contentHash = crypto.createHash('sha256').update(input.content).digest('hex');
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const existing = db.prepare(
      "SELECT id FROM observations WHERE content_hash=? AND tenant_id=? AND created_at>? AND status='active' LIMIT 1"
    ).get(contentHash, TENANT_ID, fiveMinAgo) as { id: string } | null;
    if (existing) {
      return { observation_id: existing.id, deduplicated: true, source: _source, created_at: now };
    }

    const id = ulid();
    let entityId: string | null = null, entityResolved: string | null = null;
    if (input.entity) {
      const ent = db.prepare('SELECT id,name FROM entities WHERE tenant_id=? AND (slug=? OR name LIKE ?) LIMIT 1').get(TENANT_ID, input.entity, `%${input.entity}%`) as { id: string; name: string } | null;
      if (ent) { entityId = ent.id; entityResolved = ent.name; }
    }
    db.prepare(`INSERT INTO observations (id,tenant_id,entity_id,content,source,tags,content_hash,created_at,created_by,status,embedding_version,synthesis_depth) VALUES (@id,@tenant_id,@entity_id,@content,@source,'[]',@content_hash,@now,'brain_remember','active',1,0)`)
      .run({ id, tenant_id: TENANT_ID, entity_id: entityId, content: input.content, source: _source, content_hash: contentHash, now });
    let qualityResult: QualityResult | null = null;
    try {
      const emb = await generateEmbedding('search_document: ' + input.content);
      db.prepare('UPDATE observations SET embedding=? WHERE id=?').run(Buffer.from(emb.buffer), id);
      // --- PROMETHEUS-W1: compute quality at write time ---
      try {
        const grounding = (db.prepare('SELECT grounding_tier FROM observations WHERE id=?').get(id) as { grounding_tier: string | null } | null)?.grounding_tier ?? 'unknown';
        qualityResult = computeQualityScore(db, {
          content: input.content,
          source: _source,
          grounding_tier: grounding,
          embedding: emb,
          entity_id: entityId,
          exclude_id: id,
        });
        db.prepare('UPDATE observations SET quality_score=?, surprisal=?, compression_ratio=? WHERE id=?')
          .run(qualityResult.quality_score, qualityResult.surprisal, qualityResult.compression_ratio, id);
      } catch { /* quality scoring best-effort; NULL → Pass 15 backfill */ }
    } catch { /* saved without embedding — quality_score stays NULL for Pass 15 */ }
    return {
      observation_id: id,
      entity_resolved: entityResolved,
      source: _source,
      created_at: now,
      quality_score: qualityResult?.quality_score ?? null,
    };
  } catch (e) { return { error: (e as Error).message }; }
}

function handleStatus(input: { project: string }): object {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  try {
    const normalized = input.project.replace(/-/g, ' ');
    const firstWord = input.project.split('-')[0] ?? input.project;
    const entity = db.prepare(`SELECT * FROM entities WHERE tenant_id=? AND (slug=? OR slug=? OR name LIKE ? OR name LIKE ? OR id=?) ORDER BY CASE WHEN slug=? THEN 0 WHEN slug=? THEN 1 WHEN name LIKE ? THEN 2 ELSE 3 END LIMIT 1`).get(TENANT_ID, input.project, firstWord, `%${input.project}%`, `%${normalized}%`, input.project, input.project, firstWord, `%${input.project}%`) as { id: string; name: string; type: string; slug: string | null; status: string; metadata: string; updated_at: string } | undefined;
    if (!entity) return { error: `No entity found matching '${input.project}'` };
    let metadata: Record<string, unknown> = {}; try { metadata = JSON.parse(entity.metadata); } catch { /**/ }
    const recentObs = db.prepare(`SELECT id,content,source,created_at FROM observations WHERE tenant_id=? AND entity_id=? ORDER BY created_at DESC LIMIT 5`).all(TENANT_ID, entity.id) as { id: string; content: string; source: string; created_at: string }[];
    const latestSignal = db.prepare(`SELECT source,value,previous_value,changed_at,polled_at FROM signals WHERE tenant_id=? AND entity_id=? ORDER BY polled_at DESC LIMIT 1`).get(TENANT_ID, entity.id) as { source: string; value: string; previous_value: string; changed_at: string | null; polled_at: string } | undefined;
    // PROMETHEUS-W2: status lookup is a stronger warmth signal than recall.
    boostActivation(entity.id, SESSION_BOOST_STATUS);
    return {
      entity: { id: entity.id, name: entity.name, type: entity.type, status: entity.status, metadata, updated_at: entity.updated_at },
      recent_observations: recentObs.map(o => ({ content: o.content.slice(0, 300), source: o.source, created_at: o.created_at })),
      latest_signal: latestSignal ? { source: latestSignal.source, value: (() => { try { return JSON.parse(latestSignal.value); } catch { return latestSignal.value; } })(), changed_at: latestSignal.changed_at, polled_at: latestSignal.polled_at } : null,
    };
  } catch (e) { return { error: (e as Error).message }; }
}

async function handleFeedback(input: { observation_id: string; rating: 'helpful' | 'unhelpful' | 'critical'; context?: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback_log (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, rating TEXT NOT NULL CHECK(rating IN ('helpful','unhelpful','critical')), weight_delta REAL NOT NULL, context TEXT, created_at DATETIME NOT NULL DEFAULT (datetime('now')))`).run();
    const weightDelta = input.rating === 'helpful' ? 0.15 : input.rating === 'unhelpful' ? -0.10 : 0.35;
    const id = ulid();
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('INSERT INTO feedback_log(id,observation_id,rating,weight_delta,context,created_at) VALUES(?,?,?,?,?,?)').run(id, input.observation_id, input.rating, weightDelta, input.context ?? null, nowStr);
    const obs = db.prepare('SELECT entity_id FROM observations WHERE id=?').get(input.observation_id) as { entity_id: string | null } | null;
    let edgesUpdated = 0;
    if (obs?.entity_id) {
      edgesUpdated = db.prepare('UPDATE brain_edges SET weight=MAX(0.0,MIN(1.0,weight+?)),updated_at=? WHERE source_entity_id=? OR target_entity_id=?').run(weightDelta, nowStr, obs.entity_id, obs.entity_id).changes;
    }
    return { feedback_id: id, observation_id: input.observation_id, rating: input.rating, weight_delta: weightDelta, edges_updated: edgesUpdated };
  } catch (e) { return { error: (e as Error).message }; }
}

async function handleWhetstone(input: { position: string; context?: string; calibration?: boolean; mode?: string; source_file?: string; test_file?: string; mutation_count?: number }): Promise<object> {
  if (!_apiKey) return { error: 'No Anthropic API key — WHETSTONE requires API access' };

  // === CODE MODE: Intelligent Mutation Testing ===
  if (input.mode === 'code') {
    if (!input.source_file) return { error: 'Code mode requires source_file parameter' };
    let sourceCode = '';
    let testCode = '';
    try { sourceCode = fs.readFileSync(input.source_file, 'utf8'); } catch { return { error: `Cannot read source file: ${input.source_file}` }; }
    if (input.test_file) {
      try { testCode = fs.readFileSync(input.test_file, 'utf8'); } catch { testCode = '(no test file found)'; }
    } else {
      testCode = '(no test file provided — analyze source for untested surface area)';
    }

    const mutationCount = input.mutation_count || 5;
    // Truncate to fit context window
    const srcTrunc = sourceCode.length > 8000 ? sourceCode.slice(0, 8000) + '\n... (truncated)' : sourceCode;
    const testTrunc = testCode.length > 4000 ? testCode.slice(0, 4000) + '\n... (truncated)' : testCode;

    const result = await callClaudeAPI(
      `SOURCE FILE (${input.source_file}):\n\`\`\`\n${srcTrunc}\n\`\`\`\n\nTEST FILE (${input.test_file || 'none'}):\n\`\`\`\n${testTrunc}\n\`\`\`\n\nGenerate ${mutationCount} targeted mutations. Focus on:\n- Edge cases the tests don't cover\n- Off-by-one errors the assertions wouldn't catch\n- Type coercion issues\n- Async timing assumptions\n- State mutation side effects\n- Null/undefined handling gaps\n- Error path coverage\n\nFor each mutation, provide: the location, what to change, why it's dangerous, whether existing tests would catch it, and a proposed test to close the gap.\n\nRespond with JSON: {"mutations": [{"id": "mut-001", "location": "filename:line", "original": "original code snippet", "mutated": "mutated version", "risk": "why this is dangerous", "caught_by_existing_tests": true/false, "proposed_test": {"description": "what test would catch this", "tier": "contract|unit|regression"}}], "coverage_assessment": "summary of how many caught vs missed", "risk_level": "GREEN|YELLOW|ORANGE|RED", "blind_spots": ["list of areas with no test coverage"]}`,
      `You are WHETSTONE in code mode — an adversarial test reviewer. Your job is to find the SUBTLEST possible mutations that would break real behavior but might slip past existing tests. Think like a bug that's trying to hide. Don't generate trivial mutations that any test would catch. Generate mutations that exploit actual blind spots in the test coverage. Be specific about line numbers and code. Respond with JSON only, no markdown fences.`,
      2048
    );

    if (!result) return { error: 'WHETSTONE code mode API call failed' };
    try {
      const cleaned = result.replace(/```json|```/g, '').trim();
      const analysis = JSON.parse(cleaned);

      // Persist to brain.db
      const db = getBrainDb();
      if (db) {
        const obsId = ulid();
        const caught = (analysis.mutations || []).filter((m: any) => m.caught_by_existing_tests).length;
        const total = (analysis.mutations || []).length;
        const content = `WHETSTONE code analysis: ${input.source_file} — ${caught}/${total} mutations caught. Risk: ${analysis.risk_level || '?'}. Blind spots: ${(analysis.blind_spots || []).join(', ') || 'none identified'}`;
        db.prepare("INSERT INTO observations(id,tenant_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,'session','[\"whetstone\",\"code_mutation\"]',datetime('now'),'whetstone','active',1,1)")
          .run(obsId, TENANT_ID, content);
      }

      // Store in mutation_results table if available
      try {
        const kernlDb = _require('better-sqlite3') as new (p: string, o?: object) => BrainDB;
        const kdb = new kernlDb('D:\\Projects\\Project Mind\\kernl-mcp\\data\\project-mind.db', { readonly: false });
        const mutId = ulid();
        const caught = (analysis.mutations || []).filter((m: any) => m.caught_by_existing_tests).length;
        const missed = (analysis.mutations || []).filter((m: any) => !m.caught_by_existing_tests).length;
        const total = caught + missed;
        const score = total > 0 ? Math.round((caught / total) * 100) : 0;
        kdb.prepare(`INSERT INTO mutation_results (id, project_id, source_file, test_file, mutations_generated, mutations_caught, mutations_missed, coverage_score, risk_level, details, created_at)
          VALUES (?, 'kernl', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(mutId, input.source_file, input.test_file || '', total, caught, missed, score, analysis.risk_level || 'UNKNOWN', JSON.stringify(analysis));
        kdb.close();
      } catch { /* mutation_results table may not exist yet */ }

      return { mode: 'code', source_file: input.source_file, test_file: input.test_file || null, ...analysis };
    } catch { return { error: 'WHETSTONE code mode parse error', raw: result.slice(0, 300) }; }
  }

  // === EPISTEMIC MODE (default): Challenge positions ===
  const db = getBrainDb();

  // Optional: load calibration cases for pattern matching
  let calibrationContext = '';
  if (input.calibration) {
    try {
      const raw = fs.readFileSync(CALIBRATION_PATH, 'utf8');
      const dataset = JSON.parse(raw);
      const cases = (dataset.cases as { name: string; pattern: string; signal_markers: string[] }[])
        .map(c => `${c.name}: ${c.pattern} [${c.signal_markers.join(', ')}]`).join('\n');
      calibrationContext = `\n\nCalibration reference cases:\n${cases}`;
    } catch { /* no calibration available */ }
  }

  // Load relevant brain.db observations for context
  let brainContext = '';
  if (db) {
    try {
      const emb = await generateEmbedding('search_query: ' + input.position);
      const queryJson = JSON.stringify(Array.from(emb));
      const related = db.prepare(
        `SELECT content FROM observations WHERE tenant_id=? AND status='active' AND embedding IS NOT NULL ORDER BY vec_distance_cosine(embedding, vec_f32(?)) LIMIT 3`
      ).all(TENANT_ID, queryJson) as { content: string }[];
      if (related.length > 0) {
        brainContext = '\n\nRelated observations from memory:\n' + related.map(r => '- ' + r.content.slice(0, 200)).join('\n');
      }
    } catch { /* no vector search available */ }
  }

  const result = await callClaudeAPI(
    `Position to challenge:\n"${input.position}"\n${input.context ? '\nContext: ' + input.context : ''}${calibrationContext}${brainContext}\n\nConstruct the STRONGEST possible counterargument. Think from a structurally different perspective — not just contrarily, but with different assumptions, framework, and priors. If this position has calibration pattern matches, note them.\n\nRespond with JSON: {"counterargument": "the strongest opposition", "framework": "what analytical framework the challenge uses", "calibration_match": "name of matching calibration case or null", "confidence": 0-100, "impasse": false, "impasse_reason": null}`,
    'You are WHETSTONE — an adversarial cognitive engine. Your job is to sharpen positions through friction, not to agree or be polite. Construct heterogeneous challenges: think DIFFERENTLY, not just contrarily. If the position and counterargument reach genuine irreconcilable conflict, declare impasse. Test ALL conclusions — alternative and orthodox alike. Respond with JSON only, no markdown fences.',
    768
  );

  if (!result) return { error: 'WHETSTONE API call failed' };
  try {
    const cleaned = result.replace(/```json|```/g, '').trim();
    const challenge = JSON.parse(cleaned);
    // Persist the challenge to brain.db
    if (db) {
      const obsId = ulid();
      const content = `WHETSTONE challenge: "${input.position.slice(0, 100)}" → Counter: ${challenge.counterargument?.slice(0, 200) || '?'} [framework: ${challenge.framework || '?'}, confidence: ${challenge.confidence || '?'}]`;
      db.prepare("INSERT INTO observations(id,tenant_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,'session','[\"whetstone\"]',datetime('now'),'whetstone','active',1,1)")
        .run(obsId, TENANT_ID, content);
    }
    return challenge;
  } catch { return { error: 'WHETSTONE parse error', raw: result.slice(0, 200) }; }
}

async function handleImprint(input: { session_summary: string; outcomes?: string; corrections?: string }): Promise<object> {
  if (!_apiKey) return { error: 'No Anthropic API key — IMPRINT requires API access' };
  const db = getBrainDb();

  // Gather recent session observations for context
  let recentObs = '';
  if (db) {
    const recent = db.prepare(
      "SELECT content, created_at FROM observations WHERE tenant_id=? AND status='active' AND source='session' ORDER BY created_at DESC LIMIT 10"
    ).all(TENANT_ID) as { content: string; created_at: string }[];
    recentObs = recent.map(o => `[${o.created_at.slice(0, 10)}] ${o.content.slice(0, 150)}`).join('\n');
  }

  // --- Intention lifecycle (PROMETHEUS-W3): load active intentions to reconcile ---
  let activeIntentions: { id: number; entity: string; intention: string; metacognitive_state: string }[] = [];
  if (db) {
    try {
      ensureIntentionsTable(db);
      activeIntentions = db.prepare(
        "SELECT id, entity, intention, metacognitive_state FROM intentions WHERE resolved_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 20"
      ).all() as { id: number; entity: string; intention: string; metacognitive_state: string }[];
    } catch { /* intention lifecycle load is best-effort */ }
  }
  const intentionsBlock = activeIntentions.length > 0
    ? `\n\nActive intentions currently tracked (reconcile against this session):\n${activeIntentions.map(i => `  [id ${i.id}] (${i.entity}) ${i.intention} -- state: ${i.metacognitive_state}`).join('\n')}\n\nFor each, decide whether this session RESOLVED it (work finished or abandoned), ADVANCED it (progress made -- refresh its expiry), or left it UNCHANGED.`
    : '';
  const lifecycleField = activeIntentions.length > 0
    ? ', "intention_lifecycle": [{"id": <intention id>, "action": "resolve"|"advance"|"unchanged", "reason": "brief reason"}]'
    : '';

  const result = await callClaudeAPI(
    `Session summary: ${input.session_summary}\n${input.outcomes ? 'Outcomes: ' + input.outcomes : ''}\n${input.corrections ? 'Corrections David made: ' + input.corrections : ''}\n\nRecent observations:\n${recentObs}${intentionsBlock}\n\nGenerate a post-session reflection with typed deltas:\n- ΔS: proposed changes to system prompt / bootstrap instructions\n- ΔU: updated understanding of David's preferences, patterns, working style\n- ΔT: proposed changes to tool configuration or workflow\n- ΔI: forward intentions — active hypotheses (with confidence), planned next moves, cognitive state during session\n  - hypothesis: what David/Claude thinks might be true, with confidence 0-1\n  - next_move: planned actions for next session\n  - state: cognitive mode during session (deep_flow, scattered, frustrated, eureka, systematic, exploratory)\n\nAlso identify: what worked well (reinforce), what failed (avoid), what patterns are emerging.\n\nRespond with JSON: {"deltas": {"system": ["delta1", ...], "user_model": ["delta1", ...], "tool_config": ["delta1", ...], "intentions": [{"subtype": "hypothesis"|"next_move"|"state", "content": "...", "confidence": 0.0-1.0, "related_entities": ["entity1"], "cognitive_state": "deep_flow"|"scattered"|"frustrated"|"eureka"|"systematic"|"exploratory"}]}, "reinforce": ["pattern to keep"], "avoid": ["pattern to stop"], "emerging_patterns": ["pattern noticed"], "wound_healing": {"phase": "hemostasis|inflammation|proliferation|remodeling|none", "description": "if any belief was damaged, where in the healing cascade"}${lifecycleField}}`,
    'You are IMPRINT — a reflection and learning engine. Analyze sessions for structural learning opportunities. Be concrete and actionable. Deltas should be specific enough to implement. For ΔI intentions: hypotheses persist permanently (National Razor — never discard unproven ideas), next_moves get 72h expiry, state observations are metacognitive data. Follow the wound healing cascade for damaged beliefs. Respond with JSON only, no markdown fences.',
    1024
  );

  if (!result) return { error: 'IMPRINT API call failed' };
  try {
    const cleaned = result.replace(/```json|```/g, '').trim();
    const reflection = JSON.parse(cleaned);
    // Persist reflection summary to brain.db
    if (db) {
      const obsId = ulid();
      const deltaCount = (reflection.deltas?.system?.length || 0) + (reflection.deltas?.user_model?.length || 0) + (reflection.deltas?.tool_config?.length || 0);
      const intentionCount = reflection.deltas?.intentions?.length || 0;
      const content = `IMPRINT reflection: ${deltaCount} deltas + ${intentionCount} ΔI intentions proposed. Reinforce: ${(reflection.reinforce || []).join(', ')}. Avoid: ${(reflection.avoid || []).join(', ')}. Wound healing: ${reflection.wound_healing?.phase || 'none'}`;
      db.prepare("INSERT INTO observations(id,tenant_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,'session','[\"imprint_reflection\"]',datetime('now'),'imprint','active',1,1)")
        .run(obsId, TENANT_ID, content);

      // Persist ΔI intentions as individual observations
      const intentions = reflection.deltas?.intentions || [];
      for (const intent of intentions) {
        try {
        const iId = ulid();
        const intentSource = intent.subtype === 'hypothesis' ? 'imprint_hypothesis'
                           : intent.subtype === 'next_move' ? 'imprint_next_move'
                           : 'imprint_state';
        const intentContent = `ΔI.${intent.subtype}: ${intent.content}${intent.confidence ? ` [confidence: ${intent.confidence}]` : ''}${intent.cognitive_state ? ` [state: ${intent.cognitive_state}]` : ''}`;
        // Resolve entity if provided
        let intentEntityId: string | null = null;
        if (intent.related_entities?.[0]) {
          const ent = db.prepare('SELECT id FROM entities WHERE tenant_id=? AND (slug=? OR name LIKE ?) LIMIT 1')
            .get(TENANT_ID, intent.related_entities[0], `%${intent.related_entities[0]}%`) as { id: string } | null;
          if (ent) intentEntityId = ent.id;
        }
        db.prepare("INSERT INTO observations(id,tenant_id,entity_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,?,?,'[\"imprint\",\"intention\"]',datetime('now'),'imprint','active',1,1)")
          .run(iId, TENANT_ID, intentEntityId, intentContent, intentSource);
        try {
          const emb = await generateEmbedding('search_document: ' + intentContent);
          db.prepare('UPDATE observations SET embedding=? WHERE id=?').run(Buffer.from(emb.buffer), iId);
        } catch { /* saved without embedding */ }
        } catch { /* per-intention persistence is best-effort: observations.source CHECK rejects imprint_* sources */ }
      }
    }
    // --- Intention lifecycle apply (PROMETHEUS-W3): best-effort, never blocks ---
    if (db && activeIntentions.length > 0 && Array.isArray(reflection.intention_lifecycle)) {
      try {
        const activeIds = new Set(activeIntentions.map(i => i.id));
        const resolveStmt = db.prepare("UPDATE intentions SET resolved_at=datetime('now') WHERE id=? AND resolved_at IS NULL");
        const advanceStmt = db.prepare("UPDATE intentions SET refreshed_at=datetime('now'), expires_at=datetime('now','+72 hours') WHERE id=? AND resolved_at IS NULL");
        for (const lc of reflection.intention_lifecycle) {
          if (!lc || typeof lc.id !== 'number' || !activeIds.has(lc.id)) continue;
          if (lc.action === 'resolve') resolveStmt.run(lc.id);
          else if (lc.action === 'advance') advanceStmt.run(lc.id);
        }
      } catch { /* lifecycle apply is best-effort */ }
    }
    return reflection;
  } catch { return { error: 'IMPRINT parse error', raw: result.slice(0, 200) }; }
}

async function handleInvalidate(input: { observation_id: string; reason: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  try {
    const obs = db.prepare("SELECT id, content, status FROM observations WHERE id=? AND tenant_id=?")
      .get(input.observation_id, TENANT_ID) as { id: string; content: string; status: string } | null;
    if (!obs) return { error: `Observation ${input.observation_id} not found` };
    if (obs.status === 'invalid') return { error: 'Observation already invalidated', observation_id: input.observation_id };

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare("UPDATE observations SET status='invalid', tags=json_insert(COALESCE(tags,'[]'), '$[#]', ?) WHERE id=?")
      .run(`invalidated:${input.reason.slice(0, 100)}`, input.observation_id);

    // Log the invalidation as a new observation for audit trail
    const logId = ulid();
    const logContent = `INVALIDATED observation ${input.observation_id.slice(0, 10)}...: "${obs.content.slice(0, 100)}..." — Reason: ${input.reason}`;
    db.prepare("INSERT INTO observations(id,tenant_id,content,source,tags,created_at,created_by,status,embedding_version,synthesis_depth) VALUES(?,?,?,'session','[\"invalidation\"]',?,?,'active',1,0)")
      .run(logId, TENANT_ID, logContent, now, 'brain_invalidate');

    return { invalidated: true, observation_id: input.observation_id, reason: input.reason, audit_observation_id: logId };
  } catch (e) { return { error: (e as Error).message }; }
}

/** PROMETHEUS-W3: imprint_set_intention -- create or update an entity's
 *  active intention. One active intention per entity; re-setting updates in
 *  place and refreshes the 72h expiry window. */
function handleSetIntention(input: { entity: string; intention: string; metacognitive_state?: string; context?: string }): object {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  if (!input.entity || !input.intention) return { error: 'entity and intention are both required' };
  try {
    ensureIntentionsTable(db);
    const state = input.metacognitive_state ?? 'exploring';
    const sessionId = getCurrentSessionId(db);
    const existing = db.prepare(
      "SELECT id FROM intentions WHERE entity=? AND resolved_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
    ).get(input.entity) as { id: number } | undefined;
    if (existing) {
      db.prepare(
        "UPDATE intentions SET intention=?, metacognitive_state=?, context=?, refreshed_at=datetime('now'), expires_at=datetime('now','+72 hours') WHERE id=?"
      ).run(input.intention, state, input.context ?? null, existing.id);
      return { intention_id: existing.id, entity: input.entity, action: 'updated', metacognitive_state: state, expires_in_hours: 72 };
    }
    const info = db.prepare(
      "INSERT INTO intentions (entity, intention, metacognitive_state, session_id, context) VALUES (?,?,?,?,?)"
    ).run(input.entity, input.intention, state, sessionId, input.context ?? null);
    return { intention_id: Number(info.lastInsertRowid), entity: input.entity, action: 'created', metacognitive_state: state, session_id: sessionId, expires_in_hours: 72 };
  } catch (e) { return { error: (e as Error).message }; }
}

/** PROMETHEUS-W3: imprint_resolve_intention -- mark an intention resolved
 *  (work finished or abandoned). By id, or by entity (most recent active
 *  intention for that entity). Resolved intentions stop surfacing. */
function handleResolveIntention(input: { entity?: string; id?: number }): object {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  if (input.id === undefined && !input.entity) return { error: 'either entity or id is required' };
  try {
    ensureIntentionsTable(db);
    if (input.id !== undefined) {
      const r = db.prepare("UPDATE intentions SET resolved_at=datetime('now') WHERE id=? AND resolved_at IS NULL").run(input.id);
      return r.changes > 0
        ? { intention_id: input.id, action: 'resolved' }
        : { intention_id: input.id, action: 'noop', note: 'no matching unresolved intention' };
    }
    const target = db.prepare(
      "SELECT id FROM intentions WHERE entity=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1"
    ).get(input.entity) as { id: number } | undefined;
    if (!target) return { entity: input.entity, action: 'noop', note: 'no active intention for entity' };
    db.prepare("UPDATE intentions SET resolved_at=datetime('now') WHERE id=?").run(target.id);
    return { intention_id: target.id, entity: input.entity, action: 'resolved' };
  } catch (e) { return { error: (e as Error).message }; }
}

/** PROJECT CONTEXT SCAN — Cross-pollinator
 *  Scans portfolio for tools, patterns, and APIs relevant to current project.
 *  Queries brain.db graph, checks D:\Meta\ for API keys, finds cross-project patterns. */
async function handleProjectContextScan(input: { project: string; task?: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };

  try {
    // 1. Find the project entity
    const entity = db.prepare(
      "SELECT id, name, type, metadata FROM entities WHERE tenant_id = ? AND (name LIKE ? OR name LIKE ?) AND status = 'active' LIMIT 1"
    ).get(TENANT_ID, `%${input.project}%`, input.project) as { id: string; name: string; type: string; metadata: string } | undefined;

    // 2. Get graph neighbors (structural isomorphisms, co-mentions, peers)
    let neighbors: { entity_name: string; relationship: string; weight: number }[] = [];
    if (entity) {
      try {
        const rawNeighbors = getNeighborEntities(db, [entity.id], 10);
        neighbors = rawNeighbors.map((n) => ({
          entity_name: n.entity_name,
          relationship: n.edge_relationship,
          weight: n.edge_weight,
        }));
      } catch { /* graph may not be available */ }
    }

    // 3. Get recent observations about this project
    const recentObs = entity ? (db.prepare(
      "SELECT content, source, created_at FROM observations WHERE tenant_id = ? AND entity_id = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 5"
    ).all(TENANT_ID, entity.id) as { content: string; source: string; created_at: string }[]) : [];

    // 4. Scan D:\Meta\ for available API files
    const apiFiles: { service: string; file: string }[] = [];
    try {
      const metaDir = 'D:\\Meta';
      const files = fs.readdirSync(metaDir);
      for (const f of files) {
        if ((f.endsWith(' API.md') || f.endsWith(' API.txt') || f.includes('API_KEY') || f.includes('Keys.txt')) && !f.startsWith('.')) {
          const service = f.replace(' API.md', '').replace(' API.txt', '').replace('.md', '').replace('.txt', '');
          apiFiles.push({ service, file: f });
        }
      }
    } catch { /* D:\Meta may not be accessible */ }

    // 5. Get cross-project patterns if task is provided
    let relevantPatterns: { id: string; problem: string; solution: string; project: string; confidence: number }[] = [];
    if (input.task) {
      try {
        const patterns = db.prepare(
          "SELECT id, problem, solution, project, confidence FROM patterns WHERE tenant_id = ? ORDER BY confidence DESC LIMIT 20"
        ).all(TENANT_ID) as { id: string; problem: string; solution: string; project: string; confidence: number }[];
        // Simple keyword matching for now (embeddings would be better but this is v1)
        const taskWords = input.task.toLowerCase().split(/\s+/);
        relevantPatterns = patterns.filter(p => {
          const pText = `${p.problem} ${p.solution}`.toLowerCase();
          return taskWords.some(w => w.length > 3 && pText.includes(w));
        }).slice(0, 5);
      } catch { /* patterns table may not exist */ }
    }

    // 6. Build the briefing
    return {
      project: input.project,
      entity_found: !!entity,
      entity_name: entity?.name ?? input.project,
      graph_neighbors: neighbors.filter(n => n.weight > 0.5).map(n => ({
        project: n.entity_name,
        relationship: n.relationship,
        strength: Math.round(n.weight * 100) / 100,
      })),
      recent_context: recentObs.map(o => ({
        content: o.content.slice(0, 200),
        source: o.source,
        when: o.created_at,
      })),
      available_apis: apiFiles,
      cross_project_patterns: relevantPatterns.map(p => ({
        from_project: p.project,
        problem: p.problem.slice(0, 150),
        solution: p.solution.slice(0, 150),
        confidence: p.confidence,
      })),
      suggestions: [
        ...(apiFiles.length > 0 ? [`${apiFiles.length} production API keys available in D:\\Meta\\ — check before signing up for new services`] : []),
        ...(neighbors.length > 0 ? [`${neighbors.length} related projects in graph — patterns may transfer`] : []),
        ...(relevantPatterns.length > 0 ? [`${relevantPatterns.length} cross-project patterns match your task`] : []),
      ],
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** PROMETHEUS-W2 brain_recall_spread: spreading-activation recall.
 *  Phase 1: standard brain_recall to get top results.
 *  Phase 2: extract entity seeds → spreadActivation through brain_edges.
 *  Phase 3: second recall pass scoped to activated entities.
 *  Phase 4: merge + re-rank via spread_score:
 *    quality-aware  → rrf × (0.7 + 0.3 × quality) × (0.6 + 0.4 × activation)
 *    quality-absent → rrf × (0.6 + 0.4 × activation)
 *  Quality column presence detected dynamically. */
async function handleRecallSpread(input: {
  query: string;
  depth?: number;
  dampening?: number;
  limit?: number;
}): Promise<object> {
  const db = getBrainDb();
  if (!db) return { query: input.query, results: [], error: 'brain.db unavailable' };
  const _depth = Math.max(1, Math.min(4, input.depth ?? 2));
  const _dampening = Math.max(0.1, Math.min(0.9, input.dampening ?? 0.5));
  const _limit = input.limit ?? 10;
  const t0 = Date.now();

  let hasQuality = false;
  try {
    const cols = db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
    hasQuality = cols.some(c => c.name === 'quality_score');
  } catch { /* assume absent */ }

  const seedResult = await handleRecall({ query: input.query, limit: _limit }) as {
    results: { id: string; content: string; entity_id: string | null; entity_name: string | null;
               score: number; quality_score: number | null; rank: number;
               source: string; created_at: string }[];
    total_candidates: number; scope: string; vector_search: boolean; semantic_rerank: boolean;
  };

  const seedEntityIds = [...new Set(
    seedResult.results.slice(0, 5).map(r => r.entity_id).filter((id): id is string => !!id)
  )];

  const activated = seedEntityIds.length > 0
    ? spreadActivation(db, seedEntityIds, _depth, _dampening)
    : new Map<string, number>(sessionActivation);

  const activatedNonSeed = [...activated.keys()].filter(id => !seedEntityIds.includes(id));
  type SpreadRow = {
    id: string; content: string; entity_id: string;
    entity_name: string | null; source: string;
    created_at: string; quality_score: number | null;
  };
  let spreadObs: (SpreadRow & { activation: number })[] = [];
  if (activatedNonSeed.length > 0) {
    try {
      const ids = activatedNonSeed.slice(0, 500);
      const placeholders = ids.map(() => '?').join(',');
      const qSelect = hasQuality ? 'o.quality_score' : 'NULL AS quality_score';
      const rows = db.prepare(
        `SELECT o.id, o.content, o.entity_id, e.name AS entity_name,
                o.source, o.created_at, ${qSelect}
         FROM observations o LEFT JOIN entities e ON e.id = o.entity_id
         WHERE o.tenant_id = ? AND o.status = 'active'
           AND o.entity_id IN (${placeholders})
         ORDER BY (CASE WHEN o.embedding IS NOT NULL THEN 1 ELSE 0 END) DESC,
                  o.created_at DESC
         LIMIT ?`
      ).all(TENANT_ID, ...ids, _limit * 3) as SpreadRow[];
      spreadObs = rows.map(r => ({ ...r, activation: activated.get(r.entity_id) ?? 0 }));
    } catch { /* spread DB error → return seed-only */ }
  }

  interface MergedRow {
    id: string; content: string; entity_id: string | null;
    entity_name: string | null; source: string; created_at: string;
    rrf_score: number; quality_score: number | null;
    activation: number; rank: number; spread_score: number;
    via: 'seed' | 'spread';
  }
  const merged = new Map<string, MergedRow>();

  for (const r of seedResult.results) {
    const ent = r.entity_id ?? '';
    const act = Math.max(activated.get(ent) ?? 0, sessionActivation.get(ent) ?? 0);
    merged.set(r.id, {
      id: r.id, content: r.content, entity_id: r.entity_id, entity_name: r.entity_name,
      source: r.source, created_at: r.created_at,
      rrf_score: r.score, quality_score: r.quality_score,
      activation: act, rank: 0, spread_score: 0, via: 'seed',
    });
  }

  const SPREAD_BASE_RRF = 1 / 70;
  for (let i = 0; i < spreadObs.length; i++) {
    const so = spreadObs[i]!;
    if (merged.has(so.id)) {
      const existing = merged.get(so.id)!;
      if (so.activation > existing.activation) existing.activation = so.activation;
      continue;
    }
    const positionDecay = SPREAD_BASE_RRF * (1 - i / (spreadObs.length + 5));
    merged.set(so.id, {
      id: so.id, content: so.content, entity_id: so.entity_id, entity_name: so.entity_name,
      source: so.source, created_at: so.created_at,
      rrf_score: positionDecay,
      quality_score: so.quality_score,
      activation: so.activation, rank: 0, spread_score: 0, via: 'spread',
    });
  }

  for (const m of merged.values()) {
    const actMult = 0.6 + 0.4 * m.activation;
    const qMult = hasQuality ? (0.7 + 0.3 * (m.quality_score ?? 0.5)) : 1.0;
    m.spread_score = parseFloat((m.rrf_score * qMult * actMult).toFixed(6));
  }

  const final = [...merged.values()]
    .sort((a, b) => b.spread_score - a.spread_score)
    .slice(0, _limit);
  final.forEach((r, i) => { r.rank = i + 1; });

  try {
    const trackStmt = db.prepare(
      "UPDATE observations SET last_accessed_at=datetime('now'), access_count=COALESCE(access_count,0)+1 WHERE id=?"
    );
    for (const r of final) trackStmt.run(r.id);
  } catch { /* best-effort */ }

  for (const r of final) boostActivation(r.entity_id, SESSION_BOOST_RECALL);

  const elapsedMs = Date.now() - t0;
  return {
    query: input.query,
    depth: _depth,
    dampening: _dampening,
    quality_aware: hasQuality,
    seed_entities: seedEntityIds.length,
    activated_entities: activated.size,
    spread_candidates: spreadObs.length,
    results: final,
    elapsed_ms: elapsedMs,
    activation_snapshot: [...sessionActivation.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, level]) => ({ entity_id: id, activation: parseFloat(level.toFixed(3)) })),
  };
}

/** PROMETHEUS-W4 brain_recall_community: community-scoped recall.
 *  Finds the entity's stable community via entity_communities table,
 *  gathers all co-community entities, returns their observations. */
async function handleRecallCommunity(input: { entity: string; limit?: number }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { entity: input.entity, results: [], error: 'brain.db unavailable' };
  const _limit = input.limit ?? 20;

  // Check if entity_communities table exists
  let tableExists = false;
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_communities'").all();
    tableExists = tables.length > 0;
  } catch { /* */ }
  if (!tableExists) return { entity: input.entity, results: [], error: 'entity_communities table not found — run NIGHTSHIFT Pass 16 first' };

  // Resolve entity name to ID
  const entityRow = db.prepare(
    "SELECT id FROM entities WHERE tenant_id = ? AND (name = ? OR name LIKE ? || '%') AND status = 'active' ORDER BY name = ? DESC LIMIT 1"
  ).get(TENANT_ID, input.entity, input.entity, input.entity) as { id: string } | undefined;
  if (!entityRow) return { entity: input.entity, results: [], error: 'Entity not found: ' + input.entity };

  // Look up stable community
  const communityRow = db.prepare(
    'SELECT community_id, consecutive_assignments, stable FROM entity_communities WHERE entity_id = ?'
  ).get(entityRow.id) as { community_id: number; consecutive_assignments: number; stable: number } | undefined;
  if (!communityRow) return { entity: input.entity, entity_id: entityRow.id, results: [], error: 'Entity has no community assignment' };
  if (!communityRow.stable) return { entity: input.entity, entity_id: entityRow.id, community_id: communityRow.community_id, stable: false, results: [], note: 'Community assignment not yet stable (consecutive=' + communityRow.consecutive_assignments + ', need 3)' };

  // Find all entities in the same community
  const communityMembers = db.prepare(
    'SELECT ec.entity_id, e.name FROM entity_communities ec JOIN entities e ON e.id = ec.entity_id WHERE ec.community_id = ? AND ec.stable = 1'
  ).all(communityRow.community_id) as { entity_id: string; name: string }[];

  // Get community metadata
  const meta = db.prepare('SELECT label, member_count, density FROM community_metadata WHERE community_id = ?').get(communityRow.community_id) as { label: string; member_count: number; density: number } | undefined;

  // Fetch observations for all community members
  const memberIds = communityMembers.map(m => m.entity_id);
  if (memberIds.length === 0) return { entity: input.entity, community_id: communityRow.community_id, results: [], members: [] };
  const placeholders = memberIds.map(() => '?').join(',');

  let hasQuality = false;
  try {
    const cols = db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
    hasQuality = cols.some(c => c.name === 'quality_score');
  } catch { /* */ }

  const qSelect = hasQuality ? ', o.quality_score' : '';
  const observations = db.prepare(
    `SELECT o.id, o.content, o.entity_id, e.name AS entity_name, o.source, o.created_at${qSelect}
     FROM observations o LEFT JOIN entities e ON e.id = o.entity_id
     WHERE o.tenant_id = ? AND o.status = 'active' AND o.entity_id IN (${placeholders})
     ORDER BY o.created_at DESC LIMIT ?`
  ).all(TENANT_ID, ...memberIds, _limit) as { id: string; content: string; entity_id: string; entity_name: string; source: string; created_at: string; quality_score?: number }[];

  // Track retrieval
  try {
    const trackStmt = db.prepare("UPDATE observations SET last_accessed_at=datetime('now'), access_count=COALESCE(access_count,0)+1 WHERE id=?");
    for (const o of observations) trackStmt.run(o.id);
  } catch { /* best-effort */ }

  // Boost activation for community members
  for (const m of communityMembers) boostActivation(m.entity_id, SESSION_BOOST_RECALL * 0.5);

  return {
    entity: input.entity,
    entity_id: entityRow.id,
    community_id: communityRow.community_id,
    stable: true,
    community_metadata: meta ?? null,
    members: communityMembers.map(m => m.name),
    results: observations.map((o, i) => ({
      id: o.id,
      content: o.content.length > 300 ? o.content.slice(0, 300) + '...' : o.content,
      entity_name: o.entity_name,
      source: o.source,
      created_at: o.created_at,
      quality_score: (o as any).quality_score ?? null,
      rank: i + 1,
    })),
  };
}

export function createBrainHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  // PROMETHEUS-W2: wrap each handler in tickActivation() so the session
  // activation map decays once per brain_* tool call.
  const tick = <T>(fn: (i: Record<string, unknown>) => Promise<T> | T) =>
    async (i: Record<string, unknown>): Promise<T> => { tickActivation(); return await fn(i); };
  return {
    brain_briefing:      tick((i) => handleBriefing(i as { since?: string })),
    brain_recall:        tick((i) => handleRecall(i as { query: string; scope?: string; limit?: number })),
    brain_recall_graph:  tick((i) => handleRecallGraph(i as { query: string; scope?: string; limit?: number })),
    brain_recall_spread: tick((i) => handleRecallSpread(i as { query: string; depth?: number; dampening?: number; limit?: number })),
    brain_recall_community: tick((i) => handleRecallCommunity(i as { entity: string; limit?: number })),
    brain_remember:      tick((i) => handleRemember(i as { content: string; entity?: string; source?: string })),
    brain_status:        tick((i) => Promise.resolve(handleStatus(i as { project: string }))),
    brain_feedback:      tick((i) => handleFeedback(i as { observation_id: string; rating: 'helpful'|'unhelpful'|'critical'; context?: string })),
    whetstone_challenge: tick((i) => handleWhetstone(i as { position: string; context?: string; calibration?: boolean; mode?: string; source_file?: string; test_file?: string; mutation_count?: number })),
    imprint_reflect:     tick((i) => handleImprint(i as { session_summary: string; outcomes?: string; corrections?: string })),
    imprint_set_intention: tick((i) => Promise.resolve(handleSetIntention(i as { entity: string; intention: string; metacognitive_state?: string; context?: string }))),
    imprint_resolve_intention: tick((i) => Promise.resolve(handleResolveIntention(i as { entity?: string; id?: number }))),
    project_context_scan: tick((i) => handleProjectContextScan(i as { project: string; task?: string })),
  };
}
