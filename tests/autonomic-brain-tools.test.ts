import { describe, it, expect } from 'vitest';
import { autonomicTools, createAutonomicHandlers } from '../src/tools/autonomic-tools.js';
import { brainTools } from '../src/tools/brain-tools.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Shared invariant: every MCP tool must have a name, a description, and a
// well-formed object inputSchema. These checks run with no live DB and no
// network — they validate the static contract the MCP server registers.
function expectValidToolShape(tool: Tool | undefined, name: string) {
  expect(tool, `tool '${name}' should be defined`).toBeDefined();
  expect(tool?.name).toBe(name);
  expect(typeof tool?.description).toBe('string');
  expect((tool?.description ?? '').length).toBeGreaterThan(0);
  expect(tool?.inputSchema).toBeDefined();
  expect(tool?.inputSchema.type).toBe('object');
  expect(tool?.inputSchema.properties).toBeTypeOf('object');
}

describe('autonomicTools', () => {
  it('exports a non-empty Tool array', () => {
    expect(Array.isArray(autonomicTools)).toBe(true);
    expect(autonomicTools.length).toBeGreaterThan(0);
  });

  it('defines the score_sprint tool', () => {
    expectValidToolShape(autonomicTools.find(t => t.name === 'score_sprint'), 'score_sprint');
  });

  it('defines the queue_sprint tool', () => {
    expectValidToolShape(autonomicTools.find(t => t.name === 'queue_sprint'), 'queue_sprint');
  });

  it('defines the preflight_check tool', () => {
    expectValidToolShape(autonomicTools.find(t => t.name === 'preflight_check'), 'preflight_check');
  });

  it('defines the validate_sprint tool', () => {
    expectValidToolShape(autonomicTools.find(t => t.name === 'validate_sprint'), 'validate_sprint');
  });

  it('has unique tool names', () => {
    const names = autonomicTools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('createAutonomicHandlers', () => {
  const handlers = createAutonomicHandlers();

  it('returns a handler record', () => {
    expect(handlers).toBeTypeOf('object');
  });

  it.each(['score_sprint', 'queue_sprint', 'preflight_check', 'validate_sprint'])(
    'exposes a callable handler for %s',
    (name) => {
      expect(handlers[name]).toBeTypeOf('function');
    }
  );

  it('provides a handler for every advertised autonomic tool', () => {
    for (const tool of autonomicTools) {
      expect(handlers[tool.name], `missing handler for '${tool.name}'`).toBeTypeOf('function');
    }
  });
});

describe('brainTools', () => {
  it('exports a non-empty Tool array', () => {
    expect(Array.isArray(brainTools)).toBe(true);
    expect(brainTools.length).toBeGreaterThan(0);
  });

  it('defines the brain_recall tool', () => {
    expectValidToolShape(brainTools.find(t => t.name === 'brain_recall'), 'brain_recall');
  });

  it('defines the brain_remember tool', () => {
    expectValidToolShape(brainTools.find(t => t.name === 'brain_remember'), 'brain_remember');
  });

  it('has unique tool names', () => {
    const names = brainTools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
