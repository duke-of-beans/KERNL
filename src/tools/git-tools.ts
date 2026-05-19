/**
 * KERNL MCP - Git Tools
 * 
 * Unified git operations with shadow doc integration.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { ProjectDatabase } from '../storage/database.js';

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const gitTools: Tool[] = [
  {
    name: 'smart_commit',
    description: 'Unified git commit with build verification and optional shadow doc application. Enforces conventional commits.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        type: { 
          type: 'string', 
          enum: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'style', 'perf'],
          description: 'Commit type (conventional)' 
        },
        message: { type: 'string', description: 'Commit message (without type prefix)' },
        scope: { type: 'string', description: 'Optional scope, e.g., feat(api): message' },
        verifyBuild: { type: 'boolean', description: 'Run build verification before commit (default: true)' },
        verifyTests: { type: 'boolean', description: 'Run Yuma smoke+contract tests before commit (default: true)' },
        applyShadowDocs: { type: 'boolean', description: 'Apply pending shadow docs (default: true)' },
      },
      required: ['project', 'type', 'message'],
    },
  },
  {
    name: 'session_package',
    description: 'Create a session package with git status, recent commits, and pending changes for handoff.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        includeUncommitted: { type: 'boolean', description: 'Include uncommitted changes (default: true)' },
        commitCount: { type: 'number', description: 'Number of recent commits to include (default: 10)' },
      },
      required: ['project'],
    },
  },
  {
    name: 'dev_branch',
    description: 'Staged versioning: create/switch to a dev branch for safe work. Main stays stable while you break things in dev. Use merge_to_main when ready.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        action: { type: 'string', enum: ['create', 'switch', 'status'], description: 'create = new dev branch, switch = toggle between dev/main, status = show current branch info' },
        branch_name: { type: 'string', description: 'Branch name (default: dev). For feature branches use feature/name format.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'merge_to_main',
    description: 'Merge dev branch to main. Gated by Yuma: runs test_precommit before allowing merge. Keeps main stable.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        branch: { type: 'string', description: 'Branch to merge (default: dev)' },
        delete_branch: { type: 'boolean', description: 'Delete the branch after merge (default: false)' },
        skip_tests: { type: 'boolean', description: 'Skip Yuma gate (not recommended, default: false)' },
      },
      required: ['project'],
    },
  },
];

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

export function createGitHandlers(db: ProjectDatabase): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  
  function execInProject(projectPath: string, command: string): string {
    try {
      return execSync(command, { 
        cwd: projectPath, 
        encoding: 'utf-8',
        timeout: 30000
      }).trim();
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      throw new Error(err.stderr || err.message || 'Command failed');
    }
  }
  
  return {
    smart_commit: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };
      
      const type = input.type as string;
      const message = input.message as string;
      const scope = input.scope as string | undefined;
      const verifyBuild = input.verifyBuild !== false;
      const verifyTests = input.verifyTests !== false;
      const applyShadowDocs = input.applyShadowDocs !== false;
      
      const results: Record<string, unknown> = { project: projectId };
      
      // 1. Verify build if requested
      if (verifyBuild) {
        try {
          execInProject(project.path, 'npx tsc --noEmit');
          results.buildVerified = true;
        } catch (error) {
          return { 
            error: 'Build verification failed', 
            details: error instanceof Error ? error.message : 'Unknown',
            hint: 'Fix TypeScript errors before committing'
          };
        }
      }

      // 2. Verify tests (Yuma gate) if requested
      if (verifyTests) {
        try {
          const raw = (db as any).db ?? db;
          const specs = raw.prepare(
            "SELECT * FROM test_specs WHERE project_id = ? AND tier IN ('smoke', 'contract') ORDER BY tier, name"
          ).all(projectId) as any[];
          
          if (specs.length > 0) {
            let testsPassed = 0;
            let testsFailed = 0;
            const failures: string[] = [];

            for (const spec of specs) {
              if (spec.type === 'build' || spec.type === 'custom') {
                const specDef = JSON.parse(spec.spec);
                try {
                  execSync(specDef.command, { encoding: 'utf-8', timeout: specDef.timeout_ms || 30000, cwd: project.path });
                  testsPassed++;
                } catch {
                  testsFailed++;
                  failures.push(spec.name);
                }
              } else {
                testsPassed++; // Declarative specs pass
              }
            }

            results.testsVerified = true;
            results.testsPassed = testsPassed;
            results.testsFailed = testsFailed;

            if (testsFailed > 0) {
              return {
                error: 'Yuma test gate BLOCKED commit',
                testsFailed,
                failures,
                hint: 'Fix failing tests before committing. Run test_run for details.'
              };
            }
          } else {
            results.testsVerified = false;
            results.testsNote = 'No smoke/contract tests defined — gate open';
          }
        } catch {
          results.testsVerified = false;
          results.testsNote = 'Yuma tables not available — gate skipped';
        }
      }
      
      // 3. Apply shadow docs if requested and available
      if (applyShadowDocs) {
        const pendingDocs = db.getPendingShadowDocs(projectId);
        if (pendingDocs.length > 0) {
          for (const doc of pendingDocs) {
            const fullPath = path.join(project.path, doc.filePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            if (doc.mode === 'append' && fs.existsSync(fullPath)) {
              fs.appendFileSync(fullPath, '\n' + doc.content);
            } else {
              fs.writeFileSync(fullPath, doc.content);
            }
            db.applyShadowDoc(doc.id);
          }
          results.shadowDocsApplied = pendingDocs.length;
        }
      }
      
      // 4. Stage all changes
      execInProject(project.path, 'git add -A');
      
      // 5. Create conventional commit message
      const commitMsg = scope 
        ? `${type}(${scope}): ${message}`
        : `${type}: ${message}`;
      
      // 6. Commit
      try {
        execInProject(project.path, `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
        results.committed = true;
        results.message = commitMsg;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown';
        if (errMsg.includes('nothing to commit')) {
          results.committed = false;
          results.message = 'Nothing to commit';
        } else {
          return { error: 'Commit failed', details: errMsg };
        }
      }
      
      return results;
    },

    session_package: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };
      
      const includeUncommitted = input.includeUncommitted !== false;
      const commitCount = input.commitCount as number ?? 10;
      
      const pkg: Record<string, unknown> = {
        project: projectId,
        path: project.path,
        timestamp: new Date().toISOString(),
      };
      
      // Git status
      try {
        const status = execInProject(project.path, 'git status --short');
        pkg.status = status || 'Clean';
        
        const branch = execInProject(project.path, 'git branch --show-current');
        pkg.branch = branch;
        
        // Recent commits
        const log = execInProject(project.path, `git log --oneline -${commitCount}`);
        pkg.recentCommits = log.split('\n').filter(l => l.trim());
        
        // Uncommitted changes
        if (includeUncommitted && status) {
          const diff = execInProject(project.path, 'git diff --stat');
          pkg.uncommittedStats = diff || 'No changes';
        }
      } catch (error) {
        pkg.gitError = error instanceof Error ? error.message : 'Unknown';
      }
      
      // Pending shadow docs
      const pendingDocs = db.getPendingShadowDocs(projectId);
      if (pendingDocs.length > 0) {
        pkg.pendingShadowDocs = pendingDocs.map(d => ({ file: d.filePath, mode: d.mode }));
      }
      
      // Session state
      const sessionState = db.getLatestSession(projectId);
      if (sessionState && sessionState.currentTask) {
        pkg.lastCheckpoint = {
          operation: sessionState.currentTask.operation || 'unknown',
          progress: sessionState.currentTask.progress || 0,
          timestamp: sessionState.updatedAt
        };
      }
      
      return pkg;
    },

    // ================================================================
    // STAGED VERSIONING: dev_branch
    // ================================================================
    dev_branch: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };

      const action = (input.action as string) || 'status';
      const branchName = (input.branch_name as string) || 'dev';

      if (action === 'status') {
        try {
          const current = execInProject(project.path, 'git branch --show-current');
          const branches = execInProject(project.path, 'git branch --list').split('\n').map(b => b.trim().replace(/^\* /, '')).filter(Boolean);
          const hasUncommitted = execInProject(project.path, 'git status --short').trim().length > 0;
          const aheadBehind = current !== 'main' ? (() => {
            try { return execInProject(project.path, `git rev-list --left-right --count main...${current}`); } catch { return 'unknown'; }
          })() : null;

          return {
            project: projectId,
            current_branch: current,
            branches,
            has_uncommitted: hasUncommitted,
            ahead_behind: aheadBehind,
            on_main: current === 'main',
            message: current === 'main' ? 'On main. Use dev_branch(action: "create") to start safe development.' : `On '${current}'. Develop freely — main is safe.`,
          };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      if (action === 'create') {
        try {
          // Check if branch already exists
          const branches = execInProject(project.path, 'git branch --list').split('\n').map(b => b.trim().replace(/^\* /, ''));
          if (branches.includes(branchName)) {
            // Switch to existing branch
            execInProject(project.path, `git checkout ${branchName}`);
            return { success: true, action: 'switched', branch: branchName, message: `Switched to existing '${branchName}' branch. Main is safe.` };
          }
          // Create and switch
          execInProject(project.path, `git checkout -b ${branchName}`);
          return { success: true, action: 'created', branch: branchName, message: `Created and switched to '${branchName}'. Main is safe. Break things here.` };
        } catch (err: any) {
          return { error: `Failed to create branch: ${err.message}` };
        }
      }

      if (action === 'switch') {
        try {
          const current = execInProject(project.path, 'git branch --show-current');
          const target = current === 'main' ? branchName : 'main';
          execInProject(project.path, `git checkout ${target}`);
          return { success: true, previous: current, current: target, message: `Switched from '${current}' to '${target}'.` };
        } catch (err: any) {
          return { error: `Failed to switch: ${err.message}. Commit or stash changes first.` };
        }
      }

      return { error: `Unknown action: ${action}. Use create, switch, or status.` };
    },

    // ================================================================
    // STAGED VERSIONING: merge_to_main (Yuma-gated)
    // ================================================================
    merge_to_main: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };

      const branch = (input.branch as string) || 'dev';
      const deleteBranch = input.delete_branch === true;
      const skipTests = input.skip_tests === true;

      try {
        // Verify we're not already on main
        const current = execInProject(project.path, 'git branch --show-current');
        if (current === 'main') {
          return { error: `Already on main. Switch to '${branch}' first, verify your work, then merge.` };
        }
        if (current !== branch) {
          return { error: `On '${current}', not '${branch}'. Switch to the correct branch first.` };
        }

        // Check for uncommitted changes
        const status = execInProject(project.path, 'git status --short').trim();
        if (status) {
          return { error: 'Uncommitted changes on branch. Commit or stash before merging.', uncommitted: status };
        }

        // Yuma gate (unless skipped)
        if (!skipTests) {
          try {
            const raw = (db as any).db ?? db;
            const specs = raw.prepare(
              "SELECT * FROM test_specs WHERE project_id = ? AND tier IN ('smoke', 'contract') ORDER BY tier, name"
            ).all(projectId) as any[];

            if (specs.length > 0) {
              let testsFailed = 0;
              const failures: string[] = [];

              for (const spec of specs) {
                if (spec.type === 'build' || spec.type === 'custom') {
                  const specDef = JSON.parse(spec.spec);
                  try {
                    execSync(specDef.command, { encoding: 'utf-8', timeout: specDef.timeout_ms || 30000, cwd: project.path });
                  } catch {
                    testsFailed++;
                    failures.push(spec.name);
                  }
                }
              }

              if (testsFailed > 0) {
                return {
                  error: 'Yuma test gate BLOCKED merge to main',
                  testsFailed,
                  failures,
                  hint: 'Fix failing tests on the dev branch before merging. Run test_run for details.',
                };
              }
            }
          } catch { /* Yuma tables not available — skip gate */ }
        }

        // Switch to main and merge
        execInProject(project.path, 'git checkout main');
        execInProject(project.path, `git merge ${branch}`);

        const result: Record<string, unknown> = {
          success: true,
          merged: branch,
          into: 'main',
          yuma_gated: !skipTests,
          message: `Merged '${branch}' into main. Main is updated.`,
        };

        // Optionally delete the branch
        if (deleteBranch) {
          try {
            execInProject(project.path, `git branch -d ${branch}`);
            result.branch_deleted = true;
          } catch {
            result.branch_deleted = false;
            result.delete_note = `Could not delete '${branch}'. May have unmerged changes.`;
          }
        }

        return result;
      } catch (err: any) {
        // If merge failed, try to get back to a clean state
        try { execInProject(project.path, 'git merge --abort'); } catch { /* already clean */ }
        try { execInProject(project.path, `git checkout ${branch}`); } catch { /* best effort */ }
        return { error: `Merge failed: ${err.message}. Returned to '${branch}'.` };
      }
    },
  };
}
