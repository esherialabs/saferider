'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandWordmark from '@/components/BrandWordmark';
import { NAV_CTA, NAV_LINKS } from '@/lib/navigation';
import { PARENT_ORG } from '@/lib/site';
import type { SearchItem } from '@/lib/search-index';

function scoreSearchItem(item: SearchItem, query: string) {
  const terms = query.split(/\s+/).filter(Boolean);
  const title = item.title.toLowerCase();
  const excerpt = item.excerpt.toLowerCase();
  const keywords = item.keywords.toLowerCase();
  const priorityTerms = item.priorityTerms?.join(' ').toLowerCase() ?? '';
  const searchableText = `${title} ${excerpt} ${keywords} ${priorityTerms}`;

  if (!terms.every((term) => searchableText.includes(term))) {
    return 0;
  }

  return terms.reduce((score, term) => {
    let nextScore = score;

    if (priorityTerms.includes(term)) nextScore += 120;
    if (title.includes(term)) nextScore += 80;
    if (excerpt.includes(term)) nextScore += 50;
    if (keywords.includes(term)) nextScore += 10;

    return nextScore;
  }, 0);
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m20 20-4.2-4.2m1.7-5.3a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {open ? (
        <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Logo() {
  return (
    <div className="hidden flex-col items-start sm:flex">
      <Link href="/" data-testid="nav-logo" className="inline-flex items-center" aria-label="SafeRide home">
        <BrandWordmark className="text-2xl" />
      </Link>
      <Link
        href={PARENT_ORG.url}
        target="_blank"
        rel="noopener"
        className="mt-0.5 inline-flex min-h-6 items-center gap-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-green-700 underline decoration-green-300 underline-offset-2 hover:text-green-950"
        aria-label={`A product of ${PARENT_ORG.name}; visit esheria.ai`}
      >
        A product of {PARENT_ORG.name} <span aria-hidden="true">↗</span>
      </Link>
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchItems, setSearchItems] = useState<readonly SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchDialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suppressDropdownFocusRef = useRef<string | null>(null);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (searchItems.length === 0) {
      return [];
    }

    if (!query) {
      return searchItems.slice(0, 6);
    }

    return searchItems.map((item, index) => ({ item, index, score: scoreSearchItem(item, query) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((result) => result.item)
      .slice(0, 8);
  }, [searchItems, searchQuery]);

  const loadSearchItems = async () => {
    if (searchItems.length > 0 || searchLoading) {
      return;
    }

    setSearchLoading(true);
    const searchIndex = await import('@/lib/search-index');
    setSearchItems(searchIndex.SEARCH_ITEMS);
    setSearchLoading(false);
  };

  const openSearch = () => {
    void loadSearchItems();
    setSearchOpen(true);
    setSearchQuery('');
    setDrawerOpen(false);
  };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  };

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const drawer = drawerRef.current;

    if (!drawer) {
      return;
    }

    drawer.toggleAttribute('inert', !drawerOpen);

    if (drawerOpen) {
      const firstFocusable = drawer.querySelector<HTMLElement>('a[href], button:not([disabled])');
      firstFocusable?.focus();
    }
  }, [drawerOpen]);

  const handleDrawerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!drawerOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
    );

    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = Array.from(
      searchDialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? [],
    );

    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const focusFirstDropdownLink = (dropdownId: string) => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLAnchorElement>(`#${dropdownId} a[href]`)?.focus();
    });
  };

  return (
    <>
      <nav data-testid="main-nav" className="fixed inset-x-0 top-0 z-50 border-b border-green-100 bg-white" aria-label="Primary navigation">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div className="mx-auto flex h-[88px] max-w-content items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button
              ref={menuButtonRef}
              type="button"
              data-testid="hamburger-btn"
              className="inline-flex h-11 w-11 items-center justify-center border-3 border-green-900 text-green-900 lg:hidden"
              aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={drawerOpen}
              aria-controls="mobile-navigation"
              onClick={() => setDrawerOpen((current) => !current)}
            >
              <MenuIcon open={drawerOpen} />
            </button>
            <Logo />
            <Link
              href={PARENT_ORG.url}
              target="_blank"
              rel="noopener"
              className="inline-flex flex-col text-[0.65rem] font-bold uppercase leading-tight tracking-[0.08em] text-green-700 sm:hidden"
              aria-label={`A product of ${PARENT_ORG.name}; visit esheria.ai`}
            >
              <span>A product of</span>
              <span className="text-xs text-green-950">{PARENT_ORG.name} ↗</span>
            </Link>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              aria-label="Search"
              className="grid h-11 w-11 place-items-center border-3 border-green-900 text-green-900 transition"
              onClick={openSearch}
            >
              <SearchIcon />
            </button>
            <Link href={NAV_CTA.href} className="bg-green-900 px-4 py-3 font-body text-sm font-bold text-white">
              Download
            </Link>
          </div>

          <div className="hidden items-stretch gap-1 self-stretch lg:flex">
            {NAV_LINKS.map((link) => {
              const hasChildren = 'children' in link;
              const active = isActive(link.href);
              const dropdownOpen = openDropdown === link.label;
              const dropdownId = `desktop-submenu-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
              return (
                <div
                  key={link.label}
                  className="relative flex items-center"
                  onMouseEnter={() => {
                    if (hasChildren) {
                      setOpenDropdown(link.label);
                    }
                  }}
                  onMouseLeave={() => setOpenDropdown(null)}
                  onFocus={() => {
                    if (hasChildren) {
                      if (suppressDropdownFocusRef.current === link.label) {
                        suppressDropdownFocusRef.current = null;
                        return;
                      }

                      setOpenDropdown(link.label);
                    }
                  }}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      suppressDropdownFocusRef.current = null;
                      setOpenDropdown(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!hasChildren) {
                      return;
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      suppressDropdownFocusRef.current = link.label;
                      setOpenDropdown(null);
                      event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.focus();
                      return;
                    }

                    if (event.key === 'ArrowDown' || event.key === ' ') {
                      event.preventDefault();
                      setOpenDropdown(link.label);
                      focusFirstDropdownLink(dropdownId);
                    }
                  }}
                >
                  <Link
                    href={link.href}
                    aria-haspopup={hasChildren ? 'true' : undefined}
                    aria-expanded={hasChildren ? dropdownOpen : undefined}
                    aria-controls={hasChildren ? dropdownId : undefined}
                    className={`flex h-full items-center gap-2 px-4 font-body text-base font-normal transition hover:bg-green-50 ${
                      active ? 'text-green-600' : 'text-green-900'
                    }`}
                  >
                    {link.label}
                    {hasChildren ? <ChevronIcon /> : null}
                  </Link>
                  {hasChildren ? (
                    <div
                      id={dropdownId}
                      className={`absolute left-0 top-full min-w-64 border-3 border-green-900 bg-white p-3 shadow-[4px_4px_0_#0D1B12] transition ${
                        dropdownOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-2 opacity-0'
                      }`}
                    >
                      {link.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          className="block px-4 py-3 font-body text-base font-normal text-green-900 hover:bg-green-50 hover:text-green-600"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            <button
              type="button"
              aria-label="Search"
              className="grid h-11 w-11 place-items-center border-3 border-green-900 text-green-900 transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_#0D1B12]"
              onClick={openSearch}
            >
              <SearchIcon />
            </button>
            <Link
              href={NAV_CTA.href}
              className="bg-green-900 px-6 py-[0.9rem] font-body text-base font-bold text-white transition hover:bg-green-700"
            >
              {NAV_CTA.label}
            </Link>
          </div>
        </div>

        <div
          ref={drawerRef}
          id="mobile-navigation"
          data-testid="mobile-drawer"
          aria-hidden={!drawerOpen}
          inert={!drawerOpen}
          onKeyDown={handleDrawerKeyDown}
          className={`lg:hidden ${drawerOpen ? 'max-h-screen border-t border-green-100' : 'max-h-0 overflow-hidden'} bg-white transition-all duration-300`}
        >
          <div className="mx-auto grid max-w-content gap-2 px-4 py-5">
            {NAV_LINKS.map((link) => (
              <div key={link.label} className="border-b border-green-100 pb-2">
                <Link href={link.href} className="block py-3 font-body text-xl font-normal text-green-900" onClick={() => setDrawerOpen(false)}>
                  {link.label}
                </Link>
                {'children' in link ? (
                  <div className="grid gap-1 pb-2 pl-4">
                    {link.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className="py-2 font-body text-base font-normal text-green-700"
                        onClick={() => setDrawerOpen(false)}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              aria-label="Search"
              className="mt-4 flex items-center justify-center gap-2 border-3 border-green-900 px-5 py-3 font-display font-bold text-green-900"
              onClick={openSearch}
            >
              <SearchIcon /> Search
            </button>
            <Link
              href={NAV_CTA.href}
              className="bg-green-900 px-5 py-4 text-center font-body font-bold text-white"
              onClick={() => setDrawerOpen(false)}
            >
              {NAV_CTA.label}
            </Link>
          </div>
        </div>
      </nav>

      {searchOpen ? (
        <div
          ref={searchDialogRef}
          className="fixed inset-0 z-[60] bg-green-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          onKeyDown={handleSearchKeyDown}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSearch();
            }
          }}
        >
          <div className="mx-auto mt-28 max-w-xl border-3 border-green-900 bg-white p-6 shadow-[6px_6px_0_#0D1B12]">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-2xl font-bold text-green-900">Search SafeRide</h2>
              <button type="button" className="font-display font-bold text-green-700" onClick={closeSearch}>
                Close
              </button>
            </div>
            <label className="sr-only" htmlFor="site-search">
              Search SafeRide pages
            </label>
            <input
              id="site-search"
              ref={searchInputRef}
              className="mt-6 w-full border-3 border-green-900 px-4 py-3 text-green-950 outline-none focus:ring-4 focus:ring-green-300"
              placeholder="Search SafeRide pages"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <div className="mt-5 grid gap-3" aria-live="polite">
              {searchLoading ? (
                <p className="border-2 border-green-900 p-4 text-sm font-bold text-green-900">
                  Loading SafeRide pages...
                </p>
              ) : searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <Link
                    key={result.href}
                    href={result.href}
                    className="block border-2 border-green-900 p-4 transition hover:-translate-x-1 hover:-translate-y-1 hover:bg-green-50 hover:shadow-[4px_4px_0_#0D1B12]"
                    onClick={closeSearch}
                  >
                    <span className="font-display text-lg font-semibold text-green-950">{result.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-green-900/75">{result.excerpt}</span>
                  </Link>
                ))
              ) : (
                <p className="border-2 border-green-900 p-4 text-sm font-bold text-green-900">
                  No matching SafeRide pages found.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
