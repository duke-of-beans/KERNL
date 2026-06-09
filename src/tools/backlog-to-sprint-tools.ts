/**
 * KERNL MCP - Backlog-to-Sprint Pipeline Tools (AUTONOMIC Phase 6, B2S-001)
 *
 * Core backlog assessment functions: parse, categorize, score readiness.
 *
 *   parse_backlog(project_path)        -> BacklogItem[]   (markdown -> structured)
 *   categorize_item(item)              -> Categorization   (ORACLE-style routing)
 *   assess_readiness(item, context)    -> ReadinessScore   (5-axis CCS-adapted)
 *
 * Exposed as the KERNL tool `backlog_to_sprint`, which parses + categorizes +
 * scores (no sprint generation yet -- that is B2S-002).
 *
 * Net-new file. Does NOT touch the existing `backlog-tools.ts` (epic/task
 * management) or `autonomic-tools.ts` -- additive only.
 *
 * Spec: D:\Meta\BACKLOG_TO_SPRINT_SPEC.md
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ==========================================================================
// CONSTANTS
// ==========================================================================

const PRODUCT_GRAPH_PATH = 'D:\\Meta\\PRODUCT_GRAPH.yaml';
const QUEUE_COMPLETED_DIR = 'D:\\Dev\\SPRINT_QUEUE\\completed';

const BUG_KEYWORDS = ['fix', 'broken', 'error', 'crash', 'fail', 'wrong', 'issue', 'bug'];
const BUILD_KEYWORDS = ['build', 'create', 'implement', 'add'];
const INFRA_KEYWORDS = [
  'config', 'deploy', 'migrate', 'cleanup', 'archive', 'sync', 'update', 'wire', 'refactor',
];
const RESEARCH_KEYWORDS = ['investigate', 'audit', 'verify', 'assess', 'research', 'explore'];
const POLICY_KEYWORDS = ['decide', 'choose', 'strategy', 'approach', 'prefer'];
const DESTRUCTIVE_KEYWORDS = ['delete', 'drop', 'remove', 'overwrite', 'purge', 'wipe'];
const PRODUCTION_KEYWORDS = ['production', 'prod ', 'deploy', 'live', 'release'];
const REDESIGN_KEYWORDS = ['redesign', 'rewrite', 'overhaul', 'rearchitect', 're-architect'];
const AMBIGUITY_KEYWORDS = ['choose', 'decide', 'prefer', 'approach', 'strategy', 'option', 'tbd'];
const DEPENDENCY_KEYWORDS = ['after ', 'once ', 'depends on', 'blocked by', 'requires '];

// ==========================================================================
// TYPES
// ==========================================================================

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export type Category =
  | 'bug'
  | 'feature_with_spec'
  | 'feature_needs_spec'
  | 'infrastructure'
  | 'research'
  | 'policy';

export type AutomationPotential = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type Classification = 'ready' | 'borderline' | 'not_ready';

export interface BacklogItem {
  id: string;
  description: string;
  project: string;
  project_path: string;
  priority: Priority;
  tags: string[];
  created_at: string;
  raw_line: string;
}

export interface Categorization {
  category: Category;
  automation_potential: AutomationPotential;
  signals: string[];
}

export interface ReadinessAxis {
  score: number;
  factors: string[];
}

export interface ReadinessScore {
  composite: number;
  classification: Classification;
  axes: {
    scope_clarity: ReadinessAxis;
    dependency_resolution: ReadinessAxis;
    risk_profile: ReadinessAxis;
    context_completeness: ReadinessAxis;
    staleness: ReadinessAxis;
  };
}

export interface ProjectContext {
  project: string;
  project_path: string;
  in_product_graph: boolean;
  has_status_md: boolean;
  status_md_age_days: number | null;
  git_clean: boolean | null;
  constraints_documented: boolean;
}

const AXIS_WEIGHTS = {
  scope_clarity: 0.30,
  dependency_resolution: 0.25,
  risk_profile: 0.20,
  context_completeness: 0.15,
  staleness: 0.10,
} as const;

// ==========================================================================
// HELPERS
// ==========================================================================

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

/** Minimal dependency-free reader for PRODUCT_GRAPH.yaml `products:` block. */
export function readProductGraph(graphPath: string = PRODUCT_GRAPH_PATH): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(graphPath)) return out;
  const lines = fs.readFileSync(graphPath, 'utf8').split(/\r?\n/);
  let inProducts = false;
  let currentKey: string | null = null;
  for (const line of lines) {
    if (/^products:\s*$/.test(line)) { inProducts = true; continue; }
    if (!inProducts) continue;
    // A non-indented, non-empty, non-comment line ends the products block.
    if (/^[^\s#]/.test(line)) break;
    const keyMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (keyMatch) { currentKey = keyMatch[1]; continue; }
    const pathMatch = line.match(/^ {4}path:\s*(.+?)\s*$/);
    if (pathMatch && currentKey) {
      out[currentKey] = pathMatch[1].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return out;
}

function fileMtimeISO(p: string): string {
  try {
    return fs.statSync(p).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function ageInDays(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (Date.now() - then) / 86_400_000);
}

/** Extract candidate file paths / spec references from a description. */
function extractPaths(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_:./\\-]+\.[A-Za-z0-9]{1,6}/g) || [];
  return matches.filter((m) => /\.[A-Za-z]/.test(m));
}

function referencedSpec(text: string): string | null {
  const m = text.match(/[A-Za-z0-9_:./\\-]*(?:_SPEC\.md|SPEC\.ya?ml)/i);
  return m ? m[0] : null;
}

function resolveAgainst(projectPath: string, ref: string): string {
  if (/^[A-Za-z]:[\\/]/.test(ref) || ref.startsWith('\\') || ref.startsWith('/')) return ref;
  return path.join(projectPath, ref);
}

// ==========================================================================
// 1. parse_backlog
// ==========================================================================

export function parseBacklog(projectPath: string): BacklogItem[] {
  const backlogPath = path.join(projectPath, 'BACKLOG.md');
  if (!fs.existsSync(backlogPath)) return [];

  const project = path.basename(projectPath);
  const createdAt = fileMtimeISO(backlogPath);
  const lines = fs.readFileSync(backlogPath, 'utf8').split(/\r?\n/);

  const items: BacklogItem[] = [];
  let currentPriority: Priority = 'P2';
  let inCompletedSection = false;
  let index = 0;

  for (const rawLine of lines) {
    // Section header: track priority + completed-section state.
    const header = rawLine.match(/^#{1,6}\s+(.*)$/);
    if (header) {
      const title = header[1];
      const pr = title.match(/\bP([0-3])\b/);
      if (pr) currentPriority = (`P${pr[1]}`) as Priority;
      inCompletedSection = /\b(completed|done|shipped|archive[d]?)\b/i.test(title);
      continue;
    }

    const item = rawLine.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/);
    if (!item) continue;
    const checked = item[1].toLowerCase() === 'x';
    if (checked || inCompletedSection) continue;

    let body = item[2];

    // Explicit ID prefix (e.g. "ITEM-01:" or "B2S-002:").
    let id: string;
    const idMatch = body.match(/^([A-Z][A-Z0-9]*-\d+):\s*(.*)$/);
    if (idMatch) {
      id = idMatch[1];
      body = idMatch[2];
    } else {
      id = `${slugify(project)}-${++index}`;
    }

    // Inline priority override (P0/P1/P2/P3 token in the line).
    let priority = currentPriority;
    const inlinePr = body.match(/\bP([0-3])\b/);
    if (inlinePr) priority = (`P${inlinePr[1]}`) as Priority;

    // Tags: #hashtags + bracketed [tags] that are not markdown links.
    const tags: string[] = [];
    for (const t of body.match(/#([A-Za-z][\w-]*)/g) || []) tags.push(t.slice(1));
    for (const t of body.match(/\[([^\]]+)\](?!\()/g) || []) {
      tags.push(t.slice(1, -1).trim());
    }

    items.push({
      id,
      description: body.trim(),
      project,
      project_path: projectPath,
      priority,
      tags: Array.from(new Set(tags)),
      created_at: createdAt,
      raw_line: rawLine.trim(),
    });
  }

  return items;
}

// ==========================================================================
// 2. categorize_item
// ==========================================================================

function matchedKeywords(text: string, keywords: string[]): string[] {
  return keywords.filter((k) => text.includes(k));
}

export function categorizeItem(item: BacklogItem): Categorization {
  const text = ` ${item.description.toLowerCase()} `;
  const signals: string[] = [];

  // Precedence follows the spec ordering: first matching category wins.
  const bug = matchedKeywords(text, BUG_KEYWORDS);
  if (bug.length) {
    signals.push(...bug.map((k) => `bug:${k.trim()}`));
    return { category: 'bug', automation_potential: 'HIGH', signals };
  }

  const specRef = referencedSpec(item.description);
  if (specRef) {
    const resolved = resolveAgainst(item.project_path, specRef);
    if (fs.existsSync(resolved) || fs.existsSync(specRef)) {
      signals.push(`spec_on_disk:${specRef}`);
      return { category: 'feature_with_spec', automation_potential: 'HIGH', signals };
    }
    signals.push(`spec_ref_missing:${specRef}`);
  }

  const build = matchedKeywords(text, BUILD_KEYWORDS);
  if (build.length) {
    signals.push(...build.map((k) => `build:${k.trim()}`));
    return { category: 'feature_needs_spec', automation_potential: 'MEDIUM', signals };
  }

  const infra = matchedKeywords(text, INFRA_KEYWORDS);
  if (infra.length) {
    signals.push(...infra.map((k) => `infra:${k.trim()}`));
    return { category: 'infrastructure', automation_potential: 'HIGH', signals };
  }

  const research = matchedKeywords(text, RESEARCH_KEYWORDS);
  if (research.length) {
    signals.push(...research.map((k) => `research:${k.trim()}`));
    return { category: 'research', automation_potential: 'LOW', signals };
  }

  const policy = matchedKeywords(text, POLICY_KEYWORDS);
  if (policy.length) {
    signals.push(...policy.map((k) => `policy:${k.trim()}`));
    return { category: 'policy', automation_potential: 'NONE', signals };
  }

  // Default: unclassified work that describes a deliverable -> needs spec.
  signals.push('default:no_keyword_match');
  return { category: 'feature_needs_spec', automation_potential: 'MEDIUM', signals };
}

// ==========================================================================
// PROJECT CONTEXT
// ==========================================================================

export function buildProjectContext(
  projectPath: string,
  productGraph?: Record<string, string>,
): ProjectContext {
  const graph = productGraph || readProductGraph();
  const project = path.basename(projectPath);

  const inGraph = Object.values(graph).some(
    (p) => path.resolve(p).toLowerCase() === path.resolve(projectPath).toLowerCase(),
  ) || Object.keys(graph).some((k) => k.toLowerCase() === project.toLowerCase());

  const statusPath = path.join(projectPath, 'STATUS.md');
  const hasStatus = fs.existsSync(statusPath);
  const statusAge = hasStatus ? ageInDays(fileMtimeISO(statusPath)) : null;

  let gitClean: boolean | null = null;
  try {
    const out = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    });
    gitClean = out.trim().length === 0;
  } catch {
    gitClean = null;
  }

  const constraintsDocumented =
    inGraph ||
    fs.existsSync(path.join(projectPath, 'CLAUDE.md')) ||
    fs.existsSync(path.join(projectPath, 'CONSTRAINTS.md'));

  return {
    project,
    project_path: projectPath,
    in_product_graph: inGraph,
    has_status_md: hasStatus,
    status_md_age_days: statusAge === null ? null : round2(statusAge),
    git_clean: gitClean,
    constraints_documented: constraintsDocumented,
  };
}

// ==========================================================================
// 3. assess_readiness
// ==========================================================================

function scoreScopeClarity(item: BacklogItem): ReadinessAxis {
  const text = item.description.toLowerCase();
  const factors: string[] = [];
  let score = 0;

  if (extractPaths(item.description).length > 0 || /\b\w+\(\)/.test(item.description)) {
    score += 0.3; factors.push('+0.30 names files/endpoints');
  }
  if (/^(fix|add|update|remove|wire|rename|move|create|implement)\b/.test(text) ||
      /\badd\b.*\bto\b/.test(text)) {
    score += 0.2; factors.push('+0.20 deliverable implicit');
  }
  if (matchedKeywords(` ${text} `, REDESIGN_KEYWORDS).length) {
    score -= 0.2; factors.push('-0.20 unbounded (redesign/rewrite)');
  } else if (/\b(file|module|function|tool|script|component|endpoint)\b/.test(text)) {
    score += 0.2; factors.push('+0.20 scope bounded (single unit)');
  }
  if (matchedKeywords(` ${text} `, AMBIGUITY_KEYWORDS).length === 0) {
    score += 0.3; factors.push('+0.30 decisions pre-made');
  } else {
    factors.push('+0.00 contains decision language');
  }

  return { score: round2(clamp01(score)), factors };
}

function scoreDependencyResolution(item: BacklogItem, ctx: ProjectContext): ReadinessAxis {
  const factors: string[] = [];
  let score = 0;

  if (ctx.has_status_md) { score += 0.25; factors.push('+0.25 STATUS.md present'); }
  else factors.push('+0.00 no STATUS.md');

  const refs = extractPaths(item.description);
  const refsExist = refs.length === 0 ||
    refs.every((r) => fs.existsSync(resolveAgainst(item.project_path, r)) || fs.existsSync(r));
  if (refsExist) { score += 0.25; factors.push('+0.25 referenced files exist (or none)'); }
  else factors.push('+0.00 referenced file missing');

  const hasDepLanguage = matchedKeywords(` ${item.description.toLowerCase()} `, DEPENDENCY_KEYWORDS).length > 0;
  if (!hasDepLanguage) { score += 0.25; factors.push('+0.25 no blocking-dependency language'); }
  else factors.push('+0.00 references a blocking dependency');

  if (ctx.git_clean === true) { score += 0.25; factors.push('+0.25 working tree clean'); }
  else if (ctx.git_clean === null) { score += 0.125; factors.push('+0.125 git status unknown'); }
  else factors.push('+0.00 working tree dirty');

  return { score: round2(clamp01(score)), factors };
}

function scoreRiskProfile(item: BacklogItem, category: Category): ReadinessAxis {
  const text = ` ${item.description.toLowerCase()} `;
  const factors: string[] = [];
  let score = 1;

  if (matchedKeywords(text, PRODUCTION_KEYWORDS).length) {
    score -= 0.3; factors.push('-0.30 touches production');
  }
  if (matchedKeywords(text, DESTRUCTIVE_KEYWORDS).length) {
    score -= 0.2; factors.push('-0.20 destructive operation');
  }
  const paths = extractPaths(item.description);
  if (paths.length > 1 || /\b(cross|integrate|portfolio|all projects|multi)\b/.test(text)) {
    score -= 0.15; factors.push('-0.15 multiple systems');
  }
  if (category === 'research' || /\b(novel|prototype|experiment|explore|unknown)\b/.test(text)) {
    score -= 0.15; factors.push('-0.15 novel / no pattern');
  }

  if (factors.length === 0) factors.push('+1.00 no risk signals');
  return { score: round2(clamp01(score)), factors };
}

function scoreContextCompleteness(item: BacklogItem, ctx: ProjectContext): ReadinessAxis {
  const factors: string[] = [];
  let score = 0;

  const specRef = referencedSpec(item.description);
  const specExists = specRef
    ? (fs.existsSync(resolveAgainst(item.project_path, specRef)) || fs.existsSync(specRef))
    : false;
  if (specExists) { score += 0.4; factors.push('+0.40 spec exists'); }
  else factors.push('+0.00 no spec on disk');

  if (ctx.has_status_md && ctx.status_md_age_days !== null && ctx.status_md_age_days <= 30) {
    score += 0.2; factors.push('+0.20 STATUS.md current (<=30d)');
  } else factors.push('+0.00 STATUS.md missing or stale');

  if (ctx.in_product_graph) { score += 0.2; factors.push('+0.20 in PRODUCT_GRAPH'); }
  else factors.push('+0.00 not in PRODUCT_GRAPH');

  if (ctx.constraints_documented) { score += 0.2; factors.push('+0.20 constraints documented'); }
  else factors.push('+0.00 constraints undocumented');

  return { score: round2(clamp01(score)), factors };
}

function scoreStaleness(item: BacklogItem): ReadinessAxis {
  const age = ageInDays(item.created_at);
  let score: number;
  let label: string;
  if (age < 1) { score = 1.0; label = 'today'; }
  else if (age <= 7) { score = 0.9; label = 'this week'; }
  else if (age <= 31) { score = 0.7; label = 'this month'; }
  else if (age <= 183) { score = 0.5; label = '2+ months'; }
  else { score = 0.3; label = '6+ months'; }
  return { score, factors: [`${score.toFixed(2)} age ~${Math.round(age)}d (${label})`] };
}

export function assessReadiness(item: BacklogItem, ctx: ProjectContext): ReadinessScore {
  const category = categorizeItem(item).category;

  const axes = {
    scope_clarity: scoreScopeClarity(item),
    dependency_resolution: scoreDependencyResolution(item, ctx),
    risk_profile: scoreRiskProfile(item, category),
    context_completeness: scoreContextCompleteness(item, ctx),
    staleness: scoreStaleness(item),
  };

  const composite = round2(
    axes.scope_clarity.score * AXIS_WEIGHTS.scope_clarity +
    axes.dependency_resolution.score * AXIS_WEIGHTS.dependency_resolution +
    axes.risk_profile.score * AXIS_WEIGHTS.risk_profile +
    axes.context_completeness.score * AXIS_WEIGHTS.context_completeness +
    axes.staleness.score * AXIS_WEIGHTS.staleness,
  );

  let classification: Classification;
  if (composite > 0.7) classification = 'ready';
  else if (composite >= 0.4) classification = 'borderline';
  else classification = 'not_ready';

  return { composite, classification, axes };
}

// ==========================================================================
// TOOL DEFINITION
// ==========================================================================

export const backlogToSprintTools: Tool[] = [
  {
    name: 'backlog_to_sprint',
    description:
      'Scan project BACKLOG.md files, parse unchecked items, categorize them ' +
      '(bug/feature_with_spec/feature_needs_spec/infrastructure/research/policy), and ' +
      'score sprint-readiness on 5 axes (scope_clarity, dependency_resolution, risk_profile, ' +
      'context_completeness, staleness). Returns structured items with category + readiness ' +
      'breakdown. Does not generate sprints yet (B2S-001 scope).',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project key (PRODUCT_GRAPH) or absolute path to scan. Omit to scan all.',
        },
        item_id: {
          type: 'string',
          description: 'Only process the item with this id (optional).',
        },
        dry_run: {
          type: 'boolean',
          description: 'Assess without side effects (default true for B2S-001).',
        },
      },
      required: [],
    },
  },
];

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

