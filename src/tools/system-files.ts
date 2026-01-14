/**
 * KERNL MCP - System File Operations
 * 
 * File system utilities beyond basic read/write.
 * 
 * Tools:
 * - sys_copy_path: Copy files or directories
 * - sys_delete_path: Delete files or directories
 * - sys_path_exists: Check if path exists
 * - sys_move_path: Move/rename files or directories
 * - sys_create_directory: Create directories
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResult } from '../types/index.js';
import { promises as fs } from 'fs';
import { existsSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { cpSync, rmSync } from 'fs';

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const systemFileTools: Tool[] = [
  {
    name: 'sys_copy_path',
    description: 'Copy a file or directory to a new location.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source path to copy',
        },
        destination: {
          type: 'string',
          description: 'Destination path',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite if exists (default: false)',
          default: false,
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'sys_delete_path',
    description: 'Delete a file or directory (recursively).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to delete',
        },
        force: {
          type: 'boolean',
          description: 'Force delete (ignore errors, default: false)',
          default: false,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'sys_path_exists',
    description: 'Check if a path exists and get basic info.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to check',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'sys_move_path',
    description: 'Move or rename a file or directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source path',
        },
        destination: {
          type: 'string',
          description: 'Destination path',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite if exists (default: false)',
          default: false,
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'sys_create_directory',
    description: 'Create a directory (and parent directories if needed).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create',
        },
      },
      required: ['path'],
    },
  },
];

// ==========================================================================
// HANDLERS
// ==========================================================================

interface CopyInput {
  source: string;
  destination: string;
  overwrite?: boolean;
}

interface DeleteInput {
  path: string;
  force?: boolean;
}

interface ExistsInput {
  path: string;
}

interface MoveInput {
  source: string;
  destination: string;
  overwrite?: boolean;
}

interface CreateDirInput {
  path: string;
}

export function createSystemFileHandlers() {
  return {
    sys_copy_path: async (input: CopyInput): Promise<ToolResult<unknown>> => {
      const { source, destination, overwrite = false } = input;

      if (!existsSync(source)) {
        return {
          success: false,
          error: { code: 'SOURCE_NOT_FOUND', message: `Source not found: ${source}` },
        };
      }

      if (!overwrite && existsSync(destination)) {
        return {
          success: false,
          error: { code: 'DESTINATION_EXISTS', message: `Destination exists: ${destination}. Use overwrite: true to replace.` },
        };
      }

      try {
        const sourceStats = statSync(source);
        
        // Ensure destination directory exists
        await fs.mkdir(dirname(destination), { recursive: true });
        
        if (sourceStats.isDirectory()) {
          cpSync(source, destination, { recursive: true, force: overwrite });
        } else {
          await fs.copyFile(source, destination);
        }

        return {
          success: true,
          data: {
            source,
            destination,
            type: sourceStats.isDirectory() ? 'directory' : 'file',
            size: sourceStats.size,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: { 
            code: 'COPY_FAILED', 
            message: error instanceof Error ? error.message : 'Copy failed' 
          },
        };
      }
    },

    sys_delete_path: async (input: DeleteInput): Promise<ToolResult<unknown>> => {
      const { path: targetPath, force = false } = input;

      if (!existsSync(targetPath)) {
        if (force) {
          return {
            success: true,
            data: { message: 'Path does not exist (force mode)', path: targetPath },
          };
        }
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: `Path not found: ${targetPath}` },
        };
      }

      try {
        const stats = statSync(targetPath);
        const isDir = stats.isDirectory();
        
        rmSync(targetPath, { recursive: true, force });

        return {
          success: true,
          data: {
            path: targetPath,
            type: isDir ? 'directory' : 'file',
            message: `Successfully deleted ${isDir ? 'directory' : 'file'}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: { 
            code: 'DELETE_FAILED', 
            message: error instanceof Error ? error.message : 'Delete failed' 
          },
        };
      }
    },

    sys_path_exists: async (input: ExistsInput): Promise<ToolResult<unknown>> => {
      const { path: checkPath } = input;

      const exists = existsSync(checkPath);
      
      if (!exists) {
        return {
          success: true,
          data: {
            exists: false,
            path: checkPath,
          },
        };
      }

      try {
        const stats = statSync(checkPath);
        
        return {
          success: true,
          data: {
            exists: true,
            path: checkPath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
          },
        };
      } catch (error) {
        return {
          success: true,
          data: {
            exists: true,
            path: checkPath,
            error: 'Could not read stats',
          },
        };
      }
    },

    sys_move_path: async (input: MoveInput): Promise<ToolResult<unknown>> => {
      const { source, destination, overwrite = false } = input;

      if (!existsSync(source)) {
        return {
          success: false,
          error: { code: 'SOURCE_NOT_FOUND', message: `Source not found: ${source}` },
        };
      }

      if (!overwrite && existsSync(destination)) {
        return {
          success: false,
          error: { code: 'DESTINATION_EXISTS', message: `Destination exists: ${destination}. Use overwrite: true to replace.` },
        };
      }

      try {
        // Ensure destination directory exists
        await fs.mkdir(dirname(destination), { recursive: true });
        
        // Remove destination if overwriting
        if (overwrite && existsSync(destination)) {
          rmSync(destination, { recursive: true, force: true });
        }
        
        await fs.rename(source, destination);

        return {
          success: true,
          data: {
            source,
            destination,
            message: 'Move successful',
          },
        };
      } catch (error) {
        // If rename fails (cross-device), try copy + delete
        try {
          const stats = statSync(source);
          
          if (stats.isDirectory()) {
            cpSync(source, destination, { recursive: true });
          } else {
            await fs.copyFile(source, destination);
          }
          
          rmSync(source, { recursive: true, force: true });
          
          return {
            success: true,
            data: {
              source,
              destination,
              message: 'Move successful (via copy)',
            },
          };
        } catch (copyError) {
          return {
            success: false,
            error: { 
              code: 'MOVE_FAILED', 
              message: copyError instanceof Error ? copyError.message : 'Move failed' 
            },
          };
        }
      }
    },

    sys_create_directory: async (input: CreateDirInput): Promise<ToolResult<unknown>> => {
      const { path: dirPath } = input;

      try {
        await fs.mkdir(dirPath, { recursive: true });

        return {
          success: true,
          data: {
            path: dirPath,
            message: 'Directory created',
          },
        };
      } catch (error) {
        return {
          success: false,
          error: { 
            code: 'CREATE_FAILED', 
            message: error instanceof Error ? error.message : 'Create directory failed' 
          },
        };
      }
    },
  };
}
