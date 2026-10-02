import Phaser from "phaser";

/**
 * TitleScene — the entry point. In the finished game this is reached and left
 * entirely by voice. For now it renders a title and a prompt, and advances to
 * the battle on pointer/space as a placeholder until voice is wired in.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super("Title");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 40, "SPELLSHOUT", {
        fontFamily: "monospace",
        fontSize: "64px",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 40, "Say \"start\" to begin", {
        fontFamily: "monospace",
        fontSize: "22px",
        color: "#9a92c7",
      })
      .setOrigin(0.5);

    // Placeholder input until VoiceModule drives scene transitions.
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.start("Battle"));
    this.input.once("pointerdown", () => this.scene.start("Battle"));
  }
}
