/**
 * KERNL MCP - Chrome Automation Tools
 * 
 * 19 tools for browser automation with AI-powered capabilities.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { chromeManager } from './session-manager.js';

// ==========================================================================
// TOOL DEFINITIONS (19 tools)
// ==========================================================================

export const chromeTools: Tool[] = [
  // Session Management (4 tools)
  {
    name: 'chrome_launch',
    description: 'Launch a new Chrome browser session. Returns session ID for subsequent operations.',
    inputSchema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: 'Run in headless mode (default: true)' },
        width: { type: 'number', description: 'Viewport width (default: 1920)' },
        height: { type: 'number', description: 'Viewport height (default: 1080)' },
      },
    },
  },
  {
    name: 'chrome_close',
    description: 'Close a Chrome browser session by session ID.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to close' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'chrome_list_sessions',
    description: 'List all active Chrome sessions with their URLs and activity timestamps.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'chrome_close_all',
    description: 'Close all active Chrome sessions.',
    inputSchema: { type: 'object', properties: {} },
  },

  // Navigation (3 tools)
  {
    name: 'chrome_navigate',
    description: 'Navigate to a URL in a Chrome session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['sessionId', 'url'],
    },
  },
  {
    name: 'chrome_scroll',
    description: 'Scroll the page by x and y pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        x: { type: 'number', description: 'Horizontal scroll amount' },
        y: { type: 'number', description: 'Vertical scroll amount' },
      },
      required: ['sessionId', 'y'],
    },
  },
  {
    name: 'chrome_back',
    description: 'Navigate back in browser history.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
  },

  // Interaction (4 tools)
  {
    name: 'chrome_click',
    description: 'Click on an element by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector of element to click' },
      },
      required: ['sessionId', 'selector'],
    },
  },
  {
    name: 'chrome_type',
    description: 'Type text into an input field.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector of input field' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear field before typing (default: false)' },
      },
      required: ['sessionId', 'selector', 'text'],
    },
  },
  {
    name: 'chrome_select',
    description: 'Select an option from a dropdown.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector of select element' },
        value: { type: 'string', description: 'Value to select' },
      },
      required: ['sessionId', 'selector', 'value'],
    },
  },
  {
    name: 'chrome_hover',
    description: 'Hover over an element.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector of element' },
      },
      required: ['sessionId', 'selector'],
    },
  },

  // Content & Screenshots (4 tools)
  {
    name: 'chrome_screenshot',
    description: 'Take a screenshot of the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Optional file path to save screenshot' },
        fullPage: { type: 'boolean', description: 'Capture full page (default: false)' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'chrome_get_content',
    description: 'Get the HTML content of the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'chrome_get_text',
    description: 'Get text content of an element.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector of element' },
      },
      required: ['sessionId', 'selector'],
    },
  },
  {
    name: 'chrome_get_attribute',
    description: 'Get an attribute value from an element.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector of element' },
        attribute: { type: 'string', description: 'Attribute name to get' },
      },
      required: ['sessionId', 'selector', 'attribute'],
    },
  },

  // Waiting (2 tools)
  {
    name: 'chrome_wait_for',
    description: 'Wait for an element to appear on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['sessionId', 'selector'],
    },
  },
  {
    name: 'chrome_wait_for_navigation',
    description: 'Wait for page navigation to complete.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['sessionId'],
    },
  },

  // Advanced (2 tools)
  {
    name: 'chrome_evaluate',
    description: 'Execute JavaScript in the browser context.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        script: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['sessionId', 'script'],
    },
  },
  {
    name: 'chrome_fill_form',
    description: 'AI-powered form filling - fills multiple form fields at once.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        fields: {
          type: 'array',
          description: 'Array of {selector, value} pairs to fill',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['selector', 'value'],
          },
        },
      },
      required: ['sessionId', 'fields'],
    },
  },
];


// ==========================================================================
// TOOL HANDLERS
// ==========================================================================

interface ChromeHandlers {
  [key: string]: (input: Record<string, unknown>) => Promise<unknown>;
}

export function createChromeHandlers(): ChromeHandlers {
  return {
    // Session Management
    chrome_launch: async (input) => {
      const headless = (input.headless as boolean) ?? true;
      const width = (input.width as number) ?? 1920;
      const height = (input.height as number) ?? 1080;
      
      const session = await chromeManager.launch({
        headless,
        defaultViewport: { width, height },
      });
      
      return {
        sessionId: session.id,
        url: session.url,
        createdAt: session.createdAt,
      };
    },

    chrome_close: async (input) => {
      const sessionId = input.sessionId as string;
      const closed = await chromeManager.closeSession(sessionId);
      return { success: closed, sessionId };
    },

    chrome_list_sessions: async () => {
      return { sessions: chromeManager.listSessions() };
    },

    chrome_close_all: async () => {
      const count = await chromeManager.closeAll();
      return { closedCount: count };
    },

    // Navigation
    chrome_navigate: async (input) => {
      const sessionId = input.sessionId as string;
      const url = input.url as string;
      await chromeManager.navigate(sessionId, url);
      return { success: true, url };
    },

    chrome_scroll: async (input) => {
      const sessionId = input.sessionId as string;
      const x = (input.x as number) ?? 0;
      const y = input.y as number;
      await chromeManager.scroll(sessionId, x, y);
      return { success: true, scrolled: { x, y } };
    },

    chrome_back: async (input) => {
      const sessionId = input.sessionId as string;
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      await session.page.goBack();
      return { success: true };
    },

    // Interaction
    chrome_click: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      await chromeManager.click(sessionId, selector);
      return { success: true, selector };
    },

    chrome_type: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      const text = input.text as string;
      const clear = input.clear as boolean;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      if (clear) {
        await session.page.click(selector, { clickCount: 3 });
        await session.page.keyboard.press('Backspace');
      }
      
      await chromeManager.type(sessionId, selector, text);
      return { success: true, selector, textLength: text.length };
    },

    chrome_select: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      const value = input.value as string;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      await session.page.select(selector, value);
      return { success: true, selector, value };
    },


    chrome_hover: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      await session.page.hover(selector);
      return { success: true, selector };
    },

    // Content & Screenshots
    chrome_screenshot: async (input) => {
      const sessionId = input.sessionId as string;
      const path = input.path as string | undefined;
      const fullPage = (input.fullPage as boolean) ?? false;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      const screenshot = await session.page.screenshot({
        fullPage,
        ...(path ? { path } : {}),
      });
      
      const buffer = Buffer.from(screenshot);
      return {
        success: true,
        ...(path ? { savedTo: path } : {}),
        base64: buffer.toString('base64'),
        size: buffer.length,
      };
    },

    chrome_get_content: async (input) => {
      const sessionId = input.sessionId as string;
      const content = await chromeManager.getContent(sessionId);
      return { content, length: content.length };
    },

    chrome_get_text: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      const text = await session.page.$eval(selector, (el) => el.textContent || '');
      return { text, selector };
    },

    chrome_get_attribute: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      const attribute = input.attribute as string;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      const value = await session.page.$eval(
        selector,
        (el, attr) => el.getAttribute(attr as string),
        attribute
      );
      return { value, selector, attribute };
    },

    // Waiting
    chrome_wait_for: async (input) => {
      const sessionId = input.sessionId as string;
      const selector = input.selector as string;
      const timeout = input.timeout as number | undefined;
      
      const element = await chromeManager.waitFor(sessionId, selector, timeout);
      return { found: !!element, selector };
    },

    chrome_wait_for_navigation: async (input) => {
      const sessionId = input.sessionId as string;
      const timeout = (input.timeout as number) ?? 30000;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      await session.page.waitForNavigation({ timeout });
      return { success: true, url: session.page.url() };
    },

    // Advanced
    chrome_evaluate: async (input) => {
      const sessionId = input.sessionId as string;
      const script = input.script as string;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      const result = await session.page.evaluate(script);
      return { result };
    },

    chrome_fill_form: async (input) => {
      const sessionId = input.sessionId as string;
      const fields = input.fields as Array<{ selector: string; value: string }>;
      
      const session = await chromeManager.getSession(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      
      const results: Array<{ selector: string; success: boolean; error?: string }> = [];
      
      for (const field of fields) {
        try {
          await session.page.type(field.selector, field.value);
          results.push({ selector: field.selector, success: true });
        } catch (error) {
          results.push({
            selector: field.selector,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
      
      return {
        filled: results.filter(r => r.success).length,
        total: fields.length,
        results,
      };
    },
  };
}
