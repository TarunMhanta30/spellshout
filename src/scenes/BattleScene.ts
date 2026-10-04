import Phaser from "phaser";
import { inputRouter } from "@voice/InputRouter";
import { Matcher } from "@matcher/Matcher";
import { heardCommand, matchCommand } from "@matcher/command";
import { AnimationsModule, type CreatureView } from "@animations/AnimationsModule";
import { EffectsModule } from "@effects/EffectsModule";
import { placeCreature, GROUND_Y, CREATURE_H } from "@sprites/creatureSprite";
import { scoreUltimate } from "@data/ultimate";
import { sharedAudio } from "@audio/sharedAudio";
import { sharedSound, handleSoundCommand } from "@audio/sharedSound";
import { powerMultiplier, gaugeFill, GAUGE_TOP_RATIO, type PowerResult } from "@data/power";
import {
  PLAYER,
  PLAYER_SPELLS,
  ELEMENT_COLOR,
  ELEMENT_BONUS,
  CREATURES,
  GAUNTLET_MIDS,
  BOSS,
  ENEMY_ATTACKS,
  SHIFT_ELEMENTS,
  typeMultiplier,
  type Spell,
  type Creature,
  type EnemyDef,
  type Element,
} from "@data/roster";

/** Confidence needed to fire a cast from a (possibly rough) interim result. */
const CAST_THRESHOLD = 0.7;
/** How long the big "YOUR TURN / ENEMY'S TURN" banner holds before fading. */
const TURN_BANNER_MS = 800;
/** How long the enemy telegraphs its spell ("charging…") before it attacks. */
const CHARGE_MS = 1000;
/** Travel time of an attack projectile from caster to target. */
const PROJECTILE_MS = 320;
/** Short beat after a hit resolves before the next step. */
const RESOLVE_BEAT_MS = 500;

/** Greyed-out alpha for the spell cards when it isn't the player's turn. */
const CARDS_DISABLED_ALPHA = 0.28;

/** Enemy max HP and damage multiplier by gauntlet position (boss is last). */
const GAUNTLET_HP = [72, 96, 124, 170];
const GAUNTLET_DMG = [1.0, 1.25, 1.5, 1.9];
/** HP restored to the player between fights, as a fraction of max. */
const HEAL_FRACTION = 0.3;

/** Ultimate: charge per landed hit, and the width of the charge meter. */
const ULT_CHARGE_PER_HIT = 25;
const ULT_METER_W = 158;
/** How long after the ultimate sentence stops before it fires. */
const ULT_COMMIT_MS = 1200;

/** Combo: damage multiplier when two spell names arrive together, and how long
 *  a lone spell waits for a second to be chained before casting on its own. */
const COMBO_BONUS = 1.5;
const CAST_WINDOW_MS = 800;

/** Shout Power gauge geometry (vertical bar beside the player). */
const GAUGE_X = 38;
const GAUGE_BOTTOM = 410;
const GAUGE_H = 232;
const GAUGE_W = 18;

type Turn = "idle" | "player" | "enemy" | "result" | "reward";

/** Signature move cadence and tuning. */
const SIGNATURE_EVERY = 3;
const BURN_DMG = 4;
const BURN_TURNS = 3;
const CATACLYSM_DMG = 35;
const CATACLYSM_CHARGE = 2;
/** Quick Cast: casting within this window adds a bonus. */
const QUICK_MS = 3000;
const QUICK_BONUS = 1.1;
/** Reward tuning. */
const MEND_FRACTION = 0.4;
const SURGE_CHARGE = 50;
const ECHO_BONUS = 2.0;
const FURY_MULT = 1.2;

interface HpBar {
  fill: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  nameLabel: Phaser.GameObjects.Text;
  maxWidth: number;
}

/**
 * BattleScene — the voice-driven, turn-based duel.
 *
 * Flow: a "click to begin" overlay (one gesture to enable the mic). Each turn
 * opens with a big "YOUR TURN" / "ENEMY'S TURN" banner. On the player's turn a
 * matched shout fires a projectile at the enemy (and only the enemy). On the
 * enemy's turn all voice is ignored, the cards grey out, the enemy telegraphs
 * its spell ("charging…") for a second, then fires back. Every hit shows a floating
 * damage number. Repeats until one side reaches 0 HP.
 */
export class BattleScene extends Phaser.Scene {
  private readonly matcher = new Matcher(
    PLAYER_SPELLS.map((s) => s.name),
    { threshold: CAST_THRESHOLD },
  );
  // Control vocabulary tolerates common mishearings and embedded phrasings.
  private readonly rematchMatcher = new Matcher(
    ["rematch", "re match", "play again", "again"],
    { threshold: 0.6 },
  );

  private turn: Turn = "idle";
  private castThisTurn = false;
  // A lone spell waits briefly for a second (to form a combo) before it casts.
  private pendingSpell?: Spell;
  private pendingTimer?: Phaser.Time.TimerEvent;
  /** Chosen on the select screen; its element gets the damage bonus. */
  private chosenCreature: Creature = CREATURES[0];

  private playerHp = PLAYER.maxHp;

  // Gauntlet state.
  private gauntlet: EnemyDef[] = [];
  private enemyIndex = 0;
  private defeatedCount = 0;
  private enemyDef!: EnemyDef;
  private enemyHp = 0;
  private enemyMaxHp = 0;
  /** Voidcrown's current element (shifts each of its turns). */
  private bossElement: Element = "fire";
  private enemyShadow?: Phaser.GameObjects.Ellipse;
  private bossAura?: Phaser.GameObjects.Image;
  private bossLabel?: Phaser.GameObjects.Text;

  // Per-fight signature / status state.
  private enemyTurnCount = 0;
  private playerBurn = 0;
  private enemyShield = false;
  private sealedSpell: string | null = null;
  private cataclysmCountdown = 0;
  private cataclysmLabel?: Phaser.GameObjects.Text;
  private warnText?: Phaser.GameObjects.Text;
  private turnStartTime = 0;

  // Run-long upgrades.
  private comboBonus = COMBO_BONUS;
  private furyMult: Partial<Record<Element, number>> = {};

  // UI refs.
  private readonly cards = new Map<string, { bg: Phaser.GameObjects.Rectangle; chain: Phaser.GameObjects.Text }>();
  private progressLayer?: Phaser.GameObjects.Container;
  private progressCrosses: Phaser.GameObjects.Text[] = [];
  private rewardLayer?: Phaser.GameObjects.Container;
  private rewardMatcher?: Matcher;
  private rewardOptions: { kind: string; word: string; element?: Element }[] = [];

  // Shout Power: peak mic loudness since the player's turn began / last cast.
  private peakLoudness = 0;
  private powerTrack!: Phaser.GameObjects.Rectangle;
  private powerFill!: Phaser.GameObjects.Rectangle;

  // Ultimate meter: fills ULT_CHARGE_PER_HIT per landed hit, up to 100.
  private ultCharge = 0;
  private ultInput = false;
  private ultPending = "";
  private ultTimer?: Phaser.Time.TimerEvent;
  private ultFill!: Phaser.GameObjects.Rectangle;

  // Run stats, shown on the result screen.
  private turnsTaken = 0;
  private strongestHit: { name: string; damage: number } | null = null;

  private resultLayer?: Phaser.GameObjects.Container;
  private rematchPrompt?: Phaser.GameObjects.Text;
  private resultHeard?: Phaser.GameObjects.Text;

  private playerShape!: Phaser.GameObjects.Image;
  private enemyShape!: Phaser.GameObjects.Image;
  private playerBaseX = 0;
  private enemyBaseX = 0;
  private playerPos = { x: 0, y: 0 };
  private enemyPos = { x: 0, y: 0 };

  private anim!: AnimationsModule;
  private effects!: EffectsModule;
  private playerView!: CreatureView;
  private enemyView!: CreatureView;

  private playerBar!: HpBar;
  private enemyBar!: HpBar;

