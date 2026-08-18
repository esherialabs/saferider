import PageShell from '@/components/PageShell';
import { interiorPageStructuredData } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { INTERIOR_PAGES } from '@/lib/pages';

export const metadata = pageMetadata({
  title: 'Support After Harassment in Kenya',
  description:
    'Medical care, the 1195 GBV helpline, legal aid, and counselling options in Kenya — explained plainly, with no pressure to report.',
  path: '/for-survivors',
  image: INTERIOR_PAGES['for-survivors'].ogImage,
  imageAlt: INTERIOR_PAGES['for-survivors'].imageAlt,
});

export default function Page() {
  return (
    <PageShell
      {...INTERIOR_PAGES['for-survivors']}
      structuredData={interiorPageStructuredData({ name: 'For Survivors', path: '/for-survivors' })}
    />
  );
}
