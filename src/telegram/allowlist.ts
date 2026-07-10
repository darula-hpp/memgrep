export function isAllowedUser(allowed: ReadonlySet<number>, userId: number | undefined): boolean {
  return userId !== undefined && allowed.has(userId);
}

export function parseAllowedUserIds(raw: string | undefined): Set<number> {
  if (!raw || !raw.trim()) {
    throw new Error(
      'TELEGRAM_ALLOWED_USER_IDS is required (comma-separated numeric ids). Get yours from @userinfobot.',
    );
  }
  const ids = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    throw new Error(`Invalid TELEGRAM_ALLOWED_USER_IDS "${raw}". Expected e.g. 123456789.`);
  }
  return new Set(ids);
}
