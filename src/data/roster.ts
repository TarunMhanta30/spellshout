/**
 * Roster — the approved Tier-1 creatures, spells, and enemy in one place.
 *
 * Spell names are two words, phonetically distinct with no shared first words,
 * so speech recognition can't confuse them (see the Matcher tests).
 */

export type Element = "fire" | "water" | "nature" | "void" | "shadow";

export interface Spell {
  name: string;
  element: Element;
  damage: number;
}

/**
 * The direction each sprite's art natively faces. The humanoid player set faces
 * right; the beast enemy set faces left. The shared placer flips to the side a
 * creature is on (players right, enemies left), so this is the only place art
 * facing lives.
 */
export const SPRITE_FACING: Record<string, "left" | "right"> = {
  fire: "right",
  water: "right",
  nature: "right",
  enemy: "right",
  cinderjaw: "left",
  maelstrom: "left",
  blightroot: "left",
  voidcrown: "left",
};

export const ELEMENT_COLOR: Record<Element, number> = {
  fire: 0xff6b4a,
  water: 0x4aa8ff,
  nature: 0x58e39b,
  void: 0x8b5cf6,
  shadow: 0x9a92c7,
};

/** The player's spellbook — every creature's spells combined. Shadow spells are
 *  neutral: they never get (or suffer) an element bonus. */
export const PLAYER_SPELLS: Spell[] = [
  { name: "Molten Fang", element: "fire", damage: 18 },
  { name: "Ashen Roar", element: "fire", damage: 14 },
  { name: "Tidal Crush", element: "water", damage: 18 },
  { name: "Frozen Vault", element: "water", damage: 14 },
  { name: "Thorn Whip", element: "nature", damage: 16 },
  { name: "Bramble Snare", element: "nature", damage: 15 },
  { name: "Dusk Veil", element: "shadow", damage: 16 },
  { name: "Hollow Gaze", element: "shadow", damage: 15 },
];

/** Damage multiplier a creature gets on spells of its own element. */
export const ELEMENT_BONUS = 1.25;

export interface Creature {
  name: string;
  element: Element;
  /** Texture key for the creature's sprite (also its art filename stem). */
  textureKey: string;
  /** This creature's own two spells (all it can cast). */
  spells: Spell[];
}

const spellsOf = (element: Element): Spell[] => PLAYER_SPELLS.filter((s) => s.element === element);

/** The player's party — all four fight; each casts only its own two spells. */
export const CREATURES: Creature[] = [
  { name: "Cinder", element: "fire", textureKey: "fire", spells: spellsOf("fire") },
  { name: "Ripple", element: "water", textureKey: "water", spells: spellsOf("water") },
  { name: "Dryad", element: "nature", textureKey: "nature", spells: spellsOf("nature") },
  { name: "Shade", element: "shadow", textureKey: "enemy", spells: spellsOf("shadow") },
];

export interface Combatant {
  name: string;
  color: number;
  maxHp: number;
  spells: Spell[];
}

export const PLAYER: Combatant = {
  name: "You",
  color: 0x4fd1c5,
  maxHp: 100,
  spells: PLAYER_SPELLS,
};

export const ENEMY: Combatant = {
  name: "Enemy",
  color: 0x8b5cf6,
  maxHp: 100,
  spells: [
    { name: "Void Shriek", element: "void", damage: 16 },
    { name: "Night Gloom", element: "void", damage: 12 },
  ],
};

/* -------------------------------------------------------------------------- */
/* Gauntlet                                                                   */
/* -------------------------------------------------------------------------- */

export type Signature = "burn" | "tide" | "root" | "cataclysm";

export interface EnemyDef {
  name: string;
  /** "void" marks Voidcrown, which shifts element every turn. */
  element: Element;
  textureKey: string;
  isBoss?: boolean;
  signature: Signature;
  signatureName: string;
}

/** The three mid enemies — they appear in random order before the boss. */
export const GAUNTLET_MIDS: EnemyDef[] = [
  { name: "Cinderjaw", element: "fire", textureKey: "cinderjaw", signature: "burn", signatureName: "Burn" },
  { name: "Maelstrom", element: "water", textureKey: "maelstrom", signature: "tide", signatureName: "Tide Shield" },
  { name: "Blightroot", element: "nature", textureKey: "blightroot", signature: "root", signatureName: "Root" },
];

/** Always the final boss. */
export const BOSS: EnemyDef = {
  name: "Voidcrown",
  element: "void",
  textureKey: "voidcrown",
  isBoss: true,
  signature: "cataclysm",
  signatureName: "Cataclysm",
};

/** The three combat elements Voidcrown shifts between. */
export const SHIFT_ELEMENTS: Array<"fire" | "water" | "nature"> = ["fire", "water", "nature"];

/** Attack projectiles an enemy throws, keyed by its (current) element. */
export const ENEMY_ATTACKS: Record<"fire" | "water" | "nature", Spell[]> = {
  fire: [
    { name: "Flame Lash", element: "fire", damage: 14 },
    { name: "Ember Burst", element: "fire", damage: 12 },
  ],
  water: [
    { name: "Wave Slam", element: "water", damage: 14 },
    { name: "Frost Bite", element: "water", damage: 12 },
  ],
  nature: [
    { name: "Vine Lash", element: "nature", damage: 14 },
    { name: "Spore Blast", element: "nature", damage: 12 },
  ],
};

/**
 * Elemental type chart — fire > nature > water > fire. Returns the damage
 * multiplier for `attack` hitting `defender`: 2 (super effective), 0.5
 * (resisted), or 1. Shadow and raw void are neutral in both directions.
 */
export function typeMultiplier(attack: Element, defender: Element): number {
  const beats: Partial<Record<Element, Element>> = { fire: "nature", nature: "water", water: "fire" };
  if (beats[attack] === defender) return 2;
  if (beats[defender] === attack) return 0.5;
  return 1;
}
