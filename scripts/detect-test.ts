/**
 * Tests spell detection for combos. Run with:  node scripts/detect-test.ts
 *
 * Verifies detectSpellNames finds one or two spell names in realistic phrases
 * (Wispr mode scans the whole text; Chrome accumulates across the 700ms window,
 * simulated here by feeding the full phrase).
 */
import { Matcher } from "../src/matcher/Matcher.ts";
import { detectSpellNames } from "../src/matcher/detectSpells.ts";

const SPELLS = [
  "Molten Fang",
  "Ashen Roar",
  "Tidal Crush",
  "Frozen Vault",
  "Thorn Whip",
  "Bramble Snare",
  "Dusk Veil",
  "Hollow Gaze",
];
const matcher = new Matcher(SPELLS, { threshold: 0.7 });

const cases: [string, string[]][] = [
  ["molten fang", ["Molten Fang"]],
  ["molten fang tidal crush", ["Molten Fang", "Tidal Crush"]],
  ["frozen vault then thorn whip", ["Frozen Vault", "Thorn Whip"]],
  ["ashen war and bramble stair", ["Ashen Roar", "Bramble Snare"]],
  ["dusk veil hollow gaze", ["Dusk Veil", "Hollow Gaze"]],
  ["cast molten fang", ["Molten Fang"]],
  ["pizza delivery", []],
  ["molten fang molten fang", ["Molten Fang"]], // distinct only
];

let fails = 0;
for (const [text, expected] of cases) {
  const got = detectSpellNames(matcher, SPELLS, text);
  const ok = got.length === expected.length && got.every((g, i) => g === expected[i]);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${text}" -> [${got.join(", ")}]${ok ? "" : `  expected [${expected.join(", ")}]`}`);
}
console.log(`\n${cases.length} cases, ${fails} failed.`);
process.exit(fails === 0 ? 0 : 1);
