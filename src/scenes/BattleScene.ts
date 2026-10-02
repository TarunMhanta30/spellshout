import Phaser from "phaser";

/**
 * BattleScene — the turn-based duel. The player casts by shouting spells; the
 * Matcher resolves the transcript and loudness scales the power. One enemy for
 * Tier 1. This is a placeholder shell; game logic lands with the modules.
 */
export class BattleScene extends Phaser.Scene {
  constructor() {
    super("Battle");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2, "Battle — coming soon", {
        fontFamily: "monospace",
        fontSize: "28px",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);
  }
}