  private banner!: Phaser.GameObjects.Text;
  private turnBanner!: Phaser.GameObjects.Text;
  private chargeText!: Phaser.GameObjects.Text;
  private heardLine!: Phaser.GameObjects.Text;
  private castLine!: Phaser.GameObjects.Text;
  private cardLayer!: Phaser.GameObjects.Container;

  private debugEnabled = false;
  private debugBody?: Phaser.GameObjects.Text;

  constructor() {
    super("Battle");
  }

  init(data: { creature?: Creature }): void {
    if (data?.creature) this.chosenCreature = data.creature;
  }

  preload(): void {
    // A missing sprite (e.g. cinderjaw.png) just falls back at spawn time.
    this.load.on("loaderror", () => {});
    if (!this.textures.exists("arena")) this.load.image("arena", "assets/arena.png");
    for (const c of CREATURES) {
      if (!this.textures.exists(c.textureKey)) this.load.image(c.textureKey, `assets/${c.textureKey}.png`);
    }
    for (const e of [...GAUNTLET_MIDS, BOSS]) {
      if (!this.textures.exists(e.textureKey)) this.load.image(e.textureKey, `assets/${e.textureKey}.png`);
    }
  }

  create(): void {
    const { width, height } = this.scale;

    // Arena background, scaled to cover the viewport, behind everything.
    const bg = this.add.image(width / 2, height / 2, "arena").setOrigin(0.5).setDepth(-10);
    bg.setScale(Math.max(width / bg.width, height / bg.height));

    // Atmosphere: drifting motes + edge vignette (sits just above the arena).
    this.effects = new EffectsModule(this);
    this.effects.createAtmosphere(width, height);

    // Combatants stand on a shared ground line. Player on the left; the enemy
    // sprite is (re)spawned per challenger in spawnEnemy().
    const centerY = GROUND_Y - CREATURE_H / 2;
    this.anim = new AnimationsModule(this);

    this.playerBaseX = 235;
    this.playerPos = { x: this.playerBaseX, y: centerY };
    const player = placeCreature(this, { key: this.chosenCreature.textureKey, x: this.playerBaseX, side: "player" });
    this.playerShape = player.image;
    this.playerView = this.anim.register(this.playerShape, 1, 0, 1);
    this.anim.startIdle(this.playerView);

    this.enemyBaseX = width - 235;
    this.enemyPos = { x: this.enemyBaseX, y: centerY };

    // Gauntlet order: the three mid enemies shuffled, then the boss last.
    this.gauntlet = [...Phaser.Utils.Array.Shuffle([...GAUNTLET_MIDS]), BOSS];
    this.createProgressIcons();

    // HP bars (the enemy's name/HP are filled in as each challenger spawns).
    this.playerBar = this.createHpBar(50, 48, 340, this.chosenCreature.name, "left");
    this.enemyBar = this.createHpBar(width - 50 - 340, 48, 340, "", "right");
    this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, false);

    // Ultimate charge meter, under the player's HP bar.
    this.add.text(50, 70, "ULT", { fontFamily: "monospace", fontSize: "11px", color: "#ffd36b" }).setOrigin(0, 0);
    this.add.rectangle(84, 72, ULT_METER_W + 2, 10, 0x0f0d18).setOrigin(0, 0).setStrokeStyle(1, 0x3a3550);
    this.ultFill = this.add.rectangle(85, 73, 0, 8, 0xffd36b).setOrigin(0, 0);
    this.updateUltMeter();

