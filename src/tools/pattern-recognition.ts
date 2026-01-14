/**
 * KERNL MCP - Pattern Recognition Tools
 * 
 * Cross-project learning through pattern storage and suggestion.
 * Patterns are solutions to problems that can be reused across projects.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectDatabase } from '../storage/database.js';
import type { ToolResult } from '../types/index.js';
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

export const patternRecognitionTools: Tool[] = [
  {
    name: 'suggest_patterns',
    description:
      'Find relevant patterns from other projects that might help with current problem. ' +
      'Uses semantic similarity to match problems across the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: {
          type: 'string',
          description: 'Description of the current problem or challenge',
        },
        currentProject: {
          type: 'string',
          description: 'Current project ID (patterns from this project are excluded)',
        },
        limit: {
          type: 'number',
          description: 'Maximum suggestions to return (default: 5)',
          default: 5,
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence score 0-1 (default: 0.5)',
          default: 0.5,
        },
        includeCurrentProject: {
          type: 'boolean',
          description: 'Include patterns from current project (default: false)',
          default: false,
        },
      },
      required: ['problem'],
    },
  },
  {
    name: 'record_pattern',
    description:
      'Record a successful pattern for cross-project learning. ' +
      'Patterns are indexed for semantic search and can be suggested in future sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project ID where pattern was discovered',
        },
        name: {
          type: 'string',
          description: 'Short, descriptive name for the pattern',
        },
        problem: {
          type: 'string',
          description: 'The problem this pattern solves',
        },
        solution: {
          type: 'string',
          description: 'How the pattern solves the problem',
        },
        implementation: {
          type: 'string',
          description: 'Detailed implementation steps (optional)',
        },
        metrics: {
          type: 'object',
          description: 'Before/after metrics showing improvement (optional)',
          properties: {
            before: { type: 'object' },
            after: { type: 'object' },
            improvement: { type: 'string' },
          },
        },
      },
      required: ['project', 'name', 'problem', 'solution'],
    },
  },
  {
    name: 'list_patterns',
    description:
      'List all recorded patterns, optionally filtered by project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Filter by project ID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum patterns to return (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_pattern',
    description:
      'Get full details of a specific pattern by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: {
          type: 'number',
          description: 'Pattern ID',
        },
      },
      required: ['patternId'],
    },
  },
];

// ==========================================================================
// HANDLERS
// ==========================================================================

interface SuggestPatternsInput {
  problem: string;
  currentProject?: string;
  limit?: number;
  minConfidence?: number;
  includeCurrentProject?: boolean;
}

interface RecordPatternInput {
  project: string;
  name: string;
  problem: string;
  solution: string;
  implementation?: string;
  metrics?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    improvement?: string;
  };
}

interface ListPatternsInput {
  project?: string;
  limit?: number;
}

interface GetPatternInput {
  patternId: number;
}

export function createPatternRecognitionHandlers(db: ProjectDatabase) {
  return {
    suggest_patterns: async (input: SuggestPatternsInput): Promise<ToolResult<unknown>> => {
      const { 
        problem, 
        currentProject, 
        limit = 5, 
        minConfidence = 0.5,
        includeCurrentProject = false 
      } = input;

      try {
        // Get all patterns with embeddings
        const patterns = db.getPatterns();
        
        // Filter to patterns with embeddings
        let candidates = patterns.filter(p => p.problemEmbedding);
        
        // Optionally exclude current project
        if (currentProject && !includeCurrentProject) {
          candidates = candidates.filter(p => p.projectId !== currentProject);
        }

        if (candidates.length === 0) {
          return {
            success: true,
            data: {
              message: 'No patterns found in knowledge base',
              suggestions: [],
            },
          };
        }

        // Preload and generate problem embedding
        await preload();
        const problemEmbedding = await embed(problem);

        // Find similar patterns
        const candidatesWithEmbeddings = candidates.map(p => ({
          id: p.id,
          embedding: deserializeEmbedding(p.problemEmbedding!),
        }));

        const similar = findSimilar(problemEmbedding, candidatesWithEmbeddings, limit, minConfidence);

        // Build suggestions
        const suggestions = similar.map(match => {
          const pattern = candidates.find(p => p.id === match.id);
          return {
            patternId: match.id,
            name: pattern?.name || '',
            project: pattern?.projectId || '',
            confidence: Math.round(match.similarity * 100) / 100,
            problem: pattern?.problem || '',
            solution: pattern?.solution?.substring(0, 200) + 
              ((pattern?.solution?.length || 0) > 200 ? '...' : ''),
          };
        });

        db.logActivity('suggest_patterns', {
          problem: problem.slice(0, 100),
          suggestionsFound: suggestions.length,
          patternsSearched: candidates.length,
        }, currentProject);

        return {
          success: true,
          data: { suggestions },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'SUGGESTION_ERROR',
            message: error instanceof Error ? error.message : 'Suggestion failed',
          },
        };
      }
    },

    record_pattern: async (input: RecordPatternInput): Promise<ToolResult<unknown>> => {
      const { project, name, problem, solution, implementation, metrics } = input;

      try {
        // Verify project exists
        const projectInfo = db.getProject(project);
        if (!projectInfo) {
          return {
            success: false,
            error: { code: 'PROJECT_NOT_FOUND', message: `Project '${project}' not found` },
          };
        }

        // Generate embedding for the problem
        await preload();
        const problemEmbedding = await embed(problem);
        const embeddingBuffer = serializeEmbedding(problemEmbedding);

        // Create the pattern
        const patternId = db.createPattern({
          projectId: project,
          name,
          problem,
          solution,
          implementation: implementation || null,
          metrics: metrics || null,
          problemEmbedding: embeddingBuffer,
        });

        db.logActivity('record_pattern', {
          patternId,
          name,
          problem: problem.slice(0, 100),
        }, project);

        return {
          success: true,
          data: {
            patternId,
            message: `Pattern "${name}" recorded successfully`,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'RECORD_ERROR',
            message: error instanceof Error ? error.message : 'Failed to record pattern',
          },
        };
      }
    },

    list_patterns: async (input: ListPatternsInput): Promise<ToolResult<unknown>> => {
      const { project, limit = 20 } = input;

      try {
        const patterns = db.getPatterns(project);
        
        const results = patterns.slice(0, limit).map(p => ({
          id: p.id,
          name: p.name,
          project: p.projectId,
          problem: p.problem.substring(0, 100) + (p.problem.length > 100 ? '...' : ''),
          hasImplementation: !!p.implementation,
          hasMetrics: !!p.metrics,
          createdAt: p.createdAt,
        }));

        return {
          success: true,
          data: {
            total: patterns.length,
            returned: results.length,
            patterns: results,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'LIST_ERROR',
            message: error instanceof Error ? error.message : 'Failed to list patterns',
          },
        };
      }
    },

    get_pattern: async (input: GetPatternInput): Promise<ToolResult<unknown>> => {
      const { patternId } = input;

      try {
        const pattern = db.getPattern(patternId);
        
        if (!pattern) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: `Pattern ${patternId} not found` },
          };
        }

        return {
          success: true,
          data: {
            id: pattern.id,
            name: pattern.name,
            project: pattern.projectId,
            problem: pattern.problem,
            solution: pattern.solution,
            implementation: pattern.implementation || null,
            metrics: pattern.metrics || null,
            createdAt: pattern.createdAt,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'GET_ERROR',
            message: error instanceof Error ? error.message : 'Failed to get pattern',
          },
        };
      }
    },
  };
}
