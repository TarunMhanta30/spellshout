import Phaser from "phaser";
import { VoiceModule } from "@voice/VoiceModule";
import { inputRouter } from "@voice/InputRouter";
import { sharedAudio } from "@audio/sharedAudio";
import { sharedSound } from "@audio/sharedSound";
import { handleGlobalVoice } from "@voice/globalVoice";
import { Matcher } from "@matcher/Matcher";
import { heardCommand, matchCommand } from "@matcher/command";

/**
 * TitleScene — the entry point, over the arena background.
 *
 * A single click enables the mic. Then "START" begins the game. Two voice
 * engines are selectable here: "whisper mode" switches to Wispr Flow input
 * (with a badge), "chrome mode" switches back to Web Speech. The chosen engine
 * (and mic loudness) carry through the rest of the game.
 */
export class TitleScene extends Phaser.Scene {
  private readonly startMatcher = new Matcher(["start", "begin"], { threshold: 0.6 });
  private readonly modeMatcher = new Matcher(["whisper mode", "wispr mode", "chrome mode"], { threshold: 0.62 });
  private started = false;
  private prompt!: Phaser.GameObjects.Text;
  private badge!: Phaser.GameObjects.Text;

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

    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5);
    bg.setScale(Math.max(width / bg.width, height / bg.height));

    // Soft glow behind the logo.
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

    this.add
      .text(width / 2, height - 54, "🎧 Headphones recommended", {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#9a92c7",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height - 28, 'Precision mode: say "WHISPER MODE" to cast with Wispr Flow', {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#b79cff",
      })
      .setOrigin(0.5);

    // "Wispr Flow mode" badge, shown while that engine is active.
    this.badge = this.add
      .text(width / 2, 40, "Wispr Flow mode", {
        fontFamily: "monospace",
        fontSize: "16px",
        fontStyle: "bold",
        color: "#14121f",
        backgroundColor: "#7c6cff",
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setVisible(inputRouter.getMode() === "wispr");

    this.input.once("pointerdown", () => this.enableMic());
  }

  private enableMic(): void {
    if (!VoiceModule.isSupported() && inputRouter.getMode() === "chrome") {
      this.prompt.setText("Web Speech API unavailable — use Chrome.");
      return;
    }
    // Keep reading mic loudness regardless of the input engine.
    void sharedAudio.init().catch(() => {});
    sharedSound.resume(); // audio context needs this user gesture
    sharedSound.blip();

    inputRouter.listen(
      (text) => this.onPhrase(text),
      (err) => this.prompt.setText(`Mic error: ${err}`),
    );
    this.updatePrompt();
    this.tweens.add({ targets: this.prompt, alpha: { from: 1, to: 0.5 }, duration: 650, yoyo: true, repeat: -1 });
  }

  private onPhrase(text: string): void {
    if (!text) return;
    if (handleGlobalVoice(text)) return;

    // Engine toggle (works via whichever engine is currently listening).
    const mode = matchCommand(this.modeMatcher, text);
    if (mode) {
      const toWispr = mode.phrase !== "chrome mode";
      inputRouter.setMode(toWispr ? "wispr" : "chrome");
      this.badge.setVisible(toWispr);
      this.updatePrompt();
      return;
    }

    if (this.started) return;
    if (heardCommand(this.startMatcher, text)) {
      this.started = true;
      this.scene.start("HowTo");
    }
  }

  private updatePrompt(): void {
    const engine = inputRouter.getMode() === "wispr" ? "(Wispr Flow)" : "(Chrome)";
    this.prompt.setText(`Say "START" ${engine}`);
  }
}
