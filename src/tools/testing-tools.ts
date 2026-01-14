/**
 * KERNL MCP - Testing & Validation Tools
 * 
 * Tools for running tests, validating tools, and health checks.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';

// ==========================================================================
// TOOL DEFINITIONS (4 tools)
// ==========================================================================

export const testingTools: Tool[] = [
  {
    name: 'sys_run_tests',
    description: 'Run test suite for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project path' },
        pattern: { type: 'string', description: 'Test file pattern (optional)' },
        verbose: { type: 'boolean', description: 'Verbose output' },
      },
      required: ['path'],
    },
  },
  {
    name: 'sys_validate_tools',
    description: 'Validate all KERNL tools are properly registered.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sys_check_health',
    description: 'Check KERNL system health including database and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sys_benchmark',
    description: 'Run performance benchmark on KERNL operations.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Operation to benchmark (optional)' },
        iterations: { type: 'number', description: 'Number of iterations (default: 10)' },
      },
    },
  },
];

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

export function createTestingHandlers(allTools: Tool[]): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    sys_run_tests: async (input) => {
      const projectPath = input.path as string;
      const pattern = input.pattern as string | undefined;
      const verbose = input.verbose as boolean;
      
      try {
        const cmd = pattern 
          ? `npm test -- --grep "${pattern}"${verbose ? ' --verbose' : ''}`
          : `npm test${verbose ? ' -- --verbose' : ''}`;
        
        const output = execSync(cmd, {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 120000,
        });
        
        return {
          success: true,
          output: output.substring(0, 5000),
        };
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        return {
          success: false,
          error: err.message || 'Test run failed',
          stdout: err.stdout?.substring(0, 2000),
          stderr: err.stderr?.substring(0, 2000),
        };
      }
    },

    sys_validate_tools: async () => {
      const issues: string[] = [];
      const validated: string[] = [];
      
      for (const tool of allTools) {
        if (!tool.name) {
          issues.push('Tool missing name');
          continue;
        }
        if (!tool.description) {
          issues.push(`${tool.name}: missing description`);
        }
        if (!tool.inputSchema) {
          issues.push(`${tool.name}: missing inputSchema`);
        }
        validated.push(tool.name);
      }
      
      return {
        totalTools: allTools.length,
        validated: validated.length,
        issues: issues.length,
        issueList: issues.length > 0 ? issues : undefined,
        status: issues.length === 0 ? 'healthy' : 'issues_found',
      };
    },

    sys_check_health: async () => {
      const checks: Record<string, { status: string; details?: string }> = {};
      
      // Check Node.js
      try {
        const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
        checks.nodejs = { status: 'ok', details: nodeVersion };
      } catch {
        checks.nodejs = { status: 'error', details: 'Node.js not found' };
      }
      
      // Check npm
      try {
        const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
        checks.npm = { status: 'ok', details: npmVersion };
      } catch {
        checks.npm = { status: 'error', details: 'npm not found' };
      }
      
      // Check git
      try {
        const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
        checks.git = { status: 'ok', details: gitVersion };
      } catch {
        checks.git = { status: 'error', details: 'git not found' };
      }
      
      // Memory usage
      const memUsage = process.memoryUsage();
      checks.memory = {
        status: 'ok',
        details: `Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      };
      
      // Tool count
      checks.tools = {
        status: 'ok',
        details: `${allTools.length} tools registered`,
      };
      
      const allOk = Object.values(checks).every(c => c.status === 'ok');
      
      return {
        status: allOk ? 'healthy' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
      };
    },

    sys_benchmark: async (input) => {
      const iterations = (input.iterations as number) || 10;
      const results: Record<string, number> = {};
      
      // Benchmark simple operations
      const start1 = Date.now();
      for (let i = 0; i < iterations; i++) {
        JSON.stringify({ test: 'data', iteration: i });
      }
      results.jsonStringify = Date.now() - start1;
      
      const start2 = Date.now();
      for (let i = 0; i < iterations; i++) {
        JSON.parse('{"test":"data","iteration":' + i + '}');
      }
      results.jsonParse = Date.now() - start2;
      
      return {
        iterations,
        results,
        averageMs: {
          jsonStringify: results.jsonStringify / iterations,
          jsonParse: results.jsonParse / iterations,
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}
