const TAG_RE = /#(haiku|sonnet|opus|claude-code|cursor|codex|gemini)\b/gi;
const MODEL_TAGS = new Set(['haiku', 'sonnet', 'opus']);

/**
 * Parse #model and #backend tags from message text.
 * Returns cleaned body with tags removed, plus extracted model/backend.
 */
export function parseMessageTags(body: string): {
  cleanBody: string;
  model?: string;
  backend?: string;
} {
  let model: string | undefined;
  let backend: string | undefined;

  const cleanBody = body.replace(TAG_RE, (match, tag: string) => {
    const lower = tag.toLowerCase();
    if (!model && MODEL_TAGS.has(lower)) model = lower;
    else if (!backend) backend = lower;
    return '';
  }).replace(/\s{2,}/g, ' ').trim();

  return { cleanBody, model, backend };
}
