import type { Metadata } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import { absoluteUrl, SITE_NAME } from '../lib/site';
import './globals.css';

const plex = IBM_Plex_Sans({
  variable: '--font-plex',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl()),
  title: {
    default: `${SITE_NAME} docs`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    'Local agent memory, Cursor from Telegram, scheduled playbooks, and MCP tools. Fully local search with optional remote coding.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/logo.png',
  },
  openGraph: {
    title: `${SITE_NAME} docs`,
    description:
      'Local agent memory, Cursor from Telegram, scheduled playbooks, and MCP tools.',
    type: 'website',
    url: absoluteUrl(),
  },
  alternates: {
    canonical: absoluteUrl(),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plex.variable} ${jetbrains.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
