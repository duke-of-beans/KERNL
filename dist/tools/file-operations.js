/**
 * KERNL - File Operations Tools
 * Project-aware file read/write/search
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, basename, extname, relative, dirname } from 'path';
export const fileOperationsTools = [
    {
        name: 'pm_read_file',
        description: 'Read file contents from a project.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Project ID' },
                path: { type: 'string', description: 'File path (relative to project or absolute)' },
                offset: { type: 'number', description: 'Start line (0-based)' },
                length: { type: 'number', description: 'Number of lines to read' }
            },
            required: ['project', 'path']
        }
    },
    {
        name: 'pm_write_file',
        description: 'Write content to a project file.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Project ID' },
                path: { type: 'string', description: 'File path' },
                content: { type: 'string', description: 'Content to write' },
                mode: { type: 'string', enum: ['rewrite', 'append'] }
            },
            required: ['project', 'path', 'content']
        }
    },
    {
        name: 'pm_search_files',
        description: 'Search files by pattern within a project.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Project ID' },
                pattern: { type: 'string', description: 'Search pattern' },
                contentSearch: { type: 'string', description: 'Search within file contents' },
                maxResults: { type: 'number' }
            },
            required: ['project', 'pattern']
        }
    },
    {
        name: 'pm_list_files',
        description: 'List files in a project directory.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Project ID' },
                path: { type: 'string', description: 'Directory path (relative to project)' },
                recursive: { type: 'boolean' },
                extensions: { type: 'array', items: { type: 'string' } }
            },
            required: ['project']
        }
    },
    {
        name: 'pm_batch_read',
        description: 'Read multiple files at once.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Project ID' },
                paths: { type: 'array', items: { type: 'string' } }
            },
            required: ['project', 'paths']
        }
    },
    {
        name: 'pm_get_file_info',
        description: 'Get metadata about a file.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: 'Project ID' },
                path: { type: 'string', description: 'File path' }
            },
            required: ['project', 'path']
        }
    }
];
function resolvePath(db, projectId, filePath) {
    const project = db.getProject(projectId);
    if (!project) {
        throw new Error(`Project not found: ${projectId}`);
    }
    if (filePath.match(/^[A-Za-z]:|^\//)) {
        return filePath;
    }
    return join(project.path, filePath);
}
function listFilesRecursive(dir, extensions) {
    const results = [];
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules')
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push({ path: fullPath, name: entry.name, type: 'directory' });
                results.push(...listFilesRecursive(fullPath, extensions));
            }
            else {
                const ext = extname(entry.name);
                if (!extensions || extensions.length === 0 || extensions.includes(ext)) {
                    const stats = statSync(fullPath);
                    results.push({ path: fullPath, name: entry.name, type: 'file', size: stats.size, extension: ext });
                }
            }
        }
    }
    catch { /* skip inaccessible */ }
    return results;
}
export function createFileOperationsHandlers(db) {
    return {
        pm_read_file: async (input) => {
            try {
                const fullPath = resolvePath(db, input.project, input.path);
                const content = readFileSync(fullPath, 'utf-8');
                if (input.offset !== undefined || input.length !== undefined) {
                    const lines = content.split('\n');
                    const start = input.offset || 0;
                    const end = input.length ? start + input.length : lines.length;
                    return { content: lines.slice(start, end).join('\n'), totalLines: lines.length, range: { start, end: Math.min(end, lines.length) } };
                }
                return { content };
            }
            catch (error) {
                return { error: `Failed to read: ${error instanceof Error ? error.message : error}` };
            }
        },
        pm_write_file: async (input) => {
            try {
                const fullPath = resolvePath(db, input.project, input.path);
                const dir = dirname(fullPath);
                if (!existsSync(dir))
                    mkdirSync(dir, { recursive: true });
                if (input.mode === 'append') {
                    const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '';
                    writeFileSync(fullPath, existing + input.content, 'utf-8');
                }
                else {
                    writeFileSync(fullPath, input.content, 'utf-8');
                }
                return { success: true, path: fullPath };
            }
            catch (error) {
                return { error: `Failed to write: ${error instanceof Error ? error.message : error}` };
            }
        },
        pm_search_files: async (input) => {
            const project = db.getProject(input.project);
            if (!project)
                return { error: `Project not found: ${input.project}` };
            const allFiles = listFilesRecursive(project.path);
            const patternRegex = new RegExp(input.pattern.replace(/\*/g, '.*'), 'i');
            let matches = allFiles.filter(f => f.type === 'file' && patternRegex.test(f.path));
            if (input.contentSearch) {
                matches = matches.filter(f => {
                    try {
                        return readFileSync(f.path, 'utf-8').includes(input.contentSearch);
                    }
                    catch {
                        return false;
                    }
                });
            }
            return { count: matches.length, results: matches.slice(0, input.maxResults || 50).map(f => ({ path: relative(project.path, f.path), name: f.name, size: f.size })) };
        },
        pm_list_files: async (input) => {
            const project = db.getProject(input.project);
            if (!project)
                return { error: `Project not found: ${input.project}` };
            const targetPath = input.path ? join(project.path, input.path) : project.path;
            let files;
            if (input.recursive) {
                files = listFilesRecursive(targetPath, input.extensions);
            }
            else {
                try {
                    const entries = readdirSync(targetPath, { withFileTypes: true });
                    files = entries.filter(e => !e.name.startsWith('.')).map(e => ({
                        path: join(targetPath, e.name), name: e.name,
                        type: e.isDirectory() ? 'directory' : 'file',
                        extension: e.isFile() ? extname(e.name) : undefined
                    }));
                }
                catch {
                    return { error: `Cannot access: ${targetPath}` };
                }
            }
            return { count: files.length, files: files.map(f => ({ path: relative(project.path, f.path), name: f.name, type: f.type, size: f.size, extension: f.extension })) };
        },
        pm_batch_read: async (input) => {
            const results = {};
            for (const path of input.paths) {
                try {
                    const fullPath = resolvePath(db, input.project, path);
                    results[path] = { content: readFileSync(fullPath, 'utf-8') };
                }
                catch (error) {
                    results[path] = { error: error instanceof Error ? error.message : String(error) };
                }
            }
            return { results };
        },
        pm_get_file_info: async (input) => {
            try {
                const fullPath = resolvePath(db, input.project, input.path);
                const stats = statSync(fullPath);
                return { path: fullPath, name: basename(fullPath), size: stats.size, isDirectory: stats.isDirectory(), modifiedAt: stats.mtime.toISOString() };
            }
            catch {
                return { error: `File not found: ${input.path}` };
            }
        }
    };
}
//# sourceMappingURL=file-operations.js.map