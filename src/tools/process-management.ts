/**
 * KERNL MCP - Process Management Tools
 * 
 * Provides terminal/REPL management capabilities.
 * These wrap Desktop Commander's process tools for KERNL integration.
 * 
 * Tools:
 * - sys_start_process: Start a new process/REPL
 * - sys_interact_with_process: Send input to running process
 * - sys_read_process_output: Read output from process
 * - sys_list_sessions: List all active terminal sessions
 * - sys_list_processes: List all running processes
 * - sys_kill_process: Terminate a process by PID
 * - sys_force_terminate: Force terminate a terminal session
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResult } from '../types/index.js';
import { spawn, ChildProcess, execSync } from 'child_process';
import { platform } from 'os';

// ==========================================================================
// SESSION TRACKING
// ==========================================================================

interface ProcessSession {
  pid: number;
  command: string;
  process: ChildProcess;
  output: string[];
  startTime: Date;
  blocked: boolean;
  shell: string;
}

const sessions: Map<number, ProcessSession> = new Map();

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const processManagementTools: Tool[] = [
  {
    name: 'sys_start_process',
    description: `Start a new terminal process with intelligent state detection.
    
COMMON USES:
- start_process("python3 -i") - Python REPL
- start_process("node -i") - Node.js REPL
- start_process("npx tsc --noEmit") - TypeScript type check
- start_process("git status") - Git commands

Returns PID that can be used with interact_with_process and read_process_output.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
          default: 30000,
        },
        shell: {
          type: 'string',
          description: 'Shell to use (default: system default)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'sys_interact_with_process',
    description: `Send input to a running process and receive output.
    
Use with REPLs and interactive processes. Automatically waits for 
prompt/response before returning.`,
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID from sys_start_process',
        },
        input: {
          type: 'string',
          description: 'Input to send to process',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 8000)',
          default: 8000,
        },
      },
      required: ['pid', 'input'],
    },
  },
  {
    name: 'sys_read_process_output',
    description: `Read output from a running process.
    
Supports pagination with offset and length parameters.`,
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout to wait for new output (default: 5000)',
          default: 5000,
        },
        offset: {
          type: 'number',
          description: 'Line offset (negative for tail)',
          default: 0,
        },
        length: {
          type: 'number',
          description: 'Max lines to return (default: 100)',
          default: 100,
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'sys_list_sessions',
    description: 'List all active terminal sessions started by KERNL.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sys_list_processes',
    description: 'List all running processes on the system.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sys_kill_process',
    description: 'Terminate a process by PID.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID to kill',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'sys_force_terminate',
    description: 'Force terminate a KERNL terminal session.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID of session to terminate',
        },
      },
      required: ['pid'],
    },
  },
];

// ==========================================================================
// HANDLERS
// ==========================================================================

interface StartProcessInput {
  command: string;
  timeout_ms?: number;
  shell?: string;
}

interface InteractInput {
  pid: number;
  input: string;
  timeout_ms?: number;
}

interface ReadOutputInput {
  pid: number;
  timeout_ms?: number;
  offset?: number;
  length?: number;
}

interface KillProcessInput {
  pid: number;
}

export function createProcessManagementHandlers() {
  return {
    sys_start_process: async (input: StartProcessInput): Promise<ToolResult<unknown>> => {
      const { command, timeout_ms = 30000, shell } = input;
      
      const isWindows = platform() === 'win32';
      const defaultShell = isWindows ? 'powershell.exe' : '/bin/bash';
      const useShell = shell || defaultShell;
      
      return new Promise((resolve) => {
        try {
          const proc = spawn(useShell, isWindows ? ['-Command', command] : ['-c', command], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
          });
          
          if (!proc.pid) {
            resolve({
              success: false,
              error: { code: 'SPAWN_FAILED', message: 'Failed to start process' },
            });
            return;
          }
          
          const session: ProcessSession = {
            pid: proc.pid,
            command,
            process: proc,
            output: [],
            startTime: new Date(),
            blocked: false,
            shell: useShell,
          };
          
          sessions.set(proc.pid, session);
          
          // Collect output
          proc.stdout?.on('data', (data: Buffer) => {
            session.output.push(...data.toString().split('\n'));
          });
          
          proc.stderr?.on('data', (data: Buffer) => {
            session.output.push(...data.toString().split('\n'));
          });
          
          proc.on('exit', (code) => {
            session.blocked = false;
            session.output.push(`\n[Process exited with code ${code}]`);
          });
          
          // Wait a bit for initial output
          setTimeout(() => {
            resolve({
              success: true,
              data: {
                pid: proc.pid,
                shell: useShell,
                command,
                initialOutput: session.output.slice(0, 50).join('\n'),
              },
            });
          }, Math.min(timeout_ms, 3000));
          
        } catch (error) {
          resolve({
            success: false,
            error: { 
              code: 'START_FAILED', 
              message: error instanceof Error ? error.message : 'Failed to start process' 
            },
          });
        }
      });
    },
    
    sys_interact_with_process: async (input: InteractInput): Promise<ToolResult<unknown>> => {
      const { pid, input: userInput, timeout_ms = 8000 } = input;
      
      const session = sessions.get(pid);
      if (!session) {
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: `No session with PID ${pid}` },
        };
      }
      
      return new Promise((resolve) => {
        const outputBefore = session.output.length;
        
        // Send input
        session.process.stdin?.write(userInput + '\n');
        session.blocked = true;
        
        // Wait for response
        setTimeout(() => {
          const newOutput = session.output.slice(outputBefore);
          session.blocked = false;
          
          resolve({
            success: true,
            data: {
              output: newOutput.join('\n'),
              linesReceived: newOutput.length,
            },
          });
        }, timeout_ms);
      });
    },
    
    sys_read_process_output: async (input: ReadOutputInput): Promise<ToolResult<unknown>> => {
      const { pid, offset = 0, length = 100 } = input;
      
      const session = sessions.get(pid);
      if (!session) {
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: `No session with PID ${pid}` },
        };
      }
      
      let lines: string[];
      if (offset < 0) {
        // Tail behavior
        lines = session.output.slice(offset);
      } else {
        lines = session.output.slice(offset, offset + length);
      }
      
      return {
        success: true,
        data: {
          output: lines.join('\n'),
          totalLines: session.output.length,
          offset,
          length: lines.length,
          blocked: session.blocked,
        },
      };
    },
    
    sys_list_sessions: async (): Promise<ToolResult<unknown>> => {
      const sessionList = Array.from(sessions.values()).map(s => ({
        pid: s.pid,
        command: s.command.substring(0, 50),
        shell: s.shell,
        blocked: s.blocked,
        runtime_s: Math.round((Date.now() - s.startTime.getTime()) / 1000),
        outputLines: s.output.length,
      }));
      
      return {
        success: true,
        data: {
          count: sessionList.length,
          sessions: sessionList,
        },
      };
    },
    
    sys_list_processes: async (): Promise<ToolResult<unknown>> => {
      try {
        const isWindows = platform() === 'win32';
        let processes: Array<{ pid: number; name: string }> = [];
        
        if (isWindows) {
          const output = execSync('tasklist /fo csv /nh', { encoding: 'utf-8' });
          processes = output.split('\n')
            .filter(line => line.trim())
            .slice(0, 50)
            .map(line => {
              const parts = line.split(',');
              return {
                name: (parts[0] || '').replace(/"/g, ''),
                pid: parseInt((parts[1] || '0').replace(/"/g, ''), 10),
              };
            });
        } else {
          const output = execSync('ps aux --no-headers', { encoding: 'utf-8' });
          processes = output.split('\n')
            .filter(line => line.trim())
            .slice(0, 50)
            .map(line => {
              const parts = line.trim().split(/\s+/);
              return {
                pid: parseInt(parts[1] || '0', 10),
                name: parts.slice(10).join(' '),
              };
            });
        }
        
        return {
          success: true,
          data: { processes },
        };
      } catch (error) {
        return {
          success: false,
          error: { 
            code: 'LIST_FAILED', 
            message: error instanceof Error ? error.message : 'Failed to list processes' 
          },
        };
      }
    },
    
    sys_kill_process: async (input: KillProcessInput): Promise<ToolResult<unknown>> => {
      const { pid } = input;
      
      try {
        process.kill(pid);
        sessions.delete(pid);
        
        return {
          success: true,
          data: { message: `Process ${pid} terminated` },
        };
      } catch (error) {
        return {
          success: false,
          error: { 
            code: 'KILL_FAILED', 
            message: error instanceof Error ? error.message : 'Failed to kill process' 
          },
        };
      }
    },
    
    sys_force_terminate: async (input: KillProcessInput): Promise<ToolResult<unknown>> => {
      const { pid } = input;
      
      const session = sessions.get(pid);
      if (!session) {
        return {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: `No session with PID ${pid}` },
        };
      }
      
      try {
        session.process.kill('SIGKILL');
        sessions.delete(pid);
        
        return {
          success: true,
          data: { message: `Session ${pid} force terminated` },
        };
      } catch (error) {
        return {
          success: false,
          error: { 
            code: 'TERMINATE_FAILED', 
            message: error instanceof Error ? error.message : 'Failed to terminate session' 
          },
        };
      }
    },
  };
}
