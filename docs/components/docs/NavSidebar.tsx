'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { nav, type NavSection } from '../../lib/nav';

function SidebarNav({
  sections,
  currentPath,
}: {
  sections: NavSection[];
  currentPath: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.slug, true])),
  );

  return (
    <nav aria-label="Documentation navigation" className="w-full">
      {sections.map((section) => {
        const isExpanded = expanded[section.slug];
        return (
          <div key={section.slug} className="mb-2">
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [section.slug]: !prev[section.slug] }))
              }
              aria-expanded={isExpanded}
              className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-brand)] transition-colors py-1.5 px-1 rounded"
            >
              <span>{section.title}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={`shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {isExpanded && (
              <ul className="mt-0.5 mb-1 space-y-0.5">
                {section.pages.map((page) => {
                  const href = `/docs/${section.slug}/${page.slug}`;
                  const isActive = currentPath === href;
                  return (
                    <li key={page.slug}>
                      <Link
                        href={href}
                        className={`block px-2 py-1.5 text-sm rounded transition-colors ${
                          isActive
                            ? 'text-[var(--color-brand)] bg-teal-500/10 font-medium'
                            : 'text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] hover:bg-[var(--color-surface-2)]'
                        }`}
                      >
                        {page.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function NavSidebar() {
  const pathname = usePathname() ?? '/docs';
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        className="md:hidden fixed bottom-4 right-4 z-50 w-12 h-12 bg-[var(--color-brand)] text-[var(--color-brand-fg)] rounded-full shadow-lg flex items-center justify-center"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-bg)] border-r border-[var(--color-border)] p-4 overflow-y-auto transition-transform ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex justify-between items-center mb-4">
          <span className="font-semibold">Docs</span>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            Close
          </button>
        </div>
        <SidebarNav sections={nav} currentPath={pathname} />
      </aside>

      <aside className="hidden md:block w-64 shrink-0 border-r border-[var(--color-border)] px-4 py-6 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
        <SidebarNav sections={nav} currentPath={pathname} />
      </aside>
    </>
  );
}
