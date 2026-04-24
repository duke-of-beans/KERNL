/**
 * brain-tools.ts — KERNL-BRAIN-01
 *
 * Live brain.db tools for KERNL MCP.
 * Exposes: brain_briefing, brain_recall, brain_recall_graph, brain_remember, brain_status
 *
 * Reads D:\Meta\brain.db directly via better-sqlite3.
 * Vector search via Ollama (nomic-embed-text) — degrades to BM25-only if unavailable.
 * Graph expansion via brain_edges — degrades gracefully if table missing.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
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

// ── Minimal DB types (avoids better-sqlite3 export= ESM conflicts) ───────────

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

// ── DB singleton ──────────────────────────────────────────────────────────────

let _db: BrainDB | null = null;
let _vecLoaded = false;

function getBrainDb(): BrainDB | null {
  if (_db) return _db;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Database = _require('better-sqlite3') as new (p: string, o?: object) => BrainDB;
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
      } catch { /* BM25-only — fine */ }
    }
    return _db;
  } catch (e) {
    console.error('[brain-tools] Failed to open brain.db:', (e as Error).message);
    return null;
  }
}


// ── ULID ─────────────────────────────────────────────────────────────────────

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(): string {
  const now = Date.now();
  let str = '';
  let mod = now;
  for (let i = 9; i >= 0; i--) { str = (ENC[mod % 32] ?? '0') + str; mod = Math.floor(mod / 32); }
  for (let i = 0; i < 16; i++) str += ENC[Math.floor(Math.random() * 32)] ?? '0';
  return str;
}

// ── Embedding via Ollama ──────────────────────────────────────────────────────

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

// ── Score normalization ───────────────────────────────────────────────────────

function normalizeScores(scores: Map<string, number>): Map<string, number> {
  if (scores.size === 0) return scores;
  const vals = Array.from(scores.values());
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  const result = new Map<string, number>();
  for (const [id, score] of scores) {
    result.set(id, range === 0 ? 1 : (score - min) / range);
  }
  return result;
}


// ── Tool Definitions ──────────────────────────────────────────────────────────

export const brainTools: Tool[] = [
  {
    name: 'brain_briefing',
    description: 'Live portfolio delta from brain.db — P0 items, changed signals, recent observations, open gaps. Call at session start for live context.',
    inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'ISO datetime to delta from (optional — defaults to last session end)' } } },
  },
  {
    name: 'brain_recall',
    description: 'Hybrid vector + BM25 search across all observations in brain.db. Finds relevant memories by meaning, not just keywords. Use for: "what do I know about X", "previous decisions on Y", "context for Z".',
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
    description: 'Graph-enhanced recall. Seeds via hybrid search then walks brain_edges to surface observations from connected entities. Richer context — use when the topic touches multiple projects or when you want cross-project intelligence.',
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
    description: 'Write a new observation to brain.db. Use to capture decisions, discoveries, friction points, or anything worth persisting across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remember' },
        entity: { type: 'string', description: 'Entity name to associate with (project, person, etc.)' },
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
      properties: {
        project: { type: 'string', description: 'Project or entity name to look up' },
      },
      required: ['project'],
    },
  },
];


// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleBriefing(input: { since?: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable', p0_items: [], session_note: 'brain.db offline' };
  try {
    const lastSession = db.prepare(
      'SELECT ended_at FROM sessions WHERE tenant_id = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1'
    ).get(TENANT_ID) as { ended_at: string } | undefined;
    const deltaSince = input.since ?? lastSession?.ended_at ?? new Date(0).toISOString();

    const p0Items = (db.prepare(`
      SELECT name, type, metadata FROM entities
      WHERE tenant_id = ? AND status = 'active' AND json_extract(metadata,'$.priority') = 'P0'
      ORDER BY updated_at DESC LIMIT 10
    `).all(TENANT_ID) as { name: string; type: string; metadata: string }[]).map(e => {
      let desc = '';
      try { const m = JSON.parse(e.metadata); desc = m.description ?? m.phase ?? m.status ?? ''; } catch { /**/ }
      return { entity: e.name, type: e.type, description: desc };
    });

    const changedSignals = (db.prepare(`
      SELECT s.source, e.name AS entity, s.previous_value, s.value AS current_value, s.changed_at
      FROM signals s LEFT JOIN entities e ON s.entity_id = e.id
      WHERE s.tenant_id = ? AND s.changed_at > ?
      ORDER BY s.changed_at DESC LIMIT 10
    `).all(TENANT_ID, deltaSince) as { source: string; entity: string | null; previous_value: string; current_value: string; changed_at: string }[]).map(s => ({
      source: s.source, entity: s.entity ?? 'unknown',
      from: (() => { try { return JSON.parse(s.previous_value); } catch { return s.previous_value; } })(),
      to: (() => { try { return JSON.parse(s.current_value); } catch { return s.current_value; } })(),
    }));

    const recentObs = db.prepare(`
      SELECT o.content, e.name AS entity_name, o.source, o.created_at
      FROM observations o LEFT JOIN entities e ON o.entity_id = e.id
      WHERE o.tenant_id = ? AND o.created_at > ?
      ORDER BY o.created_at DESC LIMIT 8
    `).all(TENANT_ID, deltaSince) as { content: string; entity_name: string | null; source: string; created_at: string }[];

    const openGaps = (db.prepare("SELECT COUNT(*) as n FROM gaps WHERE tenant_id = ? AND status = 'open'").get(TENANT_ID) as { n: number }).n;
    const projectCount = (db.prepare("SELECT COUNT(*) as n FROM entities WHERE tenant_id = ? AND type = 'project' AND status = 'active'").get(TENANT_ID) as { n: number }).n;

    const result = {
      delta_since: deltaSince,
      p0_items: p0Items,
      changed_signals: changedSignals,
      recent_observations: recentObs.map(o => ({
        content: o.content.length > 200 ? o.content.slice(0, 200) + '…' : o.content,
        entity: o.entity_name, source: o.source, created_at: o.created_at,
      })),
      open_gaps: openGaps,
      session_note: `${recentObs.length} new observations since last session. ${projectCount} active projects. ${openGaps} open gaps.`,
    };

    let serialized = JSON.stringify(result);
    while (serialized.length > CHAR_CAP && result.recent_observations.length > 0) {
      result.recent_observations.pop(); serialized = JSON.stringify(result);
    }
    return result;
  } catch (e) {
    return { error: (e as Error).message, p0_items: [], session_note: 'briefing failed' };
  }
}

