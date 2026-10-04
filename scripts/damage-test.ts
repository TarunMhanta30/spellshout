/**
 * Damage table — prints the damage for every player element against every enemy
 * element (including each of Voidcrown's forms), for normal and mega attacks,
 * with and without Tide Shield, and asserts nothing ever deals zero.
 *
 * Run with:  node scripts/damage-test.ts
 */
import { computeHitDamage, MIN_HIT_DAMAGE, MEGA_MIN_DAMAGE } from "../src/data/damage.ts";
import { MEGA_DAMAGE, type Element } from "../src/data/roster.ts";

/** Worst-case normal base (14) so the table proves the ≥5 floor holds. */
const NORMAL_BASE = 14;

const PLAYER_ELEMENTS: Element[] = ["fire", "water", "nature", "shadow"];
/** Enemy defending elements — the three mids and Voidcrown's three forms. */
const ENEMY_ELEMENTS: Element[] = ["fire", "water", "nature"];

function label(r: ReturnType<typeof computeHitDamage>): string {
  const tags: string[] = [];
  if (r.superEffective) tags.push("super");
  else if (r.resisted) tags.push("resist");
  else tags.push("neutral");
  if (r.brokeShield) tags.push("breaks-shield");
  if (r.shieldHalved) tags.push("halved");
  return tags.join(",");
}

let zeros = 0;
let belowFloor = 0;

console.log(`Normal base = ${NORMAL_BASE}, mega base = ${MEGA_DAMAGE}`);
console.log(`Floors: normal ≥ ${MIN_HIT_DAMAGE}, mega ≥ ${MEGA_MIN_DAMAGE}\n`);

for (const attack of PLAYER_ELEMENTS) {
  console.log(`== Player: ${attack.toUpperCase()} ==`);
  for (const kind of ["normal", "mega"] as const) {
    for (const shieldUp of [false, true]) {
      const base = kind === "mega" ? MEGA_DAMAGE : NORMAL_BASE;
      const cells = ENEMY_ELEMENTS.map((defender) => {
        const r = computeHitDamage({
          base,
          kind,
          attack,
          defender,
          boosted: attack !== "shadow", // own-element normal caster; shadow never boosts
          shieldUp,
        });
        if (r.damage === 0) zeros++;
        if (r.damage < (kind === "mega" ? MEGA_MIN_DAMAGE : MIN_HIT_DAMAGE)) belowFloor++;
        return `${defender}=${r.damage} (${label(r)})`;
      });
      const tag = `${kind}${shieldUp ? " +shield" : "        "}`;
      console.log(`  ${tag}: ${cells.join("   ")}`);
    }
  }
  console.log("");
}

console.log(`Voidcrown shifts between fire/water/nature — covered by the columns above.\n`);

if (zeros > 0) console.log(`FAIL: ${zeros} combination(s) dealt ZERO damage.`);
else if (belowFloor > 0) console.log(`FAIL: ${belowFloor} combination(s) fell below the floor.`);
else console.log("PASS: no zero damage anywhere; every hit meets its floor.");

process.exit(zeros === 0 && belowFloor === 0 ? 0 : 1);
