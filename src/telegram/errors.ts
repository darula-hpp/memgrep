/** Format undici/Node fetch failures with the underlying cause (DNS, scheme, etc.). */
export function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const bits: string[] = [error.message || error.name || 'Error'];
  const cause = error.cause;
  if (cause instanceof Error) {
    const detail = cause.message || cause.name;
    if (detail) bits.push(detail);
    const code = (cause as NodeJS.ErrnoException).code;
    if (code) bits.push(String(code));
  } else if (cause != null && cause !== '') {
    bits.push(typeof cause === 'object' ? JSON.stringify(cause) : String(cause));
  }
  return bits.join(' — ');
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const cause = error.cause;
  if (cause instanceof Error) {
    return cause.name === 'AbortError' || cause.name === 'TimeoutError';
  }
  return false;
}

export function isNetworkTimeoutError(error: unknown): boolean {
  const text = formatFetchError(error);
  return (
    text.includes('ETIMEDOUT') ||
    text.includes('ENETUNREACH') ||
    text.includes('ECONNRESET') ||
    text.includes('EAI_AGAIN')
  );
}
