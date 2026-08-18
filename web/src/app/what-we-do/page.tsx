import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'What We Do: Harassment Reporting & Route Safety',
  description:
    'How SafeRide helps women document harassment on Kenyan public transport, find support, and turn anonymous reports into safer routes.',
  path: '/what-we-do',
  image: INTERIOR_PAGES['what-we-do'].ogImage,
  imageAlt: INTERIOR_PAGES['what-we-do'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['what-we-do']}
      structuredData={interiorPageStructuredData({ name: 'What We Do', path: '/what-we-do' })}
    />
  );
}
