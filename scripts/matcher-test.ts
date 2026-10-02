/**
 * Matcher test — run with:  node scripts/matcher-test.ts
 *
 * Feeds realistic mishearings of our spell names through the Matcher and checks
 * each resolves to the expected spell (or to nothing, for the cases that should
 * fail). Not a unit-test framework — just a readable script with an exit code.
 */
import { Matcher, phoneticPhrase, normalize } from "../src/matcher/Matcher.ts";

// The real Tier-1 vocabulary (6 player spells + the enemy's signature).
const SPELLS = [
  "Molten Fang",
  "Ashen Roar",
  "Tidal Crush",
  "Frozen Vault",
  "Thorn Whip",
  "Bramble Snare",
  "Void Shriek",
];

interface Case {
  heard: string;
  expected: string | null; // null = should NOT match anything
  note: string;
}

const CASES: Case[] = [
  { heard: "molten fang", expected: "Molten Fang", note: "exact" },
  { heard: "melting fang", expected: "Molten Fang", note: "molten → melting" },
  { heard: "ashen war", expected: "Ashen Roar", note: "roar → war" },
  { heard: "title crush", expected: "Tidal Crush", note: "tidal → title" },
  { heard: "frozen fault", expected: "Frozen Vault", note: "vault → fault (v/f)" },
  { heard: "torn whip", expected: "Thorn Whip", note: "dropped the 'th'" },
  { heard: "bramble stair", expected: "Bramble Snare", note: "snare → stair" },
  { heard: "avoid shriek", expected: "Void Shriek", note: "void → avoid" },
  { heard: "pizza delivery", expected: null, note: "unrelated — must fail" },
  { heard: "golden bolt", expected: null, note: "near-ish nonsense — must fail" },
];

const matcher = new Matcher(SPELLS);

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

console.log(`\nMatcher test — threshold ${0.62}, ${SPELLS.length} spells\n`);
console.log(
  pad("heard", 16) + pad("→ matched", 16) + pad("conf", 7) + pad("expected", 16) + "result",
);
console.log("-".repeat(70));

let failures = 0;

for (const c of CASES) {
  const top = matcher.rank(c.heard)[0];
  const result = matcher.match(c.heard); // null if below threshold
  const matched = result ? result.phrase : null;
  const ok = matched === c.expected;
  if (!ok) failures++;

  console.log(
    pad(c.heard, 16) +
      pad(matched ?? "(no match)", 16) +
      pad(top.confidence.toFixed(3), 7) +
      pad(c.expected ?? "(none)", 16) +
      (ok ? "PASS" : "FAIL") +
      `   # ${c.note}`,
  );
}

console.log("-".repeat(70));

// The example from the brief: "amber lens" should match "Ember Lance".
const exampleVocab = ["Ember Lance", ...SPELLS];
const example = new Matcher(exampleVocab).match("amber lens");
const exampleOk = example?.phrase === "Ember Lance";
if (!exampleOk) failures++;
console.log(
  `\nBrief example: "amber lens" → ${example ? `${example.phrase} (${example.confidence})` : "(no match)"}  ${exampleOk ? "PASS" : "FAIL"}`,
);
console.log(
  `  codes:  amber lens = [${phoneticPhrase(normalize("amber lens"))}]   ember lance = [${phoneticPhrase(normalize("Ember Lance"))}]`,
);

console.log(`\n${CASES.length + 1} checks, ${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
