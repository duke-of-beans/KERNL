/**
 * KERNL - Project Operations Tools
 */

import type { ProjectDatabase } from '../storage/database.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectConfig } from '../types/index.js';

export const projectOperationsTools: Tool[] = [
  {
    name: 'pm_register_project',
    description: 'Register a new project with KERNL.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique project ID (kebab-case)' },
        name: { type: 'string', description: 'Display name' },
        path: { type: 'string', description: 'Absolute path to project root' },
        config: { type: 'object' },
        group: { type: 'string' }
      },
      required: ['id', 'name', 'path']
    }
  },
  {
    name: 'pm_list_projects',
    description: 'List all registered projects.',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string' },
        visibility: { type: 'string', enum: ['active', 'archived', 'hidden'] }
      }
    }
  },
  {
    name: 'pm_get_project',
    description: 'Get details of a specific project.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' } },
      required: ['project']
    }
  },
  {
    name: 'pm_update_project',
    description: 'Update project configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        name: { type: 'string' },
        config: { type: 'object' },
        group: { type: 'string' },
        visibility: { type: 'string', enum: ['active', 'archived', 'hidden'] },
        notes: { type: 'string' }
      },
      required: ['project']
    }
  },
  {
    name: 'pm_delete_project',
    description: 'Remove a project from registry.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' } },
      required: ['project']
    }
  }
];

export function createProjectOperationsHandlers(db: ProjectDatabase) {
  return {
    pm_register_project: async (input: { id: string; name: string; path: string; config?: ProjectConfig; group?: string }) => {
      const existing = db.getProject(input.id);
      if (existing) return { error: `Project already exists: ${input.id}` };
      const project = db.createProject({
        id: input.id,
        name: input.name,
        path: input.path.replace(/\\/g, '/'),
        config: input.config || {},
        workspaceGroup: input.group
      });
      return { success: true, project };
    },

    pm_list_projects: async (_input: { group?: string; visibility?: string }) => {
      const projects = db.listProjects();
      return {
        count: projects.length,
        projects: projects.map(p => ({ id: p.id, name: p.name, path: p.path, group: p.workspaceGroup, visibility: p.visibility }))
      };
    },

    pm_get_project: async (input: { project: string }) => {
      const project = db.getProject(input.project);
      if (!project) return { error: `Project not found: ${input.project}` };
      return { project };
    },

    pm_update_project: async (input: { project: string; name?: string; config?: ProjectConfig; group?: string; visibility?: 'active' | 'archived' | 'hidden'; notes?: string }) => {
      const updated = db.updateProject(input.project, {
        name: input.name,
        config: input.config,
        workspaceGroup: input.group,
        visibility: input.visibility,
        notes: input.notes
      });
      if (!updated) return { error: `Project not found: ${input.project}` };
      return { success: true, project: db.getProject(input.project) };
    },

    pm_delete_project: async (input: { project: string }) => {
      const deleted = db.deleteProject(input.project);
      if (!deleted) return { error: `Project not found: ${input.project}` };
      return { success: true, message: `Project ${input.project} removed` };
    }
  };
}
