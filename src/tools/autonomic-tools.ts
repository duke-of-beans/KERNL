/**
 * KERNL MCP - AUTONOMIC Sprint Tools (Enhanced Backend)
 *
 * These tools are KERNL's enhanced implementation of the AUTONOMIC protocol.
 * AUTONOMIC is a standalone protocol, CLI, and plugin for autonomous sprint
 * execution by AI agents: https://github.com/duke-of-beans/autonomic
 *
 * KERNL enhances AUTONOMIC's gates with:
 *   - brain.db pattern matching for smarter sprint scoring
 *   - EoS (Eye of Sauron) quality baselines for pre-flight validation
 *   - WHETSTONE adversarial probes for post-sprint validation
 *   - Learned failure patterns from the brain.db graph
 *
 * Tools:
 *   score_sprint    — classify sprint (tier, confidence) with brain.db history
 *   queue_sprint    — stage sprint with scored YAML frontmatter
 *   preflight_check — validate before execution (paths, git, patterns, deps)
 *   validate_sprint — post-sprint quality gates (EoS delta, Yuma, WHETSTONE)
 *   analyze_ticket  — abort ticket analysis with Gate 3 learning bridge
 *   backlog_to_sprint — convert backlog items to sprint prompts
 *
 * Protocol:  https://github.com/duke-of-beans/autonomic/blob/main/docs/protocol.md
 * Local spec: D:\Meta\SPRINT_AUTOMATION_ARCHITECTURE.md
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import * as http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createEosHandlers } from './eos-tools.js';
import { createBrainHandlers } from './brain-tools.js';

const _require = createRequire(import.meta.url);

// ==========================================================================
// CONSTANTS
// ==========================================================================

const QUEUE_DIR = 'D:\\Dev\\SPRINT_QUEUE';
const PENDING_DIR = path.join(QUEUE_DIR, 'pending');
const COMPLETED_DIR = path.join(QUEUE_DIR, 'completed');
const PATTERNS_DIR = path.join(QUEUE_DIR, 'patterns');
const ACTIVE_DIR = path.join(QUEUE_DIR, 'active');

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

// Known KERNL tool names for preflight tool-reference validation.
// If a sprint references a tool not in this set, preflight warns (not blocks —
// the tool may exist in a different MCP server or be yet-to-be-built).
const KNOWN_TOOLS = new Set([
  'score_sprint', 'queue_sprint', 'preflight_check', 'analyze_ticket',
  'analyze_all_tickets', 'validate_sprint', 'eos_quick_scan',
  'brain_recall', 'brain_remember', 'brain_recall_graph', 'brain_recall_spread',
  'brain_recall_community', 'brain_status', 'brain_briefing', 'brain_feedback',
  'brain_invalidate', 'whetstone_challenge', 'imprint_reflect',
  'imprint_set_intention', 'imprint_resolve_intention',
  'five_gate_check', 'smart_commit', 'test_run', 'test_health',
  'shadow_doc_update', 'project_context_scan', 'inject_sprint_context',
]);
const SEARCH_EXCLUDES = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.cache']);
const SEARCH_MAX_VISITS = 20000;

// ==========================================================================
// HELPERS
// ==========================================================================

/** Extract distinct Windows absolute paths from text, including paths with spaces.
 *  Pass 1 (quoted): captures a path verbatim between matching quotes, e.g.
 *  "D:\Projects\Project Mind\file.ts".
 *  Pass 2 (unquoted): a drive root followed by directory segments that may contain
 *  spaces but must end in a backslash, then a space-free final segment — so
 *  "D:\Projects\Project Mind\kernl-mcp is the file" yields "D:\Projects\Project Mind\kernl-mcp".
 *  ':' is excluded from segment characters so a second drive letter starts a NEW path
 *  rather than being bridged into the previous one. Trailing punctuation is trimmed. */
function extractWindowsPaths(text: string): string[] {
  const out: string[] = [];
  // Pass 1 — quoted paths: take the content between single/double quotes verbatim.
  const quoted = /["']([A-Za-z]:\\[^"']*)["']/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoted.exec(text)) !== null) out.push(qm[1]);
  // Pass 2 — unquoted paths: directory segments may bridge spaces only when a
  // backslash continues the path; the final segment is space-free.
  const unquoted = /[A-Za-z]:\\(?:[^\s\\"'<>|:]+(?: +[^\s\\"'<>|:]+)*\\)*[^\s\\"'<>|:]*/g;
  for (const m of text.match(unquoted) || []) out.push(m);
  const cleaned = out.map((m) => m.replace(/[.,;:)\]}'"]+$/, '').trim());
  return Array.from(new Set(cleaned.filter((p) => p.length > 3)));
}

/** Extract KERNL tool names referenced in sprint text. Matches underscore_separated
 *  identifiers that look like tool names (score_sprint, eos_quick_scan, etc.).
 *  Returns distinct tool names found. */
function extractToolReferences(text: string): string[] {
  const toolPattern = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = toolPattern.exec(text)) !== null) {
    const candidate = m[1];
    // Only flag names that look like known or plausible KERNL tool names
    // (underscore-separated, matching tool naming convention)
    if (KNOWN_TOOLS.has(candidate) || candidate.endsWith('_check') ||
        candidate.endsWith('_sprint') || candidate.endsWith('_scan') ||
        candidate.endsWith('_ticket') || candidate.startsWith('brain_') ||
        candidate.startsWith('eos_') || candidate.startsWith('imprint_')) {
      found.add(candidate);
    }
  }
  return Array.from(found);
}

