/**
 * KERNL - State Management Tools
 * Session state, checkpoints, and crash recovery
 */

import type { ProjectDatabase } from '../storage/database.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

export const stateManagementTools: Tool[] = [
  {
    name: 'get_session_context',
    description: `Get session context with intelligent mode detection for KERNL projects.
USE AT START OF EVERY SESSION.`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        mode: { type: 'string', enum: ['auto', 'coding', 'architecture', 'debugging'] }
      },
      required: ['project']
    }
  },
  {
    name: 'check_resume_needed',
    description: 'Check if a previous session needs to be resumed.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' } },
      required: ['project']
    }
  },
  {
    name: 'auto_checkpoint',
    description: `Save automatic checkpoint for crash recovery. CALL EVERY 5-10 TOOL CALLS.`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        operation: { type: 'string' },
        progress: { type: 'number' },
        decisions: { type: 'array', items: { type: 'string' } },
        nextSteps: { type: 'array', items: { type: 'string' } },
        activeFiles: { type: 'array', items: { type: 'string' } },
        currentStep: { type: 'string' }
      },
      required: ['project', 'operation']
    }
  },
  {
    name: 'mark_complete',
    description: 'Mark session complete and clear checkpoint state.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['project']
    }
  }
];

export function createStateManagementHandlers(db: ProjectDatabase) {
  return {
    get_session_context: async (input: { project: string; mode?: string }) => {
      const project = db.getProject(input.project);
      if (!project) {
        return { error: `Project not found: ${input.project}` };
      }

      const checkpoint = db.getLatestCheckpoint(input.project);
      const needsResume = checkpoint !== null && (checkpoint.progress || 0) < 1.0;

      return {
        needsResume,
        checkpoint: checkpoint ? {
          operation: checkpoint.operation,
          progress: checkpoint.progress,
          decisions: checkpoint.decisions,
          nextSteps: checkpoint.nextSteps,
          activeFiles: checkpoint.activeFiles,
          createdAt: checkpoint.createdAt
        } : null,
        project: { id: project.id, name: project.name, path: project.path },
        mode: input.mode || 'auto'
      };
    },

    check_resume_needed: async (input: { project: string }) => {
      const checkpoint = db.getLatestCheckpoint(input.project);
      if (!checkpoint) {
        return { needsResume: false };
      }
      return {
        needsResume: (checkpoint.progress || 0) < 1.0,
        checkpoint: {
          operation: checkpoint.operation,
          progress: checkpoint.progress,
          decisions: checkpoint.decisions,
          nextSteps: checkpoint.nextSteps
        },
        createdAt: checkpoint.createdAt
      };
    },

    auto_checkpoint: async (input: {
      project: string;
      operation: string;
      progress?: number;
      decisions?: string[];
      nextSteps?: string[];
      activeFiles?: string[];
      currentStep?: string;
    }) => {
      const sessionId = randomUUID();
      db.saveCheckpoint({
        projectId: input.project,
        sessionId,
        operation: input.operation,
        progress: input.progress || 0,
        decisions: input.decisions,
        nextSteps: input.nextSteps,
        activeFiles: input.activeFiles,
        currentStep: input.currentStep
      });
      return {
        success: true,
        message: `Checkpoint saved: ${input.operation} (${Math.round((input.progress || 0) * 100)}%)`
      };
    },

    mark_complete: async (input: { project: string; summary?: string }) => {
      // Use raw db access to delete checkpoints
      const rawDb = (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
      rawDb.prepare('DELETE FROM checkpoints WHERE project_id = ?').run(input.project);
      return { success: true, message: 'Session marked complete' };
    }
  };
}