function resolveTargets(project: string | undefined, graph: Record<string, string>): string[] {
  if (project) {
    // Direct path?
    if (fs.existsSync(project)) return [project];
    // Graph key (case-insensitive)?
    const key = Object.keys(graph).find((k) => k.toLowerCase() === project.toLowerCase());
    if (key && fs.existsSync(graph[key])) return [graph[key]];
    // Match by basename of a graph path.
    const byBase = Object.values(graph).find(
      (p) => path.basename(p).toLowerCase() === project.toLowerCase() && fs.existsSync(p),
    );
    return byBase ? [byBase] : [];
  }
  // All graph projects that have a BACKLOG.md.
  return Object.values(graph).filter(
    (p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'BACKLOG.md')),
  );
}

export function createBacklogToSprintHandlers(): Record<
  string,
  (input: Record<string, unknown>) => Promise<unknown>
> {
  return {
    backlog_to_sprint: async (input) => {
      const project = typeof input.project === 'string' ? input.project : undefined;
      const itemId = typeof input.item_id === 'string' ? input.item_id : undefined;
      const dryRun = input.dry_run === undefined ? true : Boolean(input.dry_run);

      const graph = readProductGraph();
      const targets = resolveTargets(project, graph);

      if (targets.length === 0) {
        return {
          error: project
            ? `No scannable project found for "${project}" (no path / BACKLOG.md).`
            : 'No projects with a BACKLOG.md found in PRODUCT_GRAPH.',
          scanned: 0,
        };
      }

      const categorized: Record<Category, number> = {
        bug: 0, feature_with_spec: 0, feature_needs_spec: 0,
        infrastructure: 0, research: 0, policy: 0,
      };
      const readiness = { ready: 0, borderline: 0, not_ready: 0 };
      const skipped: string[] = [];
      const resultItems: Array<Record<string, unknown>> = [];

      for (const projectPath of targets) {
        let items = parseBacklog(projectPath);
        if (itemId) items = items.filter((i) => i.id === itemId);
        if (items.length === 0) {
          skipped.push(`${path.basename(projectPath)}: no matching unchecked items`);
          continue;
        }
        const ctx = buildProjectContext(projectPath, graph);
        for (const item of items) {
          const cat = categorizeItem(item);
          const score = assessReadiness(item, ctx);
          categorized[cat.category] += 1;
          readiness[score.classification] += 1;
          resultItems.push({
            id: item.id,
            project: item.project,
            priority: item.priority,
            description: item.description,
            tags: item.tags,
            category: cat.category,
            automation_potential: cat.automation_potential,
            category_signals: cat.signals,
            readiness: score.composite,
            classification: score.classification,
            readiness_axes: score.axes,
          });
        }
      }

      return {
        dry_run: dryRun,
        scanned: resultItems.length,
        projects_scanned: targets.map((t) => path.basename(t)),
        categorized,
        readiness,
        skipped,
        items: resultItems,
      };
    },
  };
}
