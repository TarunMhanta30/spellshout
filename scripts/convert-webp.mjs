/**
 * Convert every game image to WebP, resizing to sane maximums, and delete the
 * source PNGs. Run with:  node scripts/convert-webp.mjs
 *
 * WebP at quality ~80 keeps alpha transparency and cuts these oversized PNGs
 * (arena/creatures were multiple MB each) by an order of magnitude, so the game
 * can preload every asset up front instead of stalling on each screen.
 *
 *   creatures  -> max 700px tall   (transparent)
 *   logo       -> max 900px wide   (transparent)
 *   arena      -> fit within 1920x1080
 */
import sharp from "sharp";
import { readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "public/assets";
const QUALITY = 80;

const CREATURES = ["fire", "water", "nature", "enemy", "cinderjaw", "maelstrom", "blightroot", "voidcrown"];

/** name -> sharp resize options (fit "inside" never enlarges past the source). */
const JOBS = [
  ...CREATURES.map((name) => [name, { height: 700, fit: "inside", withoutEnlargement: true }]),
  ["logo", { width: 900, fit: "inside", withoutEnlargement: true }],
  ["arena", { width: 1920, height: 1080, fit: "inside", withoutEnlargement: true }],
];

const fmtKB = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

let before = 0;
let after = 0;

for (const [name, resize] of JOBS) {
  const src = join(DIR, `${name}.png`);
  const out = join(DIR, `${name}.webp`);
  if (!existsSync(src)) {
    console.log(`${name}.png: missing — skipped`);
    continue;
  }

  const input = readFileSync(src);
  const srcSize = input.length;
  before += srcSize;

  // keepMetadata is off by default, so EXIF/ICC bloat is dropped. Alpha is
  // preserved automatically for images that have it.
  await sharp(input).resize(resize).webp({ quality: QUALITY, effort: 6 }).toFile(out);

  const outSize = statSync(out).size;
  after += outSize;
  rmSync(src);

  console.log(`${name.padEnd(12)} ${fmtKB(srcSize).padStart(10)} png  ->  ${fmtKB(outSize).padStart(10)} webp`);
}

console.log("-----");
console.log(`PNG total:  ${fmtKB(before)}  (${(before / 1048576).toFixed(2)} MB)`);
console.log(`WebP total: ${fmtKB(after)}  (${(after / 1048576).toFixed(2)} MB)`);
