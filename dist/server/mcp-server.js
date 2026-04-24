/**
 * KERNL MCP Server
 * Version: 5.1.0
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
// Phase 2: Intelligence Layer
import { semanticSearchTools, createSemanticSearchHandlers } from '../tools/semantic-search.js';
import { patternRecognitionTools, createPatternRecognitionHandlers } from '../tools/pattern-recognition.js';
import { parallelGatesTools, createParallelGatesHandlers } from '../tools/parallel-gates.js';
// Phase 3: Desktop Commander Parity
import { processManagementTools, createProcessManagementHandlers } from '../tools/process-management.js';
import { streamingSearchTools, createStreamingSearchHandlers } from '../tools/streaming-search.js';
import { systemFileTools, createSystemFileHandlers } from '../tools/system-files.js';
import { configMetaTools, createConfigMetaHandlers } from '../tools/config-meta.js';
// Phase 4: Chrome Automation
import { chromeTools, createChromeHandlers } from '../chrome/chrome-tools.js';
// Phase 5: Shadow Docs and Git
import { shadowDocTools, createShadowDocHandlers } from '../tools/shadow-docs.js';
import { gitTools, createGitHandlers } from '../tools/git-tools.js';
// Phase 6: Backlog and Testing
import { backlogTools, createBacklogHandlers } from '../tools/backlog-tools.js';
import { testingTools, createTestingHandlers } from '../tools/testing-tools.js';
// Phase 7: Utilities and Research
import { utilityTools, createUtilityHandlers } from '../tools/utility-tools.js';
import { researchTools, createResearchHandlers } from '../tools/research-tools.js';
// Phase 8: Brain Intelligence (brain.db live context + graph recall)
import { brainTools, createBrainHandlers } from '../tools/brain-tools.js';
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
        this.server = new Server({ name: 'kernl-mcp', version: '5.1.0' }, { capabilities: { tools: {} } });
        this.registerAllTools();
        this.setupRequestHandlers();
        this.setupErrorHandling();
    }
    registerAllTools() {
        const register = (tools, handlers) => {
            for (const tool of tools) {
                this.tools.set(tool.name, tool);
                const h = handlers[tool.name];
                if (h)
                    this.handlers.set(tool.name, h);
            }
        };
        register(stateManagementTools, createStateManagementHandlers(this.db));
        register(projectOperationsTools, createProjectOperationsHandlers(this.db));
        register(fileOperationsTools, createFileOperationsHandlers(this.db));
        register(semanticSearchTools, createSemanticSearchHandlers(this.db));
        register(patternRecognitionTools, createPatternRecognitionHandlers(this.db));
        register(parallelGatesTools, createParallelGatesHandlers(this.db));
        register(processManagementTools, createProcessManagementHandlers());
        register(streamingSearchTools, createStreamingSearchHandlers());
        register(systemFileTools, createSystemFileHandlers());
        register(configMetaTools, createConfigMetaHandlers(Array.from(this.tools.values())));
        register(chromeTools, createChromeHandlers());
        register(shadowDocTools, createShadowDocHandlers(this.db));
        register(gitTools, createGitHandlers(this.db));
        register(backlogTools, createBacklogHandlers(this.db));
        register(testingTools, createTestingHandlers(Array.from(this.tools.values())));
        register(utilityTools, createUtilityHandlers());
        register(researchTools, createResearchHandlers(this.db));
        // Phase 8: Brain Intelligence
        register(brainTools, createBrainHandlers());
        // Version tool
        this.tools.set('kernl_version', {
            name: 'kernl_version',
            description: 'Get KERNL version and status information',
            inputSchema: { type: 'object', properties: {} },
        });
        this.handlers.set('kernl_version', async () => ({
            name: 'KERNL', version: '5.1.0',
            description: 'The Core Intelligence Layer for AI Systems — now with brain.db intelligence',
            toolCount: this.tools.size,
            categories: ['Session', 'Project', 'Filesystem', 'Intelligence', 'Patterns', 'Gates',
                'Process', 'Search', 'Files', 'Config', 'Chrome', 'ShadowDocs', 'Git',
                'Backlog', 'Testing', 'Utility', 'Research', 'Brain'],
        }));
        console.error(`[KERNL] Registered ${this.tools.size} tools (v5.1.0 — Brain layer active)`);
    }
    setupRequestHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: Array.from(this.tools.values()),
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const handler = this.handlers.get(name);
            if (!handler)
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
                    isError: true,
                };
            try {
                const result = await handler(args ?? {});
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                console.error(`[KERNL] Error in ${name}:`, msg);
                return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
            }
        });
    }
    setupErrorHandling() {
        this.server.onerror = (error) => console.error('[KERNL] Server error:', error);
        process.on('SIGINT', () => { this.shutdown(); process.exit(0); });
    }
    async run() {
        const transport = new StdioServerTransport();
        console.error('[KERNL] Starting server v5.1.0...');
        console.error('[KERNL] Brain intelligence layer active — brain.db connected');
        await this.server.connect(transport);
        console.error('[KERNL] Server running. Waiting for requests...');
    }
    shutdown() {
        console.error('[KERNL] Shutting down...');
        this.db.close();
    }
}
//# sourceMappingURL=mcp-server.js.map