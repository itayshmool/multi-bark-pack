/**
 * Deterministic pre-filter for security screening.
 * Catches obviously malicious patterns before the LLM guard,
 * immune to prompt injection since it uses regex, not an LLM.
 */

interface PrefilterResult {
  blocked: boolean;
  category: string | null;
  reason: string | null;
}

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-\w*r\w*f\s+\/(?!\S*\.)/i, reason: 'Recursive delete on root' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/, reason: 'Fork bomb' },
  { pattern: /\bmkfs\b/i, reason: 'Filesystem format command' },
  { pattern: /\bdd\s+if=\/dev\/(zero|random|urandom)\b/i, reason: 'Disk overwrite via dd' },
  { pattern: /\b(format|fdisk)\s+\/(dev|disk)/i, reason: 'Disk format command' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'Direct write to block device' },
];

const PROMPT_INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, reason: 'Classic instruction override' },
  { pattern: /disregard\s+(all\s+)?(your\s+)?(previous\s+|system\s+)?(instructions|prompt)/i, reason: 'System prompt override' },
  { pattern: /you\s+are\s+now\s+(?!going\s+to\s+(?:fix|implement|build|create|test|debug))/i, reason: 'Role-reassignment jailbreak' },
  { pattern: /(?:new|override|replace)\s+(?:system\s+)?(?:prompt|instructions?)\s*:/i, reason: 'Prompt replacement attempt' },
  { pattern: /(?:forget|erase|clear)\s+(?:all\s+)?(?:your\s+)?(?:previous\s+)?(?:instructions|rules|guidelines)/i, reason: 'Instruction erasure attempt' },
];

export function prefilterScreen(text: string): PrefilterResult {
  for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, category: 'destructive_commands', reason };
    }
  }

  for (const { pattern, reason } of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, category: 'prompt_injection', reason };
    }
  }

  return { blocked: false, category: null, reason: null };
}
