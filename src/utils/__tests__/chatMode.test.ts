import { describe, expect, it } from 'vitest';

import { deriveLegalAidChatMode } from '../chatMode';

describe('deriveLegalAidChatMode', () => {
  it('shows local assistant setup when the phone model has not been prepared', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: true,
      localAssistantState: 'idle',
    });

    expect(mode.id).toBe('local-assistant-setup');
    expect(mode.title).toBe('Initializing local AI');
    expect(mode.description).toContain('preparing local replies');
    expect(mode.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Assistant', value: 'Initializing local AI' }),
      expect.objectContaining({ label: 'Provider', value: 'Not active in chat' }),
    ]));
  });

  it('shows guidance-only mode when the local assistant is disabled', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: false,
      localAssistantState: 'idle',
    });

    expect(mode.id).toBe('local-guidance-unavailable');
    expect(mode.title).toBe('Local assistant off');
    expect(mode.rows[0]).toMatchObject({
      label: 'Assistant',
      value: 'Local model disabled',
      tone: 'neutral',
    });
  });

  it('prioritizes on-device assistant mode only when the local model is ready', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: true,
      localAssistantEnabled: true,
      localAssistantState: 'ready',
    });

    expect(mode.id).toBe('local-assistant');
    expect(mode.rows[0]).toMatchObject({
      label: 'Assistant',
      value: 'Local AI ready',
      tone: 'success',
    });
    expect(mode.description).toContain('not a lawyer');
  });

  it('keeps preparing local assistant distinct from ready assistant mode', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: true,
      localAssistantState: 'downloading',
    });

    expect(mode.id).toBe('local-assistant-preparing');
    expect(mode.badge).toBe('Preparing');
    expect(mode.rows[0]).toMatchObject({ value: 'Downloading model', tone: 'warning' });
  });

  it('shows checksum verification as a separate post-download phase', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: true,
      localAssistantState: 'verifying',
      localAssistantProgress: 61,
    });

    expect(mode.id).toBe('local-assistant-preparing');
    expect(mode.badge).toBe('Preparing');
    expect(mode.rows[0]).toMatchObject({
      value: 'Verifying model',
      detail: 'Checking file integrity - 61%.',
      tone: 'warning',
    });
  });

  it('shows downloaded local model state before loading into memory', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: true,
      localAssistantState: 'downloaded',
    });

    expect(mode.id).toBe('local-assistant-downloaded');
    expect(mode.badge).toBe('Loading');
    expect(mode.rows[0]).toMatchObject({ value: 'Model saved', tone: 'warning' });
  });

  it('keeps local model errors separate from backend or provider claims', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: true,
      localAssistantState: 'error',
    });

    expect(mode.id).toBe('local-guidance-unavailable');
    expect(mode.title).toBe('Local AI needs attention');
    expect(mode.rows[0]).toMatchObject({
      value: 'Local model unavailable',
      tone: 'error',
    });
    expect(mode.rows[0].detail).toContain('Try setup again');
  });

  it('shows saved model download errors as resumable setup', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: false,
      localAssistantEnabled: true,
      localAssistantState: 'error',
      localAssistantProgress: 67,
      localAssistantResumable: true,
    });

    expect(mode.id).toBe('local-assistant-setup');
    expect(mode.title).toBe('Resuming local model');
    expect(mode.badge).toBe('Preparing');
    expect(mode.rows[0]).toMatchObject({
      value: 'Resuming local model',
      tone: 'warning',
    });
    expect(mode.description).toContain('resumes while SafeRide is open');
  });

  it('makes offline queued delivery explicit and does not imply provider handoff', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: false,
      hasSession: true,
      hasStoredHistory: true,
      queuedMessageCount: 2,
      localAssistantEnabled: false,
      localAssistantState: 'idle',
    });

    expect(mode.id).toBe('offline-queued');
    expect(mode.badge).toBe('Queued locally');
    expect(mode.description).toContain('No provider has received');
    expect(mode.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Delivery', value: '2 messages queued', tone: 'offline' }),
    ]));
  });

  it('shows a local phone session when the chat API is not reachable', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      sessionLocalOnly: true,
      hasStoredHistory: true,
      localAssistantEnabled: true,
      localAssistantState: 'ready',
    });

    expect(mode.id).toBe('local-assistant');
    expect(mode.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'History', value: 'Local phone session', tone: 'warning' }),
      expect.objectContaining({ label: 'Delivery', value: 'Local phone save', tone: 'offline' }),
    ]));
  });

  it('shows stored history as history rather than assistant support', () => {
    const mode = deriveLegalAidChatMode({
      isOnline: true,
      hasSession: true,
      hasStoredHistory: true,
      localAssistantEnabled: false,
      localAssistantState: 'idle',
    });

    expect(mode.id).toBe('stored-history');
    expect(mode.title).toBe('Stored conversation history');
    expect(mode.description).toContain('phone-local assistant is not ready');
  });
});