async function handleRecall(input: { query: string; scope?: string; limit?: number }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { query: input.query, results: [], error: 'brain.db unavailable' };
  const _limit = input.limit ?? 8;
  const seedLimit = _limit * 3;
  const _scope = input.scope ?? 'all';

  let scopeType: 'all' | 'project' | 'era' | 'person' = 'all';
  let scopeValue = '';
  if (_scope.startsWith('project:')) { scopeType = 'project'; scopeValue = _scope.slice(8); }
  else if (_scope.startsWith('era:')) { scopeType = 'era'; scopeValue = _scope.slice(4); }
  else if (_scope.startsWith('person:')) { scopeType = 'person'; scopeValue = _scope.slice(7); }

  type VRow = { id: string; content: string; entity_id: string | null; source: string; created_at: string; similarity: number };
  let vectorRows: VRow[] = [];
  let bm25Rows: { id: string; bm25_raw: number }[] = [];
  const vectorMeta = new Map<string, VRow>();

  if (_vecLoaded) {
    try {
      const emb = await generateEmbedding(input.query);
      const queryJson = JSON.stringify(Array.from(emb));
      let sql = `SELECT o.id, o.content, o.entity_id, o.source, o.created_at,
        (1.0-(vec_distance_cosine(o.embedding,vec_f32(?))/2.0)) AS similarity
        FROM observations o WHERE o.tenant_id=? AND o.embedding IS NOT NULL`;
      const params: unknown[] = [queryJson, TENANT_ID];
      if (scopeType === 'project') {
        sql += ` AND o.entity_id=(SELECT id FROM entities WHERE tenant_id=? AND (slug=? OR name LIKE ?) LIMIT 1)`;
        params.push(TENANT_ID, scopeValue, `%${scopeValue}%`);
      }
      sql += ` ORDER BY similarity DESC LIMIT ?`; params.push(seedLimit);
      vectorRows = db.prepare(sql).all(...params) as VRow[];
      vectorRows.forEach(r => vectorMeta.set(r.id, r));
    } catch { /* fall through to BM25 */ }
  }

  try {
    const ftsQuery = '"' + input.query.replace(/"/g, '""') + '"';
    bm25Rows = db.prepare(`
      SELECT o.id, (-fts.rank) AS bm25_raw FROM observations o
      JOIN observations_fts fts ON o.rowid=fts.rowid
      WHERE o.tenant_id=? AND observations_fts MATCH ?
      ORDER BY fts.rank LIMIT ?
    `).all(TENANT_ID, ftsQuery, seedLimit) as { id: string; bm25_raw: number }[];
  } catch { /* ignore FTS error */ }

  const vectorScores = new Map(vectorRows.map(r => [r.id, r.similarity]));
  const bm25Scores   = new Map(bm25Rows.map(r => [r.id, r.bm25_raw]));
  const normV = normalizeScores(vectorScores);
  const normB = normalizeScores(bm25Scores);
  const allIds = new Set([...vectorScores.keys(), ...bm25Scores.keys()]);

  const results: { id: string; content: string; entity_id: string | null; entity_name: string | null; source: string; created_at: string; score: number; rank: number }[] = [];
  for (const id of allIds) {
    const hybrid = 0.7 * (normV.get(id) ?? 0) + 0.3 * (normB.get(id) ?? 0);
    let meta = vectorMeta.get(id);
    if (!meta) {
      const row = db.prepare('SELECT id,content,entity_id,source,created_at FROM observations WHERE id=?').get(id) as VRow | null;
      if (!row) continue;
      meta = { ...row, similarity: 0 };
    }
    const ent = meta.entity_id ? (db.prepare('SELECT name FROM entities WHERE id=?').get(meta.entity_id) as { name: string } | null) : null;
    results.push({ id, content: meta.content, entity_id: meta.entity_id, entity_name: ent?.name ?? null,
      source: meta.source, created_at: meta.created_at, score: parseFloat(hybrid.toFixed(6)), rank: 0 });
  }

  results.sort((a, b) => b.score - a.score);
  const final = results.slice(0, _limit);
  final.forEach((r, i) => { r.rank = i + 1; });
  return { query: input.query, scope: _scope, results: final, total_candidates: allIds.size, vector_search: _vecLoaded };
}


async function handleRecallGraph(input: { query: string; scope?: string; limit?: number }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { query: input.query, results: [], graph_neighbors: [], error: 'brain.db unavailable' };

  const seedResult = await handleRecall(input) as {
    results: { id: string; content: string; entity_id: string | null; entity_name: string | null; score: number; rank: number; source: string; created_at: string }[];
    total_candidates: number; scope: string; vector_search: boolean;
  };

  const seedEntityIds = [...new Set(seedResult.results.map(r => r.entity_id).filter((id): id is string => !!id))].slice(0, 6);

  let graphNeighbors: object[] = [];
  let graphObs: object[] = [];
  let graphSummary = '';

  try {
    const neighbors = getNeighborEntities(db, seedEntityIds, 5);
    graphNeighbors = neighbors.map(n => ({
      entity_name: n.entity_name, entity_type: n.entity_type,
      relationship: n.edge_relationship, weight: n.edge_weight,
    }));
    const edgeWeightMap = new Map(neighbors.map(n => [n.entity_id, n.edge_weight]));
    const neighborObs = getObservationsForEntities(db, neighbors.slice(0, 5).map(n => n.entity_id), 3, edgeWeightMap);
    graphObs = neighborObs.map(o => ({
      content: o.content.length > 200 ? o.content.slice(0, 200) + '…' : o.content,
      entity_name: o.entity_name, via_entity: o.via_entity, graph_boost: o.graph_boost,
    }));
    const seedNames = seedResult.results.slice(0, 3).map(s => s.entity_name ?? '').filter(Boolean);
    graphSummary = buildGraphSummary(seedNames, neighbors, neighborObs);
  } catch { /* degrade to plain recall */ }

  return { ...seedResult, graph_neighbors: graphNeighbors, graph_observations: graphObs, graph_summary: graphSummary };
}

async function handleRemember(input: { content: string; entity?: string; source?: string }): Promise<object> {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  try {
    const id = ulid();
    const now = new Date().toISOString();
    const _source = input.source ?? 'session';

    let entityId: string | null = null;
    let entityResolved: string | null = null;
    if (input.entity) {
      const ent = db.prepare(
        'SELECT id,name FROM entities WHERE tenant_id=? AND (slug=? OR name LIKE ?) LIMIT 1'
      ).get(TENANT_ID, input.entity, `%${input.entity}%`) as { id: string; name: string } | null;
      if (ent) { entityId = ent.id; entityResolved = ent.name; }
    }

    db.prepare(`INSERT INTO observations (id,tenant_id,entity_id,content,source,tags,created_at)
      VALUES (@id,@tenant_id,@entity_id,@content,@source,@tags,@now)`)
      .run({ id, tenant_id: TENANT_ID, entity_id: entityId, content: input.content, source: _source, tags: '[]', now });

    try {
      const emb = await generateEmbedding(input.content);
      db.prepare('UPDATE observations SET embedding=? WHERE id=?').run(Buffer.from(emb.buffer), id);
    } catch { /* saved without embedding — fine */ }

    return { observation_id: id, entity_resolved: entityResolved, source: _source, created_at: now };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function handleStatus(input: { project: string }): object {
  const db = getBrainDb();
  if (!db) return { error: 'brain.db unavailable' };
  try {
    const normalized = input.project.replace(/-/g, ' ');
    const firstWord = input.project.split('-')[0] ?? input.project;
    const entity = db.prepare(`
      SELECT * FROM entities WHERE tenant_id=?
        AND (slug=? OR slug=? OR name LIKE ? OR name LIKE ? OR id=?)
      ORDER BY CASE WHEN slug=? THEN 0 WHEN slug=? THEN 1 WHEN name LIKE ? THEN 2 ELSE 3 END LIMIT 1
    `).get(TENANT_ID, input.project, firstWord, `%${input.project}%`, `%${normalized}%`, input.project,
        input.project, firstWord, `%${input.project}%`) as {
      id: string; name: string; type: string; slug: string | null;
      status: string; metadata: string; updated_at: string;
    } | undefined;

    if (!entity) return { error: `No entity found matching '${input.project}'` };

    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(entity.metadata); } catch { /**/ }

    const recentObs = db.prepare(`
      SELECT id,content,source,created_at FROM observations
      WHERE tenant_id=? AND entity_id=? ORDER BY created_at DESC LIMIT 5
    `).all(TENANT_ID, entity.id) as { id: string; content: string; source: string; created_at: string }[];

    const latestSignal = db.prepare(`
      SELECT source,value,previous_value,changed_at,polled_at FROM signals
      WHERE tenant_id=? AND entity_id=? ORDER BY polled_at DESC LIMIT 1
    `).get(TENANT_ID, entity.id) as { source: string; value: string; previous_value: string; changed_at: string | null; polled_at: string } | undefined;

    return {
      entity: { id: entity.id, name: entity.name, type: entity.type, status: entity.status, metadata, updated_at: entity.updated_at },
      recent_observations: recentObs.map(o => ({ content: o.content.slice(0, 300), source: o.source, created_at: o.created_at })),
      latest_signal: latestSignal ? {
        source: latestSignal.source,
        value: (() => { try { return JSON.parse(latestSignal.value); } catch { return latestSignal.value; } })(),
        changed_at: latestSignal.changed_at, polled_at: latestSignal.polled_at,
      } : null,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ── Handler factory ───────────────────────────────────────────────────────────

export function createBrainHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    brain_briefing:      (i) => handleBriefing(i as { since?: string }),
    brain_recall:        (i) => handleRecall(i as { query: string; scope?: string; limit?: number }),
    brain_recall_graph:  (i) => handleRecallGraph(i as { query: string; scope?: string; limit?: number }),
    brain_remember:      (i) => handleRemember(i as { content: string; entity?: string; source?: string }),
    brain_status:        (i) => Promise.resolve(handleStatus(i as { project: string })),
  };
}
