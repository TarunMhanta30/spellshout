/**
 * Matcher — pure phonetic matching logic.
 *
 * Given a transcript, phonetically match it to a known spell or command and
 * return the best candidate with a confidence score. Accents and small
 * mispronunciations should still resolve to the right spell — this is the
 * heart of the accessibility promise.
 *
 * Pure: no Phaser, no DOM, no Web APIs — unit-testable in isolation.
 *
 * STUB: scaffold only, no implementation yet (Tier 1).
 */

export interface MatchCandidate {
  /** The spell/command id that was matched. */
  id: string;
  /** Match confidence, 0..1. */
  confidence: number;
}

export class Matcher {
  constructor(private readonly vocabulary: string[] = []) {}

  /** Number of entries the matcher can resolve against. */
  get size(): number {
    return this.vocabulary.length;
  }

  /**
   * Resolve a transcript to the best-matching vocabulary entry.
   * Returns null when nothing clears the confidence threshold.
   */
  match(_transcript: string): MatchCandidate | null {
    // TODO(tier1): phonetic encoding (e.g. metaphone/soundex-style) + distance.
    // TODO(tier3): multi-language vocabularies (Hindi, Marathi).
    return null;
  }
}
