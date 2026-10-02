import { Matcher, type MatchResult } from "./Matcher.ts";

/**
 * Best match for a short control word (e.g. "start", "rematch", a creature
 * name) heard anywhere in the tail of a transcript, or null. Spells are matched
 * on the whole phrase, but control words are often embedded ("let's start",
 * "say cinder"), so here we test the last few words as a sliding window: the
 * full tail, each single word, and adjacent pairs, keeping the highest-scoring
 * hit. Only meant for small, distinct command vocabularies.
 */
export function matchCommand(matcher: Matcher, heard: string): MatchResult | null {
  const words = heard.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const tail = words.slice(-3);
  const windows = new Set<string>();
  windows.add(tail.join(" "));
  for (let i = 0; i < tail.length; i++) {
    windows.add(tail[i]);
    if (i + 1 < tail.length) windows.add(`${tail[i]} ${tail[i + 1]}`);
  }

  let best: MatchResult | null = null;
  for (const w of windows) {
    const r = matcher.match(w);
    if (r && (!best || r.confidence > best.confidence)) best = r;
  }
  return best;
}

/** Convenience boolean wrapper around {@link matchCommand}. */
export function heardCommand(matcher: Matcher, heard: string): boolean {
  return matchCommand(matcher, heard) !== null;
}
