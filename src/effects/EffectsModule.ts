import Phaser from "phaser";
import { ELEMENT_COLOR, type Element } from "@data/roster";

/**
 * EffectsModule — spell VFX and atmosphere, with every particle texture drawn
 * in code (no image files).
 *
 *   - projectiles: a distinct look per element (fire / water / nature / void)
 *   - impacts: a burst in the element's colours
 *   - charge glow: Phaser preFX glow on the enemy while it charges (WebGL),
 *     with a tint-pulse fallback on canvas
 *   - camera: shake scaled to damage, plus a zoom punch on the biggest hits
 *   - atmosphere: slow drifting ambient motes and a soft edge vignette
 */
export class EffectsModule {
  private chargeTween?: Phaser.Tweens.Tween;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureTextures();
  }

  /* ----------------------- generated textures ----------------------- */

  private ensureTextures(): void {
    if (this.scene.textures.exists("fx-soft")) return;

    // Soft radial blob: many stacked translucent circles → a gradient dot.
    const soft = this.scene.make.graphics({ x: 0, y: 0 }, false);
    const r = 16;
    for (let i = r; i > 0; i--) {
      soft.fillStyle(0xffffff, 0.09);
      soft.fillCircle(r, r, i);
    }
    soft.generateTexture("fx-soft", r * 2, r * 2);
    soft.destroy();

    // Small solid dot (embers, droplets, impact sparks).
    const dot = this.scene.make.graphics({ x: 0, y: 0 }, false);
    dot.fillStyle(0xffffff, 1);
    dot.fillCircle(4, 4, 4);
    dot.generateTexture("fx-dot", 8, 8);
    dot.destroy();

    // Leaf: a little pointed ellipse.
    const leaf = this.scene.make.graphics({ x: 0, y: 0 }, false);
    leaf.fillStyle(0xffffff, 1);
    leaf.fillEllipse(7, 5, 12, 7);
    leaf.generateTexture("fx-leaf", 14, 10);
    leaf.destroy();
  }

  /* --------------------------- atmosphere --------------------------- */

  createAtmosphere(width: number, height: number): void {
    // Soft vignette drawn as a radial gradient on a canvas texture.
    const key = "fx-vignette";
    if (!this.scene.textures.exists(key)) {
      const tw = 256;
      const th = Math.round((256 * height) / width);
      const canvas = this.scene.textures.createCanvas(key, tw, th);
      const ctx = canvas?.getContext();
      if (ctx) {
        const grad = ctx.createRadialGradient(tw / 2, th / 2, th * 0.18, tw / 2, th / 2, th * 0.72);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,0.55)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, tw, th);
        canvas?.refresh();
      }
    }
    this.scene.add.image(width / 2, height / 2, key).setDisplaySize(width, height).setDepth(-5);

    // Slow drifting motes (dust / embers), spread across the arena.
    this.scene.add
      .particles(0, 0, "fx-soft", {
        x: { min: 0, max: width },
        y: { min: 0, max: height },
        speedY: { min: -14, max: -3 },
        speedX: { min: -6, max: 6 },
        lifespan: 7000,
        scale: { min: 0.05, max: 0.2 },
        alpha: { start: 0.22, end: 0 },
        frequency: 240,
        tint: [0xffb36b, 0x7c6cff, 0x9fd8ff],
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(-4);
  }

  /* --------------------------- projectiles -------------------------- */

  /** Launch an element-specific projectile from → to, then burst and onHit. */
  launchProjectile(
    element: Element,
    from: { x: number; y: number },
    to: { x: number; y: number },
    duration: number,
    onHit: () => void,
  ): void {
    const color = ELEMENT_COLOR[element];
    const core = this.scene.add.image(from.x, from.y, "fx-soft").setTint(color).setDepth(50);

    let emitter: Phaser.GameObjects.Particles.ParticleEmitter;
    let wavy = false;

    switch (element) {
      case "fire":
        core.setScale(1.5).setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: core, scale: 1.85, duration: 110, yoyo: true, repeat: -1 });
        emitter = this.scene.add.particles(from.x, from.y, "fx-dot", {
          tint: [0xffd36b, 0xff8a3a, 0xff4a2a],
          speed: { min: 10, max: 55 },
          angle: { min: 0, max: 360 },
          lifespan: 320,
          scale: { start: 0.9, end: 0 },
          gravityY: -50,
          frequency: 15,
          quantity: 2,
          blendMode: Phaser.BlendModes.ADD,
        });
        break;

      case "water":
        core.setScale(1.5, 1.1).setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: core, angle: 360, duration: 480, repeat: -1 }); // spin
        emitter = this.scene.add.particles(from.x, from.y, "fx-dot", {
          tint: [0x9fd8ff, 0x4aa8ff, 0xffffff],
          speed: { min: 30, max: 95 },
          angle: { min: 0, max: 360 },
          lifespan: 360,
          scale: { start: 0.7, end: 0 },
          gravityY: 150,
          frequency: 20,
          quantity: 2,
        });
        break;

      case "nature":
        core.setScale(1.25).setBlendMode(Phaser.BlendModes.ADD);
        wavy = true; // the vine "whips" along a sine path
        emitter = this.scene.add.particles(from.x, from.y, "fx-leaf", {
          tint: [0x58e39b, 0x2fa864, 0x9be36b],
          speed: { min: 20, max: 75 },
          angle: { min: 0, max: 360 },
          rotate: { min: 0, max: 360 },
          lifespan: 520,
          scale: { start: 0.95, end: 0 },
          gravityY: 70,
          frequency: 22,
          quantity: 1,
        });
        break;

      case "void":
      default:
        core.setScale(2.1).setAlpha(0.9).setTint(0x6b5a8f);
        emitter = this.scene.add.particles(from.x, from.y, "fx-soft", {
          tint: [0x3a2a5a, 0x5b4a7a, 0x2a2440],
          speed: { min: 8, max: 32 },
          angle: { min: 0, max: 360 },
          lifespan: 540,
          scale: { start: 0.8, end: 2.1 },
          alpha: { start: 0.5, end: 0 },
          frequency: 18,
          quantity: 2,
        });
        break;
    }

    emitter.setDepth(49);
    emitter.startFollow(core);

    const finish = () => this.finishProjectile(element, core, emitter, to, onHit);

    if (wavy) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      const amp = 26;
      const state = { t: 0 };
      this.scene.tweens.add({
        targets: state,
        t: 1,
        duration,
        ease: "Quad.easeIn",
        onUpdate: () => {
          const s = Math.sin(state.t * Math.PI * 3) * amp * (1 - state.t * 0.3);
          core.x = from.x + dx * state.t + px * s;
          core.y = from.y + dy * state.t + py * s;
        },
        onComplete: finish,
      });
    } else {
      this.scene.tweens.add({ targets: core, x: to.x, y: to.y, duration, ease: "Quad.easeIn", onComplete: finish });
    }
  }

  private finishProjectile(
    element: Element,
    core: Phaser.GameObjects.Image,
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    to: { x: number; y: number },
    onHit: () => void,
  ): void {
    this.scene.tweens.killTweensOf(core);
    emitter.stopFollow();
    emitter.stop();
    core.destroy();
    this.scene.time.delayedCall(600, () => emitter.destroy());

    this.impact(element, to.x, to.y);
    onHit();
  }

  /* ---------------------------- impacts ----------------------------- */

  impact(element: Element, x: number, y: number): void {
    const color = ELEMENT_COLOR[element];
    const additive = element !== "void";
    const blend = additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL;

    const burst = this.scene.add
      .particles(x, y, "fx-dot", {
        tint: color,
        speed: { min: 60, max: 220 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 250, max: 500 },
        scale: { start: 1.1, end: 0 },
        gravityY: element === "void" ? 50 : 0,
        blendMode: blend,
        emitting: false,
      })
      .setDepth(55);
    burst.explode(element === "void" ? 20 : 28, x, y);

    // Expanding shock ring in the element colour.
    const ring = this.scene.add
      .image(x, y, "fx-soft")
      .setTint(color)
      .setScale(0.6)
      .setDepth(54)
      .setBlendMode(blend);
    this.scene.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 300,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });

    this.scene.time.delayedCall(700, () => burst.destroy());
  }

  /* -------------------------- charge glow --------------------------- */

  chargeGlowOn(img: Phaser.GameObjects.Image, color: number): void {
    this.chargeGlowOff(img);
    const preFX = img.preFX;
    if (preFX) {
      const glow = preFX.addGlow(color, 0, 0, false, 0.1, 16);
      this.chargeTween = this.scene.tweens.add({
        targets: glow,
        outerStrength: 6,
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else {
      // Canvas fallback: pulse a coloured tint.
      img.setTintFill(color);
      this.chargeTween = this.scene.tweens.add({
        targets: img,
        alpha: { from: 1, to: 0.55 },
        duration: 480,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  chargeGlowOff(img: Phaser.GameObjects.Image): void {
    this.chargeTween?.stop();
    this.chargeTween = undefined;
    img.preFX?.clear();
    img.clearTint();
    img.setAlpha(1);
  }

  /* ----------------------------- camera ----------------------------- */

  /** Shake scaled to damage; the biggest hits also get a quick zoom punch. */
  cameraHit(damage: number): void {
    const cam = this.scene.cameras.main;
    const intensity = Phaser.Math.Clamp(0.002 + damage * 0.0007, 0.003, 0.018);
    cam.shake(180, intensity);
    if (damage >= 17) this.zoomPunch();
  }

  private zoomPunch(): void {
    const cam = this.scene.cameras.main;
    cam.zoomTo(1.06, 90, "Quad.easeOut");
    this.scene.time.delayedCall(110, () => cam.zoomTo(1, 220, "Quad.easeOut"));
  }
}
