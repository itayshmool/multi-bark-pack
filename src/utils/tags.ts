/**
 * Parse #model and #backend tags from message text.
 * Returns cleaned body with tags removed, plus extracted model/backend.
 */
export function parseMessageTags(body: string): {
  cleanBody: string;
  model?: string;
  backend?: string;
} {
  let cleanBody = body;
  let model: string | undefined;
  let backend: string | undefined;

  const modelMatch = cleanBody.match(/#(haiku|sonnet|opus)\b/i);
  if (modelMatch) {
    model = modelMatch[1].toLowerCase();
    cleanBody = cleanBody.replace(modelMatch[0], '').trim();
  }

  const backendMatch = cleanBody.match(/#(claude-code|cursor|codex|gemini)\b/i);
  if (backendMatch) {
    backend = backendMatch[1].toLowerCase();
    cleanBody = cleanBody.replace(backendMatch[0], '').trim();
  }

  return { cleanBody, model, backend };
}
