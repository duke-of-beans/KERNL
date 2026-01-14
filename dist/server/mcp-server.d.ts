/**
 * KERNL MCP Server
 * Version: 5.0.1
 *
 * The core MCP server that exposes all tools to Claude.
 */
export declare class KernlMCPServer {
    private server;
    private db;
    private tools;
    private handlers;
    constructor();
    private registerAllTools;
    private setupRequestHandlers;
    private setupErrorHandling;
    run(): Promise<void>;
    shutdown(): void;
}
//# sourceMappingURL=mcp-server.d.ts.map