/** Local-date stamp YYYYMMDD. */
function todayStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Next sequential sprint id for the given date stamp, scanning ALL queue dirs (pending/active/completed/aborted) to guarantee lifecycle-wide ID uniqueness. */
function nextSprintId(stamp: string): string {
  let maxSeq = 0;
  const prefix = `AUT-${stamp}-`;
  // Scan EVERY queue directory, not just pending/. An ID must be unique across
  // the whole sprint lifecycle: emptying pending/ must not let a fresh sprint
  // reuse an ID still present in active/, completed/, or aborted/.
  for (const dir of [PENDING_DIR, ACTIVE_DIR, COMPLETED_DIR, ABORTED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
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
// TICKET ANALYZER + LEARNING BRIDGE (Gate 3 self-healing)
// ==========================================================================

const ABORTED_DIR = path.join(QUEUE_DIR, 'aborted');
const MAX_RETRIES = 2;
const PATTERN_THRESHOLD = 3;
const TRIGGER_SIM_THRESHOLD = 0.2;

// Categories whose aborts are mechanically auto-fixable (re-queue without a human).
const AUTO_FIXABLE_CATEGORIES = new Set([
  'missing_file',
  'missing_dependency',
  'missing_context',
  'scope_ambiguity',
  'environment_error',
]);

// Canonical suggested_fix_category per auto-fixable abort category.
const SUGGESTED_FIX_BY_CATEGORY: Record<string, string> = {
  missing_file: 'path_correction',
  missing_dependency: 'dep_install',
  missing_context: 'context_injection',
  scope_ambiguity: 'scope_decomposition',
  environment_error: 'branch_correction',
};

interface WritableBrainDB {
  prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
}

interface AbortTicket {
  sprintId: string;
  fm: Record<string, string>;
  body: string;
  trigger: string;
}

/** Extract a named "## Heading" section body from an abort ticket. */
function extractTicketSection(body: string, heading: string): string {
  const norm = body.replace(/\r\n/g, '\n');
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'mi');
  const m = re.exec(norm);
  if (!m) return '';
  const start = m.index + m[0].length;
  const nextRel = norm.slice(start).search(/\n##\s+/);
  return (nextRel === -1 ? norm.slice(start) : norm.slice(start, start + nextRel)).trim();
}

/** Significant-token set for fuzzy trigger matching. */
function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !BRAIN_STOP_WORDS.has(w)),
  );
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Read + parse every abort ticket in aborted\. */
function readAbortTickets(): AbortTicket[] {
  if (!fs.existsSync(ABORTED_DIR)) return [];
  const out: AbortTicket[] = [];
  for (const f of fs.readdirSync(ABORTED_DIR)) {
    if (!f.endsWith('.md')) continue;
    try {
      const content = fs.readFileSync(path.join(ABORTED_DIR, f), 'utf-8');
      const { fm, body } = parseFrontmatter(content);
      out.push({
        sprintId: fm.sprint_id || f.replace(/\.md$/, ''),
        fm,
        body,
        trigger: extractTicketSection(body, 'What Triggered the Abort'),
      });
    } catch {
      /* skip unreadable ticket */
    }
  }
  return out;
}

/** Next sequential PAT-NNN id, scanning patterns\. */
function nextPatternId(): string {
  let max = 0;
  if (fs.existsSync(PATTERNS_DIR)) {
    for (const f of fs.readdirSync(PATTERNS_DIR)) {
      const m = /^PAT-(\d+)\.ya?ml$/i.exec(f);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
    }
  }
  return `PAT-${String(max + 1).padStart(3, '0')}`;
}

/** True if an existing pattern already covers (is a superset of) these source tickets. */
function patternAlreadyExists(ticketIds: string[]): boolean {
  if (!fs.existsSync(PATTERNS_DIR)) return false;
  const want = new Set(ticketIds);
  for (const f of fs.readdirSync(PATTERNS_DIR)) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
    try {
      const pat = parseFlatYaml(fs.readFileSync(path.join(PATTERNS_DIR, f), 'utf-8'));
      const src = new Set(parseFlowList(pat.source_tickets || '[]'));
      let covered = true;
      for (const id of want) {
        if (!src.has(id)) {
          covered = false;
          break;
        }
      }
      if (covered && src.size >= want.size) return true;
    } catch {
      /* skip unparseable pattern */
    }
  }
  return false;
}

/** Best-effort log of a generated pattern to brain.db. FTS stays in sync via triggers; deduped by content_hash. */
function logPatternToBrain(patternId: string, category: string, sourceTickets: string[]): boolean {
  let db: WritableBrainDB | null = null;
  try {
    const Database = _require('better-sqlite3') as new (p: string, o?: object) => WritableBrainDB;
    db = new Database(BRAIN_DB_PATH, { fileMustExist: true });
    const content =
      `AUTONOMIC Gate 3: pattern ${patternId} generated from ${sourceTickets.length} abort ` +
      `tickets (category: ${category}). Source tickets: ${sourceTickets.join(', ')}.`;
    const hash = createHash('sha256').update(content).digest('hex');
    const dup = db.prepare('SELECT 1 FROM observations WHERE tenant_id = ? AND content_hash = ? LIMIT 1').get(BRAIN_TENANT, hash);
    if (dup) return false;
    const id = `pat_${patternId}_${Date.now()}`;
    db.prepare(
      'INSERT INTO observations (id, tenant_id, content, source, tags, status, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, BRAIN_TENANT, content, 'sprint_abort', JSON.stringify(['autonomic', 'pattern', category]), 'active', hash);
    return true;
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore close failure */
    }
  }
}

/** ISO date YYYY-MM-DD for pattern files. */
function isoDate(now: Date): string {
  return todayStamp(now).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
}

/**
 * Detect a >=3 cluster sharing abort category + similar trigger text; if found and not
 * already captured, write a PAT-NNN.yaml and log it to brain.db. Returns the new pattern id.
 */
function maybeGeneratePattern(category: string, current: AbortTicket, allTickets: AbortTicket[]): string | null {
  if (!category || category === 'unknown') return null;
  const sameCat = allTickets.filter((t) => (t.fm.abort_reason_category || '') === category);
  if (sameCat.length < PATTERN_THRESHOLD) return null;

  const seed = tokenSet(current.trigger);
  const cluster = sameCat.filter(
    (t) => t.sprintId === current.sprintId || jaccard(seed, tokenSet(t.trigger)) >= TRIGGER_SIM_THRESHOLD,
  );
  if (cluster.length < PATTERN_THRESHOLD) return null;

  const ids = Array.from(new Set(cluster.map((t) => t.sprintId))).sort();
  if (patternAlreadyExists(ids)) return null;

  const autoFix = AUTO_FIXABLE_CATEGORIES.has(category);
  const patternId = nextPatternId();
  const check = autoFix
    ? `Auto-fix sprints prone to ${category} aborts (${SUGGESTED_FIX_BY_CATEGORY[category] || 'auto'}) before firing.`
    : `Flag sprints prone to ${category} aborts as Tier 3 / escalate; not auto-fixable.`;

  const lines = [
    `pattern_id: ${patternId}`,
    `trigger_condition: ${yamlScalar(`sprint likely to abort with category ${category} (cluster of ${ids.length})`)}`,
    `source_tickets: ${yamlList(ids)}`,
    'description: >',
    `  Auto-generated by Gate 3 from ${ids.length} abort tickets sharing category "${category}"`,
    '  with similar abort triggers. Review and refine generated_check as needed.',
    `generated_check: ${yamlScalar(check)}`,
    `auto_fix: ${autoFix}`,
    `date_created: ${isoDate(new Date())}`,
    'effectiveness_score: null',
    '',
  ];

  if (!fs.existsSync(PATTERNS_DIR)) fs.mkdirSync(PATTERNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PATTERNS_DIR, `${patternId}.yaml`), lines.join('\n'), 'utf-8');
  logPatternToBrain(patternId, category, ids);
  return patternId;
}

