import Phaser from "phaser";

/**
 * AnimationsModule — code-only "juice" for the battle creatures.
 *
 * Owns every bit of creature motion so the scene just says what happened
 * (idle / attack / hit / defeat) and this module makes it feel alive:
 *   - idle: breathing squash-&-stretch, a gentle bob and sway, desynced per creature
 *   - attack: anticipation → fast lunge with a fading ghost trail → return
 *   - hit: ~80ms hit-stop, white flash, knockback + damped shake, popping number
 *   - defeat: slow-mo blow (driven by the scene), topple, grey-out, dust burst;
 *             the winner does a victory bounce
 *
 * Creatures are plain Images with origin bottom-center (feet on the ground
 * line), so scaling and rotation pivot at the feet.
 */

const HIT_STOP_MS = 80;

export interface CreatureView {
  image: Phaser.GameObjects.Image;
  /** +1 faces right (player), -1 faces left (enemy). Lunge/knockback use this. */
  facing: 1 | -1;
  /** Resting transform captured at registration. */
  baseX: number;
  baseY: number;
  baseScale: number;
  /** Desync controls so the two idles never match. */
  phase: number;
  tempo: number;
}

export class AnimationsModule {
  private readonly idleTweens = new Map<Phaser.GameObjects.Image, Phaser.Tweens.Tween[]>();

  constructor(private readonly scene: Phaser.Scene) {}

  register(image: Phaser.GameObjects.Image, facing: 1 | -1, phase: number, tempo: number): CreatureView {
    return {
      image,
      facing,
      phase,
      tempo,
      baseX: image.x,
      baseY: image.y,
      baseScale: image.scaleX,
    };
  }

  /* ----------------------------- Idle ----------------------------- */

