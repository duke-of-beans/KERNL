/**
 * KERNL MCP - AUTONOMIC Sprint Queue Tools
 *
 * score_sprint    — classify a sprint prompt (tier, confidence, flags, scoring
 *                   breakdown) using keyword/path/destructive checks plus learned
 *                   failure-pattern matching and a best-effort brain.db history signal.
 * queue_sprint    — stage a sprint prompt into D:\Dev\SPRINT_QUEUE\pending with
 *                   scored YAML frontmatter (sprint_id, tier, confidence). Uses
 *                   score_sprint internally.
 * preflight_check — validate a pending sprint before execution: path existence
 *                   (+ auto-fix), git cleanliness, failure-pattern match, deps.
 *
 * Net-new connective tissue for the AUTONOMIC system.
 * Spec:     D:\Meta\SPRINT_AUTOMATION_ARCHITECTURE.md
 * Template: D:\Dev\TEMPLATES\AUTONOMIC_SPRINT_TEMPLATE.md
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// ==========================================================================
// CONSTANTS
// ==========================================================================

const QUEUE_DIR = 'D:\\Dev\\SPRINT_QUEUE';
const PENDING_DIR = path.join(QUEUE_DIR, 'pending');
const COMPLETED_DIR = path.join(QUEUE_DIR, 'completed');
const PATTERNS_DIR = path.join(QUEUE_DIR, 'patterns');

// brain.db (read-only, best-effort) for historical scoring signals.
const BRAIN_DB_PATH = 'D:\\Meta\\brain.db';
const BRAIN_TENANT = 'dk-001';
const BRAIN_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'what', 'how', 'why',
  'when', 'where', 'who', 'are', 'was', 'did', 'does', 'sprint', 'project', 'task', 'execute',
]);

const AMBIGUITY_KEYWORDS = ['choose', 'design', 'decide', 'prefer', 'style', 'option', 'approach'];
const DESTRUCTIVE_KEYWORDS = ['delete', 'drop', 'remove', 'overwrite'];

// Roots searched when auto-resolving a moved file by basename.
const SEARCH_ROOTS = ['D:\\Projects', 'D:\\Work', 'D:\\Dev', 'D:\\Research', 'D:\\Meta'];
const SEARCH_EXCLUDES = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.cache']);
const SEARCH_MAX_VISITS = 20000;

// ==========================================================================
// HELPERS
// ==========================================================================

/** Extract distinct Windows absolute paths from text, trimming trailing punctuation. */
function extractWindowsPaths(text: string): string[] {
  const matches = text.match(/[A-Za-z]:\\[^\s"'<>|]+/g) || [];
  const cleaned = matches.map((m) => m.replace(/[.,;:)\]}'"]+$/, ''));
  return Array.from(new Set(cleaned.filter((p) => p.length > 3)));
}

/** Local-date stamp YYYYMMDD. */
function todayStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Next sequential sprint id for the given date stamp, scanning pending/. */
function nextSprintId(stamp: string): string {
  let maxSeq = 0;
  const prefix = `AUT-${stamp}-`;
  if (fs.existsSync(PENDING_DIR)) {
    for (const f of fs.readdirSync(PENDING_DIR)) {
      if (f.startsWith(prefix) && f.endsWith('.md')) {
        const seq = parseInt(f.slice(prefix.length, f.length - 3), 10);
        if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

/** Project root (drive\Projects\X or drive\Work\X) of a path, else null. */
function projectRootOf(p: string): string | null {
  const parts = p.replace(/\//g, '\\').split('\\').filter(Boolean);
  if (parts.length < 3) return null;
  const top = parts[1].toLowerCase();
  if (top === 'projects' || top === 'work') {
    return `${parts[0]}\\${parts[1]}\\${parts[2]}`.toLowerCase();
  }
  return null;
}

/** True if paths reference more than one distinct project root. */
function detectMultiProject(paths: string[]): boolean {
  const roots = new Set<string>();
  for (const p of paths) {
    const r = projectRootOf(p);
    if (r) roots.add(r);
  }
  return roots.size > 1;
}

/** Quote a YAML scalar only when it contains special characters. */
function yamlScalar(value: string): string {
  if (value === '') return "''";
  const needsQuote = /[:#[\]{}&*!|>'"%@,]/.test(value) || /^\s|\s$/.test(value) || /^[-?]/.test(value);
  return needsQuote ? `'${value.replace(/'/g, "''")}'` : value;
}

/** Render a string array as a YAML flow list. */
function yamlList(items: string[]): string {
  if (!items.length) return '[]';
  return `[${items.map((i) => yamlScalar(i)).join(', ')}]`;
}

interface Frontmatter {
  sprint_id: string;
  project: string;
  title: string;
  tier: number;
  confidence: number;
  priority: string;
  status: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  source: string;
  dependencies: string[];
  model_preference: string;
  retry_count: number;
  max_retries: number;
  parent_sprint: string | null;
  tags: string[];
}

/** Build the YAML frontmatter block per AUTONOMIC_SPRINT_TEMPLATE schema. */
function buildFrontmatter(fm: Frontmatter): string {
  const lines = [
    '---',
    `sprint_id: ${fm.sprint_id}`,
    `project: ${yamlScalar(fm.project)}`,
    `title: ${yamlScalar(fm.title)}`,
    `tier: ${fm.tier}`,
    `confidence: ${fm.confidence}`,
    `priority: ${fm.priority}`,
    `status: ${fm.status}`,
    `queued_at: ${fm.queued_at}`,
    `started_at: ${fm.started_at === null ? 'null' : fm.started_at}`,
    `completed_at: ${fm.completed_at === null ? 'null' : fm.completed_at}`,
    `source: ${fm.source}`,
    `dependencies: ${yamlList(fm.dependencies)}`,
    `model_preference: ${fm.model_preference}`,
    `retry_count: ${fm.retry_count}`,
    `max_retries: ${fm.max_retries}`,
    `parent_sprint: ${fm.parent_sprint === null ? 'null' : fm.parent_sprint}`,
    `tags: ${yamlList(fm.tags)}`,
    '---',
  ];
  return lines.join('\n');
}

/** Split frontmatter (delimited by ---) from the body of a sprint file. */
function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  const fm: Record<string, string> = {};
  if (!normalized.startsWith('---')) return { fm, body: normalized };
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { fm, body: normalized };
  const header = normalized.slice(3, end).trim();
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  for (const line of header.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return { fm, body };
}

/** Parse a YAML flow list "[a, b, c]" into a string array. */
function parseFlowList(val: string): string[] {
  const t = val.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return [];
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** Minimal flat YAML key:value parser for pattern registry files. */
function parseFlatYaml(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#') || line.trimStart().startsWith('-')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Search SEARCH_ROOTS for files matching a basename (bounded). */
function findFileByName(basename: string): string[] {
  const found: string[] = [];
  let visits = 0;
  for (const root of SEARCH_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const stack: string[] = [root];
    while (stack.length) {
      if (visits >= SEARCH_MAX_VISITS) return found;
      const dir = stack.pop() as string;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        visits++;
        if (e.isDirectory()) {
          if (!SEARCH_EXCLUDES.has(e.name)) stack.push(path.join(dir, e.name));
        } else if (e.name === basename) {
          found.push(path.join(dir, e.name));
        }
      }
    }
  }
  return found;
}

/** Walk up from a directory to find the enclosing git repo root. */
function findGitRoot(startPath: string): string | null {
  let cur = startPath;
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

// ==========================================================================
// SCORING (score_sprint — exposed as a standalone tool below)
// ==========================================================================

interface ScoringBreakdown {
  base: number;
  ambiguity_penalty: number;
  missing_path_penalty: number;
  destructive_penalty: number;
  multi_project_penalty: number;
  prometheus_bonus: number;
  pattern_match_adjustment: number;
  historical_success_bonus: number;
}

interface ScoreResult {
  confidence: number;
  tier: 1 | 2 | 3;
  autoTier: 1 | 2 | 3;
  flags: string[];
  missingPaths: string[];
  verifiedPaths: string[];
  ambiguityHits: string[];
  destructiveHits: string[];
  multiProject: boolean;
  scoringBreakdown: ScoringBreakdown;
}

/** Round to 2 decimals, stripping float noise from accumulated deltas. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function tierFromConfidence(confidence: number): 1 | 2 | 3 {
  if (confidence > 0.8) return 1;
  if (confidence >= 0.5) return 2;
  return 3;
}

// --- Task 3A: historical failure-pattern match (patterns\*.yaml) ---------
// Reads the learned-pattern registry. A matching pattern with auto_fix:true is
// informational (flag only — Gate 1 can self-correct it). A matching pattern
// WITHOUT auto_fix lowers confidence (-0.15 each), since it predicts a manual
// failure mode the scorer cannot resolve.
function computePatternMatch(sprintText: string, project: string): { adjustment: number; flags: string[] } {
  const flags: string[] = [];
  let adjustment = 0;
  if (!fs.existsSync(PATTERNS_DIR)) return { adjustment, flags };

  const lowerText = sprintText.toLowerCase();
  const projectLower = (project || '').toLowerCase();

  let files: string[];
  try {
    files = fs.readdirSync(PATTERNS_DIR);
  } catch {
    return { adjustment, flags };
  }

  for (const pf of files) {
    if (!pf.endsWith('.yaml') && !pf.endsWith('.yml')) continue;
    let pat: Record<string, string>;
    try {
      pat = parseFlatYaml(fs.readFileSync(path.join(PATTERNS_DIR, pf), 'utf-8'));
    } catch {
      continue;
    }
    const trigger = (pat.trigger_condition || '').toLowerCase();
    const patProject = (pat.project || '').toLowerCase();
    const matchesProject = !!patProject && !!projectLower && patProject === projectLower;
    const matchesTrigger =
      !!trigger && (lowerText.includes(trigger) || (!!projectLower && trigger.includes(projectLower)));
    if (!matchesProject && !matchesTrigger) continue;

    if (pat.auto_fix === 'true') {
      flags.push(`pattern_match:${pf}:auto_fix`);
    } else {
      adjustment -= 0.15;
      flags.push(`pattern_match:${pf}:penalty`);
    }
  }
  return { adjustment, flags };
}

interface BrainDBLike {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
  close(): void;
}

/** FTS5 query string: significant tokens, OR-joined with prefix match. */
function buildBrainFtsQuery(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !BRAIN_STOP_WORDS.has(w))
    .map((w) => `${w}*`);
  return Array.from(new Set(tokens)).slice(0, 12).join(' OR ');
}

// --- Task 3B: historical success/abort signal (brain.db, best-effort) ----
// Keyword-searches brain.db for observations about prior sprints on this
// project. A prior abort lowers confidence (-0.10); a prior clean completion
// raises it (+0.05). Strictly best-effort: any failure to reach brain.db
// returns a zero adjustment and never blocks scoring.
function computeHistoricalSignal(sprintText: string, project: string): { adjustment: number; flags: string[] } {
  const flags: string[] = [];
  const query = buildBrainFtsQuery(`${project} ${sprintText.slice(0, 240)}`);
  if (!query) return { adjustment: 0, flags };

  let db: BrainDBLike | null = null;
  try {
    const Database = _require('better-sqlite3') as new (p: string, o?: object) => BrainDBLike;
    db = new Database(BRAIN_DB_PATH, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT o.content AS content, o.source AS source
         FROM observations o
         JOIN observations_fts fts ON o.rowid = fts.rowid
         WHERE o.tenant_id = ? AND o.status = 'active' AND observations_fts MATCH ?
         ORDER BY fts.rank LIMIT 12`,
      )
      .all(BRAIN_TENANT, query) as { content: string; source: string }[];

    let aborted = false;
    let succeeded = false;
    for (const r of rows) {
      const c = (r.content || '').toLowerCase();
      const s = (r.source || '').toLowerCase();
      if (s === 'sprint_abort' || /\babort(ed)?\b/.test(c)) aborted = true;
      else if (/\b(completed|succeeded|success|passed)\b/.test(c)) succeeded = true;
    }
    if (aborted) {
      flags.push('history:prior_abort');
      return { adjustment: -0.1, flags };
    }
    if (succeeded) {
      flags.push('history:prior_success');
      return { adjustment: 0.05, flags };
    }
    return { adjustment: 0, flags };
  } catch {
    flags.push('history:brain_unavailable');
    return { adjustment: 0, flags };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore close failure */
    }
  }
}

function scoreSprint(sprintText: string, source: string, tierHint?: number, project = ''): ScoreResult {
  const lower = sprintText.toLowerCase();
  const base = 0.85;
  const flags: string[] = [];

  const ambiguityHits = AMBIGUITY_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
  const ambiguityPenalty = -0.1 * ambiguityHits.length;
  if (ambiguityHits.length) flags.push(`ambiguity:${ambiguityHits.join(',')}`);

  const paths = extractWindowsPaths(sprintText);
  const missingPaths: string[] = [];
  const verifiedPaths: string[] = [];
  for (const p of paths) {
    if (fs.existsSync(p)) verifiedPaths.push(p);
    else missingPaths.push(p);
  }
  const missingPathPenalty = -0.15 * missingPaths.length;
  if (missingPaths.length) flags.push(`missing_paths:${missingPaths.length}`);

  const destructiveHits = DESTRUCTIVE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
  const destructivePenalty = destructiveHits.length ? -0.2 : 0;
  if (destructiveHits.length) flags.push(`destructive:${destructiveHits.join(',')}`);

  const multiProject = detectMultiProject(paths);
  const multiProjectPenalty = multiProject ? -0.15 : 0;
  if (multiProject) flags.push('multi_project');

  const prometheusBonus = source === 'prometheus' ? 0.1 : 0;
  if (prometheusBonus) flags.push('prometheus_bonus');

  // Task 3A — learned failure-pattern registry.
  const pattern = computePatternMatch(sprintText, project);
  flags.push(...pattern.flags);

  // Task 3B — historical success/abort signal from brain.db (best-effort).
  const history = computeHistoricalSignal(sprintText, project);
  flags.push(...history.flags);

  const raw =
    base +
    ambiguityPenalty +
    missingPathPenalty +
    destructivePenalty +
    multiProjectPenalty +
    prometheusBonus +
    pattern.adjustment +
    history.adjustment;
  const confidence = Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;

  const autoTier = tierFromConfidence(confidence);
  let tier: 1 | 2 | 3 = autoTier;
  if (missingPaths.length > 2) {
    tier = 3;
    flags.push('forced_tier3_missing_paths');
  }
  if (tierHint === 1 || tierHint === 2 || tierHint === 3) {
    tier = tierHint;
    flags.push(`tier_hint_override:${tierHint}`);
  }

  const scoringBreakdown: ScoringBreakdown = {
    base,
    ambiguity_penalty: round2(ambiguityPenalty),
    missing_path_penalty: round2(missingPathPenalty),
    destructive_penalty: round2(destructivePenalty),
    multi_project_penalty: round2(multiProjectPenalty),
    prometheus_bonus: round2(prometheusBonus),
    pattern_match_adjustment: round2(pattern.adjustment),
    historical_success_bonus: round2(history.adjustment),
  };

  return {
    confidence,
    tier,
    autoTier,
    flags,
    missingPaths,
    verifiedPaths,
    ambiguityHits,
    destructiveHits,
    multiProject,
    scoringBreakdown,
  };
}

// ==========================================================================
// TOOL DEFINITIONS (2 tools)
// ==========================================================================

export const autonomicTools: Tool[] = [
  {
    name: 'score_sprint',
    description:
      'Classify an AUTONOMIC sprint prompt without queueing it. Runs the full confidence model: ' +
      'ambiguity keywords, missing/verified file paths, destructive ops, multi-project scope, PROMETHEUS ' +
      'bonus, learned failure-pattern registry (patterns\\*.yaml), and a best-effort brain.db historical ' +
      'success/abort signal. Returns tier (1 auto / 2 gated / 3 human), confidence (0-1), flags, and a ' +
      'scoring_breakdown itemizing every additive component. queue_sprint uses this same scorer internally.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_text: { type: 'string', description: 'The sprint prompt body to analyze' },
        project: { type: 'string', description: 'Project name (used for pattern + history matching)' },
        source: { type: 'string', enum: ['prometheus', 'lantern', 'chat', 'manual'], description: 'Sprint origin (default chat)' },
      },
      required: ['sprint_text'],
    },
  },
  {
    name: 'queue_sprint',
    description:
      'Stage a sprint prompt into the AUTONOMIC queue (D:\\Dev\\SPRINT_QUEUE\\pending) with scored ' +
      'YAML frontmatter. Generates the next AUT-{YYYYMMDD}-{NNN} sprint_id, runs inline confidence ' +
      'scoring (ambiguity keywords, missing file paths, destructive ops, multi-project scope, ' +
      'PROMETHEUS bonus), assigns a tier (1 auto / 2 gated / 3 human), and writes the sprint file. ' +
      'Returns sprint_id, tier, confidence, queue_position, and file_path.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_text: { type: 'string', description: 'The full sprint prompt body' },
        project: { type: 'string', description: 'Project name' },
        title: { type: 'string', description: 'Sprint title' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2'], description: 'Sprint priority' },
        tier_hint: { type: 'number', enum: [1, 2, 3], description: 'Optional manual tier override' },
        dependencies: { type: 'array', items: { type: 'string' }, description: 'Sprint IDs that must complete first' },
        model_preference: { type: 'string', enum: ['opus', 'sonnet'], description: 'Preferred model (default sonnet)' },
        source: { type: 'string', enum: ['prometheus', 'lantern', 'chat', 'manual'], description: 'Sprint origin (default chat)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Sprint tags' },
      },
      required: ['sprint_text', 'project', 'title', 'priority'],
    },
  },
  {
    name: 'preflight_check',
    description:
      'Validate a pending AUTONOMIC sprint before execution. Verifies every Windows file path in the ' +
      'sprint body exists (auto-fixing moved files by basename search and rewriting the sprint), checks ' +
      'the target git working tree is clean, matches learned failure patterns in patterns\\, and confirms ' +
      'dependency sprints are in completed\\. Returns { pass, blockers, warnings, auto_fixed }.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_id: { type: 'string', description: 'The sprint_id to preflight (reads from pending\\)' },
      },
      required: ['sprint_id'],
    },
  },
];

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

export function createAutonomicHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    score_sprint: async (input) => {
      const sprintText = input.sprint_text as string;
      if (!sprintText) return { error: 'score_sprint requires sprint_text' };

      const project = (input.project as string) || '';
      const source = (input.source as string) || 'chat';

      const score = scoreSprint(sprintText, source, undefined, project);

      return {
        tier: score.tier,
        confidence: score.confidence,
        flags: score.flags,
        scoring_breakdown: score.scoringBreakdown,
      };
    },

    queue_sprint: async (input) => {
      const sprintText = input.sprint_text as string;
      const project = input.project as string;
      const title = input.title as string;
      const priority = input.priority as string;

      if (!sprintText || !project || !title || !priority) {
        return { error: 'queue_sprint requires sprint_text, project, title, and priority' };
      }
      if (!['P0', 'P1', 'P2'].includes(priority)) {
        return { error: `Invalid priority: ${priority}. Must be P0, P1, or P2.` };
      }

      const tierHint = typeof input.tier_hint === 'number' ? (input.tier_hint as number) : undefined;
      const dependencies = Array.isArray(input.dependencies) ? (input.dependencies as string[]) : [];
      const modelPreference = (input.model_preference as string) || 'sonnet';
      const source = (input.source as string) || 'chat';
      const tags = Array.isArray(input.tags) ? (input.tags as string[]) : [];

      if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });

      const now = new Date();
      const sprintId = nextSprintId(todayStamp(now));
      const score = scoreSprint(sprintText, source, tierHint, project);

      const frontmatter = buildFrontmatter({
        sprint_id: sprintId,
        project,
        title,
        tier: score.tier,
        confidence: score.confidence,
        priority,
        status: 'pending',
        queued_at: now.toISOString(),
        started_at: null,
        completed_at: null,
        source,
        dependencies,
        model_preference: modelPreference,
        retry_count: 0,
        max_retries: 2,
        parent_sprint: null,
        tags,
      });

      const filePath = path.join(PENDING_DIR, `${sprintId}.md`);
      const fileBody = `${frontmatter}\n\n${sprintText.trim()}\n`;
      fs.writeFileSync(filePath, fileBody, 'utf-8');

      const queuePosition = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.md')).length;

      return {
        sprint_id: sprintId,
        tier: score.tier,
        confidence: score.confidence,
        queue_position: queuePosition,
        file_path: filePath,
        scoring: {
          auto_tier: score.autoTier,
          flags: score.flags,
          ambiguity_keywords: score.ambiguityHits,
          destructive_keywords: score.destructiveHits,
          missing_paths: score.missingPaths,
          verified_path_count: score.verifiedPaths.length,
          multi_project: score.multiProject,
          scoring_breakdown: score.scoringBreakdown,
        },
      };
    },

    preflight_check: async (input) => {
      const sprintId = input.sprint_id as string;
      if (!sprintId) return { error: 'preflight_check requires sprint_id' };

      const filePath = path.join(PENDING_DIR, `${sprintId}.md`);
      if (!fs.existsSync(filePath)) {
        return { error: `Sprint not found in pending: ${filePath}` };
      }

      const blockers: string[] = [];
      const warnings: string[] = [];
      const autoFixed: string[] = [];

      let content = fs.readFileSync(filePath, 'utf-8');
      const { fm, body } = parseFrontmatter(content);

      // 1. File path existence (+ auto-fix moved files by basename)
      const paths = extractWindowsPaths(body);
      let mutated = false;
      for (const p of paths) {
        if (fs.existsSync(p)) continue;
        const candidates = findFileByName(path.basename(p));
        if (candidates.length === 1) {
          content = content.split(p).join(candidates[0]);
          autoFixed.push(`Path corrected: ${p} -> ${candidates[0]}`);
          mutated = true;
        } else if (candidates.length > 1) {
          warnings.push(`Ambiguous path ${p}: ${candidates.length} candidates found, not auto-fixed`);
        } else {
          blockers.push(`Missing file, not found on disk: ${p}`);
        }
      }
      if (mutated) fs.writeFileSync(filePath, content, 'utf-8');

      // 2. Git working tree clean / expected for target project
      const anchorPath = paths.find((p) => fs.existsSync(p));
      if (anchorPath) {
        const startDir = fs.statSync(anchorPath).isDirectory() ? anchorPath : path.dirname(anchorPath);
        const gitRoot = findGitRoot(startDir);
        if (gitRoot) {
          try {
            const out = execSync('git status --porcelain', { cwd: gitRoot, encoding: 'utf-8' });
            if (out.trim()) {
              warnings.push(`Git working tree not clean at ${gitRoot} (${out.trim().split('\n').length} changes)`);
            }
          } catch {
            warnings.push(`Could not run git status at ${gitRoot}`);
          }
        } else {
          warnings.push('Could not determine git root for target project');
        }
      }

      // 3. Failure pattern registry (patterns\*.yaml)
      if (fs.existsSync(PATTERNS_DIR)) {
        const projectName = (fm.project || '').toLowerCase();
        const sprintTags = parseFlowList(fm.tags || '[]').map((t) => t.toLowerCase());
        for (const pf of fs.readdirSync(PATTERNS_DIR)) {
          if (!pf.endsWith('.yaml') && !pf.endsWith('.yml')) continue;
          try {
            const pat = parseFlatYaml(fs.readFileSync(path.join(PATTERNS_DIR, pf), 'utf-8'));
            const trigger = (pat.trigger_condition || '').toLowerCase();
            const patProject = (pat.project || '').toLowerCase();
            const matchesProject = !!patProject && !!projectName && patProject === projectName;
            const matchesTrigger =
              !!trigger && (!!projectName && trigger.includes(projectName) || sprintTags.some((t) => trigger.includes(t)));
            if (matchesProject || matchesTrigger) {
              warnings.push(`Failure pattern ${pf}: ${pat.generated_check || pat.trigger_condition || 'matched'}`);
            }
          } catch {
            /* skip unparseable pattern file */
          }
        }
      }

      // 4. Dependencies are in completed\
      const deps = parseFlowList(fm.dependencies || '[]');
      for (const dep of deps) {
        if (!fs.existsSync(path.join(COMPLETED_DIR, `${dep}.md`))) {
          blockers.push(`Dependency not completed: ${dep}`);
        }
      }

      return {
        sprint_id: sprintId,
        pass: blockers.length === 0,
        blockers,
        warnings,
        auto_fixed: autoFixed,
      };
    },
  };
}