    // Shout Power gauge beside the player — fills live with loudness.
    this.powerTrack = this.add
      .rectangle(GAUGE_X, GAUGE_BOTTOM, GAUGE_W, GAUGE_H, 0x0f0d18)
      .setOrigin(0, 1)
      .setStrokeStyle(1, 0x3a3550);
    this.powerFill = this.add.rectangle(GAUGE_X + 1, GAUGE_BOTTOM - 1, GAUGE_W - 2, 0, 0x58e39b).setOrigin(0, 1);
    // Baseline marker (where "normal" sits) and a shout line near the top.
    const baseY = GAUGE_BOTTOM - (GAUGE_H / GAUGE_TOP_RATIO);
    this.add.rectangle(GAUGE_X, baseY, GAUGE_W + 6, 2, 0x9a92c7).setOrigin(0, 0.5);
    this.add.text(GAUGE_X + GAUGE_W + 4, GAUGE_BOTTOM - GAUGE_H - 2, "SHOUT", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#ff6bd6",
    });

    // Start the quiet ambient drone (continuous; exempt from the bleed window).
    sharedSound.startDrone();

    // Status text.
    this.banner = this.add
      .text(width / 2, 18, "", { fontFamily: "monospace", fontSize: "22px", color: "#e9e4ff" })
      .setOrigin(0.5, 0);

    if (inputRouter.getMode() === "wispr") {
      this.add
        .text(width - 8, 4, "Wispr Flow mode", {
          fontFamily: "monospace",
          fontSize: "12px",
          fontStyle: "bold",
          color: "#14121f",
          backgroundColor: "#7c6cff",
          padding: { x: 7, y: 3 },
        })
        .setOrigin(1, 0)
        .setDepth(80);
    }

    // Dark translucent panel for the heard / last-cast lines. Placed BEHIND the
    // creatures (negative depth) so it never covers them; the text sits above
    // them (depth 6) and stays legible in the gap between the combatants.
    this.add
      .rectangle(width / 2, 376, 520, 60, 0x000000, 0.55)
      .setStrokeStyle(1, 0x3a3550)
      .setOrigin(0.5)
      .setDepth(-3);
    this.heardLine = this.add
      .text(width / 2, 354, "Heard: —", { fontFamily: "monospace", fontSize: "17px", color: "#9a92c7" })
      .setOrigin(0.5, 0)
      .setDepth(6);
    this.castLine = this.add
      .text(width / 2, 380, "Last cast: —", { fontFamily: "monospace", fontSize: "17px", color: "#d7e358" })
      .setOrigin(0.5, 0)
      .setDepth(6);
    this.clearStatusLines();

    // Big, impossible-to-miss turn announcement and enemy "charging" telegraph.
    this.turnBanner = this.add
      .text(width / 2, 130, "", { fontFamily: "monospace", fontSize: "52px", fontStyle: "bold", color: "#e9e4ff" })
      .setOrigin(0.5)
      .setDepth(60)
      .setAlpha(0);
    this.chargeText = this.add
      .text(width / 2, 185, "", { fontFamily: "monospace", fontSize: "24px", color: "#ffb84a" })
      .setOrigin(0.5)
      .setDepth(60)
      .setAlpha(0);

    this.cardLayer = this.add.container(0, 0);
    this.createSpellCards();

    // Debug panel: only when the URL carries ?debug (e.g. localhost:5173/?debug).
    this.debugEnabled = new URLSearchParams(window.location.search).has("debug");
    if (this.debugEnabled) this.createDebugPanel();

    // The mic was enabled on the title screen and recognition is already
    // running — just bind this scene's handler and start the first turn.
    this.beginBattle();
  }

  /* --------------------------------------------------------------------- */
  /* Shout Power                                                            */
  /* --------------------------------------------------------------------- */

  update(): void {
    let fill = 0;
    // Sample loudness only on the player's turn, and never while a game sound
    // could bleed into the mic.
    if (this.turn === "player" && sharedAudio.ready && !sharedSound.isInputBlocked()) {
      const l = sharedAudio.getLoudness();
      if (l > this.peakLoudness) this.peakLoudness = l;
      fill = gaugeFill(l, this.baseline());
    }
    this.powerFill.height = Math.max(0, (GAUGE_H - 2) * fill);
    this.powerFill.setFillStyle(fill >= 1 ? 0xff6bd6 : fill >= 0.65 ? 0xffd36b : 0x58e39b);
    this.powerTrack.setAlpha(this.turn === "player" ? 1 : 0.45);
  }

  private baseline(): number {
    return sharedAudio.getBaseline() ?? 0;
  }

  /** Shout multiplier from the peak loudness of this utterance. Defaults to
   *  normal (1.0x) when loudness can't be read (e.g. Wispr with no mic). */
  private shoutPower(): PowerResult {
    if (!sharedAudio.ready) return { mult: 1, label: "normal", crit: false };
    return powerMultiplier(this.peakLoudness, this.baseline());
  }

  /** Show the multiplier next to the damage, and the crit banner on a crit. */
  private showPower(power: PowerResult): void {
    const color = power.crit ? "#ff6bd6" : power.mult > 1 ? "#ffd36b" : power.mult < 1 ? "#9a92c7" : "#e9e4ff";
    const label = this.add
      .text(this.enemyPos.x, this.enemyPos.y - 150, `×${power.mult} ${power.label.toLowerCase()}`, {
        fontFamily: "monospace",
        fontSize: "16px",
        fontStyle: "bold",
        color,
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScale(0.6);
    this.tweens.add({ targets: label, scale: 1, duration: 150, ease: "Back.easeOut" });
    this.tweens.add({ targets: label, y: label.y - 40, alpha: 0, delay: 600, duration: 500, onComplete: () => label.destroy() });

    if (power.crit) {
      const crit = this.add
        .text(this.scale.width / 2, 250, "SHOUT CRIT!", {
          fontFamily: "monospace",
          fontSize: "46px",
          fontStyle: "bold",
          color: "#ff6bd6",
          stroke: "#14121f",
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(73)
        .setScale(0.6);
      this.tweens.add({ targets: crit, scale: 1, duration: 200, ease: "Back.easeOut" });
      this.tweens.add({ targets: crit, alpha: 0, delay: 800, duration: 450, onComplete: () => crit.destroy() });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Setup helpers                                                          */
  /* --------------------------------------------------------------------- */

  private createHpBar(x: number, y: number, width: number, name: string, align: "left" | "right"): HpBar {
    const h = 18;
    const nameLabel = this.add
      .text(align === "left" ? x : x + width, y - 20, name, {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#9a92c7",
      })
      .setOrigin(align === "left" ? 0 : 1, 0);
    this.add.rectangle(x, y, width, h, 0x0f0d18).setOrigin(0, 0).setStrokeStyle(2, 0x3a3550);
    const fill = this.add.rectangle(x + 2, y + 2, width - 4, h - 4, 0x58e39b).setOrigin(0, 0);
    const label = this.add
      .text(x + width / 2, y + h / 2, "", { fontFamily: "monospace", fontSize: "12px", color: "#14121f" })
      .setOrigin(0.5);
    return { fill, label, nameLabel, maxWidth: width - 4 };
  }

  private updateHpBar(bar: HpBar, hp: number, maxHp: number, animate: boolean): void {
    const clamped = Math.max(0, hp);
    const targetWidth = bar.maxWidth * (clamped / maxHp);
    bar.label.setText(`${clamped} / ${maxHp}`);
    const color = clamped / maxHp > 0.3 ? 0x58e39b : 0xff6b4a;
    bar.fill.setFillStyle(color);
    if (animate) {
      this.tweens.add({ targets: bar.fill, width: targetWidth, duration: 250, ease: "Quad.easeOut" });
    } else {
      bar.fill.width = targetWidth;
    }
  }

  private createSpellCards(): void {
    const { width } = this.scale;
    const margin = 18;
    const gap = 10;
    const count = PLAYER_SPELLS.length;
    const cardW = (width - margin * 2 - gap * (count - 1)) / count;
    const cardH = 84;
    const top = 436;

    PLAYER_SPELLS.forEach((spell, i) => {
      const cx = margin + i * (cardW + gap) + cardW / 2;
      const cy = top + cardH / 2;
      const boosted = this.isBoosted(spell);
      const dmg = this.effectiveDamage(spell);

      // Boosted cards get an element-coloured border to stand out.
      const bg = this.add
        .rectangle(cx, cy, cardW, cardH, 0x1e1b2e)
        .setStrokeStyle(boosted ? 3 : 2, boosted ? ELEMENT_COLOR[spell.element] : 0x3a3550);
      const dot = this.add.circle(cx - cardW / 2 + 11, cy - cardH / 2 + 11, 5, ELEMENT_COLOR[spell.element]);
      // wordWrap splits the two-word name across lines to fit the narrow card.
      const name = this.add
        .text(cx, cy - 10, spell.name, {
          fontFamily: "monospace",
          fontSize: "15px",
          color: "#e9e4ff",
          align: "center",
          wordWrap: { width: cardW - 12 },
        })
        .setOrigin(0.5);
      const meta = this.add
        .text(cx, cy + cardH / 2 - 13, boosted ? `${dmg} dmg +25%` : `${dmg} dmg`, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: boosted ? "#ffd36b" : "#9a92c7",
        })
        .setOrigin(0.5);
      // Chain overlay shown when the spell is sealed by Blightroot's Root.
      const chain = this.add
        .text(cx, cy, "⛓", { fontFamily: "monospace", fontSize: "30px", color: "#ffffff" })
        .setOrigin(0.5)
        .setVisible(false);
      this.cardLayer.add([bg, dot, name, meta, chain]);
      this.cards.set(spell.name, { bg, chain });
    });
  }

  /** Four icons at the top for the gauntlet; beaten enemies get crossed out. */
  private createProgressIcons(): void {
    this.progressLayer?.destroy(true);
    const { width } = this.scale;
    const n = this.gauntlet.length;
    const gap = 44;
    const startX = width / 2 - ((n - 1) * gap) / 2;
    this.progressCrosses = [];
    const objs: Phaser.GameObjects.GameObject[] = [];
    this.gauntlet.forEach((e, i) => {
      const x = startX + i * gap;
      objs.push(this.add.circle(x, 14, 9, e.isBoss ? 0x8b5cf6 : ELEMENT_COLOR[e.element]).setStrokeStyle(1, 0x14121f));
      objs.push(
        this.add
          .text(x, 14, e.name[0], { fontFamily: "monospace", fontSize: "11px", fontStyle: "bold", color: "#14121f" })
          .setOrigin(0.5),
      );
      const cross = this.add
        .text(x, 14, "✕", { fontFamily: "monospace", fontSize: "18px", fontStyle: "bold", color: "#ff5a5a" })
        .setOrigin(0.5)
        .setVisible(false);
      objs.push(cross);
      this.progressCrosses.push(cross);
    });
    this.progressLayer = this.add.container(0, 0, objs);
  }

  /** Whether this spell gets the chosen creature's +25% bonus. Shadow is
   *  neutral, so no creature ever boosts (or is boosted on) shadow. */
  private isBoosted(spell: Spell): boolean {
    return spell.element === this.chosenCreature.element && this.chosenCreature.element !== "shadow";
  }

  /** Spell damage after the chosen creature's same-element +25% bonus (cards). */
  private effectiveDamage(spell: Spell): number {
    return this.isBoosted(spell) ? Math.round(spell.damage * ELEMENT_BONUS) : spell.damage;
  }

  /** Base damage before type/power/quick: creature +25% and any Fury bonus. */
  private spellBase(spell: Spell): number {
    const creature = this.isBoosted(spell) ? ELEMENT_BONUS : 1;
    const fury = this.furyMult[spell.element] ?? 1;
    return spell.damage * creature * fury;
  }

  private quickBonus(): number {
    return this.time.now - this.turnStartTime <= QUICK_MS ? QUICK_BONUS : 1;
  }

  private showQuick(): void {
    const t = this.add
      .text(this.playerPos.x, this.playerPos.y - 95, "QUICK!", {
        fontFamily: "monospace",
        fontSize: "20px",
        fontStyle: "bold",
        color: "#58e39b",
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 150, ease: "Back.easeOut" });
    this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, delay: 450, duration: 450, onComplete: () => t.destroy() });
  }

  private interruptCataclysm(): void {
    this.cataclysmCountdown = 0;
    this.cataclysmLabel?.destroy();
    this.cataclysmLabel = undefined;
    this.announceTurn("CATACLYSM INTERRUPTED!", "#58e39b");
  }

  /** Grey the spell cards out when it isn't the player's turn. */
  private setCardsEnabled(enabled: boolean): void {
    this.cardLayer.setAlpha(enabled ? 1 : CARDS_DISABLED_ALPHA);
  }

  /* --------------------------------------------------------------------- */
  /* Voice wiring                                                           */
  /* --------------------------------------------------------------------- */

  private beginBattle(): void {
    // Route through the active engine (Chrome speech, or the Wispr bar — which
    // keeps Chrome recognition off so nothing casts twice).
    inputRouter.listen(
      (text, canCast) => this.onPhrase(text, canCast),
      (err) => this.banner.setText(`Mic error: ${err}`),
    );
    this.spawnEnemy(0, false);
  }

  /* --------------------------------------------------------------------- */
  /* Gauntlet                                                               */
  /* --------------------------------------------------------------------- */

  /** Bring in a challenger: clear the old one, scale its stats by position,
   *  heal the player between fights, then play a dramatic entrance. */
  private spawnEnemy(index: number, heal: boolean): void {
    this.enemyIndex = index;
    this.enemyDef = this.gauntlet[index];
    this.enemyMaxHp = GAUNTLET_HP[index];
    this.enemyHp = this.enemyMaxHp;

    // Tear down the previous challenger's objects (none on the first spawn).
    if (this.enemyShape) {
      this.anim.stopIdle(this.enemyView);
      this.effects.chargeGlowOff(this.enemyShape);
      this.enemyShape.destroy();
    }
    this.enemyShadow?.destroy();
    this.bossAura?.destroy();
    this.bossLabel?.destroy();
    this.enemyShadow = undefined;
    this.bossAura = undefined;
    this.bossLabel = undefined;

    // Reset per-fight signature / status state.
    this.enemyTurnCount = 0;
    this.enemyShield = false;
    this.cataclysmCountdown = 0;
    this.playerBurn = 0;
    this.cataclysmLabel?.destroy();
    this.cataclysmLabel = undefined;
    this.warnText?.destroy();
    this.warnText = undefined;
    this.clearSeal();

    if (heal) {
      this.playerHp = Math.min(PLAYER.maxHp, this.playerHp + Math.round(PLAYER.maxHp * HEAL_FRACTION));
      this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, true);
    }

    // Spawn sprite (fall back to the element's creature art if the file is
    // missing, e.g. cinderjaw.png).
    const key = this.textures.exists(this.enemyDef.textureKey)
      ? this.enemyDef.textureKey
      : this.fallbackTexture(this.enemyDef.element);
    // Facing (enemies face the player) is applied in the shared placer.
    const spawned = placeCreature(this, { key, x: this.enemyBaseX, side: "enemy", boss: this.enemyDef.isBoss });
    this.enemyShape = spawned.image;
    this.enemyShadow = spawned.shadow;
    this.enemyView = this.anim.register(this.enemyShape, -1, 350, 1.15);

    this.enemyBar.nameLabel.setText(this.enemyDef.name);
    this.updateHpBar(this.enemyBar, this.enemyHp, this.enemyMaxHp, false);

    if (this.enemyDef.isBoss) {
      this.bossElement = Phaser.Utils.Array.GetRandom(SHIFT_ELEMENTS);
      this.createBossAura();
      this.applyBossElement();
    }

    this.enemyEntrance();
  }

  private fallbackTexture(element: Element): string {
    return element === "water" ? "water" : element === "nature" ? "nature" : "fire";
  }

  /** The challenger's effective element (boss uses its current shifted one). */
  private enemyElement(): Element {
    return this.enemyDef.isBoss ? this.bossElement : this.enemyDef.element;
  }

  /** "NEXT CHALLENGER" banner + the enemy sliding/fading in, then play begins. */
  private enemyEntrance(): void {
    this.turn = "idle";
    this.setCardsEnabled(false);
    this.banner.setText("NEXT CHALLENGER");
    this.clearStatusLines();
    this.announceTurn(this.enemyDef.name.toUpperCase(), `#${ELEMENT_COLOR[this.enemyElement()].toString(16)}`);

    const img = this.enemyShape;
    img.setAlpha(0);
    img.x = this.enemyBaseX + 160;
    const slide: Phaser.GameObjects.GameObject[] = [img];
    if (this.bossAura) {
      this.bossAura.x = this.enemyBaseX + 160;
      slide.push(this.bossAura);
    }
    this.tweens.add({ targets: slide, x: this.enemyBaseX, duration: 520, ease: "Back.easeOut" });
    this.tweens.add({ targets: img, alpha: 1, duration: 420 });

    this.time.delayedCall(950, () => {
      img.x = this.enemyBaseX;
      if (this.bossAura) this.bossAura.x = this.enemyBaseX;
      this.anim.startIdle(this.enemyView);
      this.startPlayerTurn();
    });
  }

  private createBossAura(): void {
    this.bossAura = this.add
      .image(this.enemyPos.x, this.enemyPos.y, "fx-soft")
      .setDepth(-1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(12);
    this.tweens.add({
      targets: this.bossAura,
      alpha: { from: 0.35, to: 0.7 },
      scale: { from: 11, to: 13 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.bossLabel = this.add
      .text(this.enemyBaseX, 80, "", { fontFamily: "monospace", fontSize: "15px", fontStyle: "bold" })
      .setOrigin(0.5, 0);
  }

  /** Reflect the boss's current element in its aura colour and label. */
  private applyBossElement(): void {
    const color = ELEMENT_COLOR[this.bossElement];
    this.bossAura?.setTint(color);
    this.bossLabel?.setText(`✦ ${this.bossElement.toUpperCase()}`).setColor(`#${color.toString(16)}`);
  }

  private shiftBossElement(): void {
    const options = SHIFT_ELEMENTS.filter((e) => e !== this.bossElement);
    this.bossElement = Phaser.Utils.Array.GetRandom(options);
    this.applyBossElement();
  }

  /** A phrase from whichever engine is active. `canCast` guards against acting
   *  on a stale (non-committed) transcript. */
  private onPhrase(text: string, canCast: boolean): void {
    // Ignore input while the game's own sound could bleed into the mic.
    if (sharedSound.isInputBlocked()) return;
    if (handleSoundCommand(text)) return;

    // Debug panel updates on every phrase, even when input is being ignored.
    this.updateDebug(text);

    // On the result screen, listen only for "rematch", and show what's heard.
    if (this.turn === "result") {
      this.resultHeard?.setText(`Heard: ${text ? `“${text}”` : "—"}`);
      if (heardCommand(this.rematchMatcher, text)) this.rematch();
      return;
    }

    // On the reward screen, pick an upgrade by its word.
    if (this.turn === "reward") {
      if (text && this.rewardMatcher) {
        const m = matchCommand(this.rewardMatcher, text);
        if (m) this.applyReward(m.phrase);
      }
      return;
    }

    // Only the player's turn listens — all input is ignored otherwise.
    if (this.turn !== "player") return;

    this.heardLine.setText(`Heard: ${text ? `“${text}”` : "—"}`);

    // Ultimate: capture one free sentence, firing once it settles.
    if (this.ultInput) {
      if (canCast && text) {
        this.ultPending = text;
        this.ultTimer?.remove();
        this.ultTimer = this.time.delayedCall(ULT_COMMIT_MS, () => this.fireUltimate());
      }
      return;
    }

    // Cast only from a committed phrase, once per turn — so one utterance can't
    // cast twice and a stale transcript can't re-trigger.
    if (this.castThisTurn || !canCast || !text) return;

    const spells = this.detectSpells(text);
    if (spells.length >= 2) {
      // Two spell names in the text → combo now.
      this.pendingTimer?.remove();
      this.pendingTimer = undefined;
      this.comboCast(spells[0], spells[1]);
    } else if (spells.length === 1) {
      // Hold the lone spell briefly in case a second is chained into a combo.
      this.pendingSpell = spells[0];
      if (!this.pendingTimer) {
        this.pendingTimer = this.time.delayedCall(CAST_WINDOW_MS, () => this.commitSingle());
      }
    }
  }

  private commitSingle(): void {
    this.pendingTimer = undefined;
    const spell = this.pendingSpell;
    this.pendingSpell = undefined;
    if (spell && !this.castThisTurn && this.turn === "player" && !this.ultInput) this.playerCast(spell);
  }

  /** Distinct spell names found in the text, in order (scanning 2–3 word
   *  windows), so one phrase can yield a combo of two. */
  private detectSpells(text: string): Spell[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const hits: { spell: Spell; start: number; end: number; conf: number }[] = [];
    for (let i = 0; i < words.length; i++) {
      for (const size of [2, 3]) {
        if (i + size > words.length) continue;
        const r = this.matcher.match(words.slice(i, i + size).join(" "));
        const spell = r && PLAYER_SPELLS.find((s) => s.name === r.phrase);
        if (spell && spell.name !== this.sealedSpell) hits.push({ spell, start: i, end: i + size - 1, conf: r.confidence });
      }
    }
    // Greedily take the highest-confidence, non-overlapping, distinct spells.
    hits.sort((a, b) => b.conf - a.conf);
    const used = new Set<number>();
    const seen = new Set<string>();
    const picks: { spell: Spell; start: number }[] = [];
    for (const h of hits) {
      let overlap = false;
      for (let j = h.start; j <= h.end; j++) if (used.has(j)) overlap = true;
      if (overlap || seen.has(h.spell.name)) continue;
      for (let j = h.start; j <= h.end; j++) used.add(j);
      seen.add(h.spell.name);
      picks.push({ spell: h.spell, start: h.start });
    }
    picks.sort((a, b) => a.start - b.start);
    return picks.map((p) => p.spell);
  }

  /** Spell damage after creature/Fury base and the elemental type multiplier. */
  private spellDamage(spell: Spell): number {
    return Math.max(1, Math.round(this.spellBase(spell) * typeMultiplier(spell.element, this.enemyElement())));
  }

  /** Cast two spells at once: combined damage × COMBO_BONUS, with a banner. */
  private comboCast(a: Spell, b: Spell): void {
    this.castThisTurn = true;
    this.turn = "idle";
    this.banner.setText("");
    this.pendingSpell = undefined;

    const power = this.shoutPower();
    const quick = this.quickBonus();
    const dmg = Math.max(1, Math.round((this.spellDamage(a) + this.spellDamage(b)) * this.comboBonus * power.mult * quick));
    this.castLine.setText(`Combo! ${a.name} + ${b.name}  ×${power.mult}`);
    if (!this.strongestHit || dmg > this.strongestHit.damage) {
      this.strongestHit = { name: `${a.name} + ${b.name}`, damage: dmg };
    }
    this.announceTurn("COMBO", "#ff6bd6");

    const superEff =
      typeMultiplier(a.element, this.enemyElement()) === 2 || typeMultiplier(b.element, this.enemyElement()) === 2;
    const lethal = this.enemyHp - dmg <= 0;
    const els: Element[] = [a.element, b.element];

    this.anim.attack(this.playerView, () => {
      if (lethal) this.anim.setSlowMo(0.4);
      if (power.crit) {
        sharedSound.crit();
        this.effects.screenFlash(255, 200, 255);
      }
      els.forEach((el, i) => {
        const last = i === els.length - 1;
        this.time.delayedCall(i * 130, () => {
          sharedSound.whoosh(el);
          this.effects.launchProjectile(el, this.playerPos, this.enemyPos, PROJECTILE_MS, () => {
            if (!last) return;
            if (this.shieldBlocks(superEff)) {
              this.anim.setSlowMo(1);
              this.showBlocked();
              sharedSound.impact(2);
              this.anim.hit(this.enemyView, 2);
              this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
              return;
            }
            this.enemyHp = Math.max(0, this.enemyHp - dmg);
            this.updateHpBar(this.enemyBar, this.enemyHp, this.enemyMaxHp, true);
            this.effects.cameraHit(dmg, power.crit);
            sharedSound.impact(dmg);
            this.showPower(power);
            if (quick > 1) this.showQuick();
            if (this.cataclysmCountdown > 0 && superEff && power.crit) this.interruptCataclysm();
            this.addUltCharge(ULT_CHARGE_PER_HIT);

            if (lethal) {
              this.defeatedCount += 1;
              this.anim.hit(this.enemyView, dmg, {
                resumeIdle: false,
                onComplete: () => {
                  this.anim.setSlowMo(1);
                  this.anim.defeat(this.enemyView, this.playerView, () => this.onEnemyDefeated());
                },
              });
              return;
            }
            this.anim.hit(this.enemyView, dmg);
            this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
          });
        });
      });
    });
  }

  /* --------------------------------------------------------------------- */
  /* Ultimate                                                               */
  /* --------------------------------------------------------------------- */

  private addUltCharge(amount: number): void {
    this.ultCharge = Math.min(100, this.ultCharge + amount);
    this.updateUltMeter();
  }

  private updateUltMeter(): void {
    const ready = this.ultCharge >= 100;
    this.ultFill.width = ULT_METER_W * (this.ultCharge / 100);
    this.ultFill.setFillStyle(ready ? 0xfff2b0 : 0xffd36b);
  }

  /** Score the captured sentence and unleash a mixed-element ultimate. */
  private fireUltimate(): void {
    if (!this.ultInput) return;
    this.ultInput = false;
    this.ultTimer?.remove();
    this.ultTimer = undefined;

    const sentence = this.ultPending.trim();
    this.turn = "idle";
    this.banner.setText("");

    const score = scoreUltimate(sentence);
    const elements = (score.elements.length ? score.elements : ["fire"]) as Element[];
    const dmg = Math.max(1, score.damage);

    this.ultCharge = 0;
    this.updateUltMeter();

    if (!this.strongestHit || dmg > this.strongestHit.damage) {
      this.strongestHit = { name: "Ultimate", damage: dmg };
    }
    this.castLine.setText(`Ultimate! (-${dmg})`);
    this.showUltSentence(sentence);

    const lethal = this.enemyHp - dmg <= 0;

    this.anim.attack(this.playerView, () => {
      if (lethal) this.anim.setSlowMo(0.4);
      // One projectile per element in the mix; damage resolves on the last.
      elements.forEach((el, i) => {
        const last = i === elements.length - 1;
        this.time.delayedCall(i * 150, () => {
          sharedSound.whoosh(el);
          this.effects.launchProjectile(el, this.playerPos, this.enemyPos, PROJECTILE_MS, () => {
            if (!last) return;
            this.enemyHp = Math.max(0, this.enemyHp - dmg);
            this.updateHpBar(this.enemyBar, this.enemyHp, this.enemyMaxHp, true);
            this.effects.cameraHit(dmg);
            sharedSound.impact(dmg);

            if (lethal) {
              this.defeatedCount += 1;
              this.anim.hit(this.enemyView, dmg, {
                resumeIdle: false,
                onComplete: () => {
                  this.anim.setSlowMo(1);
                  this.anim.defeat(this.enemyView, this.playerView, () => this.onEnemyDefeated());
                },
              });
              return;
            }
            this.anim.hit(this.enemyView, dmg);
            this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
          });
        });
      });
    });
  }

  /** The ultimate sentence in big text, shown as the attack lands. */
  private showUltSentence(sentence: string): void {
    const { width } = this.scale;
    const label = this.add
      .text(width / 2, 180, sentence || "ULTIMATE", {
        fontFamily: "monospace",
        fontSize: "30px",
        fontStyle: "bold",
        color: "#ffd36b",
        align: "center",
        wordWrap: { width: 820 },
        stroke: "#14121f",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setAlpha(0)
      .setScale(0.8);
    this.tweens.add({ targets: label, alpha: 1, scale: 1, duration: 260, ease: "Back.easeOut" });
    this.tweens.add({ targets: label, alpha: 0, delay: 1700, duration: 500, onComplete: () => label.destroy() });
  }

  /* --------------------------------------------------------------------- */
  /* Turn flow                                                              */
  /* --------------------------------------------------------------------- */

  /** Reset the heard / last-cast lines to their placeholders. */
  private clearStatusLines(): void {
    this.heardLine.setText("Heard: —");
    this.castLine.setText("Last cast: —");
  }

  private startPlayerTurn(): void {
    this.turn = "player";
    this.castThisTurn = false;
    this.turnsTaken += 1;
    this.pendingTimer?.remove();
    this.pendingTimer = undefined;
    this.pendingSpell = undefined;
    this.peakLoudness = 0; // peak is per utterance / since last cast
    this.turnStartTime = this.time.now; // for Quick Cast
    this.heardLine.setText("Heard: —");
    this.applySealVisual();

    // Burn ticks at the start of each of the player's turns.
    if (this.playerBurn > 0) {
      this.playerBurn -= 1;
      this.playerHp = Math.max(0, this.playerHp - BURN_DMG);
      this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, true);
      this.anim.floatingDamage(this.playerPos.x, this.playerPos.y - 90, BURN_DMG);
      sharedSound.impact(BURN_DMG);
      if (this.playerHp <= 0) {
        this.showResult(false);
        return;
      }
    }

    if (this.ultCharge >= 100) {
      // Ultimate ready: this turn is a free-sentence describe-your-attack.
      this.ultInput = true;
      this.ultPending = "";
      this.setCardsEnabled(false);
      this.banner.setText("ULTIMATE READY — describe your attack!");
      this.announceTurn("ULTIMATE READY", "#ffd36b");
    } else {
      this.ultInput = false;
      this.setCardsEnabled(true);
      this.banner.setText("Shout a spell!");
      this.announceTurn("YOUR TURN", "#4fd1c5");
    }
  }

  /** A player cast only ever damages the enemy. */
  private playerCast(spell: Spell): void {
    this.castThisTurn = true;
    this.turn = "idle";
    this.banner.setText("");

    // Creature +25% + Fury, type multiplier, Shout Power, then Quick Cast.
    const mult = typeMultiplier(spell.element, this.enemyElement());
    const power = this.shoutPower();
    const quick = this.quickBonus();
    const dmg = Math.max(1, Math.round(this.spellBase(spell) * mult * power.mult * quick));
    this.castLine.setText(`You cast ${spell.name}  ×${power.mult}`);

    if (!this.strongestHit || dmg > this.strongestHit.damage) {
      this.strongestHit = { name: spell.name, damage: dmg };
    }

    const superEff = mult === 2;
    const lethal = this.enemyHp - dmg <= 0;

    this.anim.attack(this.playerView, () => {
      if (lethal) this.anim.setSlowMo(0.4); // the killing blow lands in slow motion
      sharedSound.whoosh(spell.element);
      if (power.crit) {
        sharedSound.crit();
        this.effects.screenFlash(255, 200, 255);
      }
      this.effects.launchProjectile(spell.element, this.playerPos, this.enemyPos, PROJECTILE_MS, () => {
        if (this.shieldBlocks(superEff)) {
          this.anim.setSlowMo(1);
          this.showBlocked();
          sharedSound.impact(2);
          this.anim.hit(this.enemyView, 2);
          this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
          return;
        }
        this.enemyHp = Math.max(0, this.enemyHp - dmg);
        this.updateHpBar(this.enemyBar, this.enemyHp, this.enemyMaxHp, true);
        this.effects.cameraHit(dmg, power.crit);
        sharedSound.impact(dmg);
        this.showEffectiveness(mult, this.enemyPos.x, this.enemyPos.y - 120);
        this.showPower(power);
        if (quick > 1) this.showQuick();
        if (this.cataclysmCountdown > 0 && superEff && power.crit) this.interruptCataclysm();
        this.addUltCharge(ULT_CHARGE_PER_HIT); // landing a hit charges the ultimate

        if (lethal) {
          this.defeatedCount += 1;
          this.anim.hit(this.enemyView, dmg, {
            resumeIdle: false,
            onComplete: () => {
              this.anim.setSlowMo(1);
              this.anim.defeat(this.enemyView, this.playerView, () => this.onEnemyDefeated());
            },
          });
          return;
        }
        this.anim.hit(this.enemyView, dmg);
        this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
      });
    });
  }

  /** Boss down → victory; otherwise offer a reward, then the next challenger. */
  private onEnemyDefeated(): void {
    this.progressCrosses[this.enemyIndex]?.setVisible(true);
    if (this.enemyDef.isBoss) this.showResult(true);
    else this.showRewards();
  }

  /* --------------------------------------------------------------------- */
  /* Rewards                                                                */
  /* --------------------------------------------------------------------- */

  private showRewards(): void {
    this.turn = "reward";
    this.banner.setText("");
    sharedSound.victory();

    const furyElement = Phaser.Utils.Array.GetRandom(["fire", "water", "nature"]) as Element;
    const all = [
      { kind: "fury", word: "fury", title: "FURY", desc: `+20% ${furyElement} damage`, element: furyElement },
      { kind: "mend", word: "mend", title: "MEND", desc: "Heal 40% HP", element: undefined },
      { kind: "surge", word: "surge", title: "SURGE", desc: "Ultimate starts half full", element: undefined },
      { kind: "echo", word: "echo", title: "ECHO", desc: "Combo bonus becomes 2×", element: undefined },
    ];
    const picks = Phaser.Utils.Array.Shuffle(all).slice(0, 2);
    this.rewardOptions = picks.map((p) => ({ kind: p.kind, word: p.word, element: p.element }));
    this.rewardMatcher = new Matcher(
      picks.map((p) => p.word),
      { threshold: 0.6 },
    );

    const { width, height } = this.scale;
    const dim = this.add.rectangle(0, 0, width, height, 0x000000, 0.8).setOrigin(0, 0);
    const heading = this.add
      .text(width / 2, 72, "CHOOSE A REWARD", { fontFamily: "monospace", fontSize: "34px", fontStyle: "bold", color: "#e9e4ff" })
      .setOrigin(0.5);
    const objs: Phaser.GameObjects.GameObject[] = [dim, heading];
    picks.forEach((p, i) => {
      const cx = width / 2 + (i === 0 ? -168 : 168);
      const cy = height / 2 + 10;
      objs.push(this.add.rectangle(cx, cy, 290, 300, 0x1e1b2e).setStrokeStyle(3, 0x7c6cff));
      objs.push(
        this.add.text(cx, cy - 95, p.title, { fontFamily: "monospace", fontSize: "38px", fontStyle: "bold", color: "#ffd36b" }).setOrigin(0.5),
      );
      objs.push(
        this.add
          .text(cx, cy, p.desc, { fontFamily: "monospace", fontSize: "19px", color: "#e9e4ff", align: "center", wordWrap: { width: 250 } })
          .setOrigin(0.5),
      );
      objs.push(
        this.add.text(cx, cy + 115, `say "${p.word}"`, { fontFamily: "monospace", fontSize: "22px", fontStyle: "bold", color: "#b79cff" }).setOrigin(0.5),
      );
    });
    this.rewardLayer = this.add.container(0, 0, objs).setDepth(100);
  }

  private applyReward(word: string): void {
    const opt = this.rewardOptions.find((o) => o.word === word);
    if (!opt) return;
    switch (opt.kind) {
      case "fury":
        if (opt.element) this.furyMult[opt.element] = (this.furyMult[opt.element] ?? 1) * FURY_MULT;
        break;
      case "mend":
        this.playerHp = Math.min(PLAYER.maxHp, this.playerHp + Math.round(PLAYER.maxHp * MEND_FRACTION));
        this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, true);
        break;
      case "surge":
        this.ultCharge = Math.max(this.ultCharge, SURGE_CHARGE);
        this.updateUltMeter();
        break;
      case "echo":
        this.comboBonus = ECHO_BONUS;
        break;
    }
    sharedSound.blip(880);
    this.rewardLayer?.destroy(true);
    this.rewardLayer = undefined;
    this.rewardMatcher = undefined;
    this.spawnEnemy(this.enemyIndex + 1, true);
  }

  private startEnemyTurn(): void {
    if (this.turn !== "idle") return;
    this.turn = "enemy";
    this.setCardsEnabled(false);
    this.heardLine.setText("Heard: — (mic paused)");
    this.clearSeal(); // the player's turn has ended
    this.enemyTurnCount += 1;

    if (this.enemyDef.isBoss) this.shiftBossElement(); // shifts every boss turn

    this.banner.setText(`${this.enemyDef.name}'s turn`);
    this.announceTurn(`${this.enemyDef.name.toUpperCase()}'S TURN`, `#${ELEMENT_COLOR[this.enemyElement()].toString(16)}`);

    // Continuing a Cataclysm charge?
    if (this.cataclysmCountdown > 0) {
      this.time.delayedCall(TURN_BANNER_MS, () => this.advanceCataclysm());
      return;
    }

    // Signature move every Nth turn (warned the turn before).
    if (this.enemyTurnCount % SIGNATURE_EVERY === 0) {
      this.time.delayedCall(TURN_BANNER_MS, () => this.performSignature());
      return;
    }

    // Otherwise a normal attack; warn if a signature is coming next turn.
    const element = this.enemyElement();
    const attack = Phaser.Utils.Array.GetRandom(ENEMY_ATTACKS[element as "fire" | "water" | "nature"]);
    const warnNext = (this.enemyTurnCount + 1) % SIGNATURE_EVERY === 0;

    this.time.delayedCall(TURN_BANNER_MS, () => {
      if (this.turn !== "enemy") return;
      this.showCharge(`${this.enemyDef.name} is charging ${attack.name}`);
      this.effects.chargeGlowOn(this.enemyShape, ELEMENT_COLOR[element]);
      this.time.delayedCall(CHARGE_MS, () => {
        if (this.turn !== "enemy") return;
        this.hideCharge();
        this.effects.chargeGlowOff(this.enemyShape);
        if (warnNext) this.showSignatureWarning();
        this.enemyAttack(attack, element);
      });
    });
  }

  /* --------------------------------------------------------------------- */
  /* Signature moves + status effects                                       */
  /* --------------------------------------------------------------------- */

  private showSignatureWarning(): void {
    this.warnText?.destroy();
    this.warnText = this.add
      .text(this.scale.width / 2, 96, `⚠ ${this.enemyDef.name} will use ${this.enemyDef.signatureName} next turn!`, {
        fontFamily: "monospace",
        fontSize: "17px",
        fontStyle: "bold",
        color: "#14121f",
        backgroundColor: "#ffb84a",
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(62);
  }

  private performSignature(): void {
    if (this.turn !== "enemy") return;
    const def = this.enemyDef;
    this.warnText?.destroy();
    this.warnText = undefined;
    this.announceTurn(def.signatureName.toUpperCase(), "#ff6bd6");
    this.effects.chargeGlowOn(this.enemyShape, ELEMENT_COLOR[this.enemyElement()]);
    this.time.delayedCall(700, () => this.effects.chargeGlowOff(this.enemyShape));
    sharedSound.crit();

    switch (def.signature) {
      case "burn":
        this.playerBurn = BURN_TURNS;
        this.castLine.setText(`${def.name} uses Burn! (${BURN_DMG}/turn × ${BURN_TURNS})`);
        break;
      case "tide":
        this.enemyShield = true;
        this.castLine.setText(`${def.name} raises Tide Shield!`);
        break;
      case "root": {
        const spell = Phaser.Utils.Array.GetRandom(PLAYER_SPELLS) as Spell;
        this.sealedSpell = spell.name;
        this.castLine.setText(`${def.name} uses Root! ${spell.name} sealed.`);
        break;
      }
      case "cataclysm":
        this.cataclysmCountdown = CATACLYSM_CHARGE;
        this.ensureCataclysmLabel();
        this.updateCataclysmLabel();
        this.castLine.setText(`${def.name} begins Cataclysm!`);
        break;
    }

    this.time.delayedCall(RESOLVE_BEAT_MS + 700, () => this.startPlayerTurn());
  }

  private advanceCataclysm(): void {
    if (this.turn !== "enemy") return;
    this.cataclysmCountdown -= 1;
    this.updateCataclysmLabel();
    if (this.cataclysmCountdown <= 0) {
      this.cataclysmLabel?.destroy();
      this.cataclysmLabel = undefined;
      this.announceTurn("CATACLYSM!", "#ff6bd6");
      this.castLine.setText(`${this.enemyDef.name} unleashes Cataclysm!`);
      this.effects.screenFlash(255, 150, 255);
      this.time.delayedCall(600, () => this.enemyStrike(CATACLYSM_DMG, this.enemyElement()));
    } else {
      this.banner.setText(`Cataclysm in ${this.cataclysmCountdown}…`);
      this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startPlayerTurn());
    }
  }

  private ensureCataclysmLabel(): void {
    if (this.cataclysmLabel) return;
    this.cataclysmLabel = this.add
      .text(this.enemyBaseX, 100, "", { fontFamily: "monospace", fontSize: "18px", fontStyle: "bold", color: "#ff6bd6" })
      .setOrigin(0.5)
      .setDepth(62);
  }

  private updateCataclysmLabel(): void {
    this.cataclysmLabel?.setText(`☄ CATACLYSM ${Math.max(0, this.cataclysmCountdown)}`);
  }

  private clearSeal(): void {
    this.sealedSpell = null;
    this.applySealVisual();
  }

  /** Reflect the sealed spell on the cards (chain icon + dimmed). */
  private applySealVisual(): void {
    for (const [name, c] of this.cards) {
      const sealed = name === this.sealedSpell;
      c.chain.setVisible(sealed);
      c.bg.setAlpha(sealed ? 0.35 : 1);
    }
  }

  /** Tide Shield: returns true if this hit is blocked (consumes the shield). */
  private shieldBlocks(superEffective: boolean): boolean {
    if (!this.enemyShield) return false;
    this.enemyShield = false;
    return !superEffective;
  }

  private showBlocked(): void {
    const t = this.add
      .text(this.enemyPos.x, this.enemyPos.y - 120, "BLOCKED", {
        fontFamily: "monospace",
        fontSize: "22px",
        fontStyle: "bold",
        color: "#4aa8ff",
      })
      .setOrigin(0.5)
      .setDepth(72);
    this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  /** A generic enemy strike (used by normal attacks and Cataclysm). */
  private enemyStrike(dmg: number, element: Element, effMult?: number): void {
    const lethal = this.playerHp - dmg <= 0;
    this.anim.attack(this.enemyView, () => {
      if (lethal) this.anim.setSlowMo(0.4);
      sharedSound.whoosh(element);
      this.effects.launchProjectile(element, this.enemyPos, this.playerPos, PROJECTILE_MS, () => {
        this.playerHp = Math.max(0, this.playerHp - dmg);
        this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, true);
        this.effects.cameraHit(dmg);
        sharedSound.impact(dmg);
        if (effMult !== undefined) this.showEffectiveness(effMult, this.playerPos.x, this.playerPos.y - 120);

        if (this.playerHp <= 0) {
          this.anim.hit(this.playerView, dmg, {
            resumeIdle: false,
            onComplete: () => {
              this.anim.setSlowMo(1);
              this.anim.defeat(this.playerView, this.enemyView, () => this.showResult(false));
            },
          });
          return;
        }
        this.anim.hit(this.playerView, dmg);
        this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startPlayerTurn());
      });
    });
  }

  private enemyAttack(attack: Spell, element: Element): void {
    this.castLine.setText(`${this.enemyDef.name} cast ${attack.name}`);
    const mult = typeMultiplier(element, this.chosenCreature.element);
    const dmg = Math.max(1, Math.round(attack.damage * GAUNTLET_DMG[this.enemyIndex] * mult));
    this.enemyStrike(dmg, element, mult);
  }

  /** "SUPER EFFECTIVE" / "RESISTED" pop-up over the target (nothing at ×1). */
  private showEffectiveness(mult: number, x: number, y: number): void {
    if (mult === 1) return;
    const sup = mult > 1;
    const label = this.add
      .text(x, y, sup ? "SUPER EFFECTIVE" : "RESISTED", {
        fontFamily: "monospace",
        fontSize: sup ? "26px" : "20px",
        fontStyle: "bold",
        color: sup ? "#ffd36b" : "#9a92c7",
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScale(0.4);
    this.tweens.add({ targets: label, scale: 1, duration: 170, ease: "Back.easeOut" });
    this.tweens.add({ targets: label, y: y - 44, alpha: 0, delay: 520, duration: 480, onComplete: () => label.destroy() });
  }

  /* --------------------------------------------------------------------- */
  /* Feedback: banners, charge telegraph, projectiles, damage numbers       */
  /* --------------------------------------------------------------------- */

  /** Flash a big centered turn banner that scales in and fades out. */
  private announceTurn(text: string, color: string): void {
    this.tweens.killTweensOf(this.turnBanner);
    this.turnBanner.setText(text).setColor(color).setAlpha(1).setScale(1.4);
    this.tweens.add({ targets: this.turnBanner, scale: 1, duration: 220, ease: "Back.easeOut" });
    this.tweens.add({
      targets: this.turnBanner,
      alpha: 0,
      delay: TURN_BANNER_MS - 250,
      duration: 250,
    });
  }

  private showCharge(text: string): void {
    this.tweens.killTweensOf(this.chargeText);
    this.chargeText.setText(text).setAlpha(1);
    // Gentle pulse while charging.
    this.tweens.add({
      targets: this.chargeText,
      scale: { from: 1, to: 1.08 },
      duration: 320,
      yoyo: true,
      repeat: -1,
    });
  }

  private hideCharge(): void {
    this.tweens.killTweensOf(this.chargeText);
    this.chargeText.setAlpha(0).setScale(1);
  }

  /* --------------------------------------------------------------------- */
  /* Debug panel (?debug)                                                   */
  /* --------------------------------------------------------------------- */

  private createDebugPanel(): void {
    const w = 320;
    const h = 150;
    const bg = this.add.rectangle(0, 0, w, h, 0x000000, 0.75).setOrigin(0, 0).setStrokeStyle(1, 0x7c6cff);
    const title = this.add.text(10, 8, "DEBUG · matcher", {
      fontFamily: "monospace",
      fontSize: "13px",
      fontStyle: "bold",
      color: "#b79cff",
    });
    this.debugBody = this.add.text(10, 30, "raw: —", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#e9e4ff",
      lineSpacing: 4,
    });
    this.add.container(12, 84, [bg, title, this.debugBody]).setDepth(90);
  }

  /** Show the raw transcript and the top three matches with their scores. */
  private updateDebug(heard: string): void {
    if (!this.debugEnabled || !this.debugBody) return;

    const query = tailWords(heard, 4);
    const top3 = this.matcher.rank(query).slice(0, 3);
    const rows = top3.map((m, i) => {
      const pass = m.confidence >= CAST_THRESHOLD ? " ✓" : "";
      return `${i + 1}. ${m.phrase.padEnd(14)} ${m.confidence.toFixed(3)}${pass}`;
    });

    this.debugBody.setText([`raw: "${heard || "—"}"`, "", ...rows].join("\n"));
  }

  /* --------------------------------------------------------------------- */
  /* Result screen + voice rematch                                          */
  /* --------------------------------------------------------------------- */

  private showResult(won: boolean): void {
    // Keep the mic running so "rematch" can be heard — do NOT stop the voice.
    this.turn = "result";
    this.banner.setText("");
    this.heardLine.setText("Heard: —");
    if (won) sharedSound.victory();
    else sharedSound.defeat();

    const { width, height } = this.scale;
    const cx = width / 2;
    const subtitle = won
      ? "Gauntlet cleared!"
      : `Enemies beaten: ${this.defeatedCount} / ${this.gauntlet.length}`;
    const text = (y: number, s: string, size: number, color: string, bold = false) =>
      this.add
        .text(cx, y, s, {
          fontFamily: "monospace",
          fontSize: `${size}px`,
          color,
          fontStyle: bold ? "bold" : "normal",
          align: "center",
        })
        .setOrigin(0.5);

    const dim = this.add.rectangle(0, 0, width, height, 0x000000, 0.82).setOrigin(0, 0);
    const heading = text(height / 2 - 120, won ? "VICTORY" : "DEFEAT", 76, won ? "#58e39b" : "#ff6b4a", true);
    const winLine = text(height / 2 - 52, subtitle, 22, "#e9e4ff");
    const turnsLine = text(height / 2 - 14, `Turns taken: ${this.turnsTaken}`, 18, "#9a92c7");
    const hitLine = text(
      height / 2 + 16,
      this.strongestHit
        ? `Strongest hit: ${this.strongestHit.name} (-${this.strongestHit.damage})`
        : "Strongest hit: —",
      18,
      "#9a92c7",
    );
    this.rematchPrompt = text(height / 2 + 86, 'Say "REMATCH" to play again', 24, "#b79cff", true);
    this.resultHeard = text(height / 2 + 128, "Heard: —", 16, "#9a92c7");

    this.resultLayer = this.add
      .container(0, 0, [dim, heading, winLine, turnsLine, hitLine, this.rematchPrompt, this.resultHeard])
      .setDepth(100);

    // Pulse the prompt so it's clearly the live call to action.
    this.tweens.add({
      targets: this.rematchPrompt,
      alpha: { from: 1, to: 0.45 },
      duration: 650,
      yoyo: true,
      repeat: -1,
    });
  }

  private rematch(): void {
    if (this.rematchPrompt) this.tweens.killTweensOf(this.rematchPrompt);
    this.resultLayer?.destroy(true);
    this.resultLayer = undefined;
    this.rematchPrompt = undefined;
    this.resultHeard = undefined;

    this.turn = "idle";
    this.playerHp = PLAYER.maxHp;
    this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, false);

    this.turnsTaken = 0;
    this.defeatedCount = 0;
    this.strongestHit = null;
    this.ultInput = false;
    this.ultTimer?.remove();
    this.ultTimer = undefined;
    this.ultCharge = 0;
    this.updateUltMeter();
    this.pendingTimer?.remove();
    this.pendingTimer = undefined;
    this.pendingSpell = undefined;
    this.comboBonus = COMBO_BONUS;
    this.furyMult = {};
    this.rewardLayer?.destroy(true);
    this.rewardLayer = undefined;
    this.rewardMatcher = undefined;
    this.clearStatusLines();

    // Restore the player from any defeat state (grey/toppled/faded).
    this.anim.reset(this.playerView);

    // Fresh gauntlet order, back to the first challenger (spawnEnemy clears the
    // current enemy sprite).
    this.gauntlet = [...Phaser.Utils.Array.Shuffle([...GAUNTLET_MIDS]), BOSS];
    this.createProgressIcons();
    this.spawnEnemy(0, false);
  }
}

/** Keep only the last n whitespace-separated words of a string. */
function tailWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}
