import Phaser from "phaser";
import { inputRouter } from "@voice/InputRouter";
import { Matcher } from "@matcher/Matcher";
import { matchCommand } from "@matcher/command";
import { AnimationsModule, type CreatureView } from "@animations/AnimationsModule";
import { EffectsModule } from "@effects/EffectsModule";
import { placeCreature } from "@sprites/creatureSprite";
import { sharedSound } from "@audio/sharedSound";
import { handleGlobalVoice } from "@voice/globalVoice";
import { CREATURES, ELEMENT_COLOR, type Creature } from "@data/roster";

const GROUND_Y = 360;

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
    if (!this.textures.exists("arena")) this.load.image("arena", "assets/arena.webp");
    for (const c of CREATURES) {
      if (!this.textures.exists(c.textureKey)) this.load.image(c.textureKey, `assets/${c.textureKey}.webp`);
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

    // Creatures side by side, evenly spaced, each with the same idle breathing.
    const n = CREATURES.length;
    const creatureH = n >= 4 ? 185 : 230; // shrink to fit when there are four
    CREATURES.forEach((c, i) => {
      const x = width * ((i + 1) / (n + 1));
      const { image: img } = placeCreature(this, {
        key: c.textureKey,
        x,
        side: "player",
        groundY: GROUND_Y,
        height: creatureH,
      });

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

    // Route through the active engine (Chrome speech or the Wispr bar).
    inputRouter.listen(
      (text) => this.onPhrase(text),
      (err) => this.prompt.setText(`Mic error: ${err}`),
    );
  }

  private onPhrase(text: string): void {
    if (handleGlobalVoice(text)) return;
    if (this.chosen || !text) return;

    const result = matchCommand(this.matcher, text);
    if (!result) return;
    const creature = CREATURES.find((c) => c.name === result.phrase);
    if (creature) this.choose(creature);
  }

  private choose(creature: Creature): void {
    this.chosen = true;
    sharedSound.blip(740);
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
      this.scene.start("Calibrate", { creature });
    });
  }
}
