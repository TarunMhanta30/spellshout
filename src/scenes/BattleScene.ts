import Phaser from "phaser";
import { inputRouter } from "@voice/InputRouter";
import { Matcher } from "@matcher/Matcher";
import { heardCommand, matchCommand } from "@matcher/command";
import { detectSpellNames } from "@matcher/detectSpells";
import { AnimationsModule, type CreatureView } from "@animations/AnimationsModule";
import { EffectsModule } from "@effects/EffectsModule";
import { placeCreature, GROUND_Y, CREATURE_H } from "@sprites/creatureSprite";
import { scoreUltimate } from "@data/ultimate";
import { sharedAudio } from "@audio/sharedAudio";
import { sharedSound } from "@audio/sharedSound";
import { handleGlobalVoice } from "@voice/globalVoice";
import { powerMultiplier, gaugeFill, GAUGE_TOP_RATIO, type PowerResult } from "@data/power";
import {
  PLAYER_SPELLS,
  ELEMENT_COLOR,
  ELEMENT_BONUS,
  CREATURES,
  GAUNTLET_MIDS,
  BOSS,
  ENEMY_ATTACKS,
  SHIFT_ELEMENTS,
  MEGA_UNLOCK_AT,
  HEAL_UNLOCK_AT,
  HEAL_FRACTION_OF_MAX,
  typeMultiplier,
  type Spell,
  type Creature,
  type EnemyDef,
  type Signature,
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
/** After the first spell is heard, wait this long for a second (combo). */
const COMBO_WAIT_MS = 700;

/** HP per party creature. */
const CREATURE_MAX_HP = 80;

interface PartyMember {
  creature: Creature;
  hp: number;
  maxHp: number;
  fainted: boolean;
  /** Normal attacks this creature has landed toward unlocking its mega / heal.
   *  Each resets to 0 when its own spell is cast ("locks again after use"). */
  megaUsed: number;
  healUsed: number;
}

/** Shout Power gauge geometry (vertical bar beside the player). */
const GAUGE_X = 38;
const GAUGE_BOTTOM = 410;
const GAUGE_H = 232;
const GAUGE_W = 18;

type Turn = "idle" | "player" | "enemy" | "result" | "reward" | "faint";

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
  private matcher = new Matcher(
    PLAYER_SPELLS.map((s) => s.name),
    { threshold: CAST_THRESHOLD },
  );
  private spellNames: string[] = PLAYER_SPELLS.map((s) => s.name);
  // Control vocabulary tolerates common mishearings and embedded phrasings.
  private readonly rematchMatcher = new Matcher(
    ["rematch", "re match", "play again", "again"],
    { threshold: 0.6 },
  );

  private turn: Turn = "idle";
  private castThisTurn = false;
  // Spells heard this window accumulate; a lone one casts after COMBO_WAIT_MS,
  // two cast as a combo.
  private pendingSpells: Spell[] = [];
  private pendingTimer?: Phaser.Time.TimerEvent;
  /** The creature chosen on the select screen — starts active. */
  private startCreature: Creature = CREATURES[0];
  /** The party: all four creatures, each with its own HP. */
  private party: PartyMember[] = [];
  private activeIndex = 0;
  private playerShadow?: Phaser.GameObjects.Ellipse;
  private playerGuard = false;
  private portraits: { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle; icon: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }[] = [];

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

  // UI refs. Each card is a container so it can be dimmed independently (locked
  // mega/heal, or a spell sealed by Root).
  private readonly cards = new Map<
    string,
    { card: Phaser.GameObjects.Container; chain: Phaser.GameObjects.Text; locked: boolean }
  >();
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
  // Score components.
  private scoreDamage = 0;
  private scoreCrits = 0;
  private scoreSuperEff = 0;
  private wisprCasts = 0;
  private runStartTime = 0;
  private wisprCountText?: Phaser.GameObjects.Text;

  private resultLayer?: Phaser.GameObjects.Container;
  private rematchPrompt?: Phaser.GameObjects.Text;
  private resultHeard?: Phaser.GameObjects.Text;
  /** Loose objects from the victory cinematic (jumping party, NEW BEST pop),
   *  cleared on rematch so they don't linger into the next run. */
  private victoryExtras: Phaser.GameObjects.GameObject[] = [];

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
    if (data?.creature) this.startCreature = data.creature;
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

    // Build the party; the chosen creature starts active, the rest wait.
    this.party = CREATURES.map((c) => ({
      creature: c,
      hp: CREATURE_MAX_HP,
      maxHp: CREATURE_MAX_HP,
      fainted: false,
      megaUsed: 0,
      healUsed: 0,
    }));
    this.activeIndex = Math.max(0, CREATURES.findIndex((c) => c.name === this.startCreature.name));

    this.playerBaseX = 235;
    this.playerPos = { x: this.playerBaseX, y: centerY };
    const player = placeCreature(this, { key: this.activeCreature().textureKey, x: this.playerBaseX, side: "player" });
    this.playerShape = player.image;
    this.playerShadow = player.shadow;
    this.playerView = this.anim.register(this.playerShape, 1, 0, 1);
    this.anim.startIdle(this.playerView);

    this.enemyBaseX = width - 235;
    this.enemyPos = { x: this.enemyBaseX, y: centerY };

    // Gauntlet order: the three mid enemies shuffled, then the boss last.
    this.gauntlet = [...Phaser.Utils.Array.Shuffle([...GAUNTLET_MIDS]), BOSS];
    this.createProgressIcons();

    // HP bars (the enemy's name/HP are filled in as each challenger spawns).
    this.playerBar = this.createHpBar(50, 48, 340, this.activeCreature().name, "left");
    this.enemyBar = this.createHpBar(width - 50 - 340, 48, 340, "", "right");
    this.updatePlayerHpBar(false);
    // The card layer must exist before setActiveSpells() → createSpellCards() uses it.
    this.cardLayer = this.add.container(0, 0);
    this.setActiveSpells();
    this.createPortraits();

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
    // Full-height fill anchored at the bottom; scaleY fills it from the bottom up.
    this.powerFill = this.add
      .rectangle(GAUGE_X + 1, GAUGE_BOTTOM - 1, GAUGE_W - 2, GAUGE_H - 2, 0x58e39b)
      .setOrigin(0, 1)
      .setScale(1, 0);
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

    // Status text — below the progress icons (top) and HP bars so nothing overlaps.
    this.banner = this.add
      .text(width / 2, 82, "", { fontFamily: "monospace", fontSize: "22px", color: "#e9e4ff" })
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
      // Live count of words Wispr Flow typed this run. Sits below the enemy HP
      // bar so it never overlaps the enemy's name (which is up at y≈28).
      this.wisprCountText = this.add
        .text(width - 8, 74, "Wispr words: 0", { fontFamily: "monospace", fontSize: "12px", color: "#b79cff" })
        .setOrigin(1, 0)
        .setDepth(80);
    }

    // Score / run timing (reset per fresh battle).
    this.runStartTime = this.time.now;
    this.scoreDamage = 0;
    this.scoreCrits = 0;
    this.scoreSuperEff = 0;
    this.wisprCasts = 0;
    inputRouter.resetWisprWords();

    // Dark translucent panel for the heard / last-cast lines. Placed BEHIND the
    // creatures (negative depth) so it never covers them; the text sits above
    // them (depth 6) and stays legible in the gap between the combatants.
    this.add
      .rectangle(width / 2, 348, 520, 60, 0x000000, 0.55)
      .setStrokeStyle(1, 0x3a3550)
      .setOrigin(0.5)
      .setDepth(-3);
    this.heardLine = this.add
      .text(width / 2, 326, "Heard: —", { fontFamily: "monospace", fontSize: "17px", color: "#9a92c7" })
      .setOrigin(0.5, 0)
      .setDepth(6);
    this.castLine = this.add
      .text(width / 2, 352, "Last cast: —", { fontFamily: "monospace", fontSize: "17px", color: "#d7e358" })
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
    this.powerFill.scaleY = Math.max(0, Math.min(1, fill));
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
  /* Score                                                                  */
  /* --------------------------------------------------------------------- */

  private recordHit(dmg: number, crit: boolean, superEff: boolean): void {
    this.scoreDamage += dmg;
    if (crit) this.scoreCrits += 1;
    if (superEff) this.scoreSuperEff += 1;
  }

  private countCast(): void {
    if (inputRouter.getMode() === "wispr") this.wisprCasts += 1;
  }

  /** Score from damage, crits, super-effective hits, enemies beaten and time. */
  private computeScore(): number {
    const elapsed = (this.time.now - this.runStartTime) / 1000;
    const timeBonus = Math.max(0, Math.round(480 - elapsed)) * 3;
    const score = this.scoreDamage + this.scoreCrits * 100 + this.scoreSuperEff * 50 + this.defeatedCount * 500 + timeBonus;
    return Math.max(0, Math.round(score));
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

  /** All six of the active creature's spells as cards that fit the screen in one
   *  row (four normals, then mega and heal). Locked mega/heal cards are dimmed
   *  and show "unlocks in N". */
  private createSpellCards(): void {
    if (!this.cardLayer) return;
    this.cardLayer.removeAll(true);
    this.cards.clear();
    const { width } = this.scale;
    const spells = this.activeCreature().spells;
    const cardW = 148;
    const cardH = 86;
    const gap = 8;
    const totalW = spells.length * cardW + (spells.length - 1) * gap;
    const startX = width / 2 - totalW / 2;
    const cy = 474; // below the heard/cast panel, above the bottom edge

    spells.forEach((spell, i) => {
      const cx = startX + i * (cardW + gap) + cardW / 2;
      const boosted = this.isBoosted(spell);
      const locked = this.spellLocked(spell);
      const accent = spell.kind === "mega" ? 0xffd36b : spell.kind === "heal" ? 0x58e39b : ELEMENT_COLOR[spell.element];

      const bg = this.add
        .rectangle(0, 0, cardW, cardH, 0x1e1b2e)
        .setStrokeStyle(boosted || spell.kind !== "normal" ? 3 : 2, boosted ? ELEMENT_COLOR[spell.element] : accent);
      const dot = this.add.circle(-cardW / 2 + 14, -cardH / 2 + 14, 6, ELEMENT_COLOR[spell.element]);
      const tag =
        spell.kind === "mega" ? "MEGA" : spell.kind === "heal" ? "HEAL" : boosted ? "+25%" : "";
      const tagText = this.add
        .text(cardW / 2 - 8, -cardH / 2 + 10, tag, {
          fontFamily: "monospace",
          fontSize: "10px",
          fontStyle: "bold",
          color: spell.kind === "mega" ? "#ffd36b" : spell.kind === "heal" ? "#58e39b" : "#ffd36b",
        })
        .setOrigin(1, 0.5);
      const name = this.add
        .text(0, -6, spell.name, {
          fontFamily: "monospace",
          fontSize: "15px",
          fontStyle: "bold",
          color: "#e9e4ff",
          align: "center",
          wordWrap: { width: cardW - 16 },
        })
        .setOrigin(0.5);
      const meta = this.add
        .text(0, cardH / 2 - 14, this.cardMeta(spell), {
          fontFamily: "monospace",
          fontSize: "12px",
          color: boosted ? "#ffd36b" : "#9a92c7",
        })
        .setOrigin(0.5);
      // "unlocks in N" line for a locked mega/heal (hidden otherwise).
      const lockText = this.add
        .text(0, cardH / 2 - 14, `unlocks in ${this.unlockRemaining(spell)}`, {
          fontFamily: "monospace",
          fontSize: "12px",
          fontStyle: "bold",
          color: "#ff9e6b",
        })
        .setOrigin(0.5)
        .setVisible(locked);
      meta.setVisible(!locked);
      // Chain overlay shown when sealed by Blightroot's Root.
      const chain = this.add
        .text(0, 0, "⛓", { fontFamily: "monospace", fontSize: "34px", color: "#ffffff" })
        .setOrigin(0.5)
        .setVisible(false);

      const card = this.add.container(cx, cy, [bg, dot, tagText, name, meta, lockText, chain]);
      this.cardLayer.add(card);
      this.cards.set(spell.name, { card, chain, locked });
    });
    this.updateCardStates();
  }

  /** Card footer text: heal fraction, mega flat damage, or normal damage. */
  private cardMeta(spell: Spell): string {
    if (spell.kind === "heal") return `heal ${Math.round(HEAL_FRACTION_OF_MAX * 100)}%`;
    if (spell.kind === "mega") return `${spell.damage} dmg`;
    const dmg = this.effectiveDamage(spell);
    return this.isBoosted(spell) ? `${dmg} dmg +25%` : `${dmg} dmg`;
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

  /* --------------------------------------------------------------------- */
  /* Party                                                                  */
  /* --------------------------------------------------------------------- */

  private active(): PartyMember {
    return this.party[this.activeIndex];
  }

  private activeCreature(): Creature {
    return this.active().creature;
  }

  private updatePlayerHpBar(animate: boolean): void {
    this.playerBar.nameLabel.setText(this.activeCreature().name);
    this.updateHpBar(this.playerBar, this.active().hp, this.active().maxHp, animate);
  }

  private refreshPlayerHp(animate: boolean): void {
    this.updatePlayerHpBar(animate);
    this.updatePortraits();
  }

  /** Point the matcher/cards at the active creature's two spells. */
  private setActiveSpells(): void {
    this.spellNames = this.activeCreature().spells.map((s) => s.name);
    this.matcher = new Matcher(this.spellNames, { threshold: CAST_THRESHOLD });
    this.createSpellCards();
  }

  private createPortraits(): void {
    this.portraits.forEach((p) => {
      p.bg.destroy();
      p.fill.destroy();
      p.icon.destroy();
      p.label.destroy();
    });
    this.portraits = [];
    this.party.forEach((m, i) => {
      const x = 56 + i * 72;
      const icon = this.add.circle(x, 98, 11, ELEMENT_COLOR[m.creature.element]).setStrokeStyle(2, 0x14121f);
      const label = this.add
        .text(x, 98, m.creature.name[0], { fontFamily: "monospace", fontSize: "12px", fontStyle: "bold", color: "#14121f" })
        .setOrigin(0.5);
      const bg = this.add.rectangle(x - 22, 116, 44, 6, 0x0f0d18).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a3550);
      const fill = this.add.rectangle(x - 21, 116, 42, 4, 0x58e39b).setOrigin(0, 0.5);
      this.portraits.push({ bg, fill, icon, label });
    });
    this.updatePortraits();
  }

  private updatePortraits(): void {
    this.party.forEach((m, i) => {
      const p = this.portraits[i];
      if (!p) return;
      const frac = Math.max(0, m.hp) / m.maxHp;
      p.fill.width = 42 * frac;
      p.fill.setFillStyle(frac > 0.3 ? 0x58e39b : 0xff6b4a);
      const activeOne = i === this.activeIndex && !m.fainted;
      p.icon.setStrokeStyle(activeOne ? 3 : 2, activeOne ? 0xffd36b : 0x14121f);
      const alpha = m.fainted ? 0.35 : 1;
      p.icon.setAlpha(alpha);
      p.label.setAlpha(alpha);
      p.bg.setAlpha(alpha);
      p.fill.setAlpha(alpha);
    });
  }

  /** Switch the active creature: new sprite, HP bar, spells and cards. */
  private switchTo(index: number, fromFaint: boolean): void {
    this.activeIndex = index;
    this.playerGuard = false;

    this.anim.stopIdle(this.playerView);
    this.playerShape.destroy();
    this.playerShadow?.destroy();
    const spawned = placeCreature(this, { key: this.activeCreature().textureKey, x: this.playerBaseX, side: "player" });
    this.playerShape = spawned.image;
    this.playerShadow = spawned.shadow;
    this.playerView = this.anim.register(this.playerShape, 1, 0, 1);
    this.anim.startIdle(this.playerView);

    this.setActiveSpells();
    this.clearSeal(); // switching escapes Root
    this.refreshPlayerHp(false);
    sharedSound.blip(620);

    if (fromFaint) {
      this.startPlayerTurn();
    } else {
      // A voluntary switch uses the turn.
      this.turn = "idle";
      this.castLine.setText(`Switched to ${this.activeCreature().name}`);
      this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
    }
  }

  /** Guard uses the turn and halves the next incoming hit. */
  private guard(): void {
    this.playerGuard = true;
    this.castThisTurn = true;
    this.turn = "idle";
    this.announceTurn("GUARD", "#4aa8ff");
    this.castLine.setText(`${this.activeCreature().name} guards`);
    sharedSound.blip(500);
    this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
  }

  /** The active creature fainted: forced free switch, or run over. */
  private handleFaint(): void {
    this.active().fainted = true;
    this.updatePortraits();
    const alive = this.party.filter((m) => !m.fainted);
    if (alive.length === 0) {
      this.showResult(false);
      return;
    }
    this.turn = "faint";
    this.setCardsEnabled(false);
    const names = alive.map((m) => m.creature.name).join(", ");
    this.banner.setText(`${this.activeCreature().name} fainted — say a name: ${names}`);
    this.announceTurn("FAINTED", "#ff6b4a");
  }

  /** Handle player-turn voice commands (guard / switch). Returns true if used. */
  private handlePlayerCommand(text: string): boolean {
    if (heardCommand(new Matcher(["guard", "defend", "block"], { threshold: 0.6 }), text)) {
      this.guard();
      return true;
    }
    // "switch to <name>" — needs a switch word plus a reserve creature's name.
    if (heardCommand(new Matcher(["switch", "swap", "change"], { threshold: 0.6 }), text)) {
      const idx = this.reserveIndexFrom(text);
      if (idx >= 0) {
        this.switchTo(idx, false);
        return true;
      }
    }
    return false;
  }

  /** Index of a non-active, non-fainted party creature named in the text. */
  private reserveIndexFrom(text: string): number {
    const names = this.party.map((m) => m.creature.name);
    const m = matchCommand(new Matcher(names, { threshold: 0.6 }), text);
    if (!m) return -1;
    const idx = this.party.findIndex((p) => p.creature.name === m.phrase);
    if (idx < 0 || idx === this.activeIndex || this.party[idx].fainted) return -1;
    return idx;
  }

  /** Whether this spell gets the active creature's +25% bonus. Only normal
   *  attacks are boosted; shadow is neutral, so Ghost never boosts. */
  private isBoosted(spell: Spell): boolean {
    return (
      spell.kind === "normal" &&
      spell.element === this.activeCreature().element &&
      this.activeCreature().element !== "shadow"
    );
  }

  /** Normal attacks are always castable; mega/heal only once unlocked. */
  private spellLocked(spell: Spell): boolean {
    if (spell.kind === "mega") return this.active().megaUsed < MEGA_UNLOCK_AT;
    if (spell.kind === "heal") return this.active().healUsed < HEAL_UNLOCK_AT;
    return false;
  }

  /** Normal attacks still needed before a locked mega/heal unlocks. */
  private unlockRemaining(spell: Spell): number {
    if (spell.kind === "mega") return Math.max(0, MEGA_UNLOCK_AT - this.active().megaUsed);
    if (spell.kind === "heal") return Math.max(0, HEAL_UNLOCK_AT - this.active().healUsed);
    return 0;
  }

  /** Count normal attacks toward both unlock meters (combo counts as two). */
  private registerNormalUse(n: number): void {
    const m = this.active();
    m.megaUsed = Math.min(MEGA_UNLOCK_AT, m.megaUsed + n);
    m.healUsed = Math.min(HEAL_UNLOCK_AT, m.healUsed + n);
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
      this.party.forEach((m) => {
        if (!m.fainted) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * HEAL_FRACTION));
      });
      this.refreshPlayerHp(true);
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
    if (handleGlobalVoice(text)) return;

    // Debug panel updates on every phrase, even when input is being ignored.
    this.updateDebug(text);
    this.wisprCountText?.setText(`Wispr words: ${inputRouter.getWisprWords()}`);

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

    // After a faint: say a reserve creature's name to send it out (free).
    if (this.turn === "faint") {
      this.heardLine.setText(`Heard: ${text ? `“${text}”` : "—"}`);
      const idx = this.reserveIndexFrom(text);
      if (idx >= 0) this.switchTo(idx, true);
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

    // Guard or switch (each uses the turn).
    if (!this.castThisTurn && this.handlePlayerCommand(text)) return;

    // Cast only from a committed phrase, once per turn — so one utterance can't
    // cast twice and a stale transcript can't re-trigger.
    if (this.castThisTurn || !canCast || !text) return;

    const detected = this.detectSpells(text);
    if (detected.length === 0) return;

    // Mega and heal never combo: if one is heard and unlocked, cast it at once.
    // (A locked one is ignored — its card shows "unlocks in N".)
    const mega = detected.find((s) => s.kind === "mega");
    if (mega && !this.spellLocked(mega)) {
      this.playerCast(mega);
      return;
    }
    const heal = detected.find((s) => s.kind === "heal");
    if (heal && !this.spellLocked(heal)) {
      this.playerCast(heal);
      return;
    }

    // Accumulate distinct normal attacks heard this window (so two names arriving
    // in separate Chrome interim segments still form a combo). Combos only ever
    // chain normal attacks.
    for (const s of detected) {
      if (s.kind === "normal" && !this.pendingSpells.some((p) => p.name === s.name)) this.pendingSpells.push(s);
    }
    if (this.pendingSpells.length === 0) return;

    if (this.pendingSpells.length >= 2) {
      this.pendingTimer?.remove();
      this.pendingTimer = undefined;
      const [a, b] = this.pendingSpells;
      this.pendingSpells = [];
      this.comboCast(a, b);
    } else if (!this.pendingTimer) {
      // One so far — wait COMBO_WAIT_MS for a second name before casting it.
      this.pendingTimer = this.time.delayedCall(COMBO_WAIT_MS, () => this.commitPending());
    }
  }

  private commitPending(): void {
    this.pendingTimer = undefined;
    const spells = this.pendingSpells;
    this.pendingSpells = [];
    if (this.castThisTurn || this.turn !== "player" || this.ultInput || spells.length === 0) return;
    if (spells.length >= 2) this.comboCast(spells[0], spells[1]);
    else this.playerCast(spells[0]);
  }

  /** Distinct spells found in the text (scans 2–3 word windows via the shared
   *  detector), excluding any spell sealed by Root. */
  private detectSpells(text: string): Spell[] {
    const names = detectSpellNames(this.matcher, this.spellNames, text, this.sealedSpell);
    return names.map((n) => PLAYER_SPELLS.find((s) => s.name === n)).filter((s): s is Spell => !!s);
  }

  /** Spell damage after creature/Fury base and the elemental type multiplier. */
  private spellDamage(spell: Spell): number {
    return Math.max(1, Math.round(this.spellBase(spell) * typeMultiplier(spell.element, this.enemyElement())));
  }

  /** Cast two normal attacks at once: combined damage × COMBO_BONUS, with a
   *  banner. Both count toward the mega / heal unlocks. */
  private comboCast(a: Spell, b: Spell): void {
    this.castThisTurn = true;
    this.countCast();
    this.turn = "idle";
    this.banner.setText("");
    this.pendingSpells = [];
    this.registerNormalUse(2);

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
            this.recordHit(dmg, power.crit, superEff);
            this.addUltCharge(ULT_CHARGE_PER_HIT);

            if (lethal) {
              this.defeatedCount += 1;
              this.anim.hit(this.enemyView, dmg, {
                resumeIdle: false,
                onComplete: () => {
                  this.resolveEnemyDefeat();
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
    this.countCast();
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
            this.recordHit(dmg, false, false);

            if (lethal) {
              this.defeatedCount += 1;
              this.anim.hit(this.enemyView, dmg, {
                resumeIdle: false,
                onComplete: () => {
                  this.resolveEnemyDefeat();
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
    this.pendingSpells = [];
    this.peakLoudness = 0; // peak is per utterance / since last cast
    this.turnStartTime = this.time.now; // for Quick Cast
    this.heardLine.setText("Heard: —");
    // Rebuild the cards so lock state and "unlocks in N" reflect this creature's
    // current counters, then apply seal/lock dimming.
    this.createSpellCards();

    // Burn ticks at the start of each of the player's turns (water is immune,
    // so switching to a water creature clears it).
    if (this.playerBurn > 0) {
      if (this.activeCreature().element === "water") {
        this.playerBurn = 0;
      } else {
        this.playerBurn -= 1;
        this.active().hp = Math.max(0, this.active().hp - BURN_DMG);
        this.refreshPlayerHp(true);
        this.anim.floatingDamage(this.playerPos.x, this.playerPos.y - 90, BURN_DMG);
        sharedSound.impact(BURN_DMG);
        if (this.active().hp <= 0) {
          this.handleFaint();
          return;
        }
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

  /** A player cast: a heal mends the active creature; everything else damages
   *  the enemy. A mega resets this creature's mega meter; a landed normal
   *  attack advances both meters toward their unlocks. */
  private playerCast(spell: Spell): void {
    this.castThisTurn = true;
    this.countCast();
    this.turn = "idle";
    this.banner.setText("");

    if (spell.kind === "heal") {
      this.castHeal();
      return;
    }

    const isMega = spell.kind === "mega";
    if (isMega) this.active().megaUsed = 0; // locks again after use
    else this.registerNormalUse(1);

    // Creature +25% + Fury, type multiplier, Shout Power, then Quick Cast.
    const mult = typeMultiplier(spell.element, this.enemyElement());
    const power = this.shoutPower();
    const quick = this.quickBonus();
    const dmg = Math.max(1, Math.round(this.spellBase(spell) * mult * power.mult * quick));
    this.castLine.setText(`${isMega ? "MEGA! " : "You cast "}${spell.name}  ×${power.mult}`);

    if (!this.strongestHit || dmg > this.strongestHit.damage) {
      this.strongestHit = { name: spell.name, damage: dmg };
    }

    const superEff = mult === 2;
    const lethal = this.enemyHp - dmg <= 0;

    this.anim.attack(this.playerView, () => {
      if (lethal) this.anim.setSlowMo(0.4); // the killing blow lands in slow motion
      sharedSound.whoosh(spell.element);
      if (isMega) {
        sharedSound.megaBoom();
        this.effects.screenFlash(255, 236, 150);
      }
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
        this.recordHit(dmg, power.crit, superEff);
        this.addUltCharge(ULT_CHARGE_PER_HIT); // landing a hit charges the ultimate

        if (lethal) {
          this.defeatedCount += 1;
          this.anim.hit(this.enemyView, dmg, {
            resumeIdle: false,
            onComplete: () => {
              this.resolveEnemyDefeat();
            },
          });
          return;
        }
        this.anim.hit(this.enemyView, dmg);
        this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
      });
    });
  }

  /** A heal mends the active creature for 30% of its max HP and ends the turn.
   *  Locks the heal again (counter reset). Common state is set by playerCast. */
  private castHeal(): void {
    this.active().healUsed = 0; // locks again after use
    const amount = Math.max(1, Math.round(this.active().maxHp * HEAL_FRACTION_OF_MAX));
    this.active().hp = Math.min(this.active().maxHp, this.active().hp + amount);
    this.refreshPlayerHp(true);
    this.castLine.setText(`${this.activeCreature().name} heals +${amount}`);

    sharedSound.heal();
    this.effects.healSparkles(this.playerPos.x, this.playerPos.y - 50);
    // A rising green "+N" over the creature.
    const label = this.add
      .text(this.playerPos.x, this.playerPos.y - 95, `+${amount}`, {
        fontFamily: "monospace",
        fontSize: "34px",
        fontStyle: "bold",
        color: "#58e39b",
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScale(0.5);
    this.tweens.add({ targets: label, scale: 1, duration: 170, ease: "Back.easeOut" });
    this.tweens.add({ targets: label, y: label.y - 60, alpha: 0, delay: 500, duration: 600, onComplete: () => label.destroy() });

    this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
  }

  /** Resolve the enemy's death: the boss shatters into particles; a mid topples
   *  and greys out (and the player celebrates). Both end in onEnemyDefeated. */
  private resolveEnemyDefeat(): void {
    this.anim.setSlowMo(1);
    if (this.enemyDef.isBoss) {
      this.effects.screenFlash(255, 255, 255);
      this.effects.shatter(this.enemyPos.x, this.enemyPos.y - CREATURE_H * 0.4, ELEMENT_COLOR.void);
      this.anim.stopIdle(this.enemyView);
      this.enemyShape.setVisible(false);
      this.enemyShadow?.setVisible(false);
      this.bossAura?.setVisible(false);
      this.time.delayedCall(360, () => this.onEnemyDefeated());
    } else {
      this.anim.defeat(this.enemyView, this.playerView, () => this.onEnemyDefeated());
    }
  }

  /** Boss down → the victory sequence; otherwise a win burst then a reward. */
  private onEnemyDefeated(): void {
    this.progressCrosses[this.enemyIndex]?.setVisible(true);
    if (this.enemyDef.isBoss) {
      this.playVictorySequence();
    } else {
      sharedSound.winBurst();
      this.showRewards();
    }
  }

  /** The full victory cinematic after Voidcrown falls: screen flash + fanfare,
   *  element-coloured confetti, the party jumping, then the result with its
   *  score counting up. (The slow-mo blow and boss shatter already played.) */
  private playVictorySequence(): void {
    this.turn = "result"; // ignore all voice until the result screen binds rematch
    this.setCardsEnabled(false);
    this.banner.setText("");
    this.clearStatusLines();

    sharedSound.fanfare();
    this.effects.screenFlash(255, 255, 255);
    this.effects.confetti(this.scale.width);
    this.jumpParty();

    this.time.delayedCall(1600, () => this.showResult(true, true));
  }

  /** The surviving party creatures line the foreground and jump for joy. */
  private jumpParty(): void {
    const { width, height } = this.scale;
    const alive = this.party.filter((m) => !m.fainted);
    const n = alive.length;
    alive.forEach((m, i) => {
      const x = width / 2 + (i - (n - 1) / 2) * 150;
      const { image, shadow } = placeCreature(this, {
        key: m.creature.textureKey,
        x,
        side: "player",
        groundY: height - 18,
        height: 128,
      });
      image.setDepth(101);
      shadow.setDepth(100);
      this.victoryExtras.push(image, shadow);
      const baseY = image.y;
      this.tweens.add({
        targets: image,
        y: baseY - 64,
        duration: 320,
        ease: "Quad.easeOut",
        yoyo: true,
        repeat: 6,
        delay: i * 90,
        onComplete: () => {
          image.y = baseY;
        },
      });
    });
  }

  /* --------------------------------------------------------------------- */
  /* Rewards                                                                */
  /* --------------------------------------------------------------------- */

  private showRewards(): void {
    this.turn = "reward";
    this.banner.setText("");

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
        this.party.forEach((m) => {
          if (!m.fainted) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * MEND_FRACTION));
        });
        this.refreshPlayerHp(true);
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

  /** Short description of how to counter a signature move. */
  private signatureCounter(sig: Signature): string {
    switch (sig) {
      case "burn":
        return "GUARD blocks it; water is immune";
      case "tide":
        return "break it with a super-effective hit";
      case "root":
        return "SWITCH creatures to escape";
      case "cataclysm":
        return "GUARD halves it; super-effective SHOUT CRIT interrupts";
    }
  }

  private showSignatureWarning(): void {
    this.warnText?.destroy();
    const def = this.enemyDef;
    this.warnText = this.add
      .text(this.scale.width / 2, 112, `⚠ ${def.name} — ${def.signatureName} next turn · ${this.signatureCounter(def.signature)}`, {
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
        if (this.activeCreature().element === "water") {
          this.castLine.setText(`${def.name} used Burn — ${this.activeCreature().name} is immune!`);
        } else if (this.playerGuard) {
          this.playerGuard = false;
          this.castLine.setText(`${def.name} used Burn — GUARD blocked it!`);
        } else {
          this.playerBurn = BURN_TURNS;
          this.castLine.setText(`${def.name} uses Burn! (${BURN_DMG}/turn × ${BURN_TURNS})`);
        }
        break;
      case "tide":
        this.enemyShield = true;
        this.castLine.setText(`${def.name} raises Tide Shield!`);
        break;
      case "root": {
        const spell = Phaser.Utils.Array.GetRandom(this.activeCreature().spells) as Spell;
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
    this.updateCardStates();
  }

  /** Reflect lock (mega/heal not yet unlocked) and seal (Root) state on the
   *  cards: a locked or sealed card is dimmed; a sealed card shows the chain. */
  private updateCardStates(): void {
    for (const [name, c] of this.cards) {
      const sealed = name === this.sealedSpell;
      c.chain.setVisible(sealed);
      c.card.setAlpha(sealed || c.locked ? 0.4 : 1);
    }
  }

  /** Tide Shield: only a super-effective hit breaks it. Non-super hits are
   *  blocked and the shield stays up. Returns true if the hit was blocked. */
  private shieldBlocks(superEffective: boolean): boolean {
    if (!this.enemyShield) return false;
    if (superEffective) {
      this.enemyShield = false; // broken; the hit goes through
      return false;
    }
    return true; // blocked; shield remains
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

  private showGuarded(): void {
    const t = this.add
      .text(this.playerPos.x, this.playerPos.y - 120, "GUARDED", {
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
    let finalDmg = dmg;
    let guarded = false;
    if (this.playerGuard) {
      this.playerGuard = false;
      finalDmg = Math.max(1, Math.round(dmg * 0.5));
      guarded = true;
    }
    const lethal = this.active().hp - finalDmg <= 0;

    this.anim.attack(this.enemyView, () => {
      if (lethal) this.anim.setSlowMo(0.4);
      sharedSound.whoosh(element);
      this.effects.launchProjectile(element, this.enemyPos, this.playerPos, PROJECTILE_MS, () => {
        this.active().hp = Math.max(0, this.active().hp - finalDmg);
        this.refreshPlayerHp(true);
        this.effects.cameraHit(finalDmg);
        sharedSound.impact(finalDmg);
        if (guarded) this.showGuarded();
        if (effMult !== undefined) this.showEffectiveness(effMult, this.playerPos.x, this.playerPos.y - 120);

        if (this.active().hp <= 0) {
          this.anim.hit(this.playerView, finalDmg, {
            resumeIdle: false,
            onComplete: () => {
              this.anim.setSlowMo(1);
              this.anim.defeat(this.playerView, this.enemyView, () => this.handleFaint());
            },
          });
          return;
        }
        this.anim.hit(this.playerView, finalDmg);
        this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startPlayerTurn());
      });
    });
  }

  private enemyAttack(attack: Spell, element: Element): void {
    this.castLine.setText(`${this.enemyDef.name} cast ${attack.name}`);
    const mult = typeMultiplier(element, this.activeCreature().element);
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

  private showResult(won: boolean, cinematic = false): void {
    // Keep the mic running so "rematch" can be heard — do NOT stop the voice.
    this.turn = "result";
    this.banner.setText("");
    this.heardLine.setText("Heard: —");
    // The cinematic path already played the fanfare; don't double up.
    if (!cinematic) {
      if (won) sharedSound.victory();
      else sharedSound.defeat();
    }

    const { width, height } = this.scale;
    const cx = width / 2;
    const h = height;
    const subtitle = won ? "Gauntlet cleared!" : `Enemies beaten: ${this.defeatedCount} / ${this.gauntlet.length}`;
    const standing = this.party.filter((m) => !m.fainted).length;

    const score = this.computeScore();
    let best = 0;
    try {
      best = parseInt(localStorage.getItem("spellshout-best") ?? "0", 10) || 0;
    } catch {
      /* ignore */
    }
    const newBest = score > best;
    if (newBest) {
      try {
        localStorage.setItem("spellshout-best", String(score));
      } catch {
        /* ignore */
      }
    }

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

    const dim = this.add.rectangle(0, 0, width, height, 0x000000, 0.84).setOrigin(0, 0);
    const lines: Phaser.GameObjects.GameObject[] = [dim];
    lines.push(text(h / 2 - 132, won ? "VICTORY" : "DEFEAT", 72, won ? "#58e39b" : "#ff6b4a", true));
    lines.push(text(h / 2 - 76, subtitle, 22, "#e9e4ff"));
    lines.push(text(h / 2 - 48, `Creatures standing: ${standing} / ${this.party.length}`, 16, "#9a92c7"));

    // Score line — counts up digit by digit on the victory cinematic, then
    // reveals a NEW BEST burst if the run set a record.
    const suffix = newBest ? "    ★ NEW BEST" : `    (best ${best})`;
    const scoreText = text(h / 2 - 18, "", 22, newBest ? "#ffd36b" : "#e9e4ff", newBest);
    if (cinematic) {
      scoreText.setText("Score: 0");
      const counter = { v: 0 };
      this.tweens.add({
        targets: counter,
        v: score,
        duration: 1100,
        ease: "Cubic.easeOut",
        onUpdate: () => scoreText.setText(`Score: ${Math.round(counter.v)}`),
        onComplete: () => {
          scoreText.setText(`Score: ${score}${suffix}`);
          if (newBest) this.showNewBestBurst(cx, h / 2 - 18);
        },
      });
    } else {
      scoreText.setText(`Score: ${score}${suffix}`);
    }
    lines.push(scoreText);

    let y = h / 2 + 12;
    if (inputRouter.getMode() === "wispr") {
      lines.push(text(y, `Spells cast with Wispr Flow: ${this.wisprCasts}`, 16, "#b79cff"));
      y += 24;
    }
    lines.push(
      text(
        y,
        this.strongestHit
          ? `Strongest hit: ${this.strongestHit.name} (-${this.strongestHit.damage})  ·  ${this.turnsTaken} turns`
          : `${this.turnsTaken} turns`,
        15,
        "#9a92c7",
      ),
    );

    this.rematchPrompt = text(h / 2 + 98, 'Say "REMATCH" to play again', 24, "#b79cff", true);
    this.resultHeard = text(h / 2 + 136, "Heard: —", 15, "#9a92c7");
    lines.push(this.rematchPrompt, this.resultHeard);

    this.resultLayer = this.add.container(0, 0, lines).setDepth(100);

    // Pulse the prompt so it's clearly the live call to action.
    this.tweens.add({
      targets: this.rematchPrompt,
      alpha: { from: 1, to: 0.45 },
      duration: 650,
      yoyo: true,
      repeat: -1,
    });
  }

  /** A celebratory pop over the score when the run sets a new best. */
  private showNewBestBurst(x: number, y: number): void {
    sharedSound.winBurst();
    const label = this.add
      .text(x, y - 42, "★ NEW BEST ★", {
        fontFamily: "monospace",
        fontSize: "30px",
        fontStyle: "bold",
        color: "#ffd36b",
        stroke: "#14121f",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(102)
      .setScale(0.3);
    this.victoryExtras.push(label);
    this.tweens.add({ targets: label, scale: 1, duration: 260, ease: "Back.easeOut" });
    this.tweens.add({
      targets: label,
      alpha: { from: 1, to: 0.6 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    const burst = this.add
      .particles(x, y - 42, "fx-dot", {
        tint: [0xffd36b, 0xffffff],
        speed: { min: 80, max: 260 },
        angle: { min: 0, max: 360 },
        lifespan: 700,
        scale: { start: 1.2, end: 0 },
        gravityY: 200,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(102);
    burst.explode(30, x, y - 42);
    this.time.delayedCall(900, () => burst.destroy());
  }

  private rematch(): void {
    if (this.rematchPrompt) this.tweens.killTweensOf(this.rematchPrompt);
    this.resultLayer?.destroy(true);
    this.resultLayer = undefined;
    this.rematchPrompt = undefined;
    this.resultHeard = undefined;
    // Clear any leftover victory-cinematic objects (jumping party, NEW BEST pop).
    this.victoryExtras.forEach((o) => {
      this.tweens.killTweensOf(o);
      o.destroy();
    });
    this.victoryExtras = [];

    this.turn = "idle";
    // Reset the whole party and return to the chosen starter.
    this.party.forEach((m) => {
      m.hp = m.maxHp;
      m.fainted = false;
      m.megaUsed = 0;
      m.healUsed = 0;
    });
    this.activeIndex = Math.max(0, CREATURES.findIndex((c) => c.name === this.startCreature.name));
    this.playerGuard = false;

    this.turnsTaken = 0;
    this.defeatedCount = 0;
    this.strongestHit = null;
    this.scoreDamage = 0;
    this.scoreCrits = 0;
    this.scoreSuperEff = 0;
    this.wisprCasts = 0;
    this.runStartTime = this.time.now;
    inputRouter.resetWisprWords();
    this.ultInput = false;
    this.ultTimer?.remove();
    this.ultTimer = undefined;
    this.ultCharge = 0;
    this.updateUltMeter();
    this.pendingTimer?.remove();
    this.pendingTimer = undefined;
    this.pendingSpells = [];
    this.comboBonus = COMBO_BONUS;
    this.furyMult = {};
    this.rewardLayer?.destroy(true);
    this.rewardLayer = undefined;
    this.rewardMatcher = undefined;
    this.clearStatusLines();

    // Respawn the starter's sprite fresh (the old one may be toppled/faded).
    this.anim.stopIdle(this.playerView);
    this.playerShape.destroy();
    this.playerShadow?.destroy();
    const respawn = placeCreature(this, { key: this.activeCreature().textureKey, x: this.playerBaseX, side: "player" });
    this.playerShape = respawn.image;
    this.playerShadow = respawn.shadow;
    this.playerView = this.anim.register(this.playerShape, 1, 0, 1);
    this.anim.startIdle(this.playerView);
    this.setActiveSpells();
    this.refreshPlayerHp(false);

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
