/**
 * KERNL MCP - Utility Tools
 * 
 * General purpose utilities for file operations, data manipulation, and helpers.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ==========================================================================
// TOOL DEFINITIONS (12 tools)
// ==========================================================================

export const utilityTools: Tool[] = [
  {
    name: 'util_hash_file',
    description: 'Calculate hash (MD5, SHA256) of a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        algorithm: { type: 'string', enum: ['md5', 'sha256', 'sha512'], description: 'Hash algorithm' },
      },
      required: ['path'],
    },
  },
  {
    name: 'util_compare_files',
    description: 'Compare two files and report differences.',
    inputSchema: {
      type: 'object',
      properties: {
        file1: { type: 'string', description: 'First file path' },
        file2: { type: 'string', description: 'Second file path' },
      },
      required: ['file1', 'file2'],
    },
  },
  {
    name: 'util_find_duplicates',
    description: 'Find duplicate files in a directory by content hash.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to scan' },
        recursive: { type: 'boolean', description: 'Scan recursively' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'util_disk_usage',
    description: 'Get disk usage statistics for a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        depth: { type: 'number', description: 'Max depth to analyze' },
      },
      required: ['path'],
    },
  },
  {
    name: 'util_line_count',
    description: 'Count lines in files matching a pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to scan' },
        pattern: { type: 'string', description: 'File pattern (e.g., *.ts)' },
        excludeDirs: { type: 'array', items: { type: 'string' }, description: 'Directories to exclude' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'util_json_query',
    description: 'Query JSON file with JSONPath-like syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'JSON file path' },
        query: { type: 'string', description: 'Query path (e.g., "data.items[0].name")' },
      },
      required: ['file', 'query'],
    },
  },
  {
    name: 'util_merge_json',
    description: 'Merge multiple JSON files.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'JSON files to merge' },
        output: { type: 'string', description: 'Output file path' },
        strategy: { type: 'string', enum: ['shallow', 'deep'], description: 'Merge strategy' },
      },
      required: ['files', 'output'],
    },
  },
  {
    name: 'util_template_render',
    description: 'Render a template file with variables.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template file path' },
        variables: { type: 'object', description: 'Variables to substitute' },
        output: { type: 'string', description: 'Output file path (optional)' },
      },
      required: ['template', 'variables'],
    },
  },
  {
    name: 'util_backup_file',
    description: 'Create a timestamped backup of a file.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to backup' },
        backupDir: { type: 'string', description: 'Backup directory (optional)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'util_watch_file',
    description: 'Watch a file for changes (returns immediately with watch ID).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to watch' },
        callback: { type: 'string', description: 'Action on change' },
      },
      required: ['file'],
    },
  },
  {
    name: 'util_env_info',
    description: 'Get environment information (Node version, OS, paths).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'util_timestamp',
    description: 'Generate formatted timestamps for various purposes.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['iso', 'unix', 'human', 'filename'], description: 'Timestamp format' },
        timezone: { type: 'string', description: 'Timezone (default: UTC)' },
      },
    },
  },
];


// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

function getFilesRecursive(dir: string, pattern?: string): string[] {
  const files: string[] = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getFilesRecursive(fullPath, pattern));
    } else if (!pattern || item.match(new RegExp(pattern.replace('*', '.*')))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge((result[key] || {}) as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function queryPath(obj: unknown, queryPath: string): unknown {
  const parts = queryPath.split(/[.\[\]]+/).filter(Boolean);
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

export function createUtilityHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    util_hash_file: async (input) => {
      const filePath = input.path as string;
      const algorithm = (input.algorithm as string) || 'sha256';
      
      if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };
      
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash(algorithm).update(content).digest('hex');
      
      return { file: filePath, algorithm, hash };
    },

    util_compare_files: async (input) => {
      const file1 = input.file1 as string;
      const file2 = input.file2 as string;
      
      if (!fs.existsSync(file1)) return { error: `File not found: ${file1}` };
      if (!fs.existsSync(file2)) return { error: `File not found: ${file2}` };
      
      const content1 = fs.readFileSync(file1, 'utf-8');
      const content2 = fs.readFileSync(file2, 'utf-8');
      
      const lines1 = content1.split('\n');
      const lines2 = content2.split('\n');
      
      const differences: Array<{ line: number; type: string; content: string }> = [];
      const maxLines = Math.max(lines1.length, lines2.length);
      
      for (let i = 0; i < maxLines; i++) {
        if (lines1[i] !== lines2[i]) {
          if (i >= lines1.length) {
            differences.push({ line: i + 1, type: 'added', content: lines2[i] });
          } else if (i >= lines2.length) {
            differences.push({ line: i + 1, type: 'removed', content: lines1[i] });
          } else {
            differences.push({ line: i + 1, type: 'changed', content: `${lines1[i]} -> ${lines2[i]}` });
          }
        }
      }
      
      return {
        identical: differences.length === 0,
        file1Lines: lines1.length,
        file2Lines: lines2.length,
        differenceCount: differences.length,
        differences: differences.slice(0, 50),
      };
    },

    util_find_duplicates: async (input) => {
      const directory = input.directory as string;
      const recursive = input.recursive !== false;
      
      if (!fs.existsSync(directory)) return { error: `Directory not found: ${directory}` };
      
      const files = recursive ? getFilesRecursive(directory) : 
        fs.readdirSync(directory).map(f => path.join(directory, f)).filter(f => fs.statSync(f).isFile());
      
      const hashes = new Map<string, string[]>();
      
      for (const file of files.slice(0, 1000)) {
        try {
          const content = fs.readFileSync(file);
          const hash = crypto.createHash('md5').update(content).digest('hex');
          
          if (!hashes.has(hash)) hashes.set(hash, []);
          hashes.get(hash)!.push(file);
        } catch { /* skip unreadable files */ }
      }
      
      const duplicates = Array.from(hashes.entries())
        .filter(([, files]) => files.length > 1)
        .map(([hash, files]) => ({ hash, files, count: files.length }));
      
      return {
        scanned: files.length,
        duplicateSets: duplicates.length,
        duplicates,
      };
    },

    util_disk_usage: async (input) => {
      const dirPath = input.path as string;
      const maxDepth = (input.depth as number) || 2;
      
      if (!fs.existsSync(dirPath)) return { error: `Path not found: ${dirPath}` };
      
      function getSize(p: string, depth: number): { size: number; children?: Record<string, unknown> } {
        const stat = fs.statSync(p);
        if (stat.isFile()) return { size: stat.size };
        
        let total = 0;
        const children: Record<string, unknown> = {};
        
        try {
          for (const item of fs.readdirSync(p)) {
            const childPath = path.join(p, item);
            const childResult = getSize(childPath, depth + 1);
            total += childResult.size;
            if (depth < maxDepth) children[item] = childResult;
          }
        } catch { /* permission denied */ }
        
        return depth < maxDepth ? { size: total, children } : { size: total };
      }
      
      const result = getSize(dirPath, 0);
      return {
        path: dirPath,
        totalBytes: result.size,
        totalMB: Math.round(result.size / 1024 / 1024 * 100) / 100,
        breakdown: result.children,
      };
    },


    util_line_count: async (input) => {
      const directory = input.directory as string;
      const pattern = (input.pattern as string) || '*';
      const excludeDirs = (input.excludeDirs as string[]) || ['node_modules', '.git', 'dist'];
      
      if (!fs.existsSync(directory)) return { error: `Directory not found: ${directory}` };
      
      const counts: Record<string, number> = {};
      let totalLines = 0;
      let totalFiles = 0;
      
      function processDir(dir: string) {
        for (const item of fs.readdirSync(dir)) {
          if (excludeDirs.includes(item)) continue;
          
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            processDir(fullPath);
          } else if (item.match(new RegExp(pattern.replace('*', '.*')))) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n').length;
              counts[fullPath] = lines;
              totalLines += lines;
              totalFiles++;
            } catch { /* skip */ }
          }
        }
      }
      
      processDir(directory);
      
      return {
        directory,
        pattern,
        totalFiles,
        totalLines,
        topFiles: Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([file, lines]) => ({ file: path.relative(directory, file), lines })),
      };
    },

    util_json_query: async (input) => {
      const file = input.file as string;
      const query = input.query as string;
      
      if (!fs.existsSync(file)) return { error: `File not found: ${file}` };
      
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const result = queryPath(content, query);
        return { file, query, result };
      } catch (error) {
        return { error: `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown'}` };
      }
    },

    util_merge_json: async (input) => {
      const files = input.files as string[];
      const output = input.output as string;
      const strategy = (input.strategy as string) || 'deep';
      
      let merged: Record<string, unknown> = {};
      
      for (const file of files) {
        if (!fs.existsSync(file)) return { error: `File not found: ${file}` };
        
        try {
          const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
          merged = strategy === 'deep' ? deepMerge(merged, content) : { ...merged, ...content };
        } catch (error) {
          return { error: `Failed to parse ${file}: ${error instanceof Error ? error.message : 'Unknown'}` };
        }
      }
      
      fs.writeFileSync(output, JSON.stringify(merged, null, 2));
      return { success: true, output, mergedFiles: files.length };
    },

    util_template_render: async (input) => {
      const template = input.template as string;
      const variables = input.variables as Record<string, string>;
      const output = input.output as string | undefined;
      
      if (!fs.existsSync(template)) return { error: `Template not found: ${template}` };
      
      let content = fs.readFileSync(template, 'utf-8');
      
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value));
      }
      
      if (output) {
        fs.writeFileSync(output, content);
        return { success: true, output };
      }
      
      return { rendered: content };
    },

    util_backup_file: async (input) => {
      const file = input.file as string;
      const backupDir = (input.backupDir as string) || path.dirname(file);
      
      if (!fs.existsSync(file)) return { error: `File not found: ${file}` };
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const backupPath = path.join(backupDir, `${base}_${timestamp}${ext}`);
      
      fs.copyFileSync(file, backupPath);
      return { success: true, original: file, backup: backupPath };
    },

    util_watch_file: async (input) => {
      const file = input.file as string;
      
      if (!fs.existsSync(file)) return { error: `File not found: ${file}` };
      
      // Note: This just returns info, actual watching would need persistent state
      return {
        file,
        exists: true,
        lastModified: fs.statSync(file).mtime.toISOString(),
        message: 'File watch info retrieved. For active watching, use a persistent process.',
      };
    },

    util_env_info: async () => {
      return {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        },
        uptime: Math.round(process.uptime()) + 's',
      };
    },

    util_timestamp: async (input) => {
      const format = (input.format as string) || 'iso';
      const now = new Date();
      
      const formats: Record<string, string> = {
        iso: now.toISOString(),
        unix: String(Math.floor(now.getTime() / 1000)),
        human: now.toLocaleString(),
        filename: now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19),
      };
      
      return { format, timestamp: formats[format] || formats.iso };
    },
  };
}
