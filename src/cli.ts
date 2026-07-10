#!/usr/bin/env node
import { createProgram } from './cli/program.js';
import { CliError } from './cli/lib/errors.js';

async function main(): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
