import { describe, expect, it } from 'vitest';

import {
  LANGUAGE_ACCESSIBILITY_COPY,
  getLanguageAccessibilityCopy,
} from '../languageAccessibilityCopy';

describe('language accessibility copy', () => {
  it('returns English copy by default', () => {
    const copy = getLanguageAccessibilityCopy();

    expect(copy).toBe(LANGUAGE_ACCESSIBILITY_COPY.en);
    expect(copy.languageTitle).toBe('Language');
    expect(copy.previewActions).toEqual(['Report', 'Chat', 'Cases', 'Tips']);
  });

  it('falls back to source copy for disabled Kiswahili', () => {
    const copy = getLanguageAccessibilityCopy('sw');

    expect(copy).toBe(LANGUAGE_ACCESSIBILITY_COPY.en);
    expect(copy.languageTitle).toBe('Language');
  });

  it('falls back to English for unavailable or unknown language codes', () => {
    expect(getLanguageAccessibilityCopy('sh')).toBe(LANGUAGE_ACCESSIBILITY_COPY.en);
    expect(getLanguageAccessibilityCopy('missing')).toBe(LANGUAGE_ACCESSIBILITY_COPY.en);
  });
});
