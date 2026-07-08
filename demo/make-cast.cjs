// Regenerate demo/trailix.gif — the README hero.
//
// Pipeline uses agg, NOT vhs: vhs renders via headless Chromium + xterm.js,
// which drops box-drawing glyphs (─│╭╮╰╯) in a GPU-less WSL environment. agg
// draws each frame directly and renders the box correctly.
//
//   deps:  agg   https://github.com/asciinema/agg  (single static binary)
//          fonts: DejaVu Sans Mono (latin + box drawing, ships with most distros)
//                 D2Coding        (monospaced Hangul, so the Korean card stays
//                                  on the cell grid — without it Hangul falls
//                                  back to a proportional CJK font and spaces out)
//
//   run (from the repo root):
//     node demo/make-cast.cjs demo/trailix.cast
//     agg --font-family "D2Coding,DejaVu Sans Mono" --font-size 20 \
//         --line-height 1.3 demo/trailix.cast demo/trailix.gif
//
// This script captures the real `trailix demo` output (colour + box via
// FORCE_COLOR), then scripts a prompt + typing animation + card render for the
// English card, then the Korean one (--lang ko). No real session data is used.
//
// Usage: node demo/make-cast.cjs <out.cast>
const { execSync } = require('child_process');
const fs = require('fs');

const cap = (cmd) =>
  execSync(cmd, { env: { ...process.env, FORCE_COLOR: '1' }, encoding: 'utf8' })
    .replace(/\n/g, '\r\n');

const cardEn = cap('node bin/trailix.ts demo');
const cardKo = cap('node bin/trailix.ts demo --lang ko');

const ev = [];
let t = 0;
const PROMPT = '\x1b[38;5;114m$\x1b[0m '; // soft green $
const push = (s) => ev.push([Number(t.toFixed(3)), 'o', s]);
const wait = (d) => { t += d; };

function typeLine(cmd) {
  push(PROMPT);
  wait(0.55);
  for (const c of cmd) { push(c); wait(0.05); }
  wait(0.35);
  push('\r\n');
  wait(0.12);
}

// English card
typeLine('npx trailix demo');
push(cardEn + '\r\n');
wait(3.0);

// clear screen + scrollback + cursor home
push('\x1b[2J\x1b[3J\x1b[H');
wait(0.25);

// Korean card (multilingual = selling point)
typeLine('npx trailix demo --lang ko');
push(cardKo + '\r\n');
wait(3.6);

const header = { version: 2, width: 82, height: 16 };
const lines = [JSON.stringify(header), ...ev.map((e) => JSON.stringify(e))];
fs.writeFileSync(process.argv[2], lines.join('\n') + '\n');
console.log(`cast: ${ev.length} events, ${t.toFixed(1)}s, -> ${process.argv[2]}`);
