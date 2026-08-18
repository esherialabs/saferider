export type InlineSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
};

export type ParagraphBlock = {
  type: 'paragraph';
  content: InlineSegment[];
};

export type ListBlock = {
  type: 'unordered-list' | 'ordered-list';
  items: InlineSegment[][];
};

export type HeadingBlock = {
  type: 'heading';
  level: number;
  content: InlineSegment[];
};

export type CodeBlock = {
  type: 'code';
  content: string;
};

export type QuoteBlock = {
  type: 'blockquote';
  content: InlineSegment[];
};

export type MarkdownBlock = ParagraphBlock | ListBlock | HeadingBlock | CodeBlock | QuoteBlock;

function parseInlineSegments(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = input;

  const pattern =
    /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|~~([^~]+)~~|\*(?!\s)([^*]+)\*|_(?!\s)([^_]+)_)/;

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match || typeof match.index !== 'number') {
      segments.push({ text: remaining });
      break;
    }

    const before = remaining.slice(0, match.index);
    if (before) {
      segments.push({ text: before });
    }

    const fullMatch = match[0];
    if (match[1] && match[2] && match[3]) {
      segments.push({
        text: match[2],
        link: match[3],
      });
    } else if (match[4]) {
      segments.push({
        text: match[4],
        bold: true,
      });
    } else if (match[5]) {
      segments.push({
        text: match[5],
        bold: true,
      });
    } else if (match[6]) {
      segments.push({
        text: match[6],
        code: true,
      });
    } else if (match[7]) {
      segments.push({
        text: match[7],
        strike: true,
      });
    } else if (match[8]) {
      segments.push({
        text: match[8],
        italic: true,
      });
    } else if (match[9]) {
      segments.push({
        text: match[9],
        italic: true,
      });
    } else {
      segments.push({ text: fullMatch });
    }

    remaining = remaining.slice(match.index + fullMatch.length);
  }

  return segments;
}

function isUnorderedList(line: string): boolean {
  return /^\s*[-*+](?:\s+|$)/.test(line);
}

function isOrderedList(line: string): boolean {
  return /^\s*\d+\.(?:\s+|$|(?=[A-Za-z]))/.test(line);
}

function isCodeFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function isQuote(line: string): boolean {
  return /^\s{0,3}>\s?/.test(line);
}

function isBlockStart(line: string): boolean {
  return isCodeFence(line) || isHeading(line) || isQuote(line);
}

function stripListMarker(line: string, ordered: boolean): string {
  return ordered
    ? line.replace(/^\s*\d+\.\s*/, '')
    : line.replace(/^\s*[-*+]\s*/, '');
}

export function parseMarkdown(input: string): MarkdownBlock[] {
  const text = input.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];

  let index = 0;

  const consumeList = (ordered: boolean): ListBlock => {
    const items: InlineSegment[][] = [];

    while (index < lines.length) {
      const line = lines[index];
      if (ordered ? !isOrderedList(line) : !isUnorderedList(line)) {
        break;
      }

      index += 1;
      const itemLines: string[] = [];
      const firstLine = stripListMarker(line, ordered).trim();
      if (firstLine) {
        itemLines.push(firstLine);
      }

      while (index < lines.length) {
        const nextLine = lines[index];
        const nextTrimmed = nextLine.trim();

        if (ordered ? isOrderedList(nextLine) : isUnorderedList(nextLine)) {
          break;
        }
        if (ordered ? isUnorderedList(nextLine) : isOrderedList(nextLine)) {
          break;
        }
        if (isBlockStart(nextLine)) {
          break;
        }
        if (!nextTrimmed) {
          index += 1;
          if (itemLines.length > 0) {
            break;
          }
          continue;
        }

        itemLines.push(nextTrimmed);
        index += 1;
      }

      const visibleContent = itemLines.join(' ').trim();
      // Skip empty items so a malformed/degenerate response (e.g. bare "1."
      // "2." "3." markers with no content) does not render as empty numbered
      // rows with large blank gaps.
      if (visibleContent) {
        items.push(parseInlineSegments(visibleContent));
      }
    }

    return {
      type: ordered ? 'ordered-list' : 'unordered-list',
      items,
    };
  };

  while (index < lines.length) {
    const current = lines[index];
    if (!current.trim()) {
      index += 1;
      continue;
    }

    if (isCodeFence(current)) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !isCodeFence(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && isCodeFence(lines[index])) {
        index += 1;
      }
      blocks.push({
        type: 'code',
        content: codeLines.join('\n'),
      });
      continue;
    }

    if (isHeading(current)) {
      const level = (current.match(/^#{1,6}/)?.[0]?.length ?? 1);
      const headingText = current.replace(/^#{1,6}\s+/, '').trim();
      blocks.push({
        type: 'heading',
        level,
        content: parseInlineSegments(headingText),
      });
      index += 1;
      continue;
    }

    if (isQuote(current)) {
      const quoteLines: string[] = [];
      while (index < lines.length && isQuote(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, '').trim());
        index += 1;
      }
      blocks.push({
        type: 'blockquote',
        content: parseInlineSegments(quoteLines.join(' ').trim()),
      });
      continue;
    }

    if (isUnorderedList(current)) {
      const block = consumeList(false);
      if (block.items.length > 0) {
        blocks.push(block);
      }
      continue;
    }

    if (isOrderedList(current)) {
      const block = consumeList(true);
      if (block.items.length > 0) {
        blocks.push(block);
      }
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length
      && lines[index].trim()
      && !isCodeFence(lines[index])
      && !isHeading(lines[index])
      && !isQuote(lines[index])
      && !isUnorderedList(lines[index])
      && !isOrderedList(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        content: parseInlineSegments(paragraphLines.join(' ')),
      });
      continue;
    }

    index += 1;
  }

  return blocks;
}
