import { describe, expect, it } from 'vitest';

import {
  formatRemainingDownloadTime,
  getLastAssistantActionMessageId,
  getLastEditableUserMessageId,
  type ChatThreadActionMessage,
} from '../chatThreadActions';

describe('chatThreadActions', () => {
  it('allows retry only when the last visible message is an assistant reply', () => {
    const messages: ChatThreadActionMessage[] = [
      { id: 'welcome', role: 'assistant' },
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
      { id: 'user-2', role: 'user' },
    ];

    expect(getLastAssistantActionMessageId(messages)).toBeNull();

    messages.push({ id: 'assistant-2', role: 'assistant' });
    expect(getLastAssistantActionMessageId(messages)).toBe('assistant-2');
  });

  it('allows editing only the current turn prompt', () => {
    const messages: ChatThreadActionMessage[] = [
      { id: 'session-welcome', role: 'assistant' },
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
      { id: 'user-2', role: 'user' },
      { id: 'assistant-2', role: 'assistant' },
    ];

    expect(getLastEditableUserMessageId(messages)).toBe('user-2');
  });

  it('formats remaining model download time for compact UI copy', () => {
    expect(formatRemainingDownloadTime(null)).toBeNull();
    expect(formatRemainingDownloadTime(18)).toBe('less than 1 min left');
    expect(formatRemainingDownloadTime(16 * 60)).toBe('16 min left');
    expect(formatRemainingDownloadTime(2 * 60 * 60 + 12 * 60)).toBe('2 hr 12 min left');
  });
});
