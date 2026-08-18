import sourceResource from './resources/en.product.v1.json';

export const LANGUAGE_ACCESSIBILITY_COPY = {
  en: sourceResource.accessibility,
} as const;

export function getLanguageAccessibilityCopy(_languageCode?: string | null) {
  return LANGUAGE_ACCESSIBILITY_COPY.en;
}

export function getModeratedTestCopy(_languageCode?: string | null) {
  return sourceResource.measurement;
}

export const PRODUCT_COPY_RESOURCE_VERSION = sourceResource.resourceVersion;
export type LanguageAccessibilityCopy = typeof LANGUAGE_ACCESSIBILITY_COPY['en'];
