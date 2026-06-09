/**
 * KERNL MCP - Backlog-to-Sprint Pipeline Tools (AUTONOMIC Phase 6)
 *
 * B2S-001 core assessment:
 *   parse_backlog(project_path)        -> BacklogItem[]   (markdown -> structured)
 *   categorize_item(item)              -> Categorization   (ORACLE-style routing)
 *   assess_readiness(item, context)    -> ReadinessScore   (5-axis CCS-adapted)
 *
 * B2S-002 generation:
 *   generate_sprint(item, ctx, score)  -> string           (fills AUTONOMIC template)
 *   scrvnr_check(sprint_text)          -> { pass, violations }
 *
 * Exposed as the KERNL tool `backlog_to_sprint`: parse + categorize + score, and
 * (B2S-002) generate sprint prompts, SCRVNR-check them, and queue ready ones via
 * the existing queue_sprint tool.
 *
 * Net-new file. Does NOT touch the existing `backlog-tools.ts` (epic/task
 * management). Reuses queue_sprint from autonomic-tools.ts.
 *
 * Spec: D:\Meta\BACKLOG_TO_SPRINT_SPEC.md (sections 1-5)
 * Template: D:\Dev\TEMPLATES\AUTONOMIC_SPRINT_TEMPLATE.md
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createAutonomicHandlers } from './autonomic-tools.js';

// ==========================================================================
// CONSTANTS
// ==========================================================================

const PRODUCT_GRAPH_PATH = 'D:\\Meta\\PRODUCT_GRAPH.yaml';
const GIT_EMAIL = '213939863+duke-of-beans@users.noreply.github.com';

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

// SCRVNR (B2S-002): forbidden vague phrases + binary-operator detector.
const SCRVNR_FORBIDDEN = [
  'implement and verify',
  'update the file',
  'fix the bug',
  'test it works',
  'make sure',
];
const BINARY_OPERATOR = /\b(exits?|exist|exists|returns?|passes?|equals?|matches?|contains?)\b|\bexit\s+0\b|\b0\s+errors?\b|\bno\s+errors?\b/i;

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

export interface ScrvnrResult {
  pass: boolean;
  violations: string[];
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
// 4. generate_sprint (B2S-002)
// ==========================================================================

/** bug/infra -> sonnet, mechanical cleanup -> haiku, complex -> opus. */
export function routeModel(category: Category, item: BacklogItem): 'opus' | 'sonnet' | 'haiku' {
  const text = item.description.toLowerCase();
  if (category === 'infrastructure' && /\b(cleanup|archive|rename|move|sync)\b/.test(text)) {
    return 'haiku';
  }
  if (category === 'bug' || category === 'infrastructure') return 'sonnet';
  return 'opus';
}

function shortTitle(description: string): string {
  const words = description.replace(/\s+/g, ' ').trim().split(' ');
  const t = words.slice(0, 9).join(' ');
  return words.length > 9 ? `${t}...` : t;
}

