/**
 * KERNL MCP - Parallel Gate Checks (P2a)
 * 
 * Eliminates sequential 5-gate verification bottleneck.
 * Previous: 5 sequential searches = 45+ seconds
 * Now: Promise.all parallel execution = ~10 seconds
 * 
 * Gates:
 * - git: Search git history for system mentions
 * - code: Search implementation files (*.ts)
 * - ui: Search UI components (*.tsx)
 * - backlog: Query epic database
 * - patterns: Suggest from cross-project patterns
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectDatabase } from '../storage/database.js';
import type { ToolResult } from '../types/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export type GateName = 'git' | 'code' | 'ui' | 'backlog' | 'patterns';

interface GateResult {
  gate: GateName;
  status: 'success' | 'error' | 'empty';
  duration_ms: number;
  count: number;
  data: unknown;
  error?: string;
}

interface ParallelGatesInput {
  project: string;
  system: string;
  gates?: GateName[];
}

interface ParallelGatesOutput {
  system: string;
  total_duration_ms: number;
  gates: Record<string, GateResult>;
  summary: {
    total_matches: number;
    gates_with_results: GateName[];
    recommendation: string;
  };
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export const parallelGatesTools: Tool[] = [
  {
    name: 'five_gate_check',
    description: `Run parallel 5-gate verification for a system/feature.

PERFORMANCE: 45 seconds sequential → ~10 seconds parallel (Promise.all)

GATES:
- git: Search git commit history for system mentions
- code: Search *.ts implementation files
- ui: Search *.tsx UI component files
- backlog: Query epic database for related work
- patterns: Find relevant patterns from other projects

RETURNS: Aggregated results with per-gate status, counts, and timing.

USE CASES:
- Verify system exists before making changes
- Find all related code before refactoring
- Check if similar work exists in backlog
- Discover patterns from past projects`,
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID (e.g., "kernl")',
        },
        system: {
          type: 'string',
          description: 'System/feature name to search for (e.g., "Active Inference Router")',
        },
        gates: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['git', 'code', 'ui', 'backlog', 'patterns'],
          },
          description: 'Specific gates to check (default: all 5)',
        },
      },
      required: ['project', 'system'],
    },
  },
];

// ============================================================================
// HANDLERS
// ============================================================================

export function createParallelGatesHandlers(db: ProjectDatabase) {
  return {
    five_gate_check: async (input: ParallelGatesInput): Promise<ToolResult<ParallelGatesOutput>> => {
      const startTime = Date.now();
      const { project, system, gates = ['git', 'code', 'ui', 'backlog', 'patterns'] } = input;

      // Get project path
      const projectInfo = db.getProject(project);
      if (!projectInfo) {
        return {
          success: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project '${project}' not found`,
          },
        };
      }

      const projectPath = projectInfo.path;

      // Build gate check functions
      const gateCheckers: Record<GateName, () => Promise<GateResult>> = {
        git: () => checkGitGate(projectPath, system),
        code: () => checkCodeGate(projectPath, system, '.ts'),
        ui: () => checkCodeGate(projectPath, system, '.tsx'),
        backlog: () => checkBacklogGate(db, project, system),
        patterns: () => checkPatternsGate(db, project, system),
      };

      // Run selected gates in parallel
      const selectedGates = gates.filter((g): g is GateName => 
        ['git', 'code', 'ui', 'backlog', 'patterns'].includes(g)
      );

      const gatePromises = selectedGates.map(gate => gateCheckers[gate]());
      const gateResults = await Promise.all(gatePromises);

      // Build results map
      const results: Record<string, GateResult> = {};
      let totalMatches = 0;
      const gatesWithResults: GateName[] = [];

      for (let i = 0; i < selectedGates.length; i++) {
        const gateName = selectedGates[i];
        const result = gateResults[i];
        if (gateName && result) {
          results[gateName] = result;
          totalMatches += result.count;
          if (result.count > 0) {
            gatesWithResults.push(gateName);
          }
        }
      }

      // Generate recommendation
      let recommendation = '';
      if (totalMatches === 0) {
        recommendation = `No matches found for "${system}". This may be a new system or spelled differently.`;
      } else if (gatesWithResults.length === 1) {
        recommendation = `System found in ${gatesWithResults[0]} only. Consider expanding implementation.`;
      } else {
        recommendation = `System well-documented across ${gatesWithResults.length} areas. Ready for modifications.`;
      }

      const totalDuration = Date.now() - startTime;

      return {
        success: true,
        data: {
          system,
          total_duration_ms: totalDuration,
          gates: results,
          summary: {
            total_matches: totalMatches,
            gates_with_results: gatesWithResults,
            recommendation,
          },
        },
      };
    },
  };
}

// ============================================================================
// GATE IMPLEMENTATIONS
// ============================================================================

/**
 * Git gate: Search commit history
 */