/** If a re-queue for this parent already exists in pending\, return its id (idempotency guard). */
function existingRequeueFor(parentSprintId: string): string | null {
  if (!fs.existsSync(PENDING_DIR)) return null;
  for (const f of fs.readdirSync(PENDING_DIR)) {
    if (!f.endsWith('.md')) continue;
    try {
      const { fm } = parseFrontmatter(fs.readFileSync(path.join(PENDING_DIR, f), 'utf-8'));
      if ((fm.parent_sprint || '') === parentSprintId) return fm.sprint_id || f.replace(/\.md$/, '');
    } catch {
      /* skip */
    }
  }
  return null;
}

interface FixResult {
  strategy: string | null;
  body: string | null;
  note: string;
}

/** Best-effort brain.db context pull for missing_context injection. */
function recallContextForInjection(sprintText: string): string {
  const query = buildBrainFtsQuery(sprintText.slice(0, 240));
  if (!query) return '';
  let db: BrainDBLike | null = null;
  try {
    const Database = _require('better-sqlite3') as new (p: string, o?: object) => BrainDBLike;
    db = new Database(BRAIN_DB_PATH, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT o.content AS content
         FROM observations o
         JOIN observations_fts fts ON o.rowid = fts.rowid
         WHERE o.tenant_id = ? AND o.status = 'active' AND observations_fts MATCH ?
         ORDER BY fts.rank LIMIT 3`,
      )
      .all(BRAIN_TENANT, query) as { content: string }[];
    return rows.map((r) => `- ${(r.content || '').slice(0, 200).replace(/\s+/g, ' ').trim()}`).join('\n');
  } catch {
    return '';
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Compute the corrected sprint body for an auto-fixable category. body=null means unfixable. */
function computeFix(category: string, originalBody: string): FixResult {
  if (category === 'missing_file') {
    let body = originalBody;
    const corrections: string[] = [];
    for (const p of extractWindowsPaths(originalBody)) {
      if (fs.existsSync(p)) continue;
      const candidates = findFileByName(path.basename(p));
      if (candidates.length === 1) {
        body = body.split(p).join(candidates[0]);
        corrections.push(`${p} -> ${candidates[0]}`);
      }
    }
    if (!corrections.length) return { strategy: null, body: null, note: 'no uniquely-resolvable missing file found' };
    return { strategy: `path_correction: ${corrections.join('; ')}`, body, note: corrections.join('; ') };
  }

  if (category === 'missing_dependency') {
    const inject = [
      '',
      '## AUTO-FIX (dep_install)',
      'A required dependency was missing on the prior run. Before the failing task, install',
      'dependencies for the target project (Node: `npm install --include=dev`; Python:',
      '`pip install --break-system-packages <pkg>`) and re-verify availability.',
      '',
    ].join('\n');
    return { strategy: 'dep_install: install step injected', body: `${originalBody.trimEnd()}\n${inject}`, note: 'install step injected' };
  }

  if (category === 'missing_context') {
    const ctx = recallContextForInjection(originalBody);
    const inject = ['', '## AUTO-FIX (context_injection)', ctx || 'No brain.db context found; review manually.', ''].join('\n');
    return { strategy: 'context_injection: brain.db context injected', body: `${originalBody.trimEnd()}\n${inject}`, note: 'context injected' };
  }

  if (category === 'environment_error') {
    const inject = [
      '',
      '## AUTO-FIX (branch_correction)',
      'Prior run hit an environment/branch error. Verify the correct git branch is checked out',
      'and the working tree is clean before executing.',
      '',
    ].join('\n');
    return { strategy: 'branch_correction: branch verification injected', body: `${originalBody.trimEnd()}\n${inject}`, note: 'branch verification injected' };
  }

  if (category === 'scope_ambiguity') {
    const inject = [
      '',
      '## AUTO-FIX (scope_decomposition)',
      'Prior run exceeded single-session scope. Execute one TASK block per session; commit and',
      're-queue the remainder as a child sprint.',
      '',
    ].join('\n');
    return { strategy: 'scope_decomposition: decomposition guidance injected', body: `${originalBody.trimEnd()}\n${inject}`, note: 'decomposition guidance injected' };
  }

  return { strategy: null, body: null, note: 'category not auto-fixable' };
}

/** Write a corrected sprint into pending\ with incremented retry_count + parent reference. Returns new id. */
function requeueFixedSprint(parentSprintId: string, fixedBody: string): string {
  const originalPath = path.join(PENDING_DIR, `${parentSprintId}.md`);
  let project = 'unknown';
  let title = parentSprintId;
  let priority = 'P1';
  let source = 'manual';
  let model = 'sonnet';
  let tier = 2;
  let confidence = 0.5;
  let retryCount = 0;
  let maxRetries = MAX_RETRIES;
  let dependencies: string[] = [];
  let tags: string[] = [];

  if (fs.existsSync(originalPath)) {
    const { fm } = parseFrontmatter(fs.readFileSync(originalPath, 'utf-8'));
    project = fm.project || project;
    title = fm.title || title;
    priority = fm.priority || priority;
    source = fm.source || source;
    model = fm.model_preference || model;
    tier = Number(fm.tier) || tier;
    confidence = Number(fm.confidence) || confidence;
    retryCount = Number(fm.retry_count) || 0;
    maxRetries = Number(fm.max_retries) || MAX_RETRIES;
    dependencies = parseFlowList(fm.dependencies || '[]');
    tags = parseFlowList(fm.tags || '[]');
  }

  const now = new Date();
  if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
  const newId = nextSprintId(todayStamp(now));

  const frontmatter = buildFrontmatter({
    sprint_id: newId,
    project,
    title,
    tier,
    confidence,
    priority,
    status: 'pending',
    queued_at: now.toISOString(),
    started_at: null,
    completed_at: null,
    source,
    dependencies,
    model_preference: model,
    retry_count: retryCount + 1,
    max_retries: maxRetries,
    parent_sprint: parentSprintId,
    tags,
  });

  fs.writeFileSync(path.join(PENDING_DIR, `${newId}.md`), `${frontmatter}\n\n${fixedBody.trim()}\n`, 'utf-8');
  return newId;
}

/** Add `analyzed: true` to an abort ticket's frontmatter (idempotent). */
function markTicketAnalyzed(ticketPath: string): void {
  try {
    const content = fs.readFileSync(ticketPath, 'utf-8').replace(/\r\n/g, '\n');
    if (/^analyzed:\s*true\s*$/m.test(content)) return;
    if (!content.startsWith('---')) return;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return;
    const updated = `${content.slice(0, end)}\nanalyzed: true${content.slice(end)}`;
    fs.writeFileSync(ticketPath, updated, 'utf-8');
  } catch {
    /* best-effort */
  }
}

/** Core analysis for one abort ticket: classify, (maybe) generate a pattern, (maybe) auto-fix + re-queue. */
function analyzeTicketCore(sprintId: string): Record<string, unknown> {
  const ticketPath = path.join(ABORTED_DIR, `${sprintId}.md`);
  if (!fs.existsSync(ticketPath)) return { error: `Abort ticket not found: ${ticketPath}` };

  const { fm, body } = parseFrontmatter(fs.readFileSync(ticketPath, 'utf-8'));
  const category = fm.abort_reason_category || 'unknown';
  const retryCount = Number(fm.retry_count) || 0;
  const ticketBlocks = fm.auto_fixable === 'false' || fm.suggested_fix_category === 'none';
  const categoryFixable = AUTO_FIXABLE_CATEGORIES.has(category);
  const autoFixable = categoryFixable && !ticketBlocks;

  // Pattern learning (runs regardless of fixability; dedup-guarded).
  const allTickets = readAbortTickets();
  const current: AbortTicket = { sprintId, fm, body, trigger: extractTicketSection(body, 'What Triggered the Abort') };
  const newPattern = maybeGeneratePattern(category, current, allTickets);
  const patternGenerated = !!newPattern;

  const base = {
    sprint_id: sprintId,
    abort_reason_category: category,
    pattern_generated: patternGenerated,
    ...(newPattern ? { pattern_id: newPattern } : {}),
  };

  // Escalate: not auto-fixable, or retry cap reached.
  if (!autoFixable || retryCount >= MAX_RETRIES) {
    const reason = !categoryFixable
      ? `category '${category}' is not auto-fixable`
      : ticketBlocks
        ? "ticket marked auto_fixable:false / suggested_fix_category:none"
        : `retry cap reached (${retryCount}/${MAX_RETRIES})`;
    return { ...base, auto_fixable: autoFixable, fix_strategy: null, fix_applied: false, requeued_sprint_id: null, escalated: true, escalation_reason: reason };
  }

  // Idempotency: never double-requeue the same parent.
  const already = existingRequeueFor(sprintId);
  if (already) {
    return { ...base, auto_fixable: true, fix_strategy: 'already_requeued', fix_applied: false, requeued_sprint_id: already, escalated: false };
  }

  const originalPath = path.join(PENDING_DIR, `${sprintId}.md`);
  const originalBody = fs.existsSync(originalPath) ? parseFrontmatter(fs.readFileSync(originalPath, 'utf-8')).body : body;
  const fix = computeFix(category, originalBody);
  if (!fix.body) {
    return { ...base, auto_fixable: true, fix_strategy: null, fix_applied: false, requeued_sprint_id: null, escalated: true, escalation_reason: fix.note };
  }

  const requeuedId = requeueFixedSprint(sprintId, fix.body);
  return { ...base, auto_fixable: true, fix_strategy: fix.strategy, fix_applied: true, requeued_sprint_id: requeuedId, escalated: false };
}

// ==========================================================================
// TOOL DEFINITIONS (4 tools)
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
  {
    name: 'analyze_ticket',
    description:
      'Analyze one AUTONOMIC abort ticket (aborted\\{sprint_id}.md) and drive the Gate 3 self-healing ' +
      'loop. Classifies by abort_reason_category, honoring an explicit auto_fixable:false / ' +
      'suggested_fix_category:none in the ticket (the aborting agent\'s assessment) over the category ' +
      'default. Auto-fixable categories (missing_file, missing_dependency, missing_context, ' +
      'scope_ambiguity, environment_error) within the retry cap are fixed and re-queued directly to ' +
      'pending\\ with parent_sprint set and retry_count incremented; non-fixable tickets or those at ' +
      'the retry cap (2) escalate. Also runs pattern learning: a cluster of 3+ same-category aborts ' +
      'with similar triggers generates a PAT-NNN.yaml and logs it to brain.db. Returns { sprint_id, ' +
      'abort_reason_category, auto_fixable, fix_strategy, fix_applied, requeued_sprint_id, ' +
      'pattern_generated, escalated }.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_id: { type: 'string', description: 'The aborted sprint_id to analyze (reads aborted\\{sprint_id}.md)' },
      },
      required: ['sprint_id'],
    },
  },
  {
    name: 'analyze_all_tickets',
    description:
      'Batch-run the ticket analyzer over every unprocessed abort ticket in aborted\\ (those without ' +
      'analyzed:true in frontmatter). Each ticket is classified, auto-fixed + re-queued where eligible, ' +
      'and contributes to pattern learning. Processed tickets are marked analyzed:true to avoid ' +
      're-processing. Pass dry_run:true to classify only (no fixes, re-queues, patterns, or marking). ' +
      'Returns { analyzed, auto_fixed, requeued, escalated, patterns_generated, results }.',
    inputSchema: {
      type: 'object',
      properties: {
        dry_run: { type: 'boolean', description: 'Classify only — no writes (default false)' },
      },
    },
  },
  {
    name: 'validate_sprint',
    description:
      'Post-sprint validation gate: run AFTER a sprint completes, BEFORE commit. Reads the pre-flight ' +
      'baseline (active\\{sprint_id}_baseline.json), re-scans the same source files with eos_quick_scan ' +
      'to compute a quality delta, runs the Yuma health gates (tsc --noEmit, lint, tests) on the target ' +
      'project, and optionally runs a WHETSTONE adversarial challenge on the changed files (skipped ' +
      'gracefully if unavailable). Produces a commit recommendation: "commit" (Yuma passes + EoS stable ' +
      'or improved), "commit_with_warnings" (Yuma passes but EoS dropped <5 pts, or EoS could not be ' +
      'assessed), or "reject" (any Yuma gate fails, or EoS dropped >5 pts). Missing baselines, ' +
      'unresolved project dirs, and absent WHETSTONE are all handled gracefully and reported in ' +
      'warnings. Returns { sprint_id, passed, eos_delta, yuma_result, whetstone_result, recommendation, ... }.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_id: { type: 'string', description: 'The completed sprint_id to validate (reads its baseline from active\\)' },
        project: { type: 'string', description: 'Optional project name (informational, echoed back)' },
        project_dir: {
          type: 'string',
          description:
            'Optional explicit project directory. Use for spaced-path projects (e.g. KERNL at ' +
            '"D:\\Projects\\Project Mind\\kernl-mcp") whose paths the baseline could not auto-resolve.',
        },
        run_whetstone: { type: 'boolean', description: 'Run the optional WHETSTONE challenge (default true; skipped gracefully if unavailable)' },
      },
      required: ['sprint_id'],
    },
  },
  {
    name: 'inject_sprint_context',
    description:
      'Retrieve relevant brain memory observations for a sprint and return a formatted context block ' +
      'to prepend before execution. Reduces dependency-missing aborts by surfacing prior knowledge ' +
      'about the sprint\'s project, entity, and domain. Call before executing any sprint.',
    inputSchema: {
      type: 'object',
      properties: {
        sprint_text: { type: 'string', description: 'The full sprint body text (YAML frontmatter + task body)' },
        sprint_id: { type: 'string', description: 'Optional sprint ID (for logging/context)' },
        limit: { type: 'number', description: 'Max observations to retrieve (default 6)' },
      },
      required: ['sprint_text'],
    },
  },
];

// ==========================================================================
// PRE-FLIGHT BASELINE (Gate 1: EoS quality + tsc/lint health + AEGIS resources)
// ==========================================================================
// Budget-capped, best-effort snapshot captured during preflight_check. Pre-flight
// establishes a FAST baseline for post-sprint delta, not a comprehensive health
// report — a 15s wall clock protects pipeline throughput. Order (per design):
// AEGIS (~1s independent) -> EoS (referenced files) -> tsc --noEmit -> lint.
// Whatever the clock allows is captured; the rest is recorded as skipped (honest
// partial baseline). No check ever blocks the sprint.

const PREFLIGHT_BUDGET_MS = 15_000;
const AEGIS_URL = 'http://localhost:7474/sprint-metrics';
const AEGIS_TIMEOUT_MS = 1_000;
const AEGIS_CPU_WARN = 90;
const AEGIS_MEM_WARN = 85;
const BASELINE_MIN_SLICE_MS = 1_500; // don't start a check with less than this left
const BASELINE_CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);

interface BaselineCheck {
  ran: boolean;
  skipped_reason?: string;
}
interface EosBaseline extends BaselineCheck {
  average?: number;
  files_scanned?: number;
  findings_count?: number;
  scores?: Record<string, number>;
}
interface HealthBaseline extends BaselineCheck {
  status?: 'clean' | 'errors' | 'unknown';
  error_count?: number;
  command?: string;
  timed_out?: boolean;
}
interface AegisBaseline extends BaselineCheck {
  available: boolean;
  cpu?: number | null;
  memory?: number | null;
  warning?: string;
  raw?: unknown;
}
interface PreflightBaseline {
  sprint_id: string;
  captured_at: string;
  budget_ms: number;
  elapsed_ms: number;
  project_dir: string | null;
  eos: EosBaseline;
  tsc: HealthBaseline;
  lint: HealthBaseline;
  aegis: AegisBaseline;
}

/** Walk up from startDir to find the nearest ancestor containing `filename`. */
function findUp(startDir: string, filename: string): string | null {
  let cur = startDir;
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(cur, filename))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Best-effort AEGIS resource snapshot. Never throws; resolves available:false on
 * any failure (offline, timeout, unparseable). Parses cpu/memory under several
 * common field names and flags a warning above the configured thresholds.
 */
function fetchAegisMetrics(timeoutMs: number): Promise<AegisBaseline> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: AegisBaseline) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const req = http.get(AEGIS_URL, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data) as Record<string, unknown>;
            const num = (...keys: string[]): number | null => {
              for (const k of keys) {
                const v = j[k];
                if (typeof v === 'number') return v;
              }
              return null;
            };
            const cpu = num('cpu', 'cpu_percent', 'cpuPercent', 'cpu_usage', 'cpuUsage');
            const memory = num('memory', 'memory_percent', 'memoryPercent', 'mem', 'mem_percent', 'memUsage');
            let warning: string | undefined;
            if ((cpu !== null && cpu > AEGIS_CPU_WARN) || (memory !== null && memory > AEGIS_MEM_WARN)) {
              warning = `AEGIS high resource usage: cpu=${cpu ?? 'n/a'}%, memory=${memory ?? 'n/a'}%`;
            }
            done({ ran: true, available: true, cpu, memory, ...(warning ? { warning } : {}), raw: j });
          } catch {
            done({ ran: true, available: false, skipped_reason: 'unparseable AEGIS response' });
          }
        });
      });
      req.on('error', () => done({ ran: true, available: false, skipped_reason: 'AEGIS endpoint unavailable' }));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        done({ ran: true, available: false, skipped_reason: 'AEGIS request timed out' });
      });
    } catch (e) {
      done({ ran: true, available: false, skipped_reason: `AEGIS request error: ${(e as Error).message}` });
    }
  });
}

/** Run a health command (tsc/lint) synchronously, counting `error TS####` lines. */
function runHealthCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): HealthBaseline {
  const command = `${cmd} ${args.join(' ')}`;
  const res = spawnSync(cmd, args, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      return { ran: true, status: 'unknown', command, timed_out: true, skipped_reason: `timed out after ${timeoutMs}ms` };
    }
    return { ran: true, status: 'unknown', command, skipped_reason: res.error.message };
  }
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const errorCount = (out.match(/error TS\d+/g) || []).length;
  const status: 'clean' | 'errors' = res.status === 0 && errorCount === 0 ? 'clean' : 'errors';
  return { ran: true, status, error_count: errorCount, command };
}

/**
 * Capture the budget-capped pre-flight baseline. `startedAt` is the preflight
 * handler's start time so the whole check (incl. earlier path/git/pattern work)
 * stays within PREFLIGHT_BUDGET_MS.
 */
async function capturePreflightBaseline(sprintId: string, body: string, startedAt: number): Promise<PreflightBaseline> {
  const remaining = () => PREFLIGHT_BUDGET_MS - (Date.now() - startedAt);

  // Referenced existing source files (EoS input).
  const codeFiles = extractWindowsPaths(body).filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile() && BASELINE_CODE_EXTS.has(path.extname(p).toLowerCase());
    } catch {
      return false;
    }
  });

  // Target project dir = nearest ancestor of the first code file holding package.json.
  const anchorDir = codeFiles.length ? path.dirname(path.resolve(codeFiles[0])) : null;
  const projectDir = anchorDir ? findUp(anchorDir, 'package.json') : null;

  // --- AEGIS resource snapshot (independent, ~1s, never blocks) ---
  let aegis: AegisBaseline;
  try {
    aegis = await fetchAegisMetrics(Math.min(AEGIS_TIMEOUT_MS, Math.max(200, remaining())));
  } catch (e) {
    aegis = { ran: true, available: false, skipped_reason: `AEGIS error: ${(e as Error).message}` };
  }

  // --- EoS quality scan on referenced files (first, fast) ---
  let eos: EosBaseline;
  if (!codeFiles.length) {
    eos = { ran: false, skipped_reason: 'no referenced source files in sprint body' };
  } else if (remaining() < BASELINE_MIN_SLICE_MS) {
    eos = { ran: false, skipped_reason: `budget exhausted before EoS (${remaining()}ms left)` };
  } else {
    try {
      const r = (await createEosHandlers().eos_quick_scan({ files: codeFiles })) as {
        average?: number;
        scores?: Record<string, number>;
        findings?: unknown[];
      };
      const scores = r.scores || {};
      eos = {
        ran: true,
        average: r.average ?? 0,
        files_scanned: Object.keys(scores).length,
        findings_count: Array.isArray(r.findings) ? r.findings.length : 0,
        scores,
      };
    } catch (e) {
      eos = { ran: false, skipped_reason: `EoS error: ${(e as Error).message}` };
    }
  }

  // --- tsc --noEmit health (if a TS project + budget remains) ---
  let tsc: HealthBaseline;
  if (!projectDir) {
    tsc = { ran: false, skipped_reason: 'no package.json found for target project' };
  } else if (!fs.existsSync(path.join(projectDir, 'tsconfig.json'))) {
    tsc = { ran: false, skipped_reason: 'no tsconfig.json in target project' };
  } else if (remaining() < BASELINE_MIN_SLICE_MS) {
    tsc = { ran: false, skipped_reason: `budget exhausted before tsc (${remaining()}ms left)` };
  } else {
    tsc = runHealthCommand('npx', ['tsc', '--noEmit'], projectDir, Math.max(1000, remaining() - 500));
  }

  // --- lint health (only if a DISTINCT lint script + budget remains) ---
  let lint: HealthBaseline;
  let lintScript = '';
  if (projectDir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      lintScript = (pkg.scripts || {}).lint || '';
    } catch {
      /* ignore unreadable package.json */
    }
  }
  if (!projectDir || !lintScript) {
    lint = { ran: false, skipped_reason: 'no lint script in target project' };
  } else if (lintScript.trim() === 'tsc --noEmit' && tsc.ran) {
    lint = { ran: false, skipped_reason: 'lint duplicates tsc --noEmit (already captured)' };
  } else if (remaining() < BASELINE_MIN_SLICE_MS) {
    lint = { ran: false, skipped_reason: `budget exhausted before lint (${remaining()}ms left)` };
  } else {
    lint = runHealthCommand('npm', ['run', 'lint'], projectDir, Math.max(1000, remaining() - 300));
  }

  return {
    sprint_id: sprintId,
    captured_at: new Date().toISOString(),
    budget_ms: PREFLIGHT_BUDGET_MS,
    elapsed_ms: Date.now() - startedAt,
    project_dir: projectDir,
    eos,
    tsc,
    lint,
    aegis,
  };
}

