import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'Our Story: Why We Built SafeRide',
  absoluteTitle: true,
  description:
    'Why Esheria built SafeRide: everyday transport risk in Nairobi, survivor-controlled design, and open, accountable technology.',
  path: '/story',
  image: INTERIOR_PAGES['story'].ogImage,
  imageAlt: INTERIOR_PAGES['story'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['story']}
      structuredData={interiorPageStructuredData({ name: 'Our Story', path: '/story' })}
    />
  );
}
