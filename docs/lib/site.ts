export const SITE_URL = 'https://memgrep.getuigen.dev';
export const SITE_NAME = 'memgrep';
export const GITHUB_URL = 'https://github.com/darula-hpp/memgrep';

export function absoluteUrl(path = ''): string {
  if (!path || path === '/') return SITE_URL;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
