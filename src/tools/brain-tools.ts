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
  run(...args: unknown[]): { changes: number };
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

export const brainTools: Tool[] = [
  {
    name: 'brain_briefing',
    description: 'Live portfolio delta from brain.db — P0 items, changed signals, recent observations, open gaps. Call at session start for live context.',
    inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'ISO datetime to delta from (optional)' } } },
  },
  {
    name: 'brain_recall',
    description: '3-signal RRF recall across brain.db observations. Fuses nomic-embed-text vector cosine + BM25 keyword + MiniLM semantic re-ranking. Finds relevant memories by meaning, not just keywords.',
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

    const result = {
      delta_since: deltaSince, p0_items: p0Items, changed_signals: changedSignals,
      recent_observations: recentObs.map(o => ({ content: o.content.length > 200 ? o.content.slice(0, 200) + '…' : o.content, entity: o.entity_name, source: o.source, created_at: o.created_at })),
      dopamine_hits: dopamineHits,
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
  const results: { id: string; content: string; entity_id: string | null; entity_name: string | null; source: string; created_at: string; score: number; rank: number }[] = [];
  for (const id of allIds) {
    const rrfScore = (vectorRank.has(id) ? 1 / (RRF_K + vectorRank.get(id)!) : 0)
                   + (bm25Rank.has(id) ? 1 / (RRF_K + bm25Rank.get(id)!) : 0);
    let meta = vectorMeta.get(id);
    if (!meta) { const row = db.prepare("SELECT id,content,entity_id,source,created_at FROM observations WHERE id=? AND status='active'").get(id) as VRow | null; if (!row) continue; meta = { ...row, similarity: 0 }; }
    const ent = meta.entity_id ? (db.prepare('SELECT name FROM entities WHERE id=?').get(meta.entity_id) as { name: string } | null) : null;
    results.push({ id, content: meta.content, entity_id: meta.entity_id, entity_name: ent?.name ?? null, source: meta.source, created_at: meta.created_at, score: parseFloat(rrfScore.toFixed(6)), rank: 0 });
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

      // Recompute RRF with 3 signals for re-ranked pool
      for (const r of reRankPool) {
        const vr = vectorRank.has(r.id) ? 1 / (RRF_K + vectorRank.get(r.id)!) : 0;
        const br = bm25Rank.has(r.id) ? 1 / (RRF_K + bm25Rank.get(r.id)!) : 0;
        const sr = semanticRank.has(r.id) ? 1 / (RRF_K + semanticRank.get(r.id)!) : 0;
        r.score = parseFloat((vr + br + sr).toFixed(6));
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

  return { query: input.query, scope: _scope, results: final, total_candidates: allIds.size, vector_search: _vecLoaded, semantic_rerank: semanticRerank };
}

async function handleRecallGraph(input: { query: string; scope?: string; limit?: number }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { query: input.query, results: [], graph_neighbors: [], error: 'brain.db unavailable' };
  const seedResult = await handleRecall(input) as { results: { id: string; content: string; entity_id: string | null; entity_name: string | null; score: number; rank: number; source: string; created_at: string }[]; total_candidates: number; scope: string; vector_search: boolean; semantic_rerank: boolean; };
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
    try {
      const emb = await generateEmbedding('search_document: ' + input.content);
      db.prepare('UPDATE observations SET embedding=? WHERE id=?').run(Buffer.from(emb.buffer), id);
    } catch { /* saved without embedding */ }
    return { observation_id: id, entity_resolved: entityResolved, source: _source, created_at: now };
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

  const result = await callClaudeAPI(
    `Session summary: ${input.session_summary}\n${input.outcomes ? 'Outcomes: ' + input.outcomes : ''}\n${input.corrections ? 'Corrections David made: ' + input.corrections : ''}\n\nRecent observations:\n${recentObs}\n\nGenerate a post-session reflection with typed deltas:\n- ΔS: proposed changes to system prompt / bootstrap instructions\n- ΔU: updated understanding of David's preferences, patterns, working style\n- ΔT: proposed changes to tool configuration or workflow\n- ΔI: forward intentions — active hypotheses (with confidence), planned next moves, cognitive state during session\n  - hypothesis: what David/Claude thinks might be true, with confidence 0-1\n  - next_move: planned actions for next session\n  - state: cognitive mode during session (deep_flow, scattered, frustrated, eureka, systematic, exploratory)\n\nAlso identify: what worked well (reinforce), what failed (avoid), what patterns are emerging.\n\nRespond with JSON: {"deltas": {"system": ["delta1", ...], "user_model": ["delta1", ...], "tool_config": ["delta1", ...], "intentions": [{"subtype": "hypothesis"|"next_move"|"state", "content": "...", "confidence": 0.0-1.0, "related_entities": ["entity1"], "cognitive_state": "deep_flow"|"scattered"|"frustrated"|"eureka"|"systematic"|"exploratory"}]}, "reinforce": ["pattern to keep"], "avoid": ["pattern to stop"], "emerging_patterns": ["pattern noticed"], "wound_healing": {"phase": "hemostasis|inflammation|proliferation|remodeling|none", "description": "if any belief was damaged, where in the healing cascade"}}`,
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
      }
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

export function createBrainHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    brain_briefing:      (i) => handleBriefing(i as { since?: string }),
    brain_recall:        (i) => handleRecall(i as { query: string; scope?: string; limit?: number }),
    brain_recall_graph:  (i) => handleRecallGraph(i as { query: string; scope?: string; limit?: number }),
    brain_remember:      (i) => handleRemember(i as { content: string; entity?: string; source?: string }),
    brain_status:        (i) => Promise.resolve(handleStatus(i as { project: string })),
    brain_feedback:      (i) => handleFeedback(i as { observation_id: string; rating: 'helpful'|'unhelpful'|'critical'; context?: string }),
    whetstone_challenge: (i) => handleWhetstone(i as { position: string; context?: string; calibration?: boolean; mode?: string; source_file?: string; test_file?: string; mutation_count?: number }),
    imprint_reflect:     (i) => handleImprint(i as { session_summary: string; outcomes?: string; corrections?: string }),
  };
}
