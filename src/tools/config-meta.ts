/**
 * KERNL MCP - Config & Meta Tools
 * 
 * System configuration and tool metadata.
 * 
 * Tools:
 * - sys_get_config: Get current configuration
 * - sys_set_config_value: Set a config value
 * - sys_get_usage_stats: Get usage statistics
 * - sys_get_tool_info: Get tool information
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResult } from '../types/index.js';
import { platform, hostname, arch, cpus, totalmem, freemem } from 'os';

// ==========================================================================
// CONFIG STORAGE
// ==========================================================================

interface KernlConfig {
  defaultShell: string;
  fileReadLineLimit: number;
  fileWriteLineLimit: number;
  allowedDirectories: string[];
  blockedCommands: string[];
}

let config: KernlConfig = {
  defaultShell: platform() === 'win32' ? 'powershell.exe' : '/bin/bash',
  fileReadLineLimit: 1000,
  fileWriteLineLimit: 50,
  allowedDirectories: [],
  blockedCommands: [],
};

// ==========================================================================
// USAGE TRACKING
// ==========================================================================

interface ToolUsage {
  name: string;
  calls: number;
  successes: number;
  failures: number;
  totalDuration: number;
}

const toolUsage: Map<string, ToolUsage> = new Map();
const startTime = Date.now();

export function trackToolUsage(name: string, success: boolean, duration: number): void {
  let usage = toolUsage.get(name);
  if (!usage) {
    usage = { name, calls: 0, successes: 0, failures: 0, totalDuration: 0 };
    toolUsage.set(name, usage);
  }
  
  usage.calls++;
  if (success) {
    usage.successes++;
  } else {
    usage.failures++;
  }
  usage.totalDuration += duration;
}

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const configMetaTools: Tool[] = [
  {
    name: 'sys_get_config',
    description: 'Get KERNL configuration and system information.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sys_set_config_value',
    description: 'Set a KERNL configuration value.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Config key to set',
          enum: ['defaultShell', 'fileReadLineLimit', 'fileWriteLineLimit', 'allowedDirectories', 'blockedCommands'],
        },
        value: {
          description: 'Value to set',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'sys_get_usage_stats',
    description: 'Get tool usage statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sys_get_tool_info',
    description: 'Get information about available tools.',
    inputSchema: {
      type: 'object',
      properties: {
        detailed: {
          type: 'boolean',
          description: 'Include detailed descriptions (default: false)',
          default: false,
        },
        category: {
          type: 'string',
          description: 'Filter by category (optional)',
        },
      },
    },
  },
];

// ==========================================================================
// HANDLERS
// ==========================================================================

interface SetConfigInput {
  key: string;
  value: unknown;
}

interface ToolInfoInput {
  detailed?: boolean;
  category?: string;
}

export function createConfigMetaHandlers(allTools: Tool[]) {
  return {
    sys_get_config: async (): Promise<ToolResult<unknown>> => {
      return {
        success: true,
        data: {
          config,
          systemInfo: {
            platform: platform(),
            arch: arch(),
            hostname: hostname(),
            cpus: cpus().length,
            totalMemory: Math.round(totalmem() / 1024 / 1024 / 1024) + 'GB',
            freeMemory: Math.round(freemem() / 1024 / 1024 / 1024) + 'GB',
          },
          uptime: Math.round((Date.now() - startTime) / 1000) + 's',
        },
      };
    },

    sys_set_config_value: async (input: SetConfigInput): Promise<ToolResult<unknown>> => {
      const { key, value } = input;

      const validKeys = ['defaultShell', 'fileReadLineLimit', 'fileWriteLineLimit', 'allowedDirectories', 'blockedCommands'];
      
      if (!validKeys.includes(key)) {
        return {
          success: false,
          error: { code: 'INVALID_KEY', message: `Invalid config key. Valid keys: ${validKeys.join(', ')}` },
        };
      }

      const oldValue = config[key as keyof KernlConfig];
      (config as any)[key] = value;

      return {
        success: true,
        data: {
          key,
          oldValue,
          newValue: value,
        },
      };
    },

    sys_get_usage_stats: async (): Promise<ToolResult<unknown>> => {
      const stats = Array.from(toolUsage.values())
        .sort((a, b) => b.calls - a.calls);

      const totalCalls = stats.reduce((sum, s) => sum + s.calls, 0);
      const totalSuccesses = stats.reduce((sum, s) => sum + s.successes, 0);
      const totalDuration = stats.reduce((sum, s) => sum + s.totalDuration, 0);

      return {
        success: true,
        data: {
          uptime: Math.round((Date.now() - startTime) / 1000) + 's',
          summary: {
            totalCalls,
            totalSuccesses,
            successRate: totalCalls > 0 ? Math.round(totalSuccesses / totalCalls * 100) + '%' : '0%',
            avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) + 'ms' : '0ms',
          },
          topTools: stats.slice(0, 10).map(s => ({
            name: s.name,
            calls: s.calls,
            successRate: s.calls > 0 ? Math.round(s.successes / s.calls * 100) + '%' : '0%',
            avgDuration: s.calls > 0 ? Math.round(s.totalDuration / s.calls) + 'ms' : '0ms',
          })),
        },
      };
    },

    sys_get_tool_info: async (input: ToolInfoInput): Promise<ToolResult<unknown>> => {
      const { detailed = false, category } = input;

      // Categorize tools
      const categories: Record<string, Tool[]> = {
        Session: allTools.filter(t => t.name.startsWith('get_session') || t.name.startsWith('check_resume') || t.name.startsWith('auto_checkpoint') || t.name.startsWith('mark_complete') || t.name.startsWith('save_session') || t.name === 'kernl_version'),
        Project: allTools.filter(t => t.name.startsWith('pm_') && !t.name.includes('index') && !t.name.includes('batch') && !t.name.includes('search_files') && !t.name.includes('list_files') && !t.name.includes('get_file') && !t.name.includes('read_file') && !t.name.includes('write_file')),
        Filesystem: allTools.filter(t => t.name.includes('read_file') || t.name.includes('write_file') || t.name.includes('batch_read') || t.name.includes('search_files') || t.name.includes('list_files') || t.name.includes('get_file_info')),
        Intelligence: allTools.filter(t => t.name === 'search_semantic' || t.name.includes('pm_index')),
        Patterns: allTools.filter(t => t.name.includes('pattern')),
        Gates: allTools.filter(t => t.name === 'five_gate_check'),
        Process: allTools.filter(t => t.name.startsWith('sys_') && (t.name.includes('process') || t.name.includes('session') && !t.name.includes('get_session'))),
        Search: allTools.filter(t => t.name.startsWith('sys_') && t.name.includes('search')),
        Files: allTools.filter(t => t.name.startsWith('sys_') && (t.name.includes('copy') || t.name.includes('delete') || t.name.includes('move') || t.name.includes('exists') || t.name.includes('directory'))),
        Config: allTools.filter(t => t.name.startsWith('sys_') && (t.name.includes('config') || t.name.includes('usage') || t.name.includes('tool_info'))),
      };

      // Filter by category if specified
      let filteredCategories = categories;
      if (category) {
        const matchedCategory = Object.keys(categories).find(c => 
          c.toLowerCase() === category.toLowerCase()
        );
        if (matchedCategory) {
          filteredCategories = { [matchedCategory]: categories[matchedCategory] || [] };
        }
      }

      // Build response
      const toolInfo: Record<string, Array<{ name: string; description?: string }>> = {};
      
      for (const [cat, tools] of Object.entries(filteredCategories)) {
        if (tools.length > 0) {
          toolInfo[cat] = tools.map(t => ({
            name: t.name,
            ...(detailed ? { description: t.description } : {}),
          }));
        }
      }

      return {
        success: true,
        data: {
          totalTools: allTools.length,
          categories: Object.keys(toolInfo).length,
          tools: toolInfo,
        },
      };
    },
  };
}
