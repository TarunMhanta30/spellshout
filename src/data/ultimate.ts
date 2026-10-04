/**
 * Ultimate scoring — the player describes their attack in one free sentence;
 * we scan it for fire / water / nature keywords. The elements found decide the
 * effect mix, and more distinct element words plus a longer sentence (up to 20
 * words) mean more damage, capped at 40.
 */

export type UltElement = "fire" | "water" | "nature";

const KEYWORDS: Record<UltElement, string[]> = {
  fire: [
    "fire", "flame", "flames", "burn", "burning", "blaze", "blazing", "ember", "embers", "lava",
    "magma", "scorch", "inferno", "heat", "ash", "molten", "sear", "char", "spark", "wildfire",
    "volcano", "smoke", "cinder", "pyre", "combust", "incinerate",
  ],
  water: [
    "water", "wave", "waves", "ocean", "sea", "ice", "frost", "freeze", "frozen", "rain",
    "flood", "tide", "splash", "drown", "mist", "river", "snow", "hail", "geyser", "torrent",
    "aqua", "deluge", "current", "wet", "tsunami", "glacier",
  ],
  nature: [
    "nature", "vine", "vines", "leaf", "leaves", "root", "roots", "thorn", "thorns", "forest",
    "tree", "trees", "bloom", "petal", "grow", "growth", "earth", "stone", "moss", "branch",
    "seed", "bramble", "wood", "grass", "flower", "bark", "jungle", "overgrow",
  ],
};

const ORDER: UltElement[] = ["fire", "water", "nature"];

export interface UltScore {
  /** Elements present in the sentence, in fire→water→nature order. */
  elements: UltElement[];
  /** Final damage (capped at 40). */
  damage: number;
  /** Count of distinct element keywords found. */
  distinct: number;
  /** Word count (uncapped) of the sentence. */
  words: number;
}

export function scoreUltimate(sentence: string): UltScore {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const present = new Set(words);

  const found: Record<UltElement, Set<string>> = { fire: new Set(), water: new Set(), nature: new Set() };
  for (const el of ORDER) {
    for (const kw of KEYWORDS[el]) {
      if (present.has(kw)) found[el].add(kw);
    }
  }

  const elements = ORDER.filter((el) => found[el].size > 0);
  const distinct = elements.reduce((n, el) => n + found[el].size, 0);
  const damage = Math.min(40, distinct * 6 + Math.min(20, words.length));

  return { elements, damage, distinct, words: words.length };
}
