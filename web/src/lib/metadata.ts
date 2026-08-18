import type { Metadata } from 'next';
import { BRAND_NAME, SITE, canonicalUrl } from '@/lib/site';

type PageMetadataInput = {
  title: string;
  description: string;
  path: `/${string}`;
  /** Skip the layout '%s - SafeRide' template (home page carries its own brand). */
  absoluteTitle?: boolean;
  /** Site-relative path to a 1200x630 social image; falls back to /og.png. */
  image?: `/${string}`;
  imageAlt?: string;
  article?: {
    publishedTime: string;
    modifiedTime: string;
    authors: string[];
  };
};

export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  image = '/og.png',
  imageAlt = SITE.name,
  article,
}: PageMetadataInput): Metadata {
  const url = canonicalUrl(path);
  const socialTitle = absoluteTitle ? title : `${title} - ${SITE.name}`;
  const socialImage = `${SITE.url}${image}`;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    // Absolute canonical in the deployed trailing-slash form so server-mode
    // test runs and the static export emit the identical URL.
    alternates: { canonical: url },
    openGraph: article
      ? {
          type: 'article',
          locale: 'en_KE',
          url,
          siteName: BRAND_NAME,
          title: socialTitle,
          description,
          publishedTime: article.publishedTime,
          modifiedTime: article.modifiedTime,
          authors: article.authors,
          images: [{ url: socialImage, width: 1200, height: 630, alt: imageAlt }],
        }
      : {
          type: 'website',
          locale: 'en_KE',
          url,
          siteName: BRAND_NAME,
          title: socialTitle,
          description,
          images: [{ url: socialImage, width: 1200, height: 630, alt: imageAlt }],
        },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: [socialImage],
    },
  };
}

export function articleMetadata(
  input: Omit<PageMetadataInput, 'article'> & {
    publishedTime: string;
    modifiedTime: string;
    authors: string[];
  },
): Metadata {
  const { publishedTime, modifiedTime, authors, ...page } = input;

  return pageMetadata({
    ...page,
    article: { publishedTime, modifiedTime, authors },
  });
}
