/** Picks a line deterministically from a seed (usually a date), so a given day always shows the same joke. */
export function quip(lines: readonly string[], seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return lines[hash % lines.length]
}
