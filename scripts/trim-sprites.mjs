/**
 * Trim transparent padding from every creature sprite, in place.
 * Run with:  node scripts/trim-sprites.mjs
 *
 * Creature art is square with lots of transparent border, which makes a
 * "scale by height" look uneven (padding counts as height). Cropping to the
 * opaque bounding box lets every creature stand equally tall on the ground line.
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "public/assets";
const NAMES = ["fire", "water", "nature", "enemy", "cinderjaw", "maelstrom", "blightroot", "voidcrown"];
const ALPHA_MIN = 8; // treat near-transparent pixels as empty

for (const name of NAMES) {
  const path = join(DIR, `${name}.png`);
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    console.log(`${name}.png: fully transparent — skipped`);
    continue;
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  if (cw === width && ch === height) {
    console.log(`${name}.png: already tight (${width}x${height})`);
    continue;
  }

  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y + minY) * width + (x + minX)) * 4;
      const di = (y * cw + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  writeFileSync(path, PNG.sync.write(out));
  console.log(`${name}.png: ${width}x${height} -> ${cw}x${ch}`);
}
