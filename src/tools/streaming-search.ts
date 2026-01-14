/**
 * KERNL MCP - Streaming Search Tools
 * 
 * Background search with progressive results.
 * Start a search, get results as they come in, stop early if needed.
 * 
 * Tools:
 * - sys_start_search: Start background search
 * - sys_get_more_search_results: Get paginated results
 * - sys_stop_search: Stop an active search
 * - sys_list_searches: List all active searches
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResult } from '../types/index.js';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

// ==========================================================================
// SEARCH SESSION TRACKING
// ==========================================================================

interface SearchResult {
  path: string;
  line?: number;
  content?: string;
  matchType: 'file' | 'content';
}

interface SearchSession {
  id: string;
  searchType: 'files' | 'content';
  pattern: string;
  path: string;
  status: 'running' | 'completed' | 'stopped';
  results: SearchResult[];
  startTime: Date;
  error?: string;
}

const searchSessions: Map<string, SearchSession> = new Map();
let searchCounter = 0;

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const streamingSearchTools: Tool[] = [
  {
    name: 'sys_start_search',
    description: `Start a streaming search that returns results progressively.

SEARCH TYPES:
- searchType="files": Find files by name pattern
- searchType="content": Search inside files for text

Returns a session ID. Use get_more_search_results to fetch results.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to search in',
        },
        pattern: {
          type: 'string',
          description: 'Search pattern (file name or content)',
        },
        searchType: {
          type: 'string',
          enum: ['files', 'content'],
          description: 'Type of search (default: files)',
          default: 'files',
        },
        filePattern: {
          type: 'string',
          description: 'Filter by file extension (e.g., "*.ts")',
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Case-insensitive search (default: true)',
          default: true,
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to find (default: 100)',
          default: 100,
        },
      },
      required: ['path', 'pattern'],
    },
  },
  {
    name: 'sys_get_more_search_results',
    description: 'Get results from an active search with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Search session ID from sys_start_search',
        },
        offset: {
          type: 'number',
          description: 'Result offset (default: 0)',
          default: 0,
        },
        length: {
          type: 'number',
          description: 'Number of results to return (default: 100)',
          default: 100,
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'sys_stop_search',
    description: 'Stop an active search session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Search session ID to stop',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'sys_list_searches',
    description: 'List all active and recent searches.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ==========================================================================
// HANDLERS
// ==========================================================================

interface StartSearchInput {
  path: string;
  pattern: string;
  searchType?: 'files' | 'content';
  filePattern?: string;
  ignoreCase?: boolean;
  maxResults?: number;
}

interface GetResultsInput {
  sessionId: string;
  offset?: number;
  length?: number;
}

interface StopSearchInput {
  sessionId: string;
}

export function createStreamingSearchHandlers() {
  return {
    sys_start_search: async (input: StartSearchInput): Promise<ToolResult<unknown>> => {
      const { 
        path: searchPath, 
        pattern, 
        searchType = 'files',
        filePattern,
        ignoreCase = true,
        maxResults = 100,
      } = input;

      if (!existsSync(searchPath)) {
        return {
          success: false,
          error: { code: 'PATH_NOT_FOUND', message: `Path not found: ${searchPath}` },
        };
      }

      const sessionId = `search_${++searchCounter}_${Date.now()}`;
      
      const session: SearchSession = {
        id: sessionId,
        searchType,
        pattern,
        path: searchPath,
        status: 'running',
        results: [],
        startTime: new Date(),
      };

      searchSessions.set(sessionId, session);

      // Start search in background
      (async () => {
        try {
          if (searchType === 'files') {
            await searchFiles(searchPath, pattern, ignoreCase, maxResults, session, filePattern);
          } else {
            await searchContent(searchPath, pattern, ignoreCase, maxResults, session, filePattern);
          }
          session.status = 'completed';
        } catch (error) {
          session.status = 'completed';
          session.error = error instanceof Error ? error.message : 'Search failed';
        }
      })();

      // Return immediately with session ID
      return {
        success: true,
        data: {
          sessionId,
          searchType,
          pattern,
          path: searchPath,
          status: 'running',
          message: 'Search started. Use sys_get_more_search_results to fetch results.',
        },
      };
    },

    sys_get_more_search_results: async (input: GetResultsInput): Promise<ToolResult<unknown>> => {
      const { sessionId, offset = 0, length = 100 } = input;

      const session = searchSessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: `Search session not found: ${sessionId}` },
        };
      }

      const results = session.results.slice(offset, offset + length);
      const runtime = Date.now() - session.startTime.getTime();

      return {
        success: true,
        data: {
          sessionId,
          status: session.status,
          runtime_ms: runtime,
          totalResults: session.results.length,
          offset,
          returned: results.length,
          results,
          error: session.error,
        },
      };
    },

    sys_stop_search: async (input: StopSearchInput): Promise<ToolResult<unknown>> => {
      const { sessionId } = input;

      const session = searchSessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: `Search session not found: ${sessionId}` },
        };
      }

      session.status = 'stopped';

      return {
        success: true,
        data: {
          sessionId,
          status: 'stopped',
          resultsFound: session.results.length,
        },
      };
    },

    sys_list_searches: async (): Promise<ToolResult<unknown>> => {
      const searches = Array.from(searchSessions.values()).map(s => ({
        sessionId: s.id,
        searchType: s.searchType,
        pattern: s.pattern,
        path: s.path,
        status: s.status,
        resultCount: s.results.length,
        runtime_ms: Date.now() - s.startTime.getTime(),
      }));

      // Clean up old completed searches (older than 5 minutes)
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [id, session] of searchSessions) {
        if (session.status !== 'running' && session.startTime.getTime() < cutoff) {
          searchSessions.delete(id);
        }
      }

      return {
        success: true,
        data: {
          count: searches.length,
          searches,
        },
      };
    },
  };
}

// ==========================================================================
// SEARCH IMPLEMENTATIONS
// ==========================================================================

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '.cache', '__pycache__',
]);

async function searchFiles(
  dir: string,
  pattern: string,
  ignoreCase: boolean,
  maxResults: number,
  session: SearchSession,
  filePattern?: string
): Promise<void> {
  const searchPattern = ignoreCase ? pattern.toLowerCase() : pattern;
  
  async function scan(currentPath: string): Promise<void> {
    if (session.status !== 'running' || session.results.length >= maxResults) return;

    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (session.status !== 'running' || session.results.length >= maxResults) break;
        
        const fullPath = join(currentPath, entry.name);
        const nameToMatch = ignoreCase ? entry.name.toLowerCase() : entry.name;
        
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            // Check if directory name matches
            if (nameToMatch.includes(searchPattern)) {
              session.results.push({
                path: fullPath,
                matchType: 'file',
              });
            }
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          // Check file pattern filter
          if (filePattern) {
            const ext = extname(entry.name);
            const filterExt = filePattern.replace('*', '');
            if (!entry.name.endsWith(filterExt)) continue;
          }
          
          if (nameToMatch.includes(searchPattern)) {
            session.results.push({
              path: fullPath,
              matchType: 'file',
            });
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await scan(dir);
}

async function searchContent(
  dir: string,
  pattern: string,
  ignoreCase: boolean,
  maxResults: number,
  session: SearchSession,
  filePattern?: string
): Promise<void> {
  const TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt',
    '.html', '.css', '.scss', '.yaml', '.yml', '.xml',
    '.sql', '.sh', '.py', '.rb', '.go', '.rs', '.c', '.cpp',
  ]);

  async function scan(currentPath: string): Promise<void> {
    if (session.status !== 'running' || session.results.length >= maxResults) return;

    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (session.status !== 'running' || session.results.length >= maxResults) break;
        
        const fullPath = join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (!TEXT_EXTENSIONS.has(ext)) continue;
          
          // Check file pattern filter
          if (filePattern) {
            const filterExt = filePattern.replace('*', '');
            if (!entry.name.endsWith(filterExt)) continue;
          }
          
          try {
            const content = await readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const searchPattern = ignoreCase ? pattern.toLowerCase() : pattern;
            
            for (let i = 0; i < lines.length && session.results.length < maxResults; i++) {
              const lineToMatch = ignoreCase ? lines[i]?.toLowerCase() : lines[i];
              if (lineToMatch?.includes(searchPattern)) {
                session.results.push({
                  path: fullPath,
                  line: i + 1,
                  content: (lines[i] || '').trim().substring(0, 200),
                  matchType: 'content',
                });
              }
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await scan(dir);
}
