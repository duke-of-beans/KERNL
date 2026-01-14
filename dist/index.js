/**
 * KERNL MCP - Entry Point
 * Version: 5.0.1
 *
 * The Core Intelligence Layer for AI Systems
 */
import { KernlMCPServer } from './server/mcp-server.js';
const server = new KernlMCPServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map