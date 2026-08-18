import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '../markdownBlocks';

function plainText(segments: Array<{ text: string }>): string {
  return segments.map(segment => segment.text).join('');
}

describe('parseMarkdown', () => {
  it('attaches bare ordered-list marker lines to following answer text', () => {
    const blocks = parseMarkdown([
      'Here are steps:',
      '',
      '1.',
      'Move to a safe public place.',
      '2.',
      'Call emergency services or a trusted support line.',
      '3.',
      'Write down what happened when it is safe.',
    ].join('\n'));

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: 'ordered-list' });
    if (blocks[1].type !== 'ordered-list') throw new Error('expected ordered list');

    expect(blocks[1].items.map(plainText)).toEqual([
      'Move to a safe public place.',
      'Call emergency services or a trusted support line.',
      'Write down what happened when it is safe.',
    ]);
  });

  it('keeps soft-wrapped ordered-list item text with the visible item', () => {
    const blocks = parseMarkdown([
      '1. Move away from the unsafe person if possible.',
      'Keep your phone with you and stay near other people.',
      '2. Ask a trusted person to stay with you.',
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'ordered-list' });
    if (blocks[0].type !== 'ordered-list') throw new Error('expected ordered list');

    expect(blocks[0].items.map(plainText)).toEqual([
      'Move away from the unsafe person if possible. Keep your phone with you and stay near other people.',
      'Ask a trusted person to stay with you.',
    ]);
  });

  it('drops empty ordered-list items so degenerate answers do not render blank "1. 2. 3." rows', () => {
    const blocks = parseMarkdown([
      'For reporting GBV in Kenya, here are some steps:',
      '',
      '1.',
      '',
      '2.',
      '',
      '3.',
    ].join('\n'));

    // The bare markers carry no content, so no list block should be produced.
    const listBlocks = blocks.filter(
      block => block.type === 'ordered-list' || block.type === 'unordered-list',
    );
    expect(listBlocks).toHaveLength(0);

    const paragraphs = blocks.filter(block => block.type === 'paragraph');
    expect(paragraphs).toHaveLength(1);
    if (paragraphs[0].type !== 'paragraph') throw new Error('expected paragraph');
    expect(plainText(paragraphs[0].content)).toContain('For reporting GBV');
  });

  it('accepts LLM ordered-list markers without a following space', () => {
    const blocks = parseMarkdown([
      '1.Prioritise safety.',
      '2.Reach out to someone trusted.',
      '3.Seek professional support.',
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'ordered-list' });
    if (blocks[0].type !== 'ordered-list') throw new Error('expected ordered list');

    expect(blocks[0].items.map(plainText)).toEqual([
      'Prioritise safety.',
      'Reach out to someone trusted.',
      'Seek professional support.',
    ]);
  });
});
