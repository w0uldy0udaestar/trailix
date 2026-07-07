import { padEndWidth, stringWidth, clampWidth } from './width.ts';

/**
 * Header box drawing. Only the header (grade + headline) is boxed; the verdict
 * and fact sections sit below it, unboxed and indented (design mockups A/B).
 * All math is ANSI-aware via stringWidth, so callers may colour body lines.
 */

const H = '─';

/** Draw a boxed header. `title` goes into the top border. */
export function boxHeader(title: string, bodyLines: string[], width: number): string[] {
  const inner = width - 4; // "│ " + content + " │"
  const lines: string[] = [];

  // top: ╭─ title ─...─╮
  const titlePart = `╭${H} ${title} `;
  const used = stringWidth(titlePart) + 1; // +1 for closing ╮
  const fill = Math.max(0, width - used);
  lines.push(`${titlePart}${H.repeat(fill)}╮`);

  for (const raw of bodyLines) {
    const clamped = stringWidth(raw) > inner ? clampWidth(raw, inner) : raw;
    lines.push(`│ ${padEndWidth(clamped, inner)} │`);
  }

  lines.push(`╰${H.repeat(width - 2)}╯`);
  return lines;
}
