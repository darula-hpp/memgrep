/** User-facing CLI error; exit with the given code (default 1). */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function fail(message: string, exitCode = 1): never {
  throw new CliError(message, exitCode);
}