// ==========================================================================
// POST-SPRINT VALIDATION (validate_sprint: EoS delta + Yuma gates + WHETSTONE)
// ==========================================================================
// Runs AFTER a sprint completes, BEFORE commit. Unlike the pre-flight baseline
// (budget-capped for throughput), validation is allowed generous per-command
// timeouts — correctness of the commit gate matters more than its latency.
//
// Yuma note: the AUTONOMIC architecture names "Yuma five_gate_check" for the
// tsc/lint/test health gate, but KERNL's actual `five_gate_check` tool is a
// code-SEARCH discovery tool (git/code/ui/backlog/patterns match counts), not a
// health runner — confirmed and resolved during AUT-20260604-006 (David, Option
// 1: Yuma health = tsc --noEmit + lint + tests). validate_sprint therefore runs
// the real gates via runHealthCommand, reusing the exact pre-flight tsc/lint
// logic and adding a tests gate, rather than calling the discovery tool.

const VALIDATE_TSC_TIMEOUT_MS = 90_000;
const VALIDATE_LINT_TIMEOUT_MS = 90_000;
const VALIDATE_TEST_TIMEOUT_MS = 180_000;
const EOS_DROP_REJECT_THRESHOLD = 5; // average points: a drop strictly greater than this rejects
const NPM_TEST_PLACEHOLDER = 'no test specified'; // npm's default scripts.test stub

