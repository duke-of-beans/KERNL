/**
 * KERNL MCP - Behavioral Check Tools
 *
 * Motor-program encoding of §0.8 BEHAVIORAL_INVARIANTS.
 * Converts text rules into pattern-matched pre-action checks.
 *
 * v1.0: Pattern-based detection of the 6 behavioral invariants.
 * Future: violation recording + learning from corrections.
 *
 * Tools:
 *   behavioral_check — scan proposed text/action for invariant violations
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ==========================================================================
// VIOLATION PATTERNS
// ==========================================================================

interface ViolationPattern {
  invariant: number;
  name: string;
  patterns: RegExp[];
  suggestion: string;
}

const VIOLATION_PATTERNS: ViolationPattern[] = [
  // §0.8.1 TOOLS>MANUAL
  {
    invariant: 1,
    name: 'TOOLS>MANUAL',
    patterns: [
      /\b(?:open|go to|navigate to|check|visit)\s+(?:the\s+)?(?:vercel|railway|supabase|stripe|github|godaddy)\s+(?:dashboard|panel|settings|console|ui)/i,
      /\b(?:in your|open your|from your)\s+(?:terminal|browser|shell|cmd)/i,
      /\b(?:manually|by hand)\s+(?:create|add|set|configure|update|delete|remove|check|verify)/i,
      /\bplease\s+(?:run|execute|open|go to|navigate|check|verify|set|add|configure)\b/i,
      /\b(?:add|set|configure|update)\s+(?:the\s+)?(?:env|environment)\s+var/i,
      /\byou(?:'ll| will| can| should| need to)\s+(?:need to\s+)?(?:manually|go to|open|navigate|run|check|add|set|configure)/i,
    ],
    suggestion: 'tool_search first. If a tool exists, USE IT instead of instructing manual action.',
  },
  // §0.8.2 DIRECT-WRITE (container staging)
  {
    invariant: 2,
    name: 'DIRECT-WRITE',
    patterns: [
      /\/home\/claude\/.*(?:\.(?:html|css|js|ts|tsx|jsx|md|json|yaml|yml|py|sh|ps1|bat))/i,
      /create_file.*\/home\/claude/i,
      /(?:cat|echo|cp|mv)\s+.*\/home\/claude.*(?:pm_write|D:\\)/i,
      /(?:save|write|create)\s+(?:it\s+)?(?:to|in|at)\s+(?:the\s+)?container/i,
      /\/mnt\/user-data\/outputs/i,
    ],
    suggestion: 'D:\\ target → pm_write_file direct. Container is for compute only.',
  },
  // §0.8.3 API-VERIFY
  {
    invariant: 3,
    name: 'API-VERIFY',
    patterns: [
      /\b(?:please|you.ll need to|you should|make sure to)\s+(?:check|verify|confirm|ensure)\s+(?:that\s+)?(?:the\s+)?(?:env|environment|config|setting|domain|dns)/i,
      /\b(?:go|head)\s+(?:to|into)\s+(?:your\s+)?(?:vercel|railway|supabase|stripe|godaddy|cloudflare)\s+(?:and\s+)?(?:check|verify|confirm|add|set)/i,
    ],
    suggestion: 'Check via API first before instructing David to verify anything.',
  },
  // §0.8.4 ×SESSION-MGMT
  {
    invariant: 4,
    name: '×SESSION-MGMT',
    patterns: [
      /\b(?:wrap(?:ping)?\s+up|wind(?:ing)?\s+down|call(?:ing)?\s+it\s+(?:a\s+)?(?:day|night|session))\b/i,
      /\b(?:good|natural|nice|great)\s+(?:stopping|breaking|pausing)\s+point\b/i,
      /\b(?:take|get)\s+(?:a\s+|some\s+)?(?:break|rest|sleep)\b/i,
      /\b(?:save|pick\s+up|continue|resume|revisit)\s+(?:this\s+)?(?:for\s+)?(?:next|tomorrow|later|another)\b/i,
      /\b(?:ready to|shall we|want to|time to)\s+(?:wrap|stop|break|pause|end|close|finish)\b/i,
      /\bthat's\s+(?:probably\s+)?(?:enough|plenty)\s+for\s+(?:now|today|tonight|one\s+session)\b/i,
      /\b(?:go get some|you should get some|time for some)\s+(?:sleep|rest)\b/i,
      /\bmaybe\s+(?:we\s+)?(?:should|could)\s+(?:stop|wrap|break|pause|rest)\b/i,
      /\b(?:before\s+(?:we|you)\s+)?(?:lose\s+steam|run\s+out\s+of|fade)\b/i,
    ],
    suggestion: 'David decides when to stop. NEVER suggest stopping, breaking, or wrapping.',
  },
  // §0.8.5 SYSTEMIC-CONSISTENCY
  {
    invariant: 5,
    name: 'SYSTEMIC-CONSISTENCY',
    patterns: [
      // This is harder to pattern-match — it's about MISSING propagation
      // Best detected by comparing what was changed vs what surfaces reference it
      // For v1, flag obvious single-surface updates
      /\b(?:just|only)\s+(?:update|change|fix|modify)\s+(?:the\s+)?(?:homepage|pricing|about|landing)\b/i,
    ],
    suggestion: 'Propagate changes to ALL surfaces. Enumerate every reference before committing.',
  },
  // §0.8.6 SESSION-END (reminder, not violation detection)
  // This fires as a reminder at session close, not as a violation detector
];

// Common false positive exclusions
const FALSE_POSITIVE_GUARDS: RegExp[] = [
  /\b(?:David|you)\s+(?:will\s+)?need\s+to\s+(?:submit|upload)\s+to\s+(?:chrome web store|CWS|AMO|app store)/i, // store submissions are genuinely manual
  /\b(?:David|you)\s+(?:will\s+)?need\s+to\s+(?:click|tap|approve|authorize|authenticate|sign|log ?in)/i, // auth actions are genuinely manual
];

// ==========================================================================
// TOOL DEFINITIONS
// ==========================================================================

export const behavioralTools: Tool[] = [
  {
    name: 'behavioral_check',
    description:
      'Scan proposed response text for §0.8 BEHAVIORAL_INVARIANT violations. Returns any ' +
      'detected violations with the invariant number, name, matched text, and suggested ' +
      'correction. Call BEFORE finalizing a response when uncertain about compliance. ' +
      'Also useful as a post-session audit: paste a response that received a correction ' +
      'to understand which invariant was violated.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The proposed response or action description to check',
        },
        context: {
          type: 'string',
          description: 'Optional context about what the response is for (helps reduce false positives)',
        },
      },
      required: ['text'],
    },
  },
];

// ==========================================================================
// HANDLER
// ==========================================================================

interface Violation {
  invariant: number;
  name: string;
  matched: string;
  suggestion: string;
  line_hint: string;
}

export function createBehavioralHandlers(): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
  return {
    behavioral_check: async (input) => {
      const text = input.text as string;
      if (!text) return { error: 'behavioral_check requires text' };

      const context = (input.context as string) || '';
      const violations: Violation[] = [];
      const lines = text.split('\n');

      // Check for false positive guards first
      const isFalsePositive = (matchedText: string): boolean => {
        return FALSE_POSITIVE_GUARDS.some((guard) => guard.test(matchedText));
      };

      for (const vp of VIOLATION_PATTERNS) {
        for (const pattern of vp.patterns) {
          // Test against full text
          const match = pattern.exec(text);
          if (!match) continue;

          const matchedText = match[0];

          // Check false positive guards using surrounding context (±100 chars)
          const start = Math.max(0, match.index - 100);
          const end = Math.min(text.length, match.index + matchedText.length + 100);
          const surrounding = text.slice(start, end);
          if (isFalsePositive(surrounding)) continue;

          // Find which line the match is on
          let charCount = 0;
          let lineNum = 0;
          for (let i = 0; i < lines.length; i++) {
            charCount += lines[i].length + 1; // +1 for newline
            if (charCount > match.index) {
              lineNum = i + 1;
              break;
            }
          }

          violations.push({
            invariant: vp.invariant,
            name: vp.name,
            matched: matchedText.trim(),
            suggestion: vp.suggestion,
            line_hint: `~line ${lineNum}`,
          });

          // Only report one match per invariant to avoid noise
          break;
        }
      }

      // Dedup by invariant (keep first match per invariant)
      const seen = new Set<number>();
      const deduped = violations.filter((v) => {
        if (seen.has(v.invariant)) return false;
        seen.add(v.invariant);
        return true;
      });

      return {
        clean: deduped.length === 0,
        violations: deduped,
        checked_invariants: VIOLATION_PATTERNS.length,
        text_length: text.length,
      };
    },
  };
}
