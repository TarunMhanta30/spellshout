/**
 * Damage — the single, pure source of truth for how much a hit deals.
 *
 * Kept free of Phaser/DOM so it can be unit-tested (see scripts/damage-test.ts)
 * and so the battle scene and the test can never disagree.
 *
 * Rules:
 *   - type chart: super effective ×2, neutral ×1, resisted ×0.5 (shadow and raw
 *     void are neutral both ways — see typeMultiplier).
 *   - a creature's own-element NORMAL attacks get the +25% element bonus.
 *   - Tide Shield no longer blocks: while it is up a non-super-effective hit is
 *     halved; a super-effective (nature, vs the water enemy) hit breaks it and
 *     lands in full.
 *   - every hit deals at least MIN_HIT_DAMAGE — never zero.
 *   - MEGA attacks ignore Tide Shield entirely and never drop below
 *     MEGA_MIN_DAMAGE after reductions.
 */

import { typeMultiplier, ELEMENT_BONUS, type Element, type SpellKind } from "./roster.ts";

/** Floor for any hit — no hit ever deals less than this (never zero). */
export const MIN_HIT_DAMAGE = 5;
/** A mega never deals less than this, whatever the reductions. */
export const MEGA_MIN_DAMAGE = 30;

export interface HitInput {
  /** The spell's base damage (normal 14–20, mega 35). */
  base: number;
  kind: SpellKind;
  attack: Element;
  defender: Element;
  /** Caster casts its own element as a normal attack (+25%). Ignored for mega. */
  boosted: boolean;
  /** Whether the enemy's Tide Shield is currently up. */
  shieldUp: boolean;
  /** Shout-power multiplier (default 1). */
  powerMult?: number;
  /** Quick-cast multiplier (default 1). */
  quickMult?: number;
  /** Fury-reward multiplier (default 1). */
  furyMult?: number;
}

export interface HitResult {
  /** Final damage dealt to the target (always ≥ the relevant floor). */
  damage: number;
  /** Type multiplier applied (2 / 1 / 0.5). */
  multiplier: number;
  superEffective: boolean;
  resisted: boolean;
  /** Tide Shield halved this (non-super) hit. */
  shieldHalved: boolean;
  /** This hit was super-effective while a shield was up, so it breaks it. */
  brokeShield: boolean;
}

/** Compute the damage for a single attack under the rules above. */
export function computeHitDamage(input: HitInput): HitResult {
  const power = input.powerMult ?? 1;
  const quick = input.quickMult ?? 1;
  const fury = input.furyMult ?? 1;

  const multiplier = typeMultiplier(input.attack, input.defender);
  const superEffective = multiplier === 2;
  const resisted = multiplier === 0.5;

  const creature = input.kind === "normal" && input.boosted ? ELEMENT_BONUS : 1;
  let dmg = input.base * creature * multiplier * power * quick * fury;

  // Mega: ignores the shield and has its own, higher floor.
  if (input.kind === "mega") {
    return {
      damage: Math.max(MEGA_MIN_DAMAGE, Math.round(dmg)),
      multiplier,
      superEffective,
      resisted,
      shieldHalved: false,
      brokeShield: input.shieldUp && superEffective,
    };
  }

  let shieldHalved = false;
  let brokeShield = false;
  if (input.shieldUp) {
    if (superEffective) {
      brokeShield = true; // a super-effective (nature) hit breaks it — full damage
    } else {
      dmg *= 0.5; // held: non-super hits are halved
      shieldHalved = true;
    }
  }

  return {
    damage: Math.max(MIN_HIT_DAMAGE, Math.round(dmg)),
    multiplier,
    superEffective,
    resisted,
    shieldHalved,
    brokeShield,
  };
}
