import Phaser from "phaser";
import { VoiceModule } from "@voice/VoiceModule";
import { inputRouter, type InputMode } from "@voice/InputRouter";
import { sharedAudio } from "@audio/sharedAudio";
import { sharedSound } from "@audio/sharedSound";

/** localStorage key for the last voice mode the player picked. */
const MODE_KEY = "spellshout-mode";

/**
 * TitleScene — the entry point, over the arena background.
 *
 * Two buttons choose the voice engine (and provide the one click the browser
 * needs to enable the mic): a large, highlighted "Play with Wispr Flow" (the
 * default) and a smaller "No Wispr Flow? Play hands-free" for Chrome speech.
 * The last choice is remembered and pre-selected next time. During the game the
 * engine can still be switched by saying "whisper mode" / "chrome mode".
 */
export class TitleScene extends Phaser.Scene {
  private started = false;
  private hint!: Phaser.GameObjects.Text;
  private wisprBg!: Phaser.GameObjects.Rectangle;
  private chromeBg!: Phaser.GameObjects.Rectangle;
  private wisprGlow!: Phaser.GameObjects.Ellipse;
  private wisprTag!: Phaser.GameObjects.Text;
  private chromeTag!: Phaser.GameObjects.Text;
  private preselected: InputMode = "wispr";

  constructor() {
    super("Title");
  }

  preload(): void {
    this.load.image("arena", "assets/arena.webp");
    this.load.image("logo", "assets/logo.webp");
  }

  create(): void {
    this.started = false;
    const { width, height } = this.scale;

    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5);
    bg.setScale(Math.max(width / bg.width, height / bg.height));

    // Soft glow behind the logo.
    const glow = this.add.ellipse(width / 2, height / 2 - 70, 460, 460, 0x7c6cff, 0.25);
    this.tweens.add({
      targets: glow,
      alpha: { from: 0.12, to: 0.4 },
      scale: { from: 0.92, to: 1.08 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const logo = this.add.image(width / 2, height / 2 - 70, "logo").setOrigin(0.5);
    logo.setScale((width * 0.38) / logo.width);
    this.tweens.add({
      targets: logo,
      scale: { from: logo.scale, to: logo.scale * 1.05 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // The remembered choice (default Wispr) is pre-selected and highlighted.
    this.preselected = this.readSavedMode();
    inputRouter.setMode(this.preselected);

    // --- Primary button: Play with Wispr Flow -------------------------------
    const wy = height - 150;
    this.wisprGlow = this.add.ellipse(width / 2, wy, 470, 96, 0x7c6cff, 0.0);
    this.wisprBg = this.add
      .rectangle(width / 2, wy, 440, 70, 0x271f45)
      .setStrokeStyle(3, 0x7c6cff)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(width / 2, wy - 9, "▶  Play with Wispr Flow", {
        fontFamily: "monospace",
        fontSize: "28px",
        fontStyle: "bold",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);
    this.wisprTag = this.add
      .text(width / 2, wy + 18, "recommended", { fontFamily: "monospace", fontSize: "13px", color: "#b79cff" })
      .setOrigin(0.5);
    this.bindButton(this.wisprBg, "wispr", 0x312858, 0x271f45);

    // --- Secondary button: Chrome hands-free --------------------------------
    const cy = height - 82;
    this.chromeBg = this.add
      .rectangle(width / 2, cy, 320, 44, 0x1b1830)
      .setStrokeStyle(2, 0x3a3550)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(width / 2, cy - 6, "No Wispr Flow? Play hands-free", {
        fontFamily: "monospace",
        fontSize: "17px",
        fontStyle: "bold",
        color: "#cfc8e8",
      })
      .setOrigin(0.5);
    this.chromeTag = this.add
      .text(width / 2, cy + 13, "Chrome speech", { fontFamily: "monospace", fontSize: "11px", color: "#9a92c7" })
      .setOrigin(0.5);
    this.bindButton(this.chromeBg, "chrome", 0x241f3a, 0x1b1830);

    this.hint = this.add
      .text(width / 2, height - 34, "🎧 Headphones recommended", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#9a92c7",
      })
      .setOrigin(0.5);

    this.applyPreselect();
  }

  /** Read the saved mode; default to Wispr Flow when none/invalid. */
  private readSavedMode(): InputMode {
    try {
      return localStorage.getItem(MODE_KEY) === "chrome" ? "chrome" : "wispr";
    } catch {
      return "wispr";
    }
  }

  /** Hover + click wiring for a mode button (fill brightens on hover). */
  private bindButton(bg: Phaser.GameObjects.Rectangle, mode: InputMode, hoverColor: number, restColor: number): void {
    bg.on("pointerover", () => {
      if (!this.started) bg.setFillStyle(hoverColor);
    });
    bg.on("pointerout", () => {
      if (!this.started) bg.setFillStyle(restColor);
    });
    bg.on("pointerdown", () => this.chooseMode(mode));
  }

  /** Mark the pre-selected button: a pulsing glow + "last used" tag. */
  private applyPreselect(): void {
    const onWispr = this.preselected === "wispr";
    this.wisprGlow.setFillStyle(0x7c6cff, onWispr ? 0.22 : 0);
    if (onWispr) {
      this.tweens.add({
        targets: this.wisprGlow,
        alpha: { from: 0.5, to: 1 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    // The remembered choice gets a brighter accent border.
    this.wisprBg.setStrokeStyle(onWispr ? 4 : 3, onWispr ? 0x9b86ff : 0x6a5aa0);
    this.chromeBg.setStrokeStyle(onWispr ? 2 : 3, onWispr ? 0x3a3550 : 0x4fd1c5);
    this.wisprTag.setText(onWispr ? "✓ last used · recommended" : "recommended");
    this.chromeTag.setText(onWispr ? "Chrome speech" : "✓ last used · Chrome speech");
  }

  /** Commit a mode: remember it, enable the mic, and start the game. */
  private chooseMode(mode: InputMode): void {
    if (this.started) return;

    // Chrome mode needs the Web Speech API; Wispr Flow does not.
    if (mode === "chrome" && !VoiceModule.isSupported()) {
      this.hint.setText("Web Speech API unavailable — use Chrome, or choose Wispr Flow.").setColor("#ff9e6b");
      return;
    }

    this.started = true;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    inputRouter.setMode(mode);

    // The click is the gesture the browser needs: open the mic + audio now.
    void sharedAudio.init().catch(() => {});
    sharedSound.resume();
    sharedSound.blip();

    this.scene.start("HowTo");
  }
}