  startIdle(v: CreatureView): void {
    this.stopIdle(v);
    const img = v.image;
    const t = v.tempo;
    const tweens: Phaser.Tweens.Tween[] = [];

    // Breathing: stretch tall / squash wide, volume roughly preserved.
    tweens.push(
      this.scene.tweens.add({
        targets: img,
        scaleY: v.baseScale * 1.04,
        scaleX: v.baseScale * 0.98,
        duration: 1600 * t,
        delay: v.phase,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    );
    // Bob up and down (feet planted by the shadow, which doesn't move).
    tweens.push(
      this.scene.tweens.add({
        targets: img,
        y: v.baseY - 7,
        duration: 1500 * t,
        delay: v.phase * 0.5,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    );
    // Gentle sway.
    tweens.push(
      this.scene.tweens.add({
        targets: img,
        angle: v.facing * 1.6,
        duration: 2000 * t,
        delay: v.phase,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    );

    this.idleTweens.set(img, tweens);
  }

  stopIdle(v: CreatureView): void {
    this.idleTweens.get(v.image)?.forEach((tw) => tw.stop());
    this.idleTweens.delete(v.image);
    v.image.setScale(v.baseScale).setAngle(0);
    v.image.x = v.baseX;
    v.image.y = v.baseY;
  }

  /** Full reset to resting pose (used on rematch after a defeat). */
  reset(v: CreatureView): void {
    this.scene.tweens.killTweensOf(v.image);
    this.idleTweens.delete(v.image);
    v.image.setScale(v.baseScale).setAngle(0).setAlpha(1).clearTint();
    v.image.x = v.baseX;
    v.image.y = v.baseY;
    this.startIdle(v);
  }

  /* ---------------------------- Attack ---------------------------- */

  /** Anticipation → lunge (with ghost trail) → return. `onLunge` fires at the
   *  forward apex, where the scene spawns its projectile. */
  attack(v: CreatureView, onLunge: () => void): void {
    this.stopIdle(v);
    const img = v.image;
    const dir = v.facing;

    // 1) Anticipation: pull back and squash.
    this.scene.tweens.add({
      targets: img,
      x: v.baseX - dir * 24,
      scaleX: v.baseScale * 1.12,
      scaleY: v.baseScale * 0.9,
      duration: 190,
      ease: "Quad.easeOut",
      onComplete: () => {
        // 2) Lunge forward with stretch, shedding ghost copies.
        const stopTrail = this.ghostTrail(v);
        this.scene.tweens.add({
          targets: img,
          x: v.baseX + dir * 72,
          scaleX: v.baseScale * 0.9,
          scaleY: v.baseScale * 1.12,
          duration: 110,
          ease: "Quad.easeIn",
          onComplete: () => {
            stopTrail();
            onLunge();
            // 3) Ease back to rest and resume breathing.
            this.scene.tweens.add({
              targets: img,
              x: v.baseX,
              scaleX: v.baseScale,
              scaleY: v.baseScale,
              duration: 240,
              ease: "Back.easeOut",
              onComplete: () => this.startIdle(v),
            });
          },
        });
      },
    });
  }

  /** Spawn fading ghost copies while the returned stop() hasn't been called. */
  private ghostTrail(v: CreatureView): () => void {
    let last = 0;
    const event = this.scene.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        const now = this.scene.time.now;
        if (now - last < 22) return;
        last = now;
        const img = v.image;
        const ghost = this.scene.add
          .image(img.x, img.y, img.texture.key)
          .setOrigin(0.5, 1)
          .setScale(img.scaleX, img.scaleY)
          .setAngle(img.angle)
          .setAlpha(0.45)
          .setTint(0x9a92c7)
          .setDepth(img.depth - 1);
        this.scene.tweens.add({
          targets: ghost,
          alpha: 0,
          duration: 260,
          onComplete: () => ghost.destroy(),
        });
      },
    });
    return () => event.remove();
  }

  /* ------------------------------ Hit ----------------------------- */

  /** Hit-stop, flash, knockback + damped shake (scaled by damage), and a
   *  popping damage number. */
  hit(
    v: CreatureView,
    damage: number,
    opts: { resumeIdle?: boolean; onComplete?: () => void } = {},
  ): void {
    this.stopIdle(v);
    const img = v.image;

    // Hit-stop: a brief freeze before the reaction sells the impact.
    this.scene.time.delayedCall(HIT_STOP_MS, () => {
      img.setTintFill(0xffffff);
      this.scene.time.delayedCall(90, () => img.clearTint());

      const amp = Phaser.Math.Clamp(8 + damage, 10, 36); // bigger damage → bigger shake
      const knockDir = -v.facing; // pushed away from the attacker

      this.floatingDamage(v.baseX, v.baseY - img.displayHeight * 0.95, damage);

      // Knockback out, then a damped shake back to rest.
      this.scene.tweens.add({
        targets: img,
        x: v.baseX + knockDir * amp,
        duration: 70,
        ease: "Quad.easeOut",
        yoyo: true,
        onComplete: () => this.shake(v, amp, opts),
      });
    });
  }

  private shake(v: CreatureView, amp: number, opts: { resumeIdle?: boolean; onComplete?: () => void }): void {
    const img = v.image;
    const total = 5;
    let i = total;
    const step = (): void => {
      i -= 1;
      const dx = (i % 2 === 0 ? 1 : -1) * amp * (i / total); // decaying amplitude
      this.scene.tweens.add({
        targets: img,
        x: v.baseX + dx,
        duration: 38,
        ease: "Sine.easeInOut",
        onComplete: () => {
          if (i > 0) {
            step();
          } else {
            img.x = v.baseX;
            if (opts.resumeIdle !== false) this.startIdle(v);
            opts.onComplete?.();
          }
        },
      });
    };
    step();
  }

  /** Floating "-N" that pops in and rises away; bigger hits are bigger. */
  floatingDamage(x: number, y: number, amount: number): void {
    const size = Phaser.Math.Clamp(26 + amount, 28, 58);
    const label = this.scene.add
      .text(x, y, `-${amount}`, {
        fontFamily: "monospace",
        fontSize: `${size}px`,
        fontStyle: "bold",
        color: "#ff5a5a",
      })
      .setOrigin(0.5)
      .setDepth(70)
      .setScale(0.4);
    this.scene.tweens.add({ targets: label, scale: 1, duration: 150, ease: "Back.easeOut" });
    this.scene.tweens.add({
      targets: label,
      y: y - 72,
      alpha: 0,
      delay: 150,
      duration: 650,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  /* ----------------------------- Defeat --------------------------- */

  /** Slow-mo scaling for the killing blow (driven by the scene). */
  setSlowMo(scale: number): void {
    this.scene.tweens.timeScale = scale;
    this.scene.time.timeScale = scale;
  }

  /** Loser topples, greys out and bursts to dust; winner bounces. */
  defeat(loser: CreatureView, winner: CreatureView, onDone: () => void): void {
    this.stopIdle(loser);
    const img = loser.image;

    this.scene.tweens.add({
      targets: img,
      angle: -loser.facing * 82, // topple backward, away from the opponent
      duration: 620,
      ease: "Quad.easeIn",
      onComplete: () => {
        img.setTint(0x555555); // fade to grey
        this.dustBurst(loser.baseX, loser.baseY);
        this.scene.tweens.add({ targets: img, alpha: 0, duration: 450 });
        this.scene.time.delayedCall(480, onDone);
      },
    });

    this.victoryBounce(winner);
  }

  private victoryBounce(v: CreatureView): void {
    this.stopIdle(v);
    const img = v.image;
    this.scene.tweens.add({
      targets: img,
      y: v.baseY - 42,
      duration: 300,
      ease: "Quad.easeOut",
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        img.y = v.baseY;
        this.startIdle(v);
      },
    });
  }

  private dustBurst(x: number, y: number): void {
    this.ensureDustTexture();
    const emitter = this.scene.add.particles(x, y, "dust-px", {
      speed: { min: 50, max: 180 },
      angle: { min: 200, max: 340 },
      gravityY: 320,
      lifespan: 650,
      scale: { start: 1.3, end: 0 },
      tint: 0x9a92c7,
      emitting: false,
    });
    emitter.setDepth(55);
    emitter.explode(26, x, y);
    this.scene.time.delayedCall(900, () => emitter.destroy());
  }

  private ensureDustTexture(): void {
    if (this.scene.textures.exists("dust-px")) return;
    const g = this.scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture("dust-px", 8, 8);
    g.destroy();
  }
}
