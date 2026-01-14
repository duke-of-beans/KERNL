/**
 * KERNL MCP Server
 * Version: 5.0.1
 *
 * The core MCP server that exposes all tools to Claude.
 * Handles tool registration, request routing, and error handling.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { ProjectDatabase } from '../storage/database.js';
// Tool imports will be added as we implement them
// import { stateManagementTools, createStateManagementHandlers } from '../tools/state-management.js';
export class KernlMCPServer {
    server;
    db;
    tools;
    handlers;
    constructor() {
        const dbPath = process.env.PROJECT_MIND_DB ||
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
        // Placeholder: Tools will be registered here as we implement them
        // For now, register a simple test tool
        const testTool = {
            name: 'kernl_version',
            description: 'Get KERNL version information',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        };
        this.tools.set(testTool.name, testTool);
        this.handlers.set('kernl_version', async () => ({
            success: true,
            data: {
                name: 'KERNL',
                version: '5.0.1',
                description: 'The Core Intelligence Layer for AI Systems',
                status: 'rebuilding',
                toolCount: this.tools.size,
            },
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
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: {
                                    code: 'TOOL_NOT_FOUND',
                                    message: `Unknown tool: ${name}`,
                                },
                            }),
                        },
                    ],
                    isError: true,
                };
            }
            try {
                const result = await handler(args ?? {});
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error(`[KERNL] Error in ${name}:`, errorMessage);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: {
                                    code: 'EXECUTION_ERROR',
                                    message: errorMessage,
                                },
                            }),
                        },
                    ],
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
            console.error('[KERNL] Shutting down...');
            this.shutdown();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.error('[KERNL] Terminating...');
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
        console.error('[KERNL] Closing database...');
        this.db.close();
        console.error('[KERNL] Shutdown complete.');
    }
    getDatabase() {
        return this.db;
    }
}
//# sourceMappingURL=mcp-server.js.map