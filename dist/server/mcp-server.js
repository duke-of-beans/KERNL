/**
 * KERNL MCP Server
 * Version: 5.0.1
 *
 * The core MCP server that exposes all tools to Claude.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { ProjectDatabase } from '../storage/database.js';
// Tool imports
import { stateManagementTools, createStateManagementHandlers } from '../tools/state-management.js';
import { projectOperationsTools, createProjectOperationsHandlers } from '../tools/project-operations.js';
import { fileOperationsTools, createFileOperationsHandlers } from '../tools/file-operations.js';
export class KernlMCPServer {
    server;
    db;
    tools;
    handlers;
    constructor() {
        const dbPath = process.env.PROJECT_MIND_DB_PATH ||
            process.env.PROJECT_MIND_DB ||
            process.env.KERNL_DB ||
            'D:/Projects/Project Mind/kernl-mcp/data/project-mind.db';
        this.db = new ProjectDatabase(dbPath);
        this.tools = new Map();
        this.handlers = new Map();
        this.server = new Server({
            name: 'kernl-mcp',
            version: '5.0.1',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.registerAllTools();
        this.setupRequestHandlers();
        this.setupErrorHandling();
    }
    registerAllTools() {
        // State Management Tools
        const stateHandlers = createStateManagementHandlers(this.db);
        for (const tool of stateManagementTools) {
            this.tools.set(tool.name, tool);
            const handler = stateHandlers[tool.name];
            if (handler) {
                this.handlers.set(tool.name, handler);
            }
        }
        // Project Operations Tools  
        const projectHandlers = createProjectOperationsHandlers(this.db);
        for (const tool of projectOperationsTools) {
            this.tools.set(tool.name, tool);
            const handler = projectHandlers[tool.name];
            if (handler) {
                this.handlers.set(tool.name, handler);
            }
        }
        // File Operations Tools
        const fileHandlers = createFileOperationsHandlers(this.db);
        for (const tool of fileOperationsTools) {
            this.tools.set(tool.name, tool);
            const handler = fileHandlers[tool.name];
            if (handler) {
                this.handlers.set(tool.name, handler);
            }
        }
        // Version tool
        const versionTool = {
            name: 'kernl_version',
            description: 'Get KERNL version and status information',
            inputSchema: { type: 'object', properties: {} },
        };
        this.tools.set(versionTool.name, versionTool);
        this.handlers.set('kernl_version', async () => ({
            name: 'KERNL',
            version: '5.0.1',
            description: 'The Core Intelligence Layer for AI Systems',
            status: 'rebuilding',
            toolCount: this.tools.size,
            categories: ['Session', 'Project', 'Filesystem']
        }));
        console.error(`[KERNL] Registered ${this.tools.size} tools`);
    }
    setupRequestHandlers() {
        // List all available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: Array.from(this.tools.values()),
            };
        });
        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const handler = this.handlers.get(name);
            if (!handler) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
                    isError: true,
                };
            }
            try {
                const result = await handler(args ?? {});
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error(`[KERNL] Error in ${name}:`, errorMessage);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
                    isError: true,
                };
            }
        });
    }
    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error('[KERNL] Server error:', error);
        };
        process.on('SIGINT', () => {
            this.shutdown();
            process.exit(0);
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        console.error('[KERNL] Starting server v5.0.1...');
        console.error('[KERNL] The Core Intelligence Layer for AI Systems');
        await this.server.connect(transport);
        console.error('[KERNL] Server running. Waiting for requests...');
    }
    shutdown() {
        console.error('[KERNL] Shutting down...');
        this.db.close();
    }
}
//# sourceMappingURL=mcp-server.js.map