async function checkGitGate(projectPath: string, system: string): Promise<GateResult> {
  const startTime = Date.now();
  
  try {
    // Check if it's a git repository
    const gitDir = join(projectPath, '.git');
    if (!existsSync(gitDir)) {
      return {
        gate: 'git',
        status: 'empty',
        duration_ms: Date.now() - startTime,
        count: 0,
        data: { reason: 'Not a git repository' },
      };
    }

    // Search git log for system mentions
    const { stdout } = await execAsync(
      `git log --oneline --all --grep="${system}" -n 20`,
      { cwd: projectPath, timeout: 10000 }
    );

    const commits = stdout.trim().split('\n').filter(line => line.length > 0);

    return {
      gate: 'git',
      status: commits.length > 0 ? 'success' : 'empty',
      duration_ms: Date.now() - startTime,
      count: commits.length,
      data: commits.slice(0, 5),  // Return first 5 commits
    };
  } catch (error) {
    return {
      gate: 'git',
      status: 'error',
      duration_ms: Date.now() - startTime,
      count: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Git search failed',
    };
  }
}

/**
 * Code gate: Search code files
 */
async function checkCodeGate(projectPath: string, system: string, extension: string): Promise<GateResult> {
  const startTime = Date.now();
  const gateName: GateName = extension === '.tsx' ? 'ui' : 'code';
  
  try {
    const matches: Array<{ file: string; line: number; content: string }> = [];
    const searchLower = system.toLowerCase();

    await searchFilesRecursive(projectPath, extension, searchLower, matches, 20);

    return {
      gate: gateName,
      status: matches.length > 0 ? 'success' : 'empty',
      duration_ms: Date.now() - startTime,
      count: matches.length,
      data: matches.slice(0, 5),  // Return first 5 matches
    };
  } catch (error) {
    return {
      gate: gateName,
      status: 'error',
      duration_ms: Date.now() - startTime,
      count: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Code search failed',
    };
  }
}

/**
 * Backlog gate: Query epics database
 */
async function checkBacklogGate(db: ProjectDatabase, project: string, system: string): Promise<GateResult> {
  const startTime = Date.now();
  
  try {
    const epics = db.getEpics(project);
    const searchLower = system.toLowerCase();
    
    const matchingEpics = epics.filter(epic => 
      epic.title.toLowerCase().includes(searchLower) ||
      (epic.description?.toLowerCase().includes(searchLower))
    );

    return {
      gate: 'backlog',
      status: matchingEpics.length > 0 ? 'success' : 'empty',
      duration_ms: Date.now() - startTime,
      count: matchingEpics.length,
      data: matchingEpics.slice(0, 5).map(e => ({
        id: e.id,
        title: e.title,
        status: e.status,
        priority: e.priority,
      })),
    };
  } catch (error) {
    return {
      gate: 'backlog',
      status: 'error',
      duration_ms: Date.now() - startTime,
      count: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Backlog query failed',
    };
  }
}

/**
 * Patterns gate: Find similar patterns
 */
async function checkPatternsGate(db: ProjectDatabase, project: string, system: string): Promise<GateResult> {
  const startTime = Date.now();
  
  try {
    const patterns = db.getPatterns();
    const searchLower = system.toLowerCase();
    
    // Filter by text similarity
    const matchingPatterns = patterns.filter(pattern => 
      pattern.name.toLowerCase().includes(searchLower) ||
      pattern.problem.toLowerCase().includes(searchLower) ||
      pattern.solution.toLowerCase().includes(searchLower)
    );

    // Exclude patterns from current project
    const otherProjectPatterns = matchingPatterns.filter(p => p.projectId !== project);

    return {
      gate: 'patterns',
      status: otherProjectPatterns.length > 0 ? 'success' : 'empty',
      duration_ms: Date.now() - startTime,
      count: otherProjectPatterns.length,
      data: otherProjectPatterns.slice(0, 5).map(p => ({
        id: p.id,
        name: p.name,
        project: p.projectId,
        problem: p.problem.substring(0, 100) + (p.problem.length > 100 ? '...' : ''),
      })),
    };
  } catch (error) {
    return {
      gate: 'patterns',
      status: 'error',
      duration_ms: Date.now() - startTime,
      count: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Pattern search failed',
    };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '.cache',
]);

async function searchFilesRecursive(
  dir: string,
  extension: string,
  searchTerm: string,
  matches: Array<{ file: string; line: number; content: string }>,
  maxMatches: number
): Promise<void> {
  if (matches.length >= maxMatches) return;

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await searchFilesRecursive(fullPath, extension, searchTerm, matches, maxMatches);
        }
      } else if (entry.isFile() && extname(entry.name) === extension) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
            if (lines[i]?.toLowerCase().includes(searchTerm)) {
              matches.push({
                file: fullPath,
                line: i + 1,
                content: (lines[i] || '').trim().substring(0, 100),
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}
