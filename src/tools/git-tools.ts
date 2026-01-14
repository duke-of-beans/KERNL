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
      
      // 2. Apply shadow docs if requested and available
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
      
      // 3. Stage all changes
      execInProject(project.path, 'git add -A');
      
      // 4. Create conventional commit message
      const commitMsg = scope 
        ? `${type}(${scope}): ${message}`
        : `${type}: ${message}`;
      
      // 5. Commit
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
  };
}
