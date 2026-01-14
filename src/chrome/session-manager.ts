/**
 * KERNL MCP - Chrome Session Manager
 * 
 * Manages Puppeteer browser sessions with lifecycle handling.
 */

import puppeteer, { Browser, Page, ElementHandle } from 'puppeteer';
import { EventEmitter } from 'events';

// ==========================================================================
// SESSION TYPES
// ==========================================================================

export interface ChromeSession {
  id: string;
  browser: Browser;
  page: Page;
  url: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface ChromeConfig {
  headless: boolean;
  defaultViewport: { width: number; height: number };
  timeout: number;
  userDataDir?: string;
}

// ==========================================================================
// SESSION MANAGER
// ==========================================================================

class ChromeSessionManager extends EventEmitter {
  private sessions: Map<string, ChromeSession> = new Map();
  private sessionCounter = 0;
  private defaultConfig: ChromeConfig = {
    headless: true,
    defaultViewport: { width: 1920, height: 1080 },
    timeout: 30000,
  };

  setConfig(config: Partial<ChromeConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
  }

  getConfig(): ChromeConfig {
    return { ...this.defaultConfig };
  }

  async launch(options?: Partial<ChromeConfig>): Promise<ChromeSession> {
    const config = { ...this.defaultConfig, ...options };
    const sessionId = `chrome_${++this.sessionCounter}_${Date.now()}`;

    try {
      const browser = await puppeteer.launch({
        headless: config.headless,
        defaultViewport: config.defaultViewport,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        ...(config.userDataDir ? { userDataDir: config.userDataDir } : {}),
      });

      const page = await browser.newPage();
      await page.setDefaultTimeout(config.timeout);

      const session: ChromeSession = {
        id: sessionId,
        browser,
        page,
        url: 'about:blank',
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.sessions.set(sessionId, session);
      this.emit('sessionCreated', session);

      return session;
    } catch (error) {
      throw new Error(`Failed to launch Chrome: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getSession(sessionId: string): Promise<ChromeSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      await session.browser.close();
      this.sessions.delete(sessionId);
      this.emit('sessionClosed', sessionId);
      return true;
    } catch (error) {
      this.sessions.delete(sessionId);
      return false;
    }
  }

  async closeAll(): Promise<number> {
    let closed = 0;
    for (const sessionId of this.sessions.keys()) {
      if (await this.closeSession(sessionId)) closed++;
    }
    return closed;
  }

  listSessions(): Array<{
    id: string;
    url: string;
    createdAt: Date;
    lastActivity: Date;
  }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      url: s.url,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  }

  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await session.page.goto(url, { waitUntil: 'networkidle2' });
    session.url = url;
    this.updateActivity(sessionId);
  }

  async screenshot(sessionId: string, path?: string): Promise<Buffer> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.updateActivity(sessionId);
    const screenshot = await session.page.screenshot({
      fullPage: false,
      ...(path ? { path } : {}),
    });
    return Buffer.from(screenshot);
  }

  async click(sessionId: string, selector: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await session.page.click(selector);
    this.updateActivity(sessionId);
  }

  async type(sessionId: string, selector: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await session.page.type(selector, text);
    this.updateActivity(sessionId);
  }

  async waitFor(sessionId: string, selector: string, timeout?: number): Promise<ElementHandle | null> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.updateActivity(sessionId);
    return await session.page.waitForSelector(selector, { timeout });
  }

  async getContent(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.updateActivity(sessionId);
    return await session.page.content();
  }

  async evaluate<T>(sessionId: string, fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.updateActivity(sessionId);
    return await session.page.evaluate(fn, ...args);
  }

  async scroll(sessionId: string, x: number, y: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await session.page.evaluate(`window.scrollBy(${x}, ${y})`);
    this.updateActivity(sessionId);
  }

  async getElement(sessionId: string, selector: string): Promise<ElementHandle | null> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.updateActivity(sessionId);
    return await session.page.$(selector);
  }

  async getElements(sessionId: string, selector: string): Promise<ElementHandle[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    this.updateActivity(sessionId);
    return await session.page.$$(selector);
  }
}

// Singleton instance
export const chromeManager = new ChromeSessionManager();
