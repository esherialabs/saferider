import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'Source, Models & Licenses',
  description:
    "Review SafeRide's sanitized source mirror, Android testing preview, on-device Gemma 4 model, dataset, artifact checksums, and separate license boundaries.",
  path: '/open-source',
  image: INTERIOR_PAGES['open-source'].ogImage,
  imageAlt: INTERIOR_PAGES['open-source'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['open-source']}
      structuredData={interiorPageStructuredData({ name: 'Source, Models & Licenses', path: '/open-source' })}
    />
  );
}
