/**
 * KERNL - Project Operations Tools
 */
export const projectOperationsTools = [
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
export function createProjectOperationsHandlers(db) {
    return {
        pm_register_project: async (input) => {
            const existing = db.getProject(input.id);
            if (existing)
                return { error: `Project already exists: ${input.id}` };
            const project = db.createProject({
                id: input.id,
                name: input.name,
                path: input.path.replace(/\\/g, '/'),
                config: input.config || {},
                workspaceGroup: input.group
            });
            return { success: true, project };
        },
        pm_list_projects: async (_input) => {
            const projects = db.listProjects();
            return {
                count: projects.length,
                projects: projects.map(p => ({ id: p.id, name: p.name, path: p.path, group: p.workspaceGroup, visibility: p.visibility }))
            };
        },
        pm_get_project: async (input) => {
            const project = db.getProject(input.project);
            if (!project)
                return { error: `Project not found: ${input.project}` };
            return { project };
        },
        pm_update_project: async (input) => {
            const updated = db.updateProject(input.project, {
                name: input.name,
                config: input.config,
                workspaceGroup: input.group,
                visibility: input.visibility,
                notes: input.notes
            });
            if (!updated)
                return { error: `Project not found: ${input.project}` };
            return { success: true, project: db.getProject(input.project) };
        },
        pm_delete_project: async (input) => {
            const deleted = db.deleteProject(input.project);
            if (!deleted)
                return { error: `Project not found: ${input.project}` };
            return { success: true, message: `Project ${input.project} removed` };
        }
    };
}
//# sourceMappingURL=project-operations.js.map