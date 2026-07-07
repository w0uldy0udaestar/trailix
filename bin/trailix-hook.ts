#!/usr/bin/env node
import { runHook } from '../src/hook.ts';

/**
 * trailix Stop-hook entrypoint. Registered as a Claude Code Stop hook.
 *
 * Fail-silent contract (design / Day 1 spike): the entire body is guarded and
 * ALWAYS exits 0 — exit 2 (the "block completion" signal) is never used. Any
 * error means "no card", never a disrupted or blocked session.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const out = await runHook(await readStdin(), process.env);
  if (out !== '') process.stdout.write(out);
} catch {
  // swallow — never disrupt the session
}
process.exitCode = 0;
