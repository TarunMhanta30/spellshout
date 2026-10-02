import Phaser from "phaser";
import { VoiceModule } from "@voice/VoiceModule";
import { sharedVoice } from "@voice/sharedVoice";
import { Matcher } from "@matcher/Matcher";
import { heardCommand } from "@matcher/command";

/**
 * TitleScene — the entry point, over the arena background.
 *
 * The logo pulses with a slow glow and "Say START" sits below it. A single
 * click anywhere enables the microphone (the one gesture browsers require);
 * after that, saying "START" begins the battle. The mic stays on across the
 * handoff (shared VoiceModule), so the battle never needs another click.
 */
export class TitleScene extends Phaser.Scene {
  private readonly startMatcher = new Matcher(["start", "begin"], { threshold: 0.6 });
  private started = false;
  private prompt!: Phaser.GameObjects.Text;

  constructor() {
    super("Title");
  }

  preload(): void {
    this.load.image("arena", "assets/arena.png");
    this.load.image("logo", "assets/logo.png");
  }

  create(): void {
    this.started = false;
    const { width, height } = this.scale;

    // Arena background, scaled to cover.
    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5);
    bg.setScale(Math.max(width / bg.width, height / bg.height));

    // Soft glow behind the logo (an accent oval whose alpha pulses slowly).
    const glow = this.add.ellipse(width / 2, height / 2 - 40, 460, 460, 0x7c6cff, 0.25);
    this.tweens.add({
      targets: glow,
      alpha: { from: 0.12, to: 0.4 },
      scale: { from: 0.92, to: 1.08 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Logo, large and centered, with a gentle breathing pulse.
    const logo = this.add.image(width / 2, height / 2 - 40, "logo").setOrigin(0.5);
    logo.setScale((width * 0.42) / logo.width);
    this.tweens.add({
      targets: logo,
      scale: { from: logo.scale, to: logo.scale * 1.05 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.prompt = this.add
      .text(width / 2, height - 90, "Click anywhere to enable your mic", {
        fontFamily: "monospace",
        fontSize: "26px",
        fontStyle: "bold",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);

    // First gesture: enable the mic, then listen for "START".
    this.input.once("pointerdown", () => this.enableMic());
  }

  private enableMic(): void {
    if (!VoiceModule.isSupported()) {
      this.prompt.setText("Web Speech API unavailable — use Chrome.");
      return;
    }
    sharedVoice.start(
      (update) => this.onVoice(update.interim, update.final),
      (err) => this.prompt.setText(`Mic error: ${err}`),
    );
    this.prompt.setText('Say "START"');
    this.tweens.add({
      targets: this.prompt,
      alpha: { from: 1, to: 0.5 },
      duration: 650,
      yoyo: true,
      repeat: -1,
    });
  }

  private onVoice(interim: string, final: string): void {
    const heard = interim || tailWords(final, 3);
    if (this.started || !heard) return;
    if (heardCommand(this.startMatcher, heard)) {
      this.started = true;
      this.scene.start("Select");
    }
  }
}

/** Keep only the last n whitespace-separated words of a string. */
function tailWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}
