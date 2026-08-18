import { describe, expect, it } from 'vitest';

import {
  getAssistantLanguageInstruction,
  getChatLegalAidCopy,
  getRootRouteTitle,
} from '../appLanguage';

describe('app language copy', () => {
  it('falls back to source route titles when Kiswahili is not approved', () => {
    expect(getRootRouteTitle('Settings', 'sw')).toBe('Settings');
    expect(getRootRouteTitle('LanguageAccessibility', 'sw')).toBe('Language & Accessibility');
    expect(getRootRouteTitle('EvidenceDetail', 'sw')).toBe('Evidence');
  });

  it('keeps English route titles as the default', () => {
    expect(getRootRouteTitle('Settings')).toBe('Settings');
    expect(getRootRouteTitle('EvidenceDetail', 'missing')).toBe('Evidence');
  });

  it('uses the shared source-locale fallback for assistant claims', () => {
    expect(getAssistantLanguageInstruction('sw')).toContain('Reply in English');
    expect(getChatLegalAidCopy('sw').welcomeMessage).toContain('General support only');
    expect(getChatLegalAidCopy('sw').quickChips[0].label).toBe('How do I report to the police?');
  });
});
