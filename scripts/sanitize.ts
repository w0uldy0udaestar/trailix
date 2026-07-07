#!/usr/bin/env node
/**
 * Sanitize a session JSONL for safe sharing (bug reports, public fixtures).
 *
 *   node scripts/sanitize.ts <input.jsonl> [output.jsonl]
 *
 * Redacts secret-shaped tokens, genericizes home paths, and replaces free-text
 * bodies with same-length filler. Prints to stdout if no output path is given.
 * Always eyeball the result before publishing — this is a safety net, not a
 * guarantee against every possible identifier.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeSession } from '../src/sanitize.ts';

const [input, output] = process.argv.slice(2);
if (input === undefined) {
  process.stderr.write('usage: node scripts/sanitize.ts <input.jsonl> [output.jsonl]\n');
  process.exitCode = 1;
} else {
  const out = sanitizeSession(readFileSync(input, 'utf8'));
  if (output === undefined) process.stdout.write(out);
  else {
    writeFileSync(output, out);
    process.stderr.write(`sanitized → ${output}\n`);
  }
}
