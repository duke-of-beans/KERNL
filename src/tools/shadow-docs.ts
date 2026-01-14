/**
 * KERNL MCP - Shadow Documentation Tools
 * 
 * Non-blocking documentation updates that queue for later commit.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectDatabase } from '../storage/database.js';
import * as path from 'path';
import * as fs from 'fs';

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const shadowDocTools: Tool[] = [
  {
    name: 'shadow_doc_update',
    description: 'Queue a documentation update without blocking code work. Applied during smart_commit.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        file: { type: 'string', description: 'Relative path to doc file' },
        content: { type: 'string', description: 'Content to write' },
        mode: { type: 'string', enum: ['rewrite', 'append'], description: 'Write mode (default: append)' },
        commitWith: { type: 'string', description: 'When to apply: "next_code_commit" or "manual"' },
      },
      required: ['project', 'file', 'content'],
    },
  },
  {
    name: 'list_pending_doc_updates',
    description: 'List all pending shadow documentation updates.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
      },
      required: ['project'],
    },
  },
  {
    name: 'cancel_pending_doc_update',
    description: 'Cancel a pending documentation update.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        id: { type: 'number', description: 'Shadow doc ID to cancel' },
      },
      required: ['project', 'id'],
    },
  },
  {
    name: 'apply_pending_doc_updates',
    description: 'Manually apply all pending documentation updates without committing.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
      },
      required: ['project'],
    },
  },
];

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

export function createShadowDocHandlers(db: ProjectDatabase): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    shadow_doc_update: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };
      
      const file = input.file as string;
      const content = input.content as string;
      const mode = (input.mode as 'rewrite' | 'append') || 'append';
      const commitWith = (input.commitWith as string) || 'next_code_commit';
      
      // Use createShadowDoc method
      const id = db.createShadowDoc({
        projectId,
        filePath: file,
        content,
        mode,
        commitWith,
      });
      
      return {
        success: true,
        id,
        file,
        mode,
        commitWith,
        message: `Documentation update queued. Will be applied during ${commitWith}.`
      };
    },

    list_pending_doc_updates: async (input) => {
      const projectId = input.project as string;
      const pendingDocs = db.getPendingShadowDocs(projectId);
      
      return {
        project: projectId,
        count: pendingDocs.length,
        pending: pendingDocs.map(d => ({
          id: d.id,
          file: d.filePath,
          commitWith: d.commitWith,
          createdAt: d.createdAt,
          preview: d.content.substring(0, 100) + (d.content.length > 100 ? '...' : '')
        }))
      };
    },

    cancel_pending_doc_update: async (input) => {
      const id = input.id as number;
      const success = db.cancelShadowDoc(id);
      return { success, id, message: success ? 'Cancelled' : 'Not found or already applied' };
    },

    apply_pending_doc_updates: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };
      
      const pendingDocs = db.getPendingShadowDocs(projectId);
      const applied: string[] = [];
      
      for (const doc of pendingDocs) {
        const fullPath = path.join(project.path, doc.filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        // Get mode from database or default to append
        const mode = 'append'; // Default, since mode isn't stored separately
        if (mode === 'append' && fs.existsSync(fullPath)) {
          fs.appendFileSync(fullPath, '\n' + doc.content);
        } else {
          fs.writeFileSync(fullPath, doc.content);
        }
        db.applyShadowDoc(doc.id);
        applied.push(doc.filePath);
      }
      
      return {
        success: true,
        appliedCount: applied.length,
        files: applied,
        message: applied.length > 0 
          ? `Applied ${applied.length} documentation updates. Remember to commit.`
          : 'No pending updates to apply.'
      };
    },
  };
}
