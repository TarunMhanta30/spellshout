import Phaser from "phaser";
import { inputRouter } from "@voice/InputRouter";
import { Matcher } from "@matcher/Matcher";
import { heardCommand } from "@matcher/command";
import { handleGlobalVoice } from "@voice/globalVoice";

/**
 * HowToScene — a short how-to-play shown after the title. Three cards; saying
 * "skip" (or "continue") moves on to creature select.
 */
export class HowToScene extends Phaser.Scene {
  private readonly skipMatcher = new Matcher(["skip", "continue", "start", "ready"], { threshold: 0.6 });
  private done = false;

  constructor() {
    super("HowTo");
  }

  preload(): void {
    if (!this.textures.exists("arena")) this.load.image("arena", "assets/arena.png");
  }

  create(): void {
    this.done = false;
    const { width, height } = this.scale;

    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5).setDepth(-10);
    bg.setScale(Math.max(width / bg.width, height / bg.height));
    this.add.rectangle(0, 0, width, height, 0x14121f, 0.78).setOrigin(0, 0).setDepth(-9);

    this.add
      .text(width / 2, 44, "HOW TO PLAY", { fontFamily: "monospace", fontSize: "34px", fontStyle: "bold", color: "#e9e4ff" })
      .setOrigin(0.5);

    // In Wispr Flow mode, remind the player how to trigger it.
    if (inputRouter.getMode() === "wispr") {
      this.add
        .text(width / 2, 84, "Hold your Wispr Flow hotkey (Ctrl + Win on Windows) and speak.", {
          fontFamily: "monospace",
          fontSize: "15px",
          fontStyle: "bold",
          color: "#14121f",
          backgroundColor: "#7c6cff",
          padding: { x: 10, y: 5 },
        })
        .setOrigin(0.5);
    }

    const cards: [string, string, number][] = [
      ["SHOUT", "Say spell names to cast.\nThe LOUDER you shout, the\nstronger the spell — a full\nshout is a SHOUT CRIT.", 0xffd36b],
      ["ELEMENTS", "Fire > Nature > Water > Fire.\nSuper-effective = ×2,\nresisted = ×0.5.\nShadow is neutral.", 0x58e39b],
      ["TACTICS", 'Say "switch to <name>" to\nchange creature, or "guard"\nto halve the next hit.\nChain two spells for a combo.', 0x7c6cff],
    ];
    const cw = 300;
    const gap = 24;
    const startX = width / 2 - (cards.length * cw + (cards.length - 1) * gap) / 2;
    cards.forEach(([title, body, color], i) => {
      const cx = startX + i * (cw + gap) + cw / 2;
      const cy = height / 2 - 10;
      this.add.rectangle(cx, cy, cw, 300, 0x1e1b2e).setStrokeStyle(3, color);
      this.add.text(cx, cy - 110, title, { fontFamily: "monospace", fontSize: "26px", fontStyle: "bold", color: `#${color.toString(16)}` }).setOrigin(0.5);
      this.add.text(cx, cy + 20, body, { fontFamily: "monospace", fontSize: "17px", color: "#e9e4ff", align: "center", lineSpacing: 6 }).setOrigin(0.5);
    });

    const prompt = this.add
      .text(width / 2, height - 54, 'Say "SKIP" to begin', { fontFamily: "monospace", fontSize: "24px", fontStyle: "bold", color: "#b79cff" })
      .setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: { from: 1, to: 0.5 }, duration: 700, yoyo: true, repeat: -1 });

    inputRouter.listen((text) => this.onPhrase(text));
  }

  private onPhrase(text: string): void {
    if (handleGlobalVoice(text)) return;
    if (this.done || !text) return;
    if (heardCommand(this.skipMatcher, text)) {
      this.done = true;
      this.scene.start("Select");
    }
  }
}