interface YumaGate {
  ran: boolean;
  pass: boolean;
  reason?: string;
  error_count?: number;
  command?: string;
}
interface YumaResult {
  tsc: boolean;
  lint: boolean;
  tests: boolean;
  overall: boolean;
}

/** Read scripts.{key} from a project's package.json, '' if absent/unreadable. */
function readPkgScript(projectDir: string, key: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    return (pkg.scripts || {})[key] || '';
  } catch {
    return '';
  }
}

/**
 * Run the Yuma health gates (tsc --noEmit, lint, tests) on a resolved project
 * directory. A gate that is legitimately not applicable (no tsconfig, no lint
 * script, no/placeholder test script) is recorded as ran:false, pass:true — the
 * absence of a gate is not a failure. If the project directory could not be
 * resolved at all, every gate is ran:false, pass:false (inconclusive — the gate
 * could not validate anything, so it must not green-light a commit).
 */
function runYuma(projectDir: string | null): { result: YumaResult; detail: { tsc: YumaGate; lint: YumaGate; tests: YumaGate } } {
  if (!projectDir) {
    const inconclusive: YumaGate = { ran: false, pass: false, reason: 'project directory could not be resolved' };
    return {
      result: { tsc: false, lint: false, tests: false, overall: false },
      detail: { tsc: { ...inconclusive }, lint: { ...inconclusive }, tests: { ...inconclusive } },
    };
  }

  const na = (reason: string): YumaGate => ({ ran: false, pass: true, reason });
  const fromHealth = (h: HealthBaseline): YumaGate => ({
    ran: true,
    pass: h.status === 'clean',
    ...(h.timed_out ? { reason: 'timed out' } : h.status === 'unknown' ? { reason: h.skipped_reason } : {}),
    ...(typeof h.error_count === 'number' ? { error_count: h.error_count } : {}),
    ...(h.command ? { command: h.command } : {}),
  });

  // tsc --noEmit (only if a tsconfig.json exists)
  const tsc: YumaGate = !fs.existsSync(path.join(projectDir, 'tsconfig.json'))
    ? na('no tsconfig.json (non-TS project)')
    : fromHealth(runHealthCommand('npx', ['tsc', '--noEmit'], projectDir, VALIDATE_TSC_TIMEOUT_MS));

  // lint (only if a distinct lint script exists; dedupe when it mirrors tsc)
  const lintScript = readPkgScript(projectDir, 'lint');
  let lint: YumaGate;
  if (!lintScript) lint = na('no lint script');
  else if (lintScript.trim() === 'tsc --noEmit') lint = { ran: false, pass: tsc.pass, reason: 'duplicates tsc --noEmit' };
  else lint = fromHealth(runHealthCommand('npm', ['run', 'lint'], projectDir, VALIDATE_LINT_TIMEOUT_MS));

  // tests (only if a real test script exists — skip npm's default placeholder)
  const testScript = readPkgScript(projectDir, 'test');
  const tests: YumaGate =
    !testScript || testScript.includes(NPM_TEST_PLACEHOLDER)
      ? na('no test script')
      : fromHealth(runHealthCommand('npm', ['test'], projectDir, VALIDATE_TEST_TIMEOUT_MS));

  const overall = tsc.pass && lint.pass && tests.pass;
  return { result: { tsc: tsc.pass, lint: lint.pass, tests: tests.pass, overall }, detail: { tsc, lint, tests } };
}

