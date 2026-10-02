/**
 * Matcher — phonetic + edit-distance phrase matching.
 *
 * Given a transcript and a list of valid phrases, returns the best match with a
 * confidence score (0..1), or null when nothing clears the threshold. The score
 * blends two signals so accents and mishearings still resolve:
 *   - phonetic similarity: each word is reduced to a rough sound code, then
 *     compared — so "amber" and "ember" look nearly identical.
 *   - raw similarity: edit distance on the literal normalized text, as a
 *     tie-breaker and guard against over-eager phonetic collapsing.
 *
 * Pure: no Phaser, no DOM, no Web APIs — unit-testable in isolation.
 */

export interface MatchResult {
  /** The matched phrase, exactly as supplied in the phrase list. */
  phrase: string;
  /** Match confidence, 0..1 (rounded to 3 dp). */
  confidence: number;
}

export interface MatcherOptions {
  /** Minimum confidence to accept a match. Default 0.62. */
  threshold?: number;
}

export const DEFAULT_THRESHOLD = 0.62;

// Phonetic signal is weighted above raw text, since it's what absorbs accents.
const PHONETIC_WEIGHT = 0.6;
const RAW_WEIGHT = 0.4;

export class Matcher {
  private readonly vocabulary: string[];
  private readonly threshold: number;

  constructor(vocabulary: string[] = [], options: MatcherOptions = {}) {
    this.vocabulary = vocabulary;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  /** Number of entries the matcher can resolve against by default. */
  get size(): number {
    return this.vocabulary.length;
  }

  /**
   * Score every phrase against the transcript, best first. Always returns a
   * result per phrase (even low-confidence) — useful for diagnostics/tests.
   */
  rank(transcript: string, phrases: string[] = this.vocabulary): MatchResult[] {
    const normInput = normalize(transcript);
    const codeInput = phoneticPhrase(normInput);

    const results = phrases.map((phrase) => {
      const normPhrase = normalize(phrase);
      const codePhrase = phoneticPhrase(normPhrase);
      const score =
        PHONETIC_WEIGHT * similarity(codeInput, codePhrase) +
        RAW_WEIGHT * similarity(normInput, normPhrase);
      return { phrase, confidence: round(score) };
    });

    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  /**
   * Resolve a transcript to the best-matching phrase, or null if the top
   * candidate doesn't clear the confidence threshold.
   */
  match(transcript: string, phrases: string[] = this.vocabulary): MatchResult | null {
    if (!normalize(transcript) || phrases.length === 0) return null;
    const top = this.rank(transcript, phrases)[0];
    return top && top.confidence >= this.threshold ? top : null;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers (exported for tests)                                               */
/* -------------------------------------------------------------------------- */

/** Lowercase, keep letters and spaces, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduce a single word to a rough phonetic code (a pragmatic, Metaphone-style
 * encoder): fold equivalent sounds together, keep the leading sound, and drop
 * interior vowels so only the consonant skeleton remains.
 */
export function phonetic(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";

  w = w
    .replace(/x/g, "ks") // literal x → k+s, before 'X' is used as a sound token
    .replace(/ph/g, "f")
    .replace(/gh/g, "") // commonly silent
    .replace(/wh/g, "w")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sk")
    .replace(/sh/g, "X") // 'X' token = sh sound
    .replace(/ch/g, "X") // ch ≈ sh/k → same token
    .replace(/th/g, "0") // '0' token = th sound
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/z/g, "s");

  w = w.replace(/(.)\1+/g, "$1"); // collapse doubled letters

  const first = w[0];
  const rest = w.slice(1).replace(/[aeiouy]/g, ""); // drop interior vowels
  return (first + rest).toUpperCase();
}

/** Encode a (normalized) phrase word-by-word, joined with spaces. */
export function phoneticPhrase(normalized: string): string {
  return normalized
    .split(" ")
    .map(phonetic)
    .filter((code) => code.length > 0)
    .join(" ");
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized similarity in 0..1 (1 = identical). */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
