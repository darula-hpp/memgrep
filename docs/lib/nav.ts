export interface NavPage {
  title: string;
  slug: string;
}

export interface NavSection {
  title: string;
  slug: string;
  pages: NavPage[];
}

export const nav: NavSection[] = [
  {
    title: 'Getting Started',
    slug: 'getting-started',
    pages: [
      { title: 'Introduction', slug: 'introduction' },
      { title: 'Quick Start', slug: 'quick-start' },
      { title: 'Installation', slug: 'installation' },
    ],
  },
  {
    title: 'Concepts',
    slug: 'concepts',
    pages: [
      { title: 'How It Works', slug: 'how-it-works' },
      { title: 'Playbooks', slug: 'playbooks' },
      { title: 'Local Memory', slug: 'local-memory' },
    ],
  },
  {
    title: 'Guides',
    slug: 'guides',
    pages: [
      { title: 'Telegram + Cursor', slug: 'telegram-cursor' },
      { title: 'Scheduled Jobs', slug: 'scheduled-jobs' },
      { title: 'Background Ingest', slug: 'background-ingest' },
      { title: 'Coding Loop', slug: 'coding-loop' },
      { title: 'MCP Setup', slug: 'mcp-setup' },
    ],
  },
  {
    title: 'CLI',
    slug: 'cli',
    pages: [
      { title: 'Overview', slug: 'overview' },
      { title: 'Memory Commands', slug: 'memory' },
      { title: 'Telegram', slug: 'telegram' },
      { title: 'Jobs', slug: 'jobs' },
      { title: 'Loop', slug: 'loop' },
    ],
  },
  {
    title: 'MCP',
    slug: 'mcp',
    pages: [
      { title: 'Overview', slug: 'overview' },
      { title: 'Memory Tools', slug: 'memory-tools' },
      { title: 'Optional Suites', slug: 'optional-suites' },
    ],
  },
];