/**
 * Best-effort WHETSTONE adversarial challenge on changed files. WHETSTONE is
 * optional (per sprint CRITICAL CONSTRAINTS — "skip gracefully if unavailable")
 * and is not part of this KERNL source tree's build, so this probes for a
 * forward-compatible handler module via a runtime-computed specifier (kept
 * non-literal so tsc does not attempt to resolve it). Returns null whenever
 * WHETSTONE cannot be invoked — never throws.
 */
async function tryWhetstone(files: string[], run: boolean): Promise<{ challenged: boolean; findings: string[] } | null> {
  if (!run || !files.length) return null;
  try {
    const spec = ['..', 'tools', 'whetstone-tools.js'].join('/'); // non-literal: tsc skips resolution
    const mod = (await import(spec)) as {
      createWhetstoneHandlers?: () => Record<string, (input: Record<string, unknown>) => Promise<unknown>>;
    };
    const handler = mod.createWhetstoneHandlers?.().whetstone_challenge;
    if (typeof handler !== 'function') return null;
    const res = (await handler({ files })) as { findings?: unknown };
    const findings = Array.isArray(res?.findings) ? (res.findings as unknown[]).map((f) => String(f)) : [];
    return { challenged: true, findings };
  } catch {
    return null;
  }
}

/** Locate a sprint's body markdown across the queue dirs (completed -> active -> pending). */
function locateSprintBody(sprintId: string): string | null {
  for (const dir of [COMPLETED_DIR, ACTIVE_DIR, PENDING_DIR]) {
    const p = path.join(dir, `${sprintId}.md`);
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
    } catch {
      /* unreadable — try next */
    }
  }
  return null;
}

