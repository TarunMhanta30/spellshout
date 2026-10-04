import Phaser from "phaser";
import { CREATURES, GAUNTLET_MIDS, BOSS } from "@data/roster";

/**
 * PreloadScene — loads every image the game will ever show, once, up front,
 * behind a progress bar, then hands off to the Title scene.
 *
 * Because all textures are in memory after this runs, the later scenes'
 * guarded `load.image(...)` calls all no-op: no screen stalls to fetch art
 * mid-game. Assets are WebP (see scripts/convert-webp.mjs), so the whole set
 * is well under a megabyte.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("Preload");
  }

  preload(): void {
    this.buildProgressBar();

    // Every creature/enemy sprite, plus the shared arena and logo. Keys are the
    // textureKeys the rest of the game already references.
    const keys = new Set<string>([
      ...CREATURES.map((c) => c.textureKey),
      ...GAUNTLET_MIDS.map((e) => e.textureKey),
      BOSS.textureKey,
    ]);
    for (const key of keys) this.load.image(key, `assets/${key}.webp`);
    this.load.image("arena", "assets/arena.webp");
    this.load.image("logo", "assets/logo.webp");
  }

  create(): void {
    this.scene.start("Title");
  }

  /** A simple loading bar driven by the Phaser loader's progress events. */
  private buildProgressBar(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const barW = 360;
    const barH = 16;

    this.add
      .text(cx, cy - 48, "SPELLSHOUT", {
        fontFamily: "monospace",
        fontSize: "34px",
        fontStyle: "bold",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);

    const label = this.add
      .text(cx, cy + 44, "Loading… 0%", { fontFamily: "monospace", fontSize: "15px", color: "#9a92c7" })
      .setOrigin(0.5);

    // Track (border) and the fill that grows with progress.
    this.add
      .rectangle(cx, cy, barW, barH)
      .setStrokeStyle(2, 0x4a4370)
      .setFillStyle(0x1b1830);
    const fill = this.add.rectangle(cx - barW / 2 + 2, cy, 0, barH - 6, 0x7c6cff).setOrigin(0, 0.5);

    this.load.on("progress", (value: number) => {
      fill.width = (barW - 4) * value;
      label.setText(`Loading… ${Math.round(value * 100)}%`);
    });
    this.load.on("complete", () => label.setText("Ready"));
  }
}
