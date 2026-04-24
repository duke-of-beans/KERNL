/**
 * KERNL MCP Server
 * Version: 5.1.0
 * 
 * The core MCP server that exposes all tools to Claude.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
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
  private server: Server;
  private db: ProjectDatabase;
  private tools: Map<string, Tool>;
  private handlers: Map<string, (input: unknown) => Promise<unknown>>;

  constructor() {
    const dbPath = process.env.PROJECT_MIND_DB_PATH || 
                   process.env.PROJECT_MIND_DB || 
                   process.env.KERNL_DB ||
                   'D:/Projects/Project Mind/kernl-mcp/data/project-mind.db';
    
    this.db = new ProjectDatabase(dbPath);
    this.tools = new Map();
    this.handlers = new Map();

    this.server = new Server(
      { name: 'kernl-mcp', version: '5.1.0' },
      { capabilities: { tools: {} } }
    );

    this.registerAllTools();
    this.setupRequestHandlers();
    this.setupErrorHandling();
  }

  private registerAllTools(): void {
    const register = (tools: Tool[], handlers: Record<string, (input: unknown) => Promise<unknown>>) => {
      for (const tool of tools) {
        this.tools.set(tool.name, tool);
        const h = handlers[tool.name];
        if (h) this.handlers.set(tool.name, h);
      }
    };

    register(stateManagementTools,  createStateManagementHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(projectOperationsTools, createProjectOperationsHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(fileOperationsTools,    createFileOperationsHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(semanticSearchTools,    createSemanticSearchHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(patternRecognitionTools,createPatternRecognitionHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(parallelGatesTools,     createParallelGatesHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(processManagementTools, createProcessManagementHandlers() as Record<string, (input: unknown) => Promise<unknown>>);
    register(streamingSearchTools,   createStreamingSearchHandlers() as Record<string, (input: unknown) => Promise<unknown>>);
    register(systemFileTools,        createSystemFileHandlers() as Record<string, (input: unknown) => Promise<unknown>>);
    register(configMetaTools,        createConfigMetaHandlers(Array.from(this.tools.values())) as Record<string, (input: unknown) => Promise<unknown>>);
    register(chromeTools,            createChromeHandlers() as Record<string, (input: unknown) => Promise<unknown>>);
    register(shadowDocTools,         createShadowDocHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(gitTools,               createGitHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(backlogTools,           createBacklogHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);
    register(testingTools,           createTestingHandlers(Array.from(this.tools.values())) as Record<string, (input: unknown) => Promise<unknown>>);
    register(utilityTools,           createUtilityHandlers() as Record<string, (input: unknown) => Promise<unknown>>);
    register(researchTools,          createResearchHandlers(this.db) as Record<string, (input: unknown) => Promise<unknown>>);

    // Phase 8: Brain Intelligence
    register(brainTools, createBrainHandlers() as Record<string, (input: unknown) => Promise<unknown>>);

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
      categories: ['Session','Project','Filesystem','Intelligence','Patterns','Gates',
                   'Process','Search','Files','Config','Chrome','ShadowDocs','Git',
                   'Backlog','Testing','Utility','Research','Brain'],
    }));

    console.error(`[KERNL] Registered ${this.tools.size} tools (v5.1.0 — Brain layer active)`);
  }

  private setupRequestHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.from(this.tools.values()),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = this.handlers.get(name);
      if (!handler) return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
      try {
        const result = await handler(args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[KERNL] Error in ${name}:`, msg);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error('[KERNL] Server error:', error);
    process.on('SIGINT', () => { this.shutdown(); process.exit(0); });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    console.error('[KERNL] Starting server v5.1.0...');
    console.error('[KERNL] Brain intelligence layer active — brain.db connected');
    await this.server.connect(transport);
    console.error('[KERNL] Server running. Waiting for requests...');
  }

  shutdown(): void {
    console.error('[KERNL] Shutting down...');
    this.db.close();
  }
}
