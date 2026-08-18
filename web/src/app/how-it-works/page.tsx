import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'How to Report Harassment with SafeRide',
  absoluteTitle: true,
  description:
    'Step-by-step: record what happened offline, add evidence safely, understand Kenyan legal options, and choose if and how to report.',
  path: '/how-it-works',
  image: INTERIOR_PAGES['how-it-works'].ogImage,
  imageAlt: INTERIOR_PAGES['how-it-works'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['how-it-works']}
      structuredData={interiorPageStructuredData({ name: 'How It Works', path: '/how-it-works' })}
    />
  );
}
