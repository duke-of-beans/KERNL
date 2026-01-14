/**
 * KERNL MCP - Backlog Management Tools
 * 
 * Epic and task tracking for project management.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectDatabase } from '../storage/database.js';
import type { EpicStatus, EpicPriority } from '../types/index.js';

// ==========================================================================
// TOOL DEFINITIONS (5 tools)
// ==========================================================================

export const backlogTools: Tool[] = [
  {
    name: 'query_backlog',
    description: 'Query epics and tasks from the project backlog.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        status: { type: 'string', enum: ['backlog', 'in_progress', 'complete', 'blocked', 'all'], description: 'Filter by status' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'all'], description: 'Filter by priority' },
      },
      required: ['project'],
    },
  },
  {
    name: 'add_epic',
    description: 'Add a new epic to the project backlog.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        title: { type: 'string', description: 'Epic title' },
        description: { type: 'string', description: 'Epic description' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'Priority level (P0=critical)' },
        estimatedHours: { type: 'number', description: 'Estimated hours to complete' },
      },
      required: ['project', 'title'],
    },
  },
  {
    name: 'update_epic',
    description: 'Update an existing epic.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        id: { type: 'number', description: 'Epic ID' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        status: { type: 'string', enum: ['backlog', 'in_progress', 'complete', 'blocked'] },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      },
      required: ['project', 'id'],
    },
  },
  {
    name: 'complete_epic',
    description: 'Mark an epic as completed.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        id: { type: 'number', description: 'Epic ID to complete' },
        summary: { type: 'string', description: 'Completion summary' },
      },
      required: ['project', 'id'],
    },
  },
  {
    name: 'get_project_status',
    description: 'Get overall project status including backlog summary.',
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

export function createBacklogHandlers(db: ProjectDatabase): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    query_backlog: async (input) => {
      const projectId = input.project as string;
      const statusFilter = (input.status as string) || 'all';
      const priorityFilter = (input.priority as string) || 'all';
      
      const epics = db.getEpics(projectId);
      
      let filtered = epics;
      if (statusFilter !== 'all') {
        filtered = filtered.filter(e => e.status === statusFilter);
      }
      if (priorityFilter !== 'all') {
        filtered = filtered.filter(e => e.priority === priorityFilter);
      }
      
      return {
        project: projectId,
        totalEpics: epics.length,
        filtered: filtered.length,
        epics: filtered.map(e => ({
          id: e.id,
          title: e.title,
          status: e.status,
          priority: e.priority,
          estimatedHours: e.estimatedHours,
          createdAt: e.createdAt,
        })),
      };
    },

    add_epic: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };
      
      const priority = (input.priority as EpicPriority) || 'P2';
      const estimatedHours = input.estimatedHours as number | undefined;
      
      const id = db.createEpic({
        projectId,
        title: input.title as string,
        description: (input.description as string) || undefined,
        status: 'backlog' as EpicStatus,
        priority,
        estimatedHours,
      });
      
      return {
        success: true,
        id,
        title: input.title,
        message: `Epic #${id} created`,
      };
    },

    update_epic: async (input) => {
      const id = input.id as number;
      
      const updates: Record<string, unknown> = {};
      if (input.title) updates.title = input.title;
      if (input.description) updates.description = input.description;
      if (input.status) updates.status = input.status;
      if (input.priority) updates.priority = input.priority;
      
      const success = db.updateEpic(id, updates);
      return { success, id, updates };
    },

    complete_epic: async (input) => {
      const id = input.id as number;
      const summary = (input.summary as string) || '';
      
      const success = db.updateEpic(id, {
        status: 'complete' as EpicStatus,
        completedAt: new Date().toISOString(),
      });
      
      return {
        success,
        id,
        summary,
        message: success ? `Epic #${id} completed` : 'Epic not found',
      };
    },

    get_project_status: async (input) => {
      const projectId = input.project as string;
      const project = db.getProject(projectId);
      if (!project) return { error: `Project not found: ${projectId}` };
      
      const epics = db.getEpics(projectId);
      const backlog = epics.filter(e => e.status === 'backlog').length;
      const inProgress = epics.filter(e => e.status === 'in_progress').length;
      const complete = epics.filter(e => e.status === 'complete').length;
      const blocked = epics.filter(e => e.status === 'blocked').length;
      
      const totalEstimated = epics.reduce((sum, e) => sum + (e.estimatedHours || 0), 0);
      
      return {
        project: projectId,
        name: project.name,
        backlog: {
          total: epics.length,
          backlog,
          inProgress,
          complete,
          blocked,
          completionRate: epics.length > 0 ? Math.round((complete / epics.length) * 100) : 0,
        },
        estimates: {
          totalHours: totalEstimated,
        },
        criticalItems: epics.filter(e => e.priority === 'P0' && e.status !== 'complete').length,
      };
    },
  };
}
