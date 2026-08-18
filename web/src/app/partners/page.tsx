import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'Partner With SafeRide in Kenya',
  absoluteTitle: true,
  description:
    'Work with SafeRide on survivor support review, route safety pilots, and safe technology for women on Kenyan public transport.',
  path: '/partners',
  image: INTERIOR_PAGES['partners'].ogImage,
  imageAlt: INTERIOR_PAGES['partners'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['partners']}
      structuredData={interiorPageStructuredData({ name: 'Partners', path: '/partners' })}
    />
  );
}
