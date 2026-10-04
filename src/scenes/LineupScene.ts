import Phaser from "phaser";
import { placeCreature } from "@sprites/creatureSprite";
import { CREATURES, GAUNTLET_MIDS, BOSS } from "@data/roster";

/**
 * LineupScene — a debug check view (reached at ?lineup).
 *
 * Shows the four player creatures on the left and the four enemies on the right,
 * at battle size (equal height, Voidcrown 20% taller) with real facing applied
 * via the shared placer — so you can verify players face right and enemies face
 * left. Laid out 2×2 per side to fit four at battle scale.
 */
export class LineupScene extends Phaser.Scene {
  constructor() {
    super("Lineup");
  }

  preload(): void {
    this.load.on("loaderror", () => {});
    if (!this.textures.exists("arena")) this.load.image("arena", "assets/arena.webp");
    for (const c of CREATURES) {
      if (!this.textures.exists(c.textureKey)) this.load.image(c.textureKey, `assets/${c.textureKey}.webp`);
    }
    for (const e of [...GAUNTLET_MIDS, BOSS]) {
      if (!this.textures.exists(e.textureKey)) this.load.image(e.textureKey, `assets/${e.textureKey}.webp`);
    }
  }

  create(): void {
    const { width, height } = this.scale;

    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5).setDepth(-10);
    bg.setScale(Math.max(width / bg.width, height / bg.height));
    this.add.rectangle(0, 0, width, height, 0x14121f, 0.5).setOrigin(0, 0).setDepth(-9);
    this.add.rectangle(width / 2, height / 2, 2, height, 0x3a3550).setDepth(-8);

    this.add
      .text(width / 2, 6, "LINEUP · players face →   |   ← enemies face", {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#e9e4ff",
      })
      .setOrigin(0.5, 0)
      .setDepth(20);

    const rows = [268, 524];
    const playerCols = [135, 350];
    const enemyCols = [610, 825];

    const label = (x: number, y: number, name: string) =>
      this.add
        .text(x, y, name, { fontFamily: "monospace", fontSize: "13px", fontStyle: "bold", color: "#e9e4ff" })
        .setOrigin(0.5, 0)
        .setDepth(20);

    CREATURES.forEach((c, i) => {
      const x = playerCols[i % 2];
      const groundY = rows[i < 2 ? 0 : 1];
      placeCreature(this, { key: c.textureKey, x, side: "player", groundY });
      label(x, groundY + 3, c.name);
    });

    [...GAUNTLET_MIDS, BOSS].forEach((e, i) => {
      const x = enemyCols[i % 2];
      const groundY = rows[i < 2 ? 0 : 1];
      placeCreature(this, { key: e.textureKey, x, side: "enemy", groundY, boss: e.isBoss });
      label(x, groundY + 3, e.name);
    });
  }
}
