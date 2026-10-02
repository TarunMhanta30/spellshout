import Phaser from "phaser";
import { VoiceModule } from "@voice/VoiceModule";
import { Matcher } from "@matcher/Matcher";
import { PLAYER, ENEMY, PLAYER_SPELLS, ELEMENT_COLOR, type Spell } from "@data/roster";

/** Confidence needed to fire a cast from a (possibly rough) interim result. */
const CAST_THRESHOLD = 0.7;
/** How long the big "YOUR TURN / UMBRA'S TURN" banner holds before fading. */
const TURN_BANNER_MS = 800;
/** How long the enemy telegraphs its spell ("charging…") before it attacks. */
const CHARGE_MS = 1000;
/** Travel time of an attack projectile from caster to target. */
const PROJECTILE_MS = 320;
/** Short beat after a hit resolves before the next step. */
const RESOLVE_BEAT_MS = 500;

/** Greyed-out alpha for the spell cards when it isn't the player's turn. */
const CARDS_DISABLED_ALPHA = 0.28;

type Turn = "idle" | "player" | "enemy" | "result";

interface HpBar {
  fill: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  maxWidth: number;
}

/**
 * BattleScene — the voice-driven, turn-based duel.
 *
 * Flow: a "click to begin" overlay (one gesture to enable the mic). Each turn
 * opens with a big "YOUR TURN" / "UMBRA'S TURN" banner. On the player's turn a
 * matched shout fires a projectile at the enemy (and only the enemy). On the
 * enemy's turn all voice is ignored, the cards grey out, Umbra telegraphs its
 * spell ("charging…") for a second, then fires back. Every hit shows a floating
 * damage number. Repeats until one side reaches 0 HP.
 */
export class BattleScene extends Phaser.Scene {
  private readonly voice = new VoiceModule();
  private readonly matcher = new Matcher(
    PLAYER_SPELLS.map((s) => s.name),
    { threshold: CAST_THRESHOLD },
  );
  // "rematch" is a short, common word — a slightly looser threshold is fine.
  private readonly rematchMatcher = new Matcher(["rematch"], { threshold: 0.6 });

  private turn: Turn = "idle";
  private castThisTurn = false;

  private playerHp = PLAYER.maxHp;
  private enemyHp = ENEMY.maxHp;

  // Run stats, shown on the result screen.
  private turnsTaken = 0;
  private strongestHit: { name: string; damage: number } | null = null;

  private resultLayer?: Phaser.GameObjects.Container;
  private rematchPrompt?: Phaser.GameObjects.Text;

  private playerShape!: Phaser.GameObjects.Rectangle;
  private enemyShape!: Phaser.GameObjects.Rectangle;
  private playerBaseX = 0;
  private enemyBaseX = 0;
  private playerPos = { x: 0, y: 0 };
  private enemyPos = { x: 0, y: 0 };

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

  create(): void {
    const { width, height } = this.scale;

    this.add.rectangle(0, 0, width, height, 0x14121f).setOrigin(0, 0);

    // Combatants.
    this.enemyBaseX = width - 240;
    this.enemyPos = { x: this.enemyBaseX, y: 220 };
    this.enemyShape = this.add
      .rectangle(this.enemyBaseX, 220, 140, 170, ENEMY.color)
      .setStrokeStyle(3, 0x000000, 0.25);
    this.add
      .text(this.enemyBaseX, 320, ENEMY.name, { fontFamily: "monospace", fontSize: "18px", color: "#e9e4ff" })
      .setOrigin(0.5, 0);

    this.playerBaseX = 240;
    this.playerPos = { x: this.playerBaseX, y: 235 };
    this.playerShape = this.add
      .rectangle(this.playerBaseX, 235, 150, 150, PLAYER.color)
      .setStrokeStyle(3, 0x000000, 0.25);
    this.add
      .text(this.playerBaseX, 320, PLAYER.name, { fontFamily: "monospace", fontSize: "18px", color: "#e9e4ff" })
      .setOrigin(0.5, 0);

    // HP bars.
    this.playerBar = this.createHpBar(50, 48, 340, PLAYER.name);
    this.enemyBar = this.createHpBar(width - 50 - 340, 48, 340, ENEMY.name);
    this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, false);
    this.updateHpBar(this.enemyBar, this.enemyHp, ENEMY.maxHp, false);

    // Status text.
    this.banner = this.add
      .text(width / 2, 18, "", { fontFamily: "monospace", fontSize: "22px", color: "#e9e4ff" })
      .setOrigin(0.5, 0);
    this.heardLine = this.add
      .text(width / 2, 352, "Heard: —", { fontFamily: "monospace", fontSize: "18px", color: "#9a92c7" })
      .setOrigin(0.5, 0);
    this.castLine = this.add
      .text(width / 2, 380, "Last cast: —", { fontFamily: "monospace", fontSize: "18px", color: "#d7e358" })
      .setOrigin(0.5, 0);

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

    // Clean up recognition if the scene is torn down.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.voice.stop());

