import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Footer from '@/components/Footer';
import Nav from '@/components/Nav';
import { JsonLd, articleSchema, breadcrumbSchema, graph } from '@/lib/json-ld';
import { articleMetadata } from '@/lib/metadata';
import { SITE } from '@/lib/site';

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = SITE.updates.find((candidate) => candidate.slug === slug);

  if (!post) {
    notFound();
  }

  const metaTitle = ('seoTitle' in post && post.seoTitle) || post.title;

  return articleMetadata({
    title: metaTitle,
    description: post.excerpt,
    path: `/blog/${slug}`,
    absoluteTitle: metaTitle.includes(SITE.name),
    image: post.ogImage,
    imageAlt: post.title,
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    authors: [post.authorName],
  });
}

export function generateStaticParams() {
  return SITE.updates.map((post) => ({ slug: post.slug }));
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = SITE.updates.find((candidate) => candidate.slug === slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = SITE.updates.filter((candidate) =>
    post.relatedSlugs.some((relatedSlug) => relatedSlug === candidate.slug),
  );

  return (
    <>
      <Nav />
      <main id="main-content" className="bg-white pt-20">
        <JsonLd
          id="article-structured-data"
          data={graph([
            breadcrumbSchema([
              { name: 'Guides', path: '/blog' },
              { name: post.title, path: `/blog/${post.slug}` },
            ]),
            articleSchema(post),
          ])}
        />
        <article>
          <header className="mx-auto max-w-[1000px] px-4 py-14 sm:px-6 lg:px-0 lg:py-20">
            <Link href="/blog" className="font-display text-sm font-semibold uppercase tracking-normal underline decoration-2 underline-offset-4">
              Back to guides
            </Link>
            <p className="mt-8 text-sm font-semibold uppercase tracking-normal text-green-800">{post.tag}</p>
            <h1 className="mt-4 font-display text-[clamp(2.5rem,6vw,5.25rem)] font-semibold leading-[0.9] tracking-normal">
              {post.title}
            </h1>
            <p className="mt-8 max-w-3xl text-xl leading-8 text-green-950/80 md:text-2xl md:leading-9">{post.excerpt}</p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-y border-black/20 py-4 text-sm text-black/68">
              <span>By {post.authorName}</span>
              <span>
                Published <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              </span>
              <span>
                Updated <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time>
              </span>
            </div>
            <p className="mt-4 text-sm font-semibold text-amber-800">Review status: {post.reviewStatus}</p>
          </header>

          <div className="border-y-3 border-black bg-[#EAF9EE] py-12 md:py-16">
            <div className="mx-auto max-w-[850px] px-4 sm:px-6 lg:px-0">
              <aside className="border-3 border-black bg-[#F7EC36] p-5 shadow-[5px_5px_0_#0D1B12]" aria-label="Editorial boundary">
                <p className="text-xs font-semibold uppercase tracking-normal">Important boundary</p>
                <p className="mt-3 text-base leading-7 text-black/78">{post.editorialNote}</p>
              </aside>

              <div className="mt-12 space-y-14">
                {post.sections.map((section) => (
                  <section key={section.heading}>
                    <h2 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[0.95] tracking-normal">
                      {section.heading}
                    </h2>
                    <div className="mt-6 space-y-5">
                      {section.paragraphs.map((paragraph) => (
                        <p key={paragraph} className="text-lg leading-8 text-green-950/82">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>

          <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6 lg:px-0 lg:py-20" aria-labelledby="next-actions-heading">
            <h2 id="next-actions-heading" className="font-display text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[0.92] tracking-normal">
              Choose your next step.
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {post.actions.map((action) => (
                <Link key={action.href} href={action.href} className="interactive-card border-3 border-black bg-white p-6 hover:bg-[#50C9F0]">
                  <h3 className="font-display text-2xl font-semibold leading-none tracking-normal">{action.label}</h3>
                  <p className="mt-4 text-base leading-7 text-black/72">{action.body}</p>
                  <span className="mt-6 inline-block font-semibold underline decoration-2 underline-offset-4">Continue</span>
                </Link>
              ))}
            </div>
          </section>

          {post.sources.length > 0 ? (
            <section className="border-y-3 border-black bg-[#50C9F0] py-12" aria-labelledby="sources-heading">
              <div className="mx-auto max-w-[850px] px-4 sm:px-6 lg:px-0">
                <h2 id="sources-heading" className="font-display text-3xl font-semibold leading-none tracking-normal">Sources and further reading</h2>
                <ul className="mt-6 space-y-4">
                  {post.sources.map((source) => (
                    <li key={source.href} className="border-t border-black pt-4">
                      <Link href={source.href} target="_blank" rel="noreferrer" className="font-semibold underline decoration-2 underline-offset-4">
                        {source.title}
                      </Link>
                      <span className="ml-2 text-black/65">— {source.publisher}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6 lg:px-0" aria-labelledby="related-guides-heading">
            <h2 id="related-guides-heading" className="font-display text-3xl font-semibold leading-none tracking-normal">Related SafeRide guides</h2>
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              {relatedPosts.map((related) => (
                <Link key={related.slug} href={`/blog/${related.slug}`} className="interactive-card border-3 border-black p-5 hover:bg-[#F7EC36]">
                  <p className="text-xs font-semibold uppercase tracking-normal text-green-800">{related.tag}</p>
                  <h3 className="mt-3 font-display text-2xl font-semibold leading-[0.98] tracking-normal">{related.title}</h3>
                </Link>
              ))}
            </div>
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}
