import Phaser from "phaser";
import { SPRITE_FACING } from "@data/roster";

/** Ground line the creatures stand on. */
export const GROUND_Y = 418;
/** Common standing height — all creatures are scaled by height to this. */
export const CREATURE_H = 260;
/** Voidcrown (the boss) stands 20% taller. */
export const BOSS_HEIGHT_SCALE = 1.2;

const SHADOW_W_RATIO = 0.7;
const SHADOW_H = 30;

export type Side = "player" | "enemy";

export interface PlacedCreature {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
}

/**
 * Place a creature sprite on the ground line: scaled by height (so every
 * creature stands equally tall, the boss 20% taller), facing the right way for
 * its side (players face right, enemies face left — flipping only when the
 * source art faces the other way), with a shadow sized to match the sprite.
 *
 * This is the single shared place facing + sizing are applied, so battle,
 * gauntlet spawns, select and the lineup view all stay consistent.
 */
export function placeCreature(
  scene: Phaser.Scene,
  opts: { key: string; x: number; side: Side; boss?: boolean; groundY?: number; height?: number },
): PlacedCreature {
  const groundY = opts.groundY ?? GROUND_Y;
  const targetH = opts.height ?? CREATURE_H * (opts.boss ? BOSS_HEIGHT_SCALE : 1);

  const src = scene.textures.get(opts.key).getSourceImage();
  const scale = targetH / src.height;
  const displayW = src.width * scale;

  const shadow = scene.add.ellipse(
    opts.x,
    groundY,
    displayW * SHADOW_W_RATIO,
    SHADOW_H * (targetH / CREATURE_H),
    0x000000,
    0.35,
  );
  const image = scene.add.image(opts.x, groundY, opts.key).setOrigin(0.5, 1).setScale(scale);

  // Players face right, enemies face left; flip only if the art faces the other way.
  const want: "left" | "right" = opts.side === "player" ? "right" : "left";
  const native = SPRITE_FACING[opts.key] ?? "right";
  image.setFlipX(native !== want);

  return { image, shadow };
}