    this.showStartOverlay();
  }

  /* --------------------------------------------------------------------- */
  /* Setup helpers                                                          */
  /* --------------------------------------------------------------------- */

  private createHpBar(x: number, y: number, width: number, name: string): HpBar {
    const h = 18;
    this.add
      .text(x, y - 20, name, { fontFamily: "monospace", fontSize: "13px", color: "#9a92c7" })
      .setOrigin(0, 0);
    this.add.rectangle(x, y, width, h, 0x0f0d18).setOrigin(0, 0).setStrokeStyle(2, 0x3a3550);
    const fill = this.add.rectangle(x + 2, y + 2, width - 4, h - 4, 0x58e39b).setOrigin(0, 0);
    const label = this.add
      .text(x + width / 2, y + h / 2, "", { fontFamily: "monospace", fontSize: "12px", color: "#14121f" })
      .setOrigin(0.5);
    return { fill, label, maxWidth: width - 4 };
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
    const margin = 20;
    const gap = 12;
    const count = PLAYER_SPELLS.length;
    const cardW = (width - margin * 2 - gap * (count - 1)) / count;
    const cardH = 84;
    const top = 436;

    PLAYER_SPELLS.forEach((spell, i) => {
      const cx = margin + i * (cardW + gap) + cardW / 2;
      const cy = top + cardH / 2;
      const bg = this.add.rectangle(cx, cy, cardW, cardH, 0x1e1b2e).setStrokeStyle(2, 0x3a3550);
      const dot = this.add.circle(cx - cardW / 2 + 14, cy - cardH / 2 + 14, 6, ELEMENT_COLOR[spell.element]);
      const name = this.add
        .text(cx, cy - 8, spell.name.replace(" ", "\n"), {
          fontFamily: "monospace",
          fontSize: "17px",
          color: "#e9e4ff",
          align: "center",
        })
        .setOrigin(0.5);
      const meta = this.add
        .text(cx, cy + cardH / 2 - 14, `say it · ${spell.damage} dmg`, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#9a92c7",
        })
        .setOrigin(0.5);
      this.cardLayer.add([bg, dot, name, meta]);
    });
  }

  /** Grey the spell cards out when it isn't the player's turn. */
  private setCardsEnabled(enabled: boolean): void {
    this.cardLayer.setAlpha(enabled ? 1 : CARDS_DISABLED_ALPHA);
  }

  /* --------------------------------------------------------------------- */
  /* Start overlay + voice wiring                                           */
  /* --------------------------------------------------------------------- */

  private showStartOverlay(): void {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.75).setOrigin(0, 0).setDepth(100);
    const title = this.add
      .text(width / 2, height / 2 - 20, "Click anywhere to begin", {
        fontFamily: "monospace",
        fontSize: "32px",
        color: "#e9e4ff",
      })
      .setOrigin(0.5)
      .setDepth(100);
    const sub = this.add
      .text(width / 2, height / 2 + 24, "(enables your microphone — Chrome only)", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#9a92c7",
      })
      .setOrigin(0.5)
      .setDepth(100);

    this.input.once("pointerdown", () => {
      overlay.destroy();
      title.destroy();
      sub.destroy();
      this.beginBattle();
    });
  }

  private beginBattle(): void {
    if (!VoiceModule.isSupported()) {
      this.banner.setText("Web Speech API unavailable — use Chrome.");
      return;
    }
    this.voice.start(
      (update) => this.onVoice(update.interim, update.final),
      (err) => this.banner.setText(`Mic error: ${err}`),
    );
    this.startPlayerTurn();
  }

  private onVoice(interim: string, final: string): void {
    const heard = interim || tailWords(final, 3);

    // Debug panel updates on every result, even when input is being ignored.
    this.updateDebug(heard);

    // On the result screen, listen only for "rematch".
    if (this.turn === "result") {
      if (interim && this.rematchMatcher.match(tailWords(interim, 3))) this.rematch();
      return;
    }

    // Only the player's turn listens — all voice is ignored otherwise.
    if (this.turn !== "player") return;

    this.heardLine.setText(`Heard: ${heard ? `“${heard}”` : "—"}`);

    // Cast only from interim, only once per turn — so one shout can't cast
    // twice and a stale final can't re-trigger.
    if (this.castThisTurn || !interim) return;

    const result = this.matcher.match(tailWords(interim, 4));
    if (result) {
      const spell = PLAYER_SPELLS.find((s) => s.name === result.phrase);
      if (spell) this.playerCast(spell);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Turn flow                                                              */
  /* --------------------------------------------------------------------- */

  private startPlayerTurn(): void {
    this.turn = "player";
    this.castThisTurn = false;
    this.turnsTaken += 1;
    this.banner.setText("Shout a spell!");
    this.heardLine.setText("Heard: —");
    this.setCardsEnabled(true);
    this.announceTurn("YOUR TURN", "#4fd1c5");
  }

  /** A player cast only ever damages the enemy. */
  private playerCast(spell: Spell): void {
    this.castThisTurn = true;
    this.turn = "idle";
    this.banner.setText("");
    this.castLine.setText(`You cast ${spell.name}`);

    if (!this.strongestHit || spell.damage > this.strongestHit.damage) {
      this.strongestHit = { name: spell.name, damage: spell.damage };
    }

    this.fireProjectile(this.playerPos, this.enemyPos, ELEMENT_COLOR[spell.element], () => {
      this.enemyHp = Math.max(0, this.enemyHp - spell.damage);
      this.updateHpBar(this.enemyBar, this.enemyHp, ENEMY.maxHp, true);
      this.hitEffect(this.enemyShape, ENEMY.color, this.enemyBaseX);
      this.floatingDamage(this.enemyPos, spell.damage);

      if (this.enemyHp <= 0) {
        this.showResult(true);
        return;
      }
      this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startEnemyTurn());
    });
  }

  private startEnemyTurn(): void {
    if (this.turn !== "idle") return;
    this.turn = "enemy";
    this.setCardsEnabled(false);
    this.banner.setText(`${ENEMY.name}'s turn`);
    this.heardLine.setText("Heard: — (mic paused)");
    this.announceTurn("UMBRA'S TURN", "#b79cff");

    const spell = Phaser.Utils.Array.GetRandom(ENEMY.spells) as Spell;

    // Telegraph the attack for one second before it lands.
    this.time.delayedCall(TURN_BANNER_MS, () => {
      if (this.turn !== "enemy") return;
      this.showCharge(`${ENEMY.name} is charging ${spell.name}`);
      this.time.delayedCall(CHARGE_MS, () => {
        if (this.turn !== "enemy") return;
        this.hideCharge();
        this.enemyAttack(spell);
      });
    });
  }

  private enemyAttack(spell: Spell): void {
    this.castLine.setText(`${ENEMY.name} cast ${spell.name}`);
    this.fireProjectile(this.enemyPos, this.playerPos, ELEMENT_COLOR[spell.element], () => {
      this.playerHp = Math.max(0, this.playerHp - spell.damage);
      this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, true);
      this.hitEffect(this.playerShape, PLAYER.color, this.playerBaseX);
      this.floatingDamage(this.playerPos, spell.damage);

      if (this.playerHp <= 0) {
        this.showResult(false);
        return;
      }
      this.time.delayedCall(RESOLVE_BEAT_MS, () => this.startPlayerTurn());
    });
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

  /** Launch a projectile from caster to target, then run onHit on arrival. */
  private fireProjectile(
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: number,
    onHit: () => void,
  ): void {
    const bolt = this.add.circle(from.x, from.y, 12, color).setDepth(50);
    const glow = this.add.circle(from.x, from.y, 20, color, 0.35).setDepth(49);
    this.tweens.add({
      targets: [bolt, glow],
      x: to.x,
      y: to.y,
      duration: PROJECTILE_MS,
      ease: "Quad.easeIn",
      onComplete: () => {
        bolt.destroy();
        glow.destroy();
        onHit();
      },
    });
  }

  /** Floating "-N" damage number that rises and fades over the target. */
  private floatingDamage(at: { x: number; y: number }, amount: number): void {
    const label = this.add
      .text(at.x, at.y - 40, `-${amount}`, {
        fontFamily: "monospace",
        fontSize: "34px",
        fontStyle: "bold",
        color: "#ff5a5a",
      })
      .setOrigin(0.5)
      .setDepth(70);
    this.tweens.add({
      targets: label,
      y: at.y - 100,
      alpha: 0,
      duration: 850,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  /** Flash the target white and shake it to sell the hit. */
  private hitEffect(target: Phaser.GameObjects.Rectangle, baseColor: number, baseX: number): void {
    target.setFillStyle(0xffffff);
    this.time.delayedCall(100, () => target.setFillStyle(baseColor));
    this.tweens.add({
      targets: target,
      x: baseX + 12,
      duration: 40,
      yoyo: true,
      repeat: 4,
      onComplete: () => {
        target.x = baseX;
      },
    });
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

    const { width, height } = this.scale;
    const cx = width / 2;
    const winner = won ? PLAYER.name : ENEMY.name;
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
    const winLine = text(height / 2 - 52, `${winner} won the duel`, 22, "#e9e4ff");
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

    this.resultLayer = this.add
      .container(0, 0, [dim, heading, winLine, turnsLine, hitLine, this.rematchPrompt])
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

    this.turn = "idle";
    this.playerHp = PLAYER.maxHp;
    this.enemyHp = ENEMY.maxHp;
    this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, false);
    this.updateHpBar(this.enemyBar, this.enemyHp, ENEMY.maxHp, false);

    this.turnsTaken = 0;
    this.strongestHit = null;
    this.castLine.setText("Last cast: —");

    this.startPlayerTurn();
  }
}

/** Keep only the last n whitespace-separated words of a string. */
function tailWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}
