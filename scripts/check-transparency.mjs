/**
 * Verify every creature sprite has a real transparent background by sampling
 * the four corners. Run with:  node scripts/check-transparency.mjs
 *
 * Must run on the UN-trimmed source: trimming crops to the opaque bounding box,
 * so a trimmed image's corners legitimately touch the creature.
 */
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "public/assets";
const NAMES = ["fire", "water", "nature", "enemy", "cinderjaw", "maelstrom", "blightroot", "voidcrown"];
const PATCH = 8; // sample an 8x8 block at each corner
const THRESHOLD = 16; // max alpha allowed in a corner to count as transparent

const bad = [];
for (const name of NAMES) {
  const png = PNG.sync.read(readFileSync(join(DIR, `${name}.png`)));
  const { width: w, height: h, data } = png;
  const corners = {
    TL: [0, 0],
    TR: [w - PATCH, 0],
    BL: [0, h - PATCH],
    BR: [w - PATCH, h - PATCH],
  };

  const maxAlpha = {};
  let fail = false;
  for (const [k, [sx, sy]] of Object.entries(corners)) {
    let m = 0;
    for (let y = sy; y < sy + PATCH; y++) {
      for (let x = sx; x < sx + PATCH; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a > m) m = a;
      }
    }
    maxAlpha[k] = m;
    if (m > THRESHOLD) fail = true;
  }

  console.log(
    `${name.padEnd(12)} ${w}x${h}  corners(maxA) TL=${maxAlpha.TL} TR=${maxAlpha.TR} BL=${maxAlpha.BL} BR=${maxAlpha.BR}  ${fail ? "<<< NOT TRANSPARENT" : "ok"}`,
  );
  if (fail) bad.push(`${name}.png`);
}

if (bad.length) {
  console.log(`\nDO NOT USE (opaque corners): ${bad.join(", ")}`);
  process.exit(1);
}
console.log("\nAll corners transparent.");
