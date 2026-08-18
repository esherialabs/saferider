import type { MetadataRoute } from 'next';
import { PRODUCTION_ORIGIN, SITE } from '@/lib/site';

export const dynamic = 'force-static';

// Origin-level comparison (SITE.url is already normalized in site.ts) so a
// cosmetic env-var difference can never silently ship `Disallow: /` to
// production. validate-static-export.mjs and infra smoke tests assert the
// generated/live robots.txt as additional layers.
function isProductionOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(PRODUCTION_ORIGIN).origin;
  } catch {
    return false;
  }
}

export default function robots(): MetadataRoute.Robots {
  const isProductionHost = isProductionOrigin(SITE.url);

  return {
    rules: isProductionHost
      ? { userAgent: '*', allow: '/' }
      : { userAgent: '*', disallow: '/' },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
