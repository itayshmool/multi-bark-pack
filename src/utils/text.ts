/**
 * Truncate a message to a maximum length, appending '...' if truncated.
 * Used as a safety net in adapter send/edit methods for platform hard limits.
 */
export function truncateMessage(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.substring(0, maxLen) + '...';
}

/**
 * Split a long message into chunks that fit within maxLen.
 * Splits at natural boundaries: paragraph > code fence > line > sentence > word.
 * Avoids splitting inside fenced code blocks when possible.
 * When a code block is too large to avoid splitting, fence-healing closes the
 * block at the split point and re-opens it in the next chunk so each chunk
 * has properly paired ``` fences (critical for Telegram MarkdownV1).
 */
export function splitMessage(text: string, maxLen: number): string[] {
  if (!text) return ['(no output)'];
  if (maxLen <= 0) return [text];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    const segment = remaining.substring(0, maxLen);
    const splitAt = Math.max(1, findSplitPoint(segment, maxLen));

    chunks.push(remaining.substring(0, splitAt).trimEnd());
    remaining = remaining.substring(splitAt).trimStart();
  }

  return healFences(chunks.filter(c => c.length > 0));
}

/**
 * Post-process chunks to ensure every chunk has properly paired ``` fences.
 * When splitMessage is forced to split inside a code block, this closes the
 * block at the end of the chunk and re-opens it at the start of the next one,
 * preserving the language tag. This prevents Telegram MarkdownV1 parse failures.
 */
function healFences(chunks: string[]): string[] {
  let inCode = false;
  let langTag = '';

  for (let i = 0; i < chunks.length; i++) {
    if (inCode) {
      chunks[i] = '```' + langTag + '\n' + chunks[i];
    }

    let codeOpen = false;
    let lastLang = '';
    const fenceMatches = chunks[i].match(/^```(\w*)/gm) || [];
    for (const m of fenceMatches) {
      if (!codeOpen) {
        codeOpen = true;
        lastLang = m.slice(3);
      } else {
        codeOpen = false;
        lastLang = '';
      }
    }

    if (codeOpen) {
      chunks[i] += '\n```';
      inCode = true;
      langTag = lastLang;
    } else {
      inCode = false;
      langTag = '';
    }
  }

  return chunks;
}

function findSplitPoint(segment: string, maxLen: number): number {
  const minSplit = Math.floor(maxLen * 0.3);

  // Avoid splitting inside a fenced code block — if odd number of ```, split before the last fence
  const fenceCount = (segment.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    const lastFence = segment.lastIndexOf('\n```');
    if (lastFence > minSplit) {
      return lastFence + 1;
    }
  }

  // Priority 1: paragraph boundary (double newline)
  const dblNewline = segment.lastIndexOf('\n\n');
  if (dblNewline > minSplit) return dblNewline + 2;

  // Priority 2: line boundary
  const newline = segment.lastIndexOf('\n');
  if (newline > minSplit) return newline + 1;

  // Priority 3: sentence end
  const sentenceEnd = Math.max(
    segment.lastIndexOf('. '),
    segment.lastIndexOf('! '),
    segment.lastIndexOf('? '),
  );
  if (sentenceEnd > minSplit) return sentenceEnd + 2;

  // Priority 4: word boundary
  const space = segment.lastIndexOf(' ');
  if (space > minSplit) return space + 1;

  // Fallback: hard split
  return maxLen;
}
