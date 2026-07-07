#!/usr/bin/env node
import { runCli } from '../src/cli.ts';

/**
 * trailix CLI entrypoint. Requires Node 24+ (native TypeScript type stripping).
 * Read-only observer: any unexpected error is swallowed to a quiet exit so the
 * tool can never disrupt the user's terminal flow.
 */
try {
  const result = await runCli({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    isTTY: process.stdout.isTTY === true,
    termWidth: process.stdout.columns ?? 80,
  });
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
} catch {
  process.exitCode = 0;
}
