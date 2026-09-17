export interface PromptAttentionEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const DELIMITERS = new Set(`.,\\/!?%^*;:{}=\`~() \t\r\n`.split(""));
const WEIGHTED_BLOCK = /\(([^()]*)\s*:(-?\d+(?:\.\d+)?)\)/g;

function formatWeight(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}.0` : `${rounded}`;
}

function enclosingWeightedBlock(text: string, selectionStart: number, selectionEnd: number) {
  let selected: { start: number; end: number; content: string; weight: number } | null = null;
  for (const match of text.matchAll(WEIGHTED_BLOCK)) {
    const start = match.index;
    const end = start + match[0].length;
    if (selectionStart >= start && selectionEnd <= end) {
      selected = {
        start,
        end,
        content: match[1].trimEnd(),
        weight: Number(match[2]),
      };
      break;
    }
  }
  return selected;
}

function currentWord(text: string, caret: number): [number, number] {
  let start = Math.min(caret, text.length);
  let end = start;
  while (start > 0 && !DELIMITERS.has(text[start - 1])) start -= 1;
  while (end < text.length && !DELIMITERS.has(text[end])) end += 1;
  return [start, end];
}

/** Forge-compatible Ctrl+Arrow attention editing without a Gradio global. */
export function adjustPromptAttention(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 1 | -1,
): PromptAttentionEdit | null {
  const block = enclosingWeightedBlock(text, selectionStart, selectionEnd);
  if (block) {
    const nextWeight = Math.round((block.weight + direction * 0.1) * 10) / 10;
    if (Math.abs(nextWeight - 1) < 0.000001) {
      const next = text.slice(0, block.start) + block.content + text.slice(block.end);
      return {
        text: next,
        selectionStart: block.start,
        selectionEnd: block.start + block.content.length,
      };
    }
    const replacement = `(${block.content}:${formatWeight(nextWeight)})`;
    return {
      text: text.slice(0, block.start) + replacement + text.slice(block.end),
      selectionStart: block.start + 1,
      selectionEnd: block.start + 1 + block.content.length,
    };
  }

  if (selectionStart === selectionEnd) {
    [selectionStart, selectionEnd] = currentWord(text, selectionStart);
  }
  while (selectionEnd > selectionStart && text[selectionEnd - 1] === " ") {
    selectionEnd -= 1;
  }
  if (selectionStart === selectionEnd) return null;
  const content = text.slice(selectionStart, selectionEnd);
  const weight = 1 + direction * 0.1;
  const replacement = `(${content}:${formatWeight(weight)})`;
  return {
    text: text.slice(0, selectionStart) + replacement + text.slice(selectionEnd),
    selectionStart: selectionStart + 1,
    selectionEnd: selectionStart + 1 + content.length,
  };
}
