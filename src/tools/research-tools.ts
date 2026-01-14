/**
 * KERNL MCP - Research & Notes Tools
 * 
 * Tools for managing research notes, snippets, and knowledge capture.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectDatabase } from '../storage/database.js';

// ==========================================================================
// TOOL DEFINITIONS (10 tools)
// ==========================================================================

export const researchTools: Tool[] = [
  {
    name: 'research_add_note',
    description: 'Add a research note to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        title: { type: 'string', description: 'Note title' },
        content: { type: 'string', description: 'Note content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        source: { type: 'string', description: 'Source URL or reference' },
      },
      required: ['project', 'title', 'content'],
    },
  },
  {
    name: 'research_search_notes',
    description: 'Search research notes by content or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        query: { type: 'string', description: 'Search query' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      },
      required: ['project'],
    },
  },
  {
    name: 'research_get_note',
    description: 'Get a specific research note by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        id: { type: 'number', description: 'Note ID' },
      },
      required: ['project', 'id'],
    },
  },
  {
    name: 'research_update_note',
    description: 'Update an existing research note.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        id: { type: 'number', description: 'Note ID' },
        title: { type: 'string', description: 'New title' },
        content: { type: 'string', description: 'New content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
      },
      required: ['project', 'id'],
    },
  },
  {
    name: 'research_delete_note',
    description: 'Delete a research note.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        id: { type: 'number', description: 'Note ID' },
      },
      required: ['project', 'id'],
    },
  },
  {
    name: 'research_list_tags',
    description: 'List all tags used in research notes.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
      },
      required: ['project'],
    },
  },
  {
    name: 'research_export_notes',
    description: 'Export research notes to markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        output: { type: 'string', description: 'Output file path' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      },
      required: ['project', 'output'],
    },
  },
  {
    name: 'research_link_notes',
    description: 'Create a link between two research notes.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        fromId: { type: 'number', description: 'Source note ID' },
        toId: { type: 'number', description: 'Target note ID' },
        relationship: { type: 'string', description: 'Relationship type (related, depends, extends)' },
      },
      required: ['project', 'fromId', 'toId'],
    },
  },
  {
    name: 'research_summary',
    description: 'Get summary statistics for research notes.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
      },
      required: ['project'],
    },
  },
  {
    name: 'research_recent',
    description: 'Get recently modified research notes.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project ID' },
        limit: { type: 'number', description: 'Max notes to return (default: 10)' },
      },
      required: ['project'],
    },
  },
];

// ==========================================================================
// IN-MEMORY STORAGE (for research notes - can be migrated to DB later)
// ==========================================================================

interface ResearchNote {
  id: number;
  projectId: string;
  title: string;
  content: string;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
}

const notesStore = new Map<string, ResearchNote[]>();
let noteIdCounter = 0;

function getProjectNotes(projectId: string): ResearchNote[] {
  if (!notesStore.has(projectId)) notesStore.set(projectId, []);
  return notesStore.get(projectId)!;
}

// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

export function createResearchHandlers(_db: ProjectDatabase): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    research_add_note: async (input) => {
      const projectId = input.project as string;
      const notes = getProjectNotes(projectId);
      
      const note: ResearchNote = {
        id: ++noteIdCounter,
        projectId,
        title: input.title as string,
        content: input.content as string,
        tags: (input.tags as string[]) || [],
        source: input.source as string | undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      notes.push(note);
      return { success: true, id: note.id, title: note.title };
    },

    research_search_notes: async (input) => {
      const projectId = input.project as string;
      const query = (input.query as string)?.toLowerCase() || '';
      const filterTags = input.tags as string[] | undefined;
      
      let notes = getProjectNotes(projectId);
      
      if (query) {
        notes = notes.filter(n => 
          n.title.toLowerCase().includes(query) || 
          n.content.toLowerCase().includes(query)
        );
      }
      
      if (filterTags?.length) {
        notes = notes.filter(n => filterTags.some(t => n.tags.includes(t)));
      }
      
      return {
        project: projectId,
        count: notes.length,
        notes: notes.map(n => ({
          id: n.id,
          title: n.title,
          tags: n.tags,
          preview: n.content.substring(0, 100) + (n.content.length > 100 ? '...' : ''),
          updatedAt: n.updatedAt,
        })),
      };
    },

    research_get_note: async (input) => {
      const projectId = input.project as string;
      const id = input.id as number;
      
      const note = getProjectNotes(projectId).find(n => n.id === id);
      if (!note) return { error: `Note not found: ${id}` };
      
      return note;
    },

    research_update_note: async (input) => {
      const projectId = input.project as string;
      const id = input.id as number;
      
      const notes = getProjectNotes(projectId);
      const note = notes.find(n => n.id === id);
      if (!note) return { error: `Note not found: ${id}` };
      
      if (input.title) note.title = input.title as string;
      if (input.content) note.content = input.content as string;
      if (input.tags) note.tags = input.tags as string[];
      note.updatedAt = new Date().toISOString();
      
      return { success: true, id, updatedAt: note.updatedAt };
    },

    research_delete_note: async (input) => {
      const projectId = input.project as string;
      const id = input.id as number;
      
      const notes = getProjectNotes(projectId);
      const index = notes.findIndex(n => n.id === id);
      if (index === -1) return { error: `Note not found: ${id}` };
      
      notes.splice(index, 1);
      return { success: true, id };
    },

    research_list_tags: async (input) => {
      const projectId = input.project as string;
      const notes = getProjectNotes(projectId);
      
      const tagCounts = new Map<string, number>();
      for (const note of notes) {
        for (const tag of note.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      
      return {
        project: projectId,
        tags: Array.from(tagCounts.entries())
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count),
      };
    },

    research_export_notes: async (input) => {
      const projectId = input.project as string;
      const output = input.output as string;
      const filterTags = input.tags as string[] | undefined;
      
      let notes = getProjectNotes(projectId);
      if (filterTags?.length) {
        notes = notes.filter(n => filterTags.some(t => n.tags.includes(t)));
      }
      
      const markdown = notes.map(n => 
        `# ${n.title}\n\n` +
        `**Tags:** ${n.tags.join(', ') || 'none'}\n` +
        `**Created:** ${n.createdAt}\n` +
        (n.source ? `**Source:** ${n.source}\n` : '') +
        `\n${n.content}\n\n---\n`
      ).join('\n');
      
      const fs = await import('fs');
      fs.writeFileSync(output, markdown);
      
      return { success: true, output, exportedCount: notes.length };
    },

    research_link_notes: async (input) => {
      const projectId = input.project as string;
      const fromId = input.fromId as number;
      const toId = input.toId as number;
      const relationship = (input.relationship as string) || 'related';
      
      const notes = getProjectNotes(projectId);
      const from = notes.find(n => n.id === fromId);
      const to = notes.find(n => n.id === toId);
      
      if (!from) return { error: `Source note not found: ${fromId}` };
      if (!to) return { error: `Target note not found: ${toId}` };
      
      // Add link as tag for now (could be separate table)
      from.tags.push(`link:${relationship}:${toId}`);
      from.updatedAt = new Date().toISOString();
      
      return { success: true, fromId, toId, relationship };
    },

    research_summary: async (input) => {
      const projectId = input.project as string;
      const notes = getProjectNotes(projectId);
      
      const tagCounts = new Map<string, number>();
      let totalWords = 0;
      
      for (const note of notes) {
        totalWords += note.content.split(/\s+/).length;
        for (const tag of note.tags) {
          if (!tag.startsWith('link:')) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }
      
      return {
        project: projectId,
        totalNotes: notes.length,
        totalWords,
        uniqueTags: tagCounts.size,
        topTags: Array.from(tagCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag, count]) => ({ tag, count })),
      };
    },

    research_recent: async (input) => {
      const projectId = input.project as string;
      const limit = (input.limit as number) || 10;
      
      const notes = getProjectNotes(projectId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
      
      return {
        project: projectId,
        count: notes.length,
        notes: notes.map(n => ({
          id: n.id,
          title: n.title,
          tags: n.tags.filter(t => !t.startsWith('link:')),
          updatedAt: n.updatedAt,
        })),
      };
    },
  };
}
