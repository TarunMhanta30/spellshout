/**
 * Quick check: does the matcher accept realistic transcriptions of the control
 * words "rematch" (result screen) and "start" (title screen)?
 * Run with:  node scripts/voice-words-test.ts
 */
import { Matcher } from "../src/matcher/Matcher.ts";
import { heardCommand } from "../src/matcher/command.ts";

function report(label: string, vocab: string[], cases: [string, boolean][]) {
  const m = new Matcher(vocab, { threshold: 0.6 });
  console.log(`\n${label}  vocab=[${vocab.join(", ")}]  threshold 0.6`);
  let fails = 0;
  for (const [heard, shouldMatch] of cases) {
    const got = heardCommand(m, heard);
    const ok = got === shouldMatch;
    if (!ok) fails++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  "${heard}" -> ${got ? "command" : "(no match)"}`);
  }
  return fails;
}

let fails = 0;

fails += report("REMATCH", ["rematch", "re match", "play again", "again"], [
  ["rematch", true],
  ["re match", true],
  ["rematched", true],
  ["rematch please", true],
  ["play again", true],
  ["again", true],
  ["we match", true],
  ["void shriek", false],
  ["molten fang", false],
]);

fails += report("START", ["start", "begin"], [
  ["start", true],
  ["begin", true],
  ["let's start", true],
  ["started", true],
  ["star", true],
  ["molten fang", false],
  ["pizza delivery", false],
]);

console.log(`\n${fails} failed.\n`);
process.exit(fails === 0 ? 0 : 1);
