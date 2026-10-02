/**
 * Roster — the approved Tier-1 creatures, spells, and enemy in one place.
 *
 * Spell names are two words, phonetically distinct with no shared first words,
 * so speech recognition can't confuse them (see the Matcher tests).
 */

export type Element = "fire" | "water" | "nature" | "void";

export interface Spell {
  name: string;
  element: Element;
  damage: number;
}

export const ELEMENT_COLOR: Record<Element, number> = {
  fire: 0xff6b4a,
  water: 0x4aa8ff,
  nature: 0x58e39b,
  void: 0x8b5cf6,
};

/** The player's Tier-1 spellbook — the three creatures' spells combined. */
export const PLAYER_SPELLS: Spell[] = [
  { name: "Molten Fang", element: "fire", damage: 18 },
  { name: "Ashen Roar", element: "fire", damage: 14 },
  { name: "Tidal Crush", element: "water", damage: 18 },
  { name: "Frozen Vault", element: "water", damage: 14 },
  { name: "Thorn Whip", element: "nature", damage: 16 },
  { name: "Bramble Snare", element: "nature", damage: 15 },
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
  name: "Umbra",
  color: 0x8b5cf6,
  maxHp: 100,
  spells: [
    { name: "Void Shriek", element: "void", damage: 16 },
    { name: "Night Gloom", element: "void", damage: 12 },
  ],
};
