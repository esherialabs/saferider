import { describe, expect, it } from 'vitest';

import {
  APP_LANGUAGES,
  getEnabledLanguageCodes,
  getLanguageByCode,
  getSpeechLocaleForLanguage,
  isLanguageClaimable,
  isLocaleEntryRuntimeApproved,
  isLanguageSelectable,
  normalizeSelectableLanguageCode,
} from '../languageAvailability';

describe('language availability', () => {
  it('enables only the source locale without a native-language approval record', () => {
    expect(getEnabledLanguageCodes()).toEqual(['en']);
    expect(isLanguageSelectable('en')).toBe(true);
    expect(isLanguageSelectable('sw')).toBe(false);
    expect(isLanguageClaimable('sw')).toBe(false);
  });

  it('keeps Kiswahili and Sheng unavailable until reviewed packs exist', () => {
    expect(isLanguageSelectable('sh')).toBe(false);
    expect(isLanguageSelectable('missing')).toBe(false);

    expect(getLanguageByCode('sh')?.unavailableReason).toContain(
      'reviewed source pack',
    );
    expect(getLanguageByCode('sw')?.unavailableReason).toContain('native or fluent');
  });

  it('normalizes unsupported or stale stored language codes to English', () => {
    expect(normalizeSelectableLanguageCode('en')).toBe('en');
    expect(normalizeSelectableLanguageCode('sw')).toBe('en');
    expect(normalizeSelectableLanguageCode('sh')).toBe('en');
    expect(normalizeSelectableLanguageCode('missing')).toBe('en');
    expect(normalizeSelectableLanguageCode(null)).toBe('en');
    expect(normalizeSelectableLanguageCode(undefined)).toBe('en');
  });

  it('switches speech locale only for selectable language packs', () => {
    expect(getSpeechLocaleForLanguage('en')).toBe('en-US');
    expect(getSpeechLocaleForLanguage('sw')).toBe('en-US');
    expect(getSpeechLocaleForLanguage('sh')).toBe('en-US');
  });

  it('does not include release-facing translated strings in the language metadata', () => {
    expect(APP_LANGUAGES.map((language) => language.name)).toEqual([
      'English (EN)',
      'Kiswahili (SW)',
      'Sheng (SH)',
    ]);
  });

  it('fails closed when an unbundled locale is marked enabled without a usable reviewed resource', () => {
    expect(isLocaleEntryRuntimeApproved({
      code: 'sw',
      name: 'Kiswahili (SW)',
      flag: 'SW',
      productStatus: 'enabled',
      claimStatus: 'enabled',
      resource: 'src/i18n/resources/sw.product.v1.json',
      review: {
        status: 'approved',
        reviewId: 'synthetic-review-id',
        reviewedAt: '2026-07-30T00:00:00.000Z',
        reviewerRole: 'native or fluent reviewer',
        scope: ['app-shell', 'core-settings', 'accessibility', 'moderated-testing'],
        findings: 'Synthetic test input only.',
      },
      unavailableReason: null,
    })).toBe(false);
  });
});
