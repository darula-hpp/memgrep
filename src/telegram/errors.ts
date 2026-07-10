/** Format undici/Node fetch failures with the underlying cause (DNS, scheme, etc.). */
export function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error) {
    return `${error.message} (${cause.message})`;
  }
  return error.message;
}