/** Decompose a description into concrete numbered task bodies. */
function decomposeTasks(item: BacklogItem, category: Category): string[] {
  const clauses = item.description
    .split(/\s*(?:,| and | then |;)\s*/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
  const steps = clauses.length > 0 ? clauses : [item.description];

  const verbByCategory: Record<Category, string> = {
    bug: 'Reproduce, then correct, the defect',
    feature_with_spec: 'Implement, per the referenced spec,',
    feature_needs_spec: 'Implement',
    infrastructure: 'Apply the change',
    research: 'Investigate and document',
    policy: 'Document the options and the chosen decision for',
  };

  return steps.slice(0, 5).map((clause, i) => {
    const verb = i === 0 ? verbByCategory[category] : 'Continue with';
    return (
      `TASK ${i + 1} — ${shortTitle(clause)}\n` +
      `${verb}: ${clause}. Work inside ${item.project_path} with explicit, absolute file paths. ` +
      `Commit: ${conventionalPrefix(category)}(${slugify(item.project)}): ${shortTitle(clause)}`
    );
  });
}

function conventionalPrefix(category: Category): string {
  switch (category) {
    case 'bug': return 'fix';
    case 'infrastructure': return 'chore';
    case 'research': return 'docs';
    case 'policy': return 'docs';
    default: return 'feat';
  }
}

function acceptanceCriteria(item: BacklogItem): string[] {
  const crit: string[] = [];
  if (fs.existsSync(path.join(item.project_path, 'package.json'))) {
    crit.push('npm run build exits 0');
  }
  for (const ref of extractPaths(item.description).slice(0, 2)) {
    crit.push(`${ref} exists on disk after the change`);
  }
  crit.push('git status --porcelain returns empty after the final commit');
  crit.push('the commit for this item exists on origin/main after push');
  return crit;
}

export function generateSprint(
  item: BacklogItem,
  ctx: ProjectContext,
  score: ReadinessScore,
  category?: Category,
): string {
  const cat = category || categorizeItem(item).category;
  const model = routeModel(cat, item);
  const title = `${item.id}: ${shortTitle(item.description)}`;
  const tier = score.classification === 'ready' ? 1 : 2;

  const bootstrap: string[] = [];
  const specRef = referencedSpec(item.description);
  if (specRef) bootstrap.push(resolveAgainst(item.project_path, specRef));
  if (ctx.has_status_md) bootstrap.push(path.join(item.project_path, 'STATUS.md'));
  bootstrap.push(path.join(item.project_path, 'BACKLOG.md'));
  const bootstrapBlock = bootstrap.map((f, i) => `${i + 1}. ${f}`).join('\n');

  const tasks = decomposeTasks(item, cat);
  const validateTaskNum = tasks.length + 1;

  const crit = acceptanceCriteria(item).map((c) => `- [ ] ${c}`).join('\n');

  const constraints = [
    'Shell: cmd (NOT PowerShell - PAT-003)',
    `Git identity: ${GIT_EMAIL} (PAT-002)`,
    ctx.in_product_graph
      ? 'Project is registered in PRODUCT_GRAPH; honor its documented constraints.'
      : 'Project is NOT in PRODUCT_GRAPH; confirm paths before writing.',
  ].map((c) => `- ${c}`).join('\n');

  return (
    `⚡ AUTONOMIC AUTO-EXECUTE - This sprint is pre-approved and pre-flighted.\n` +
    `Do not ask for confirmation. Do not present options. Begin executing Task 1 immediately.\n\n` +
    `Execute Sprint - ${title} for ${item.project}.\n` +
    `Source: backlog\n` +
    `Tier: ${tier} | Confidence: ${score.composite}\n\n` +
    `YOUR ROLE: This sprint delivers the backlog item "${item.description}" for ${item.project} ` +
    `(category: ${cat}, readiness ${score.composite}). David is the architect.\n\n` +
    `GIT PROTOCOL: All git ops use shell cmd. Write commit message to\n` +
    `.git\\COMMIT_MSG_TEMP, then: git commit -F .git\\COMMIT_MSG_TEMP\n` +
    `GIT IDENTITY: git config user.email "${GIT_EMAIL}" && git config user.name "David Kirsch"\n\n` +
    `MANDATORY BOOTSTRAP:\n${bootstrapBlock}\n\n` +
    `## ===========================================================\n` +
    `## AUTONOMIC EXECUTION DIRECTIVE - NO QUESTIONS\n` +
    `## ===========================================================\n` +
    `You are executing autonomously. Do NOT ask for clarification. Do NOT pause for input.\n` +
    `If a referenced file does not exist, requirements are ambiguous, a destructive action\n` +
    `lacks authorization, a dependency errors, or the same fix fails 3+ times: ABORT, write a\n` +
    `ticket to D:\\Dev\\SPRINT_QUEUE\\aborted\\{sprint_id}.md, and exit cleanly.\n\n` +
    `<!-- phase:execute -->\n\n` +
    `${tasks.join('\n\n')}\n\n` +
    `TASK ${validateTaskNum} — Validate, Commit, and Push\n` +
    `1. Run the acceptance-criteria checks below.\n` +
    `2. Friction pass -> D:\\Dev\\SPRINT_QUEUE\\completed\\{sprint_id}_friction.md\n` +
    `3. git add -A && git commit -F .git\\COMMIT_MSG_TEMP && git push\n` +
    `4. Move the sprint file from pending\\ to completed\\.\n\n` +
    `CRITICAL CONSTRAINTS:\n${constraints}\n\n` +
    `ACCEPTANCE CRITERIA:\n${crit}\n\n` +
    `MODEL ROUTING: ${model}\n`
  );
}

// ==========================================================================
// 5. scrvnr_check (B2S-002)
// ==========================================================================

export function scrvnrCheck(sprintText: string): ScrvnrResult {
  const violations: string[] = [];
  const lower = sprintText.toLowerCase();

  for (const phrase of SCRVNR_FORBIDDEN) {
    if (lower.includes(phrase)) violations.push(`forbidden vague phrase: "${phrase}"`);
  }

  const acIdx = sprintText.indexOf('ACCEPTANCE CRITERIA');
  if (acIdx === -1) {
    violations.push('missing ACCEPTANCE CRITERIA section');
  } else {
    const section = sprintText.slice(acIdx);
    const critLines = section
      .split(/\r?\n/)
      .filter((l) => /^\s*-\s*\[[ xX]?\]/.test(l));
    if (critLines.length === 0) {
      violations.push('ACCEPTANCE CRITERIA section has no checklist items');
    }
    for (const line of critLines) {
      if (!BINARY_OPERATOR.test(line)) {
        violations.push(`non-binary acceptance criterion: "${line.trim()}"`);
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

// ==========================================================================
// TOOL DEFINITION
// ==========================================================================

export const backlogToSprintTools: Tool[] = [
  {
    name: 'backlog_to_sprint',
    description:
      'Scan project BACKLOG.md files; parse unchecked items; categorize ' +
      '(bug/feature_with_spec/feature_needs_spec/infrastructure/research/policy); score ' +
      'readiness on 5 axes; and (B2S-002) generate AUTONOMIC sprint prompts for ready/' +
      'borderline items, SCRVNR-check them for vague language + non-binary criteria, and ' +
      'queue ready+clean sprints via queue_sprint. dry_run=true (default) generates without ' +
      'queuing.',
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
          description: 'If true (default), generate + score without queuing. If false, queue ready sprints.',
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
    if (fs.existsSync(project)) return [project];
    const key = Object.keys(graph).find((k) => k.toLowerCase() === project.toLowerCase());
    if (key && fs.existsSync(graph[key])) return [graph[key]];
    const byBase = Object.values(graph).find(
      (p) => path.basename(p).toLowerCase() === project.toLowerCase() && fs.existsSync(p),
    );
    return byBase ? [byBase] : [];
  }
  return Object.values(graph).filter(
    (p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'BACKLOG.md')),
  );
}

export function createBacklogToSprintHandlers(): Record<
  string,
  (input: Record<string, unknown>) => Promise<unknown>
> {
  const autonomic = createAutonomicHandlers();

  return {
    backlog_to_sprint: async (input) => {
      const project = typeof input.project === 'string' ? input.project : undefined;
      const itemId = typeof input.item_id === 'string' ? input.item_id : undefined;
      const dryRun = input.dry_run === undefined ? true : Boolean(input.dry_run);
      const includeBodies = Boolean(project || itemId);

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
      const queued: string[] = [];
      const flaggedForReview: Array<Record<string, unknown>> = [];
      const resultItems: Array<Record<string, unknown>> = [];
      let generated = 0;

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

          const base: Record<string, unknown> = {
            id: item.id,
            project: item.project,
            priority: item.priority,
            description: item.description,
            category: cat.category,
            automation_potential: cat.automation_potential,
            readiness: score.composite,
            classification: score.classification,
          };

          if (score.classification === 'not_ready') {
            skipped.push(`${item.id}: readiness ${score.composite} < 0.4 (not ready)`);
            resultItems.push({ ...base, action: 'skipped' });
            continue;
          }

          // ready or borderline -> generate + SCRVNR check
          const sprintText = generateSprint(item, ctx, score, cat.category);
          const scrvnr = scrvnrCheck(sprintText);
          generated += 1;

          const title = `${item.id}: ${shortTitle(item.description)}`;
          let action: string;
          let queuedSprintId: string | null = null;

          if (score.classification === 'ready' && scrvnr.pass) {
            if (!dryRun) {
              const q = (await autonomic.queue_sprint({
                sprint_text: sprintText,
                project: item.project,
                title,
                priority: item.priority === 'P3' ? 'P2' : item.priority,
                source: 'chat',
                model_preference: routeModel(cat.category, item),
                tags: ['backlog', cat.category],
              })) as { sprint_id?: string; error?: string };
              if (q && q.sprint_id) {
                queuedSprintId = q.sprint_id;
                queued.push(q.sprint_id);
                action = 'queued';
              } else {
                action = 'queue_failed';
                flaggedForReview.push({ id: item.id, reason: 'queue_error', detail: q?.error || 'unknown' });
              }
            } else {
              action = 'ready_dry_run';
            }
          } else if (score.classification === 'ready' && !scrvnr.pass) {
            action = 'flagged_scrvnr';
            flaggedForReview.push({ id: item.id, reason: 'scrvnr_violations', violations: scrvnr.violations });
          } else {
            // borderline
            action = 'flagged_review';
            flaggedForReview.push({ id: item.id, reason: 'borderline_readiness', readiness: score.composite });
          }

          resultItems.push({
            ...base,
            action,
            scrvnr_pass: scrvnr.pass,
            scrvnr_violations: scrvnr.violations,
            queued_sprint_id: queuedSprintId,
            ...(includeBodies
              ? { generated_sprint: sprintText }
              : { generated_preview: sprintText.slice(0, 200) }),
          });
        }
      }

      return {
        dry_run: dryRun,
        scanned: resultItems.length,
        projects_scanned: targets.map((t) => path.basename(t)),
        categorized,
        readiness,
        generated,
        queued,
        flagged_for_review: flaggedForReview,
        skipped,
        items: resultItems,
      };
    },
  };
}
