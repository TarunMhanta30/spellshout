import Phaser from "phaser";
import { VoiceModule } from "@voice/VoiceModule";
import { sharedVoice } from "@voice/sharedVoice";
import { Matcher } from "@matcher/Matcher";
import { matchCommand } from "@matcher/command";
import { AnimationsModule, type CreatureView } from "@animations/AnimationsModule";
import { EffectsModule } from "@effects/EffectsModule";
import { CREATURES, ELEMENT_COLOR, type Creature } from "@data/roster";

const GROUND_Y = 360;
const CREATURE_H = 230;

/**
 * CreatureSelectScene — pick your creature by voice.
 *
 * The three creatures stand side by side, breathing with the same idle, under
 * "Say a name to choose." Saying a name (matched phonetically) makes that
 * creature glow and jump, then starts the battle with it on the left. The mic
 * is already live from the title screen (shared VoiceModule).
 */
export class CreatureSelectScene extends Phaser.Scene {
  private readonly matcher = new Matcher(
    CREATURES.map((c) => c.name),
    { threshold: 0.6 },
  );
  private anim!: AnimationsModule;
  private effects!: EffectsModule;
  private views = new Map<string, { view: CreatureView; label: Phaser.GameObjects.Text }>();
  private prompt!: Phaser.GameObjects.Text;
  private chosen = false;

  constructor() {
    super("Select");
  }

  preload(): void {
    if (!this.textures.exists("arena")) this.load.image("arena", "assets/arena.png");
    for (const c of CREATURES) {
      if (!this.textures.exists(c.textureKey)) this.load.image(c.textureKey, `assets/${c.textureKey}.png`);
    }
  }

  create(): void {
    this.chosen = false;
    const { width, height } = this.scale;

    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5).setDepth(-10);
    bg.setScale(Math.max(width / bg.width, height / bg.height));

    this.anim = new AnimationsModule(this);
    this.effects = new EffectsModule(this);
    this.effects.createAtmosphere(width, height);

    this.add
      .text(width / 2, 40, "CHOOSE YOUR CREATURE", {
        fontFamily: "monospace",
        fontSize: "30px",
        fontStyle: "bold",
        color: "#e9e4ff",
      })
      .setOrigin(0.5);

    // Three creatures side by side, each with the same idle breathing.
    const slots = [0.22, 0.5, 0.78];
    CREATURES.forEach((c, i) => {
      const x = width * slots[i];
      const img = this.add.image(x, GROUND_Y, c.textureKey).setOrigin(0.5, 1);
      img.setScale(CREATURE_H / img.height);
      this.add.ellipse(x, GROUND_Y, img.displayWidth * 0.72, 30, 0x000000, 0.35).setDepth(-1);

      const label = this.add
        .text(x, GROUND_Y + 16, c.name, {
          fontFamily: "monospace",
          fontSize: "22px",
          fontStyle: "bold",
          color: "#e9e4ff",
        })
        .setOrigin(0.5, 0);

      // Same breathing for all three (identical phase + tempo).
      const view = this.anim.register(img, 1, 0, 1);
      this.anim.startIdle(view);
      this.views.set(c.name, { view, label });
    });

    this.prompt = this.add
      .text(width / 2, height - 60, "Say a name to choose.", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#b79cff",
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: this.prompt, alpha: { from: 1, to: 0.55 }, duration: 700, yoyo: true, repeat: -1 });

    if (!VoiceModule.isSupported()) {
      this.prompt.setText("Web Speech API unavailable — use Chrome.");
      return;
    }
    // Mic is already running from the title; this just swaps in our handler.
    sharedVoice.start(
      (update) => this.onVoice(update.interim, update.final),
      (err) => this.prompt.setText(`Mic error: ${err}`),
    );
  }

  private onVoice(interim: string, final: string): void {
    const heard = interim || tailWords(final, 3);
    if (this.chosen || !heard) return;

    const result = matchCommand(this.matcher, heard);
    if (!result) return;
    const creature = CREATURES.find((c) => c.name === result.phrase);
    if (creature) this.choose(creature);
  }

  private choose(creature: Creature): void {
    this.chosen = true;
    this.prompt.setText(`${creature.name} chosen!`);
    this.tweens.killTweensOf(this.prompt);
    this.prompt.setAlpha(1);

    const chosen = this.views.get(creature.name)!;

    // Dim the creatures that weren't picked.
    for (const [name, entry] of this.views) {
      if (name === creature.name) continue;
      this.tweens.add({ targets: [entry.view.image, entry.label], alpha: 0.3, duration: 250 });
    }

    // Glow + jump the chosen one, then start the battle.
    const img = chosen.view.image;
    this.anim.stopIdle(chosen.view);
    this.effects.chargeGlowOn(img, ELEMENT_COLOR[creature.element]);
    this.tweens.add({
      targets: img,
      y: chosen.view.baseY - 60,
      duration: 260,
      ease: "Quad.easeOut",
      yoyo: true,
      onComplete: () => {
        img.y = chosen.view.baseY;
      },
    });

    this.time.delayedCall(750, () => {
      this.effects.chargeGlowOff(img);
      this.scene.start("Battle", { creature });
    });
  }
}

/** Keep only the last n whitespace-separated words of a string. */
function tailWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}
