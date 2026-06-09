/**
 * KERNL MCP - Eye of Sauron Quality Scan Tools
 *
 * eos_quick_scan — thin wrapper around Eye of Sauron's sauron-cli.js. Scans the
 *                  given source files for code-quality issues and returns a
 *                  per-file quality score (0-100), the average, a scan timestamp,
 *                  and a flattened findings list. Feeds the AUTONOMIC pre-flight
 *                  quality baseline (Gate 1) and post-sprint quality delta.
 *
 * EoS discovers files within a directory; a single-file input yields zero files.
 * This wrapper therefore groups the requested files by parent directory, scans
 * each unique directory once (cached), then extracts the requested files'
 * entries from the report. sauron-cli exits 1 when critical issues exist, so the
 * exit code is intentionally ignored — only a spawn error, timeout, or absent
 * JSON report is treated as a failure.
 *
 * Spec: D:\Meta\SPRINT_AUTOMATION_ARCHITECTURE.md (Pre-flight quality)
 * CLI:  D:\Projects\eye-of-sauron\sauron-cli.js  (override via EOS_CLI_PATH)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// ==========================================================================
// CONSTANTS
// ==========================================================================

const DEFAULT_EOS_CLI = 'D:\\Projects\\eye-of-sauron\\sauron-cli.js';
const SCAN_TIMEOUT_MS = 10_000;
const SCAN_MODE = 'quick';

// Per-issue penalty (points off a 100 baseline), keyed by EoS severity.
const SEVERITY_PENALTY: Record<string, number> = {
  APOCALYPSE: 25,
  DANGER: 15,
  WARNING: 5,
  NOTICE: 2,
  INFO: 1,
};
const DEFAULT_PENALTY = 3;

// ==========================================================================
// TYPES
// ==========================================================================

interface EosIssue {
  type?: string;
  severity?: string;
  file?: string;
  line?: number;
  message?: string;
  description?: string;
}

interface EosFileEntry {
  path: string;
  issues?: EosIssue[];
}

interface EosReport {
  summary?: Record<string, unknown>;
  files?: Record<string, EosFileEntry>;
}

// ==========================================================================
// HELPERS
// ==========================================================================

/** Resolve the sauron-cli.js path, allowing an EOS_CLI_PATH override. */
function resolveEosCli(): string {
  return process.env.EOS_CLI_PATH || DEFAULT_EOS_CLI;
}

/** Normalize a path for case-insensitive Windows comparison. */
function normPath(p: string): string {
  return path.resolve(p).replace(/\//g, '\\').toLowerCase();
}

/** Per-file score: 100 minus severity-weighted issue penalties, clamped 0-100. */
function scoreFromIssues(issues: EosIssue[]): number {
  let penalty = 0;
  for (const it of issues) {
    penalty += SEVERITY_PENALTY[(it.severity || '').toUpperCase()] ?? DEFAULT_PENALTY;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/** Run sauron-cli on a directory; return parsed report or an error string. */
function scanDirectory(cli: string, dir: string): { report?: EosReport; error?: string } {
  const res = spawnSync(
    'node',
    [cli, '--input', dir, '--mode', SCAN_MODE, '--silent', '--output', '-'],
    { encoding: 'utf-8', timeout: SCAN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
  );

  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    const msg =
      code === 'ETIMEDOUT'
        ? `EoS scan timed out after ${SCAN_TIMEOUT_MS}ms: ${dir}`
        : `EoS scan failed for ${dir}: ${res.error.message}`;
    return { error: msg };
  }

  const out = res.stdout || '';
  const start = out.indexOf('{');
  if (start === -1) {
    return { error: `EoS produced no JSON report for ${dir}` };
  }
  try {
    return { report: JSON.parse(out.slice(start)) as EosReport };
  } catch (e) {
    return { error: `Could not parse EoS report for ${dir}: ${(e as Error).message}` };
  }
}

// ==========================================================================
// TOOL DEFINITIONS (1 tool)
// ==========================================================================

export const eosTools: Tool[] = [
  {
    name: 'eos_quick_scan',
    description:
      'Run an Eye of Sauron quality scan over specific source files and return per-file ' +
      'quality scores. Groups the requested files by parent directory, invokes sauron-cli.js ' +
      '(quick mode, 10s timeout per directory) once per directory, then extracts each file\'s ' +
      'issues. Returns { scores: {file -> 0-100}, average, scan_timestamp, findings: ' +
      '[{file, issue, severity}], errors? }. Missing files, a missing EoS CLI, parse failures, ' +
      'and timeouts are reported in errors without throwing. Used for the AUTONOMIC pre-flight ' +
      'quality baseline and post-sprint quality delta.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths of the source files to scan',
        },
        project: { type: 'string', description: 'Optional project name (informational, echoed back)' },
      },
      required: ['files'],
    },
  },
];

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

export function createEosHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    eos_quick_scan: async (input) => {
      const scanTimestamp = new Date().toISOString();
      const project = (input.project as string) || '';
      const files = Array.isArray(input.files) ? (input.files as string[]) : [];

      const fail = (error: string) => ({
        error,
        scores: {},
        average: 0,
        scan_timestamp: scanTimestamp,
        findings: [],
        ...(project ? { project } : {}),
      });

      if (!files.length) return fail('eos_quick_scan requires a non-empty files array');

      const cli = resolveEosCli();
      if (!fs.existsSync(cli)) {
        return fail(`Eye of Sauron CLI not found at ${cli} (set EOS_CLI_PATH to override)`);
      }

      const errors: string[] = [];

      // Validate inputs: keep existing files, record the rest.
      const existing: string[] = [];
      for (const f of files) {
        try {
          if (fs.existsSync(f) && fs.statSync(f).isFile()) existing.push(f);
          else errors.push(`File not found: ${f}`);
        } catch {
          errors.push(`File not accessible: ${f}`);
        }
      }

      // Group existing files by parent directory; scan each directory once.
      const byDir = new Map<string, string[]>();
      for (const f of existing) {
        const d = path.dirname(path.resolve(f));
        const list = byDir.get(d);
        if (list) list.push(f);
        else byDir.set(d, [f]);
      }

      const dirReports = new Map<string, EosReport>();
      for (const dir of byDir.keys()) {
        const { report, error } = scanDirectory(cli, dir);
        if (error) errors.push(error);
        else dirReports.set(dir, report || {});
      }

      const scores: Record<string, number> = {};
      const findings: Array<{ file: string; issue: string; severity: string }> = [];

      for (const f of existing) {
        const dir = path.dirname(path.resolve(f));
        const report = dirReports.get(dir);
        if (!report) continue; // directory scan failed — already recorded in errors

        const target = normPath(f);
        let entry: EosFileEntry | undefined;
        for (const key of Object.keys(report.files || {})) {
          if (normPath(key) === target) {
            entry = report.files![key];
            break;
          }
        }

        if (!entry) {
          errors.push(`Not scanned by EoS (unsupported type or excluded): ${f}`);
          continue;
        }

        const issues = entry.issues || [];
        scores[f] = scoreFromIssues(issues);
        for (const it of issues) {
          findings.push({
            file: f,
            issue: it.message || it.description || it.type || 'unknown issue',
            severity: (it.severity || 'INFO').toUpperCase(),
          });
        }
      }

      const scored = Object.values(scores);
      const average = scored.length
        ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100
        : 0;

      return {
        scores,
        average,
        scan_timestamp: scanTimestamp,
        findings,
        ...(errors.length ? { errors } : {}),
        ...(project ? { project } : {}),
      };
    },
  };
}
