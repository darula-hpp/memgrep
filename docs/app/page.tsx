import Image from 'next/image';
import Link from 'next/link';
import { SiteHeader } from '../components/SiteHeader';
import { GITHUB_URL } from '../lib/site';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader variant="marketing" />

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <Image
          src="/logo.svg"
          alt="memgrep"
          width={72}
          height={72}
          className="mb-6 rounded-2xl shadow-lg shadow-teal-500/10"
          priority
        />
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-4 max-w-3xl">
          Cursor with{' '}
          <span className="text-[var(--color-brand)]">memory that outlives sessions</span>
        </h1>
        <p className="text-base md:text-lg text-[var(--color-ink-soft)] max-w-xl mb-10 leading-relaxed">
          Local memory. A coding loop. Cursor from your phone. Playbooks on a schedule.
        </p>

        <div className="w-full max-w-lg mb-10">
          <div className="terminal-window rounded-xl border border-[var(--color-border)] overflow-hidden text-left">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10">
              <span className="w-3 h-3 rounded-full bg-red-500/70" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <span className="w-3 h-3 rounded-full bg-green-500/70" />
            </div>
            <pre className="terminal-code px-5 py-4 text-sm overflow-x-auto font-mono">
              <code>
                <span className="terminal-prompt">$</span>{' '}
                <span className="terminal-cmd">npm</span> i -g memgrep
                {'\n'}
                <span className="terminal-prompt">$</span> memgrep ingest
                {'\n'}
                <span className="terminal-prompt">$</span> memgrep recall{' '}
                <span className="terminal-string">&quot;auth race fix&quot;</span>
              </code>
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/docs/getting-started/quick-start"
            className="px-6 py-2.5 bg-[var(--color-brand)] hover:bg-[var(--color-brand-mid)] text-[var(--color-brand-fg)] rounded-lg font-medium transition-colors text-sm"
          >
            Get started
          </Link>
          <Link
            href="/docs/guides/coding-loop"
            className="px-6 py-2.5 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] rounded-lg font-medium transition-colors text-sm"
          >
            Meet the loop
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] rounded-lg font-medium transition-colors text-sm"
          >
            GitHub
          </a>
        </div>
      </main>

      <section className="px-6 py-16 border-t border-[var(--color-border)]" aria-label="Features">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-left">
          {[
            {
              title: 'Memory that outlives sessions',
              body: 'Ingest Cursor, Claude, and Kiro chats. Recall the fix, the playbook, the decision, mid-task via MCP.',
            },
            {
              title: 'A coding loop',
              body: 'Run a task with exits and actions until it is done. Per-project profiles, status you can check, memory attached the whole way.',
            },
            {
              title: 'Cursor from your phone',
              body: 'Telegram drives a real local Cursor agent in an allowlisted folder, with memgrep memory on the wire.',
            },
            {
              title: 'Playbooks on a schedule',
              body: 'Remember a workflow once. Cron it with jobs so the agent runs it on a clock, not from vibes.',
            },
          ].map((f) => (
            <div key={f.title}>
              <h2 className="text-lg font-semibold mb-2 tracking-tight">{f.title}</h2>
              <p className="text-sm text-[var(--color-ink-soft)] leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
