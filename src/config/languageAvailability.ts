import rawMatrix from '../../config/localization/locale-availability.v1.json';
import sourceResource from '../i18n/resources/en.product.v1.json';

export type AppLanguageCode = 'en' | 'sw' | 'sh';
// Kept as the persisted compatibility union so stale `sw` values can be read
// and normalized safely. Runtime selectability is determined by the matrix.
export type SelectableAppLanguageCode = 'en' | 'sw';

export type AppLanguage = {
  code: AppLanguageCode;
  name: string;
  flag: string;
  available: boolean;
  claimable: boolean;
  unavailableReason?: string;
};

export const LANGUAGE_UNAVAILABLE_MESSAGE =
  'A complete versioned language pack and required human review are not available for this build.';

export const DEFAULT_LANGUAGE_CODE: SelectableAppLanguageCode = 'en';
export const LOCALE_AVAILABILITY_MATRIX_VERSION = rawMatrix.matrixVersion;

const REQUIRED_REVIEW_SCOPES = ['app-shell', 'core-settings', 'accessibility', 'moderated-testing'];
const BUNDLED_RESOURCES: Partial<Record<AppLanguageCode, { path: string; version: string }>> = {
  en: {
    path: 'src/i18n/resources/en.product.v1.json',
    version: sourceResource.resourceVersion,
  },
};

type LocaleMatrixEntry = typeof rawMatrix.locales[number];

export function isLocaleEntryRuntimeApproved(locale: LocaleMatrixEntry): boolean {
  const bundled = BUNDLED_RESOURCES[locale.code as AppLanguageCode];
  const reviewStatusAllowed = locale.code === 'en'
    ? locale.review.status === 'source'
    : locale.review.status === 'approved';
  return locale.productStatus === 'enabled' &&
    locale.claimStatus === 'enabled' &&
    Boolean(bundled) &&
    locale.resource === bundled?.path &&
    rawMatrix.resourceVersion === bundled?.version &&
    reviewStatusAllowed &&
    Boolean(locale.review.reviewId) &&
    Boolean(locale.review.reviewedAt) &&
    Number.isFinite(Date.parse(locale.review.reviewedAt ?? '')) &&
    REQUIRED_REVIEW_SCOPES.every(scope => locale.review.scope.includes(scope));
}

export const APP_LANGUAGES: AppLanguage[] = rawMatrix.locales.map((locale) => ({
  code: locale.code as AppLanguageCode,
  name: locale.name,
  flag: locale.flag,
  available: isLocaleEntryRuntimeApproved(locale),
  claimable: isLocaleEntryRuntimeApproved(locale),
  unavailableReason: locale.unavailableReason ?? undefined,
}));

export function getLanguageByCode(languageCode: string) {
  return APP_LANGUAGES.find((language) => language.code === languageCode);
}

export function isLanguageSelectable(languageCode: string) {
  return getLanguageByCode(languageCode)?.available === true;
}

export function isLanguageClaimable(languageCode: string) {
  return getLanguageByCode(languageCode)?.claimable === true;
}

export function normalizeSelectableLanguageCode(
  _languageCode?: string | null,
): SelectableAppLanguageCode {
  return DEFAULT_LANGUAGE_CODE;
}

export function getEnabledLanguageCodes() {
  return APP_LANGUAGES.filter((language) => language.available).map(
    (language) => language.code,
  );
}

export function getSpeechLocaleForLanguage(_languageCode: string) {
  return 'en-US';
}
