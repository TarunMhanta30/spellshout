import { Matcher } from "./Matcher.ts";

/**
 * Scan a transcript for every spell name it contains, in order. Slides 2–3 word
 * windows across the text and greedily keeps the highest-confidence,
 * non-overlapping, distinct matches — so one phrase can yield a combo of two.
 * `sealed` (if given) is excluded (Blightroot's Root).
 */
export function detectSpellNames(
  matcher: Matcher,
  names: readonly string[],
  text: string,
  sealed?: string | null,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const hits: { name: string; start: number; end: number; conf: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const size of [2, 3]) {
      if (i + size > words.length) continue;
      const r = matcher.match(words.slice(i, i + size).join(" "));
      if (r && names.includes(r.phrase) && r.phrase !== sealed) {
        hits.push({ name: r.phrase, start: i, end: i + size - 1, conf: r.confidence });
      }
    }
  }

  hits.sort((a, b) => b.conf - a.conf);
  const used = new Set<number>();
  const seen = new Set<string>();
  const picks: { name: string; start: number }[] = [];
  for (const h of hits) {
    let overlap = false;
    for (let j = h.start; j <= h.end; j++) if (used.has(j)) overlap = true;
    if (overlap || seen.has(h.name)) continue;
    for (let j = h.start; j <= h.end; j++) used.add(j);
    seen.add(h.name);
    picks.push({ name: h.name, start: h.start });
  }
  picks.sort((a, b) => a.start - b.start);
  return picks.map((p) => p.name);
}
