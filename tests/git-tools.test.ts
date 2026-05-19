import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { gitTools, createGitHandlers } from '../src/tools/git-tools.js';
import type { ProjectDatabase } from '../src/storage/database.js';

// Mock external dependencies
vi.mock('child_process');
vi.mock('fs');
vi.mock('path');

const mockExecSync = vi.mocked(execSync);
const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);

// Mock database
const createMockDb = () => ({
  getProject: vi.fn(),
  getPendingShadowDocs: vi.fn(),
  applyShadowDoc: vi.fn(),
  getLatestSession: vi.fn(),
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn()
    }))
  }
});

describe('gitTools', () => {
  describe('tool definitions', () => {
    it('should export correct number of tools', () => {
      expect(gitTools).toHaveLength(2);
    });

    it('should define smart_commit tool correctly', () => {
      const smartCommit = gitTools.find(tool => tool.name === 'smart_commit');
      expect(smartCommit).toBeDefined();
      expect(smartCommit?.description).toContain('Unified git commit');
      expect(smartCommit?.inputSchema.properties).toHaveProperty('project');
      expect(smartCommit?.inputSchema.properties).toHaveProperty('type');
      expect(smartCommit?.inputSchema.properties).toHaveProperty('message');
      expect(smartCommit?.inputSchema.required).toEqual(['project', 'type', 'message']);
    });

    it('should define session_package tool correctly', () => {
      const sessionPackage = gitTools.find(tool => tool.name === 'session_package');
      expect(sessionPackage).toBeDefined();
      expect(sessionPackage?.description).toContain('Create a session package');
      expect(sessionPackage?.inputSchema.properties).toHaveProperty('project');
      expect(sessionPackage?.inputSchema.required).toEqual(['project']);
    });

    it('should enforce conventional commit types', () => {
      const smartCommit = gitTools.find(tool => tool.name === 'smart_commit');
      const typeProperty = smartCommit?.inputSchema.properties.type as any;
      expect(typeProperty.enum).toEqual(['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'style', 'perf']);
    });
  });
});

describe('createGitHandlers', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let handlers: ReturnType<typeof createGitHandlers>;

  beforeEach(() => {
    mockDb = createMockDb();
    handlers = createGitHandlers(mockDb as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('smart_commit', () => {
    const mockProject = { path: '/test/project', name: 'test-project' };

    beforeEach(() => {
      mockDb.getProject.mockReturnValue(mockProject);
      mockDb.getPendingShadowDocs.mockReturnValue([]);
      mockExecSync.mockReturnValue('success');
    });

    describe('normal cases', () => {
      it('should commit successfully with all verifications enabled', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add new feature',
          verifyBuild: true,
          verifyTests: true,
          applyShadowDocs: true
        };

        const mockPrepare = vi.fn(() => ({ all: vi.fn(() => []) }));
        mockDb.db.prepare = mockPrepare;

        const result = await handlers.smart_commit(input);

        expect(result).toEqual({
          project: 'test-project',
          buildVerified: true,
          testsVerified: false,
          testsNote: 'No smoke/contract tests defined — gate open',
          committed: true,
          message: 'feat: add new feature'
        });

        expect(mockExecSync).toHaveBeenCalledWith('npx tsc --noEmit', expect.any(Object));
        expect(mockExecSync).toHaveBeenCalledWith('git add -A', expect.any(Object));
        expect(mockExecSync).toHaveBeenCalledWith('git commit -m "feat: add new feature"', expect.any(Object));
      });

      it('should commit with scope in message', async () => {
        const input = {
          project: 'test-project',
          type: 'fix',
          message: 'resolve api timeout',
          scope: 'api'
        };

        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => []) }));

        const result = await handlers.smart_commit(input);

        expect(result).toMatchObject({
          committed: true,
          message: 'fix(api): resolve api timeout'
        });
      });

      it('should skip verifications when disabled', async () => {
        const input = {
          project: 'test-project',
          type: 'chore',
          message: 'update dependencies',
          verifyBuild: false,
          verifyTests: false,
          applyShadowDocs: false
        };

        const result = await handlers.smart_commit(input);

        expect(result).toEqual({
          project: 'test-project',
          committed: true,
          message: 'chore: update dependencies'
        });

        expect(mockExecSync).not.toHaveBeenCalledWith('npx tsc --noEmit', expect.any(Object));
      });
    });

    describe('build verification', () => {
      it('should fail on build errors', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature',
          verifyBuild: true
        };

        mockExecSync.mockImplementation((command) => {
          if (command === 'npx tsc --noEmit') {
            const error = new Error('Type errors found') as any;
            error.stderr = 'TS2339: Property does not exist';
            throw error;
          }
          return 'success';
        });

        const result = await handlers.smart_commit(input);

        expect(result).toEqual({
          error: 'Build verification failed',
          details: 'TS2339: Property does not exist',
          hint: 'Fix TypeScript errors before committing'
        });
      });

      it('should handle build errors without stderr', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature',
          verifyBuild: true
        };

        mockExecSync.mockImplementation((command) => {
          if (command === 'npx tsc --noEmit') {
            throw new Error('Build failed');
          }
          return 'success';
        });

        const result = await handlers.smart_commit(input);

        expect(result).toEqual({
          error: 'Build verification failed',
          details: 'Build failed',
          hint: 'Fix TypeScript errors before committing'
        });
      });
    });

    describe('test verification', () => {
      it('should pass when smoke/contract tests succeed', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature',
          verifyTests: true
        };

        const mockSpecs = [
          { 
            name: 'smoke-test', 
            tier: 'smoke', 
            type: 'build',
            spec: JSON.stringify({ command: 'npm test' })
          },
          {
            name: 'contract-test',
            tier: 'contract',
            type: 'custom',
            spec: JSON.stringify({ command: 'npm run test:contract', timeout_ms: 10000 })
          }
        ];

        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => mockSpecs) }));

        const result = await handlers.smart_commit(input);

        expect(result).toMatchObject({
          testsVerified: true,
          testsPassed: 2,
          testsFailed: 0,
          committed: true
        });
      });

      it('should fail when tests fail', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature',
          verifyTests: true
        };

        const mockSpecs = [
          {
            name: 'failing-test',
            tier: 'smoke',
            type: 'build',
            spec: JSON.stringify({ command: 'npm test' })
          }
        ];

        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => mockSpecs) }));
        
        mockExecSync.mockImplementation((command) => {
          if (command === 'npm test') {
            throw new Error('Tests failed');
          }
          return 'success';
        });

        const result = await handlers.smart_commit(input);

        expect(result).toEqual({
          error: 'Yuma test gate BLOCKED commit',
          testsFailed: 1,
          failures: ['failing-test'],
          hint: 'Fix failing tests before committing. Run test_run for details.'
        });
      });

      it('should handle declarative tests', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature',
          verifyTests: true
        };

        const mockSpecs = [
          {
            name: 'declarative-test',
            tier: 'smoke',
            type: 'declarative',
            spec: JSON.stringify({ assertion: 'file exists' })
          }
        ];

        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => mockSpecs) }));

        const result = await handlers.smart_commit(input);

        expect(result).toMatchObject({
          testsVerified: true,
          testsPassed: 1,
          testsFailed: 0
        });
      });

      it('should handle database errors gracefully', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature',
          verifyTests: true
        };

        mockDb.db.prepare = vi.fn(() => {
          throw new Error('Database error');
        });

        const result = await handlers.smart_commit(input);

        expect(result).toMatchObject({
          testsVerified: false,
          testsNote: 'Yuma tables not available — gate skipped',
          committed: true
        });
      });
    });

    describe('shadow docs application', () => {
      beforeEach(() => {
        mockPath.join.mockImplementation((...parts) => parts.join('/'));
        mockPath.dirname.mockImplementation((p) => p.split('/').slice(0, -1).join('/'));
        mockFs.existsSync.mockReturnValue(true);
        mockFs.mkdirSync.mockImplementation(() => undefined);
        mockFs.writeFileSync.mockImplementation(() => undefined);
        mockFs.appendFileSync.mockImplementation(() => undefined);
      });

      it('should apply pending shadow docs', async () => {
        const input = {
          project: 'test-project',
          type: 'docs',
          message: 'update documentation',
          applyShadowDocs: true
        };

        const mockShadowDocs = [
          { id: 1, filePath: 'README.md', content: '# New content', mode: 'write' },
          { id: 2, filePath: 'docs/api.md', content: 'API docs', mode: 'append' }
        ];

        mockDb.getPendingShadowDocs.mockReturnValue(mockShadowDocs);
        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => []) }));

        const result = await handlers.smart_commit(input);

        expect(result).toMatchObject({
          shadowDocsApplied: 2,
          committed: true
        });

        expect(mockFs.writeFileSync).toHaveBeenCalledWith('/test/project/README.md', '# New content');
        expect(mockFs.appendFileSync).toHaveBeenCalledWith('/test/project/docs/api.md', '\nAPI docs');
        expect(mockDb.applyShadowDoc).toHaveBeenCalledWith(1);
        expect(mockDb.applyShadowDoc).toHaveBeenCalledWith(2);
      });

      it('should create directories if they do not exist', async () => {
        const input = {
          project: 'test-project',
          type: 'docs',
          message: 'add new docs',
          applyShadowDocs: true
        };

        const mockShadowDocs = [
          { id: 1, filePath: 'new/dir/file.md', content: 'content', mode: 'write' }
        ];

        mockDb.getPendingShadowDocs.mockReturnValue(mockShadowDocs);
        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => []) }));
        mockFs.existsSync.mockReturnValue(false);

        await handlers.smart_commit(input);

        expect(mockFs.mkdirSync).toHaveBeenCalledWith('/test/project/new/dir', { recursive: true });
      });

      it('should handle append mode with non-existing file', async () => {
        const input = {
          project: 'test-project',
          type: 'docs',
          message: 'add docs',
          applyShadowDocs: true
        };

        const mockShadowDocs = [
          { id: 1, filePath: 'new-file.md', content: 'content', mode: 'append' }
        ];

        mockDb.getPendingShadowDocs.mockReturnValue(mockShadowDocs);
        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => []) }));
        mockFs.existsSync.mockReturnValue(false);

        await handlers.smart_commit(input);

        expect(mockFs.writeFileSync).toHaveBeenCalledWith('/test/project/new-file.md', 'content');
      });
    });

    describe('git operations', () => {
      it('should handle nothing to commit', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature'
        };

        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => []) }));
        
        mockExecSync.mockImplementation((command) => {
          if (command.includes('git commit')) {
            const error = new Error('nothing to commit, working tree clean');
            throw error;
          }
          return 'success';
        });

        const result = await handlers.smart_commit(input);

        expect(result).toMatchObject({
          committed: false,
          message: 'Nothing to commit'
        });
      });

      it('should handle commit failures', async () => {
        const input = {
          project: 'test-project',
          type: 'feat',
          message: 'add feature'
        };

        mockDb.db.prepare = vi.fn(() => ({ all: vi.fn(() => []) }));
        
        mockExecSync.mockImplementation((command) => {
          if (command.includes('git commit')) {
            throw new Error('commit failed: permission denied');
          }
          return '