/**
 * Resolve the target project directory for validation, in priority order:
 *   1. explicit input.project_dir (lets spaced-path projects like KERNL validate)
 *   2. baseline.project_dir (captured at pre-flight)
 *   3. nearest package.json above a real path referenced in the sprint body
 *   4. nearest package.json above a baseline-scored source file
 * Returns null when none resolve (validation is then honestly inconclusive).
 */
function resolveValidationProjectDir(opts: {
  explicit?: string;
  baselineDir?: string | null;
  body?: string | null;
  scoreFiles: string[];
}): string | null {
  const { explicit, baselineDir, body, scoreFiles } = opts;
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (baselineDir && fs.existsSync(baselineDir)) return baselineDir;
  if (body) {
    const files = extractWindowsPaths(body).filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (files.length) {
      const d = findUp(path.dirname(path.resolve(files[0])), 'package.json');
      if (d) return d;
    }
  }
  for (const f of scoreFiles) {
    try {
      if (fs.existsSync(f)) {
        const d = findUp(path.dirname(path.resolve(f)), 'package.json');
        if (d) return d;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

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

      const preflightStart = Date.now();
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

      // 4b. Tool reference validation — warn if sprint references tools not in KNOWN_TOOLS
      const referencedTools = extractToolReferences(body);
      for (const tool of referencedTools) {
        if (!KNOWN_TOOLS.has(tool)) {
          warnings.push(`Referenced tool '${tool}' not in known KERNL tool registry`);
        }
      }
      if (referencedTools.length) {
        const known = referencedTools.filter((t) => KNOWN_TOOLS.has(t));
        const unknown = referencedTools.filter((t) => !KNOWN_TOOLS.has(t));
        if (unknown.length) {
          warnings.push(`Tool references: ${known.length} known, ${unknown.length} unknown [${unknown.join(', ')}]`);
        }
      }

      // 5. Pre-flight baseline: EoS quality + tsc/lint health + AEGIS resources
      //    (budget-capped, best-effort, non-blocking). Persisted for post-sprint delta.
      const baseline = await capturePreflightBaseline(sprintId, body, preflightStart);
      const baselineFile = path.join(ACTIVE_DIR, `${sprintId}_baseline.json`);
      try {
        if (!fs.existsSync(ACTIVE_DIR)) fs.mkdirSync(ACTIVE_DIR, { recursive: true });
        fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2), 'utf-8');
      } catch (e) {
        warnings.push(`Could not persist baseline JSON: ${(e as Error).message}`);
      }
      // AEGIS high-usage is a warning, never a blocker (per spec).
      if (baseline.aegis.warning) warnings.push(baseline.aegis.warning);

      return {
        sprint_id: sprintId,
        pass: blockers.length === 0,
        blockers,
        warnings,
        auto_fixed: autoFixed,
        baseline,
        baseline_file: baselineFile,
      };
    },

    analyze_ticket: async (input) => {
      const sprintId = input.sprint_id as string;
      if (!sprintId) return { error: 'analyze_ticket requires sprint_id' };
      return analyzeTicketCore(sprintId);
    },

    analyze_all_tickets: async (input) => {
      const dryRun = input.dry_run === true;
      if (!fs.existsSync(ABORTED_DIR)) {
        return { analyzed: 0, auto_fixed: 0, requeued: 0, escalated: 0, patterns_generated: 0, results: [] };
      }

      const files = fs.readdirSync(ABORTED_DIR).filter((f) => f.endsWith('.md'));
      let analyzed = 0;
      let autoFixed = 0;
      let requeued = 0;
      let escalated = 0;
      let patternsGenerated = 0;
      const results: unknown[] = [];

      for (const f of files) {
        const ticketPath = path.join(ABORTED_DIR, f);
        let fm: Record<string, string>;
        try {
          fm = parseFrontmatter(fs.readFileSync(ticketPath, 'utf-8')).fm;
        } catch {
          continue;
        }
        if (fm.analyzed === 'true') continue; // already processed
        const sprintId = fm.sprint_id || f.replace(/\.md$/, '');

        if (dryRun) {
          const category = fm.abort_reason_category || 'unknown';
          const ticketBlocks = fm.auto_fixable === 'false' || fm.suggested_fix_category === 'none';
          const wouldFix =
            AUTO_FIXABLE_CATEGORIES.has(category) && !ticketBlocks && (Number(fm.retry_count) || 0) < MAX_RETRIES;
          analyzed++;
          if (wouldFix) autoFixed++;
          else escalated++;
          results.push({ sprint_id: sprintId, abort_reason_category: category, would_auto_fix: wouldFix });
          continue;
        }

        const res = analyzeTicketCore(sprintId) as Record<string, unknown>;
        analyzed++;
        if (res.pattern_generated) patternsGenerated++;
        if (res.fix_applied && res.requeued_sprint_id) {
          autoFixed++;
          requeued++;
        } else {
          escalated++;
        }
        results.push(res);
        markTicketAnalyzed(ticketPath);
      }

      return { analyzed, auto_fixed: autoFixed, requeued, escalated, patterns_generated: patternsGenerated, results };
    },

    validate_sprint: async (input) => {
      const sprintId = input.sprint_id as string;
      if (!sprintId) return { error: 'validate_sprint requires sprint_id' };

      const project = (input.project as string) || '';
      const explicitDir = (input.project_dir as string) || '';
      const runWhetstone = input.run_whetstone !== false; // default true
      const warnings: string[] = [];

      // 1. Load the pre-flight baseline (best-effort; absence is non-fatal).
      const baselineFile = path.join(ACTIVE_DIR, `${sprintId}_baseline.json`);
      let baseline: PreflightBaseline | null = null;
      if (fs.existsSync(baselineFile)) {
        try {
          baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8')) as PreflightBaseline;
        } catch (e) {
          warnings.push(`Baseline present but unreadable: ${(e as Error).message}`);
        }
      } else {
        warnings.push(`No baseline at ${baselineFile} — EoS delta cannot be computed`);
      }

      const beforeScores: Record<string, number> = baseline?.eos?.scores || {};
      const filesToScan = Object.keys(beforeScores);

      // 2. Resolve the target project directory (explicit > baseline > body > scored files).
      const body = locateSprintBody(sprintId);
      const projectDir = resolveValidationProjectDir({
        explicit: explicitDir || undefined,
        baselineDir: baseline?.project_dir ?? null,
        body,
        scoreFiles: filesToScan,
      });
      if (!projectDir) warnings.push('Could not resolve target project directory — Yuma gates inconclusive');

      // 3. EoS after-scan on the SAME files the baseline scored, then compute delta.
      let eosAfter: Record<string, number> = {};
      let filesDegraded: string[] = [];
      let eosDrop = 0;
      let eosAssessed = false;
      if (filesToScan.length) {
        try {
          const r = (await createEosHandlers().eos_quick_scan({
            files: filesToScan,
            ...(project ? { project } : {}),
          })) as { scores?: Record<string, number>; errors?: string[] };
          eosAfter = r.scores || {};
          if (Array.isArray(r.errors) && r.errors.length) warnings.push(`EoS after-scan reported ${r.errors.length} error(s)`);
          const common = filesToScan.filter((f) => f in eosAfter);
          filesDegraded = common.filter((f) => eosAfter[f] < beforeScores[f]);
          if (common.length) {
            const beforeAvg = common.reduce((a, f) => a + beforeScores[f], 0) / common.length;
            const afterAvg = common.reduce((a, f) => a + eosAfter[f], 0) / common.length;
            eosDrop = Math.round((beforeAvg - afterAvg) * 100) / 100;
            eosAssessed = true;
          } else {
            warnings.push('No overlap between baseline and after-scan files — EoS delta not assessed');
          }
        } catch (e) {
          warnings.push(`EoS after-scan failed: ${(e as Error).message}`);
        }
      } else if (baseline) {
        warnings.push('Baseline recorded no EoS scores — EoS delta not assessed (likely spaced-path project)');
      }

      const eos_delta = { before: beforeScores, after: eosAfter, files_degraded: filesDegraded };

      // 4. Yuma health gates (tsc / lint / tests).
      const yuma = runYuma(projectDir);

      // 5. WHETSTONE adversarial challenge (optional, graceful).
      const whetstone_result = await tryWhetstone(filesToScan, runWhetstone);
      if (runWhetstone && whetstone_result === null) {
        warnings.push('WHETSTONE unavailable in this build — adversarial check skipped');
      } else if (whetstone_result && whetstone_result.findings.length) {
        warnings.push(`WHETSTONE returned ${whetstone_result.findings.length} finding(s)`);
      }

      // 6. Recommendation — strictly per sprint logic (Yuma + EoS delta only):
      //    reject  : any Yuma gate fails OR EoS dropped > 5 points
      //    commit  : Yuma passes AND EoS assessed stable-or-improved (drop <= 0)
      //    warnings: Yuma passes AND (EoS dropped <5 pts OR EoS not assessable)
      const yumaPass = yuma.result.overall;
      const eosDropMajor = eosAssessed && eosDrop > EOS_DROP_REJECT_THRESHOLD;
      const eosStableOrImproved = eosAssessed && eosDrop <= 0;
      let recommendation: 'commit' | 'commit_with_warnings' | 'reject';
      if (!yumaPass || eosDropMajor) recommendation = 'reject';
      else if (eosStableOrImproved) recommendation = 'commit';
      else recommendation = 'commit_with_warnings';
      const passed = recommendation !== 'reject';

      return {
        sprint_id: sprintId,
        passed,
        eos_delta,
        yuma_result: yuma.result,
        whetstone_result,
        recommendation,
        // ---- diagnostics (additive; not part of the core contract) ----
        eos_drop: eosAssessed ? eosDrop : null,
        eos_assessed: eosAssessed,
        yuma_detail: yuma.detail,
        project_dir: projectDir,
        baseline_found: baseline !== null,
        warnings,
        ...(project ? { project } : {}),
      };
    },

    inject_sprint_context: async (input) => {
      const sprintText = input.sprint_text as string;
      if (!sprintText) return { error: 'inject_sprint_context requires sprint_text', context_block: '' };

      const sprintId = (input.sprint_id as string) || '';
      const limit = typeof input.limit === 'number' ? input.limit : 6;

      // Extract project and title from YAML frontmatter or markdown heading
      const projectMatch = sprintText.match(/^project:\s*(.+)/m);
      const titleMatch = sprintText.match(/^title:\s*'?([^'\n]+)'?/m) || sprintText.match(/^#\s+(.+)/m);
      const project = projectMatch ? projectMatch[1].trim() : '';
      const title = titleMatch ? titleMatch[1].trim() : '';

      // Build query from sprint metadata — fall back to first 200 chars of body
      const queryParts = [title, project].filter(Boolean);
      const query = queryParts.length > 0 ? queryParts.join(' ') : sprintText.slice(0, 200);

      try {
        const brainHandlers = createBrainHandlers();
        const recalled = await brainHandlers.brain_recall({ query, limit }) as {
          results?: Array<{ content: string; entity_name: string | null; source: string; created_at: string }>;
        };

        const results = recalled.results ?? [];
        if (results.length === 0) {
          return { context_block: '', observations_count: 0, query, ...(sprintId ? { sprint_id: sprintId } : {}) };
        }

        const lines = results.map((r, i) => {
          const entity = r.entity_name ? ` [${r.entity_name}]` : '';
          const date = r.created_at ? ` (${r.created_at.slice(0, 10)})` : '';
          const snippet = r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content;
          return `${i + 1}.${entity}${date} ${snippet}`;
        });

        const contextBlock =
          `<!-- INJECTED BRAIN CONTEXT: ${results.length} observations for "${query}" -->\n` +
          lines.join('\n') +
          `\n<!-- END BRAIN CONTEXT -->`;

        return {
          context_block: contextBlock,
          observations_count: results.length,
          query,
          ...(sprintId ? { sprint_id: sprintId } : {}),
        };
      } catch (e) {
        return {
          context_block: '',
          observations_count: 0,
          query,
          error: `brain_recall failed: ${(e as Error).message}`,
        };
      }
    },
  };
}
