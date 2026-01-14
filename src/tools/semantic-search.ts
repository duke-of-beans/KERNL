/**
 * KERNL MCP - Semantic Search Tools
 * 
 * Intelligence-powered search that understands meaning, not just text.
 * Uses local ONNX embeddings for semantic similarity.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectDatabase } from '../storage/database.js';
import type { ToolResult } from '../types/index.js';
import { readFile } from 'fs/promises';
import { join, extname, relative } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { readdir, stat } from 'fs/promises';
import {
  embed,
  findSimilar,
  serializeEmbedding,
  deserializeEmbedding,
  preload,
} from '../intelligence/embeddings.js';

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const semanticSearchTools: Tool[] = [
  {
    name: 'search_semantic',
    description:
      'Semantic search across project files - understands meaning, not just text. ' +
      'Use natural language queries like "authentication logic" or "database connection handling". ' +
      'Returns files ranked by semantic relevance.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        project: {
          type: 'string',
          description: 'Project ID',
        },
        fileTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by file extensions (e.g., [".ts", ".tsx"])',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
          default: 10,
        },
        minRelevance: {
          type: 'number',
          description: 'Minimum relevance score 0-1 (default: 0.3)',
          default: 0.3,
        },
      },
      required: ['query', 'project'],
    },
  },
  {
    name: 'pm_index_files',
    description:
      'Index project files for semantic search. ' +
      'Generates embeddings for all text files in the project. ' +
      'Run this before using search_semantic for best results.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific paths to index (optional, defaults to entire project)',
        },
        reindex: {
          type: 'boolean',
          description: 'Force reindex even if files unchanged (default: false)',
          default: false,
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'pm_index_file',
    description:
      'Index a single file for semantic search. ' +
      'Use for incremental indexing after file changes. ' +
      'Automatically called by pm_write_file.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID',
        },
        path: {
          type: 'string',
          description: 'File path (relative to project)',
        },
        force: {
          type: 'boolean',
          description: 'Force reindex even if unchanged (default: false)',
          default: false,
        },
      },
      required: ['project', 'path'],
    },
  },
  {
    name: 'pm_index_status',
    description:
      'Get indexing status for a project. ' +
      'Shows how many files are indexed and ready for semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID',
        },
      },
      required: ['project'],
    },
  },
];

// ==========================================================================
// HANDLERS
// ==========================================================================

interface SearchSemanticInput {
  query: string;
  project: string;
  fileTypes?: string[];
  limit?: number;
  minRelevance?: number;
}

interface IndexFilesInput {
  project: string;
  paths?: string[];
  reindex?: boolean;
}

interface IndexFileInput {
  project: string;
  path: string;
  force?: boolean;
}

interface IndexStatusInput {
  project: string;
}

export function createSemanticSearchHandlers(db: ProjectDatabase) {
  return {
    search_semantic: async (input: SearchSemanticInput): Promise<ToolResult<unknown>> => {
      const { query, project, fileTypes, limit = 10, minRelevance = 0.3 } = input;

      // Verify project exists
      const projectInfo = db.getProject(project);
      if (!projectInfo) {
        return {
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: `Project '${project}' not found` },
        };
      }

      // Get indexed files
      const indexedFiles = db.getIndexedFiles(project);
      
      // Filter by embedding existence and file types
      let candidates = indexedFiles.filter(f => f.embedding);
      
      if (fileTypes && fileTypes.length > 0) {
        candidates = candidates.filter(f => 
          fileTypes.some(ext => f.path.endsWith(ext))
        );
      }

      if (candidates.length === 0) {
        return {
          success: false,
          error: { 
            code: 'NO_INDEXED_FILES', 
            message: 'No indexed files found. Run pm_index_files first.' 
          },
        };
      }

      // Generate query embedding
      const queryEmbedding = await embed(query);

      // Find similar files
      const candidatesWithEmbeddings = candidates.map(f => ({
        id: f.path,
        embedding: deserializeEmbedding(f.embedding!),
      }));

      const similar = findSimilar(queryEmbedding, candidatesWithEmbeddings, limit, minRelevance);

      // Build results with previews
      const results = similar.map(match => {
        const file = candidates.find(f => f.path === match.id);
        return {
          path: match.id as string,
          relevance: Math.round(match.similarity * 100) / 100,
          preview: file?.content_preview?.substring(0, 200) || '',
        };
      });

      return {
        success: true,
        data: {
          query,
          matchCount: results.length,
          results,
        },
      };
    },

    pm_index_files: async (input: IndexFilesInput): Promise<ToolResult<unknown>> => {
      const { project, paths, reindex = false } = input;

      // Verify project exists
      const projectInfo = db.getProject(project);
      if (!projectInfo) {
        return {
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: `Project '${project}' not found` },
        };
      }

      // Preload embeddings model
      await preload();

      const projectPath = projectInfo.path;
      const searchPaths = paths?.map(p => join(projectPath, p)) || [projectPath];

      // Find all text files
      const allFiles: string[] = [];
      for (const searchPath of searchPaths) {
        if (existsSync(searchPath)) {
          const files = await findTextFiles(searchPath);
          allFiles.push(...files);
        }
      }

      let indexed = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const filePath of allFiles) {
        try {
          const relativePath = relative(projectPath, filePath);
          const content = await readFile(filePath, 'utf-8');
          const contentHash = createHash('md5').update(content).digest('hex');

          // Check if already indexed with same hash
          const existing = db.getIndexedFile(project, relativePath);
          if (existing && existing.content_hash === contentHash && !reindex) {
            skipped++;
            continue;
          }

          // Generate embedding
          const embedding = await embed(content);
          const serialized = serializeEmbedding(embedding);

          // Store in database
          const fileStats = await stat(filePath);
          db.indexFile(project, relativePath, {
            file_type: extname(filePath),
            size: fileStats.size,
            content_hash: contentHash,
            content_preview: content.substring(0, 1000),
            embedding: serialized,
          });

          indexed++;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          errors.push(`${filePath}: ${error}`);
        }
      }

      return {
        success: true,
        data: {
          totalFiles: allFiles.length,
          indexed,
          skipped,
          errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        },
      };
    },

    pm_index_file: async (input: IndexFileInput): Promise<ToolResult<unknown>> => {
      const { project, path: relativePath, force = false } = input;

      // Verify project exists
      const projectInfo = db.getProject(project);
      if (!projectInfo) {
        return {
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: `Project '${project}' not found` },
        };
      }

      const filePath = join(projectInfo.path, relativePath);
      
      // Check if file exists
      if (!existsSync(filePath)) {
        return {
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: `File not found: ${relativePath}` },
        };
      }

      // Check if it's a text file
      const ext = extname(filePath);
      if (!TEXT_EXTENSIONS.has(ext)) {
        return {
          success: true,
          data: { skipped: true, reason: 'Not a text file' },
        };
      }

      try {
        const content = await readFile(filePath, 'utf-8');
        const contentHash = createHash('md5').update(content).digest('hex');

        // Check if already indexed with same hash
        const existing = db.getIndexedFile(project, relativePath);
        if (existing && existing.content_hash === contentHash && !force) {
          return {
            success: true,
            data: { skipped: true, reason: 'File unchanged' },
          };
        }

        // Generate embedding
        await preload();
        const embedding = await embed(content);
        const serialized = serializeEmbedding(embedding);

        // Store in database
        const fileStats = await stat(filePath);
        db.indexFile(project, relativePath, {
          file_type: ext,
          size: fileStats.size,
          content_hash: contentHash,
          content_preview: content.substring(0, 1000),
          embedding: serialized,
        });

        return {
          success: true,
          data: { indexed: true, path: relativePath },
        };
      } catch (err) {
        return {
          success: false,
          error: { 
            code: 'INDEX_FAILED', 
            message: err instanceof Error ? err.message : String(err) 
          },
        };
      }
    },

    pm_index_status: async (input: IndexStatusInput): Promise<ToolResult<unknown>> => {
      const { project } = input;

      // Verify project exists
      const projectInfo = db.getProject(project);
      if (!projectInfo) {
        return {
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: `Project '${project}' not found` },
        };
      }

      const indexedFiles = db.getIndexedFiles(project);
      const withEmbeddings = indexedFiles.filter(f => f.embedding);
      
      // Get last indexed time
      const lastIndexed = indexedFiles.length > 0 
        ? indexedFiles.reduce((latest, f) => 
            f.indexed_at > latest ? f.indexed_at : latest, 
            indexedFiles[0]?.indexed_at || ''
          )
        : null;

      return {
        success: true,
        data: {
          indexed: withEmbeddings.length > 0,
          fileCount: withEmbeddings.length,
          totalIndexed: indexedFiles.length,
          lastIndexed,
        },
      };
    },
  };
}

// ==========================================================================
// HELPER: Export indexing function for use in pm_write_file
// ==========================================================================

export async function indexFileAfterWrite(
  db: ProjectDatabase,
  project: string,
  relativePath: string
): Promise<void> {
  const projectInfo = db.getProject(project);
  if (!projectInfo) return;

  const ext = extname(relativePath);
  if (!TEXT_EXTENSIONS.has(ext)) return;

  const filePath = join(projectInfo.path, relativePath);
  if (!existsSync(filePath)) return;

  try {
    const content = await readFile(filePath, 'utf-8');
    const contentHash = createHash('md5').update(content).digest('hex');

    await preload();
    const embedding = await embed(content);
    const serialized = serializeEmbedding(embedding);

    const fileStats = await stat(filePath);
    db.indexFile(project, relativePath, {
      file_type: ext,
      size: fileStats.size,
      content_hash: contentHash,
      content_preview: content.substring(0, 1000),
      embedding: serialized,
    });
  } catch {
    // Silent fail - indexing is non-critical
  }
}

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt',
  '.html', '.css', '.scss', '.less', '.yaml', '.yml',
  '.xml', '.sql', '.sh', '.bash', '.ps1', '.py', '.rb',
  '.java', '.kt', '.go', '.rs', '.c', '.cpp', '.h',
  '.cs', '.fs', '.vue', '.svelte', '.astro', '.toml',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '.cache', '__pycache__',
  'vendor', 'target', 'bin', 'obj', '.idea', '.vscode',
]);

async function findTextFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  
  async function scan(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            await scan(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (TEXT_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
  
  await scan(dirPath);
  return files;
}
