import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'Impact & Transparency',
  description:
    'What we measure in the SafeRide pilot — completion, comprehension, trust, and whether partners act — and what we publish.',
  path: '/impact',
  image: INTERIOR_PAGES['impact'].ogImage,
  imageAlt: INTERIOR_PAGES['impact'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['impact']}
      structuredData={interiorPageStructuredData({ name: 'Impact', path: '/impact' })}
    />
  );
}
