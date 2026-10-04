import Phaser from "phaser";
import { inputRouter } from "@voice/InputRouter";
import { Matcher } from "@matcher/Matcher";
import { matchCommand } from "@matcher/command";
import { sharedAudio } from "@audio/sharedAudio";
import { sharedSound } from "@audio/sharedSound";
import { handleGlobalVoice } from "@voice/globalVoice";
import { type Creature } from "@data/roster";

/**
 * CalibrationScene — measures the player's normal speaking loudness.
 *
 * "Say READY in your normal voice." While they speak, we track peak loudness;
 * saying READY saves it as the baseline, shows "Calibrated", and continues to
 * the battle. Works in both engines (the mic is read regardless).
 */
export class CalibrationScene extends Phaser.Scene {
  private readonly readyMatcher = new Matcher(["ready"], { threshold: 0.6 });
  private creature!: Creature;
  private peak = 0;
  private done = false;
  private prompt!: Phaser.GameObjects.Text;
  private meterFill!: Phaser.GameObjects.Rectangle;

  constructor() {
    super("Calibrate");
  }

  init(data: { creature?: Creature }): void {
    if (data?.creature) this.creature = data.creature;
  }

  preload(): void {
    if (!this.textures.exists("arena")) this.load.image("arena", "assets/arena.webp");
  }

  create(): void {
    this.done = false;
    this.peak = 0;
    const { width, height } = this.scale;

    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5).setDepth(-10);
    bg.setScale(Math.max(width / bg.width, height / bg.height));
    this.add.rectangle(0, 0, width, height, 0x14121f, 0.55).setOrigin(0, 0).setDepth(-9);

    this.add
      .text(width / 2, height / 2 - 90, "CALIBRATION", {
        fontFamily: "monospace",
        fontSize: "28px",
        fontStyle: "bold",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);
    this.prompt = this.add
      .text(width / 2, height / 2 - 30, 'Say "READY" in your normal voice', {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#b79cff",
      })
      .setOrigin(0.5);

    // Live loudness meter so the player can see it's listening.
    this.add.rectangle(width / 2, height / 2 + 40, 404, 20, 0x0f0d18).setStrokeStyle(1, 0x3a3550);
    this.meterFill = this.add.rectangle(width / 2 - 200, height / 2 + 40, 0, 16, 0x58e39b).setOrigin(0, 0.5);

    inputRouter.listen(
      (text) => this.onPhrase(text),
      (err) => this.prompt.setText(`Mic error: ${err}`),
    );
  }

  update(): void {
    if (this.done) return;
    if (sharedAudio.ready && !sharedSound.isInputBlocked()) {
      const l = sharedAudio.getLoudness();
      if (l > this.peak) this.peak = l;
      this.meterFill.width = 400 * Math.min(1, l / 0.5);
    }
  }

  private onPhrase(text: string): void {
    if (handleGlobalVoice(text)) return;
    if (this.done || !text) return;
    if (matchCommand(this.readyMatcher, text)) this.finish();
  }

  private finish(): void {
    this.done = true;
    const baseline = sharedAudio.ready ? Math.max(this.peak, 0.03) : 0;
    sharedAudio.calibrate(baseline);
    sharedSound.blip(660);
    this.prompt.setText("Calibrated");
    this.time.delayedCall(900, () => this.scene.start("Battle", { creature: this.creature }));
  }
}
