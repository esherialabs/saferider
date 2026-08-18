import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'Nairobi Matatu Route Safety Index',
  description:
    'How anonymous, consented reports from riders become route-level safety signals for Nairobi matatu corridors — without exposing survivors.',
  path: '/route-safety-index',
  image: INTERIOR_PAGES['route-safety-index'].ogImage,
  imageAlt: INTERIOR_PAGES['route-safety-index'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['route-safety-index']}
      structuredData={interiorPageStructuredData({ name: 'Route Safety Index', path: '/route-safety-index' })}
    />
  );
}
