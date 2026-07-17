import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { GITHUB_URL } from '../lib/site';

interface SiteHeaderProps {
  variant: 'marketing' | 'docs';
}

export function SiteHeader({ variant }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] relative">
      <div aria-hidden="true" className="absolute inset-0 bg-[var(--color-bg)]/90 backdrop-blur" />
      <div className="relative flex items-center gap-3 px-6 h-14">
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight hover:text-[var(--color-brand)] transition-colors"
          >
            <Image src="/logo.svg" alt="" width={28} height={28} className="shrink-0 rounded-lg" />
            memgrep
          </Link>
        </div>

        {variant === 'docs' && <div className="flex-1" />}
        {variant === 'marketing' && <div className="flex-1" />}

        <div className="flex items-center gap-4 shrink-0">
          {variant === 'marketing' && (
            <Link
              href="/docs/getting-started/introduction"
              className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
            >
              Docs
            </Link>
          )}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-brand)] transition-colors"
          >
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
