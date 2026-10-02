import Phaser from "phaser";
import { VoiceModule } from "@voice/VoiceModule";
import { Matcher } from "@matcher/Matcher";
import { PLAYER, ENEMY, PLAYER_SPELLS, ELEMENT_COLOR, type Spell } from "@data/roster";

/** Confidence needed to fire a cast from a (possibly rough) interim result. */
const CAST_THRESHOLD = 0.7;
/** Pause after the player's cast before the enemy strikes back. */
const ENEMY_DELAY_MS = 1000;
/** Short beat after the enemy's cast before control returns to the player. */
const RETURN_DELAY_MS = 800;

type Turn = "idle" | "player" | "enemy" | "over";

interface HpBar {
  fill: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  maxWidth: number;
}

/**
 * BattleScene — the voice-driven, turn-based duel.
 *
 * Flow: a "click to begin" overlay (one gesture to enable the mic) → the player
 * shouts a spell, which casts the instant an interim transcript matches with
 * good confidence (and then ignores the rest of that shout) → the target shakes
 * and flashes → after a beat the enemy casts a random spell → repeat until one
 * side reaches 0 HP.
 */
export class BattleScene extends Phaser.Scene {
  private readonly voice = new VoiceModule();
  private readonly matcher = new Matcher(
    PLAYER_SPELLS.map((s) => s.name),
    { threshold: CAST_THRESHOLD },
  );

  private turn: Turn = "idle";
  private castThisTurn = false;

  private playerHp = PLAYER.maxHp;
  private enemyHp = ENEMY.maxHp;

  private playerShape!: Phaser.GameObjects.Rectangle;
  private enemyShape!: Phaser.GameObjects.Rectangle;
  private playerBaseX = 0;
  private enemyBaseX = 0;

  private playerBar!: HpBar;
  private enemyBar!: HpBar;

  private banner!: Phaser.GameObjects.Text;
  private heardLine!: Phaser.GameObjects.Text;
  private castLine!: Phaser.GameObjects.Text;

  constructor() {
    super("Battle");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add.rectangle(0, 0, width, height, 0x14121f).setOrigin(0, 0);

    // Combatants.
    this.enemyBaseX = width - 240;
    this.enemyShape = this.add
      .rectangle(this.enemyBaseX, 220, 140, 170, ENEMY.color)
      .setStrokeStyle(3, 0x000000, 0.25);
    this.add
      .text(this.enemyBaseX, 320, ENEMY.name, { fontFamily: "monospace", fontSize: "18px", color: "#e9e4ff" })
      .setOrigin(0.5, 0);

    this.playerBaseX = 240;
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

    this.createSpellCards();

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
      this.add.rectangle(cx, cy, cardW, cardH, 0x1e1b2e).setStrokeStyle(2, 0x3a3550);
      this.add.circle(cx - cardW / 2 + 14, cy - cardH / 2 + 14, 6, ELEMENT_COLOR[spell.element]);
      this.add
        .text(cx, cy - 8, spell.name.replace(" ", "\n"), {
          fontFamily: "monospace",
          fontSize: "17px",
          color: "#e9e4ff",
          align: "center",
        })
        .setOrigin(0.5);
      this.add
        .text(cx, cy + cardH / 2 - 14, `say it · ${spell.damage} dmg`, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#9a92c7",
        })
        .setOrigin(0.5);
    });
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
    // Show what's being heard either way.
    const heard = interim || tailWords(final, 3);
    this.heardLine.setText(`Heard: ${heard ? `“${heard}”` : "—"}`);

    // Cast only from interim, only on the player's turn, only once per turn —
    // so one shout can't cast twice and a stale final can't re-trigger.
    if (this.turn !== "player" || this.castThisTurn || !interim) return;

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
    this.banner.setText("Your turn — shout a spell!");
    this.heardLine.setText("Heard: —");
  }

  private playerCast(spell: Spell): void {
    this.castThisTurn = true;
    this.turn = "idle";
    this.castLine.setText(`You cast ${spell.name}  (-${spell.damage})`);
    this.banner.setText("");

    this.enemyHp -= spell.damage;
    this.updateHpBar(this.enemyBar, this.enemyHp, ENEMY.maxHp, true);
    this.hitEffect(this.enemyShape, ENEMY.color, this.enemyBaseX);

    if (this.enemyHp <= 0) {
      this.endBattle(true);
      return;
    }
    this.time.delayedCall(ENEMY_DELAY_MS, () => this.enemyTurn());
  }

  private enemyTurn(): void {
    if (this.turn === "over") return;
    this.turn = "enemy";
    const spell = Phaser.Utils.Array.GetRandom(ENEMY.spells) as Spell;
    this.banner.setText(`${ENEMY.name} casts ${spell.name}!`);
    this.castLine.setText(`${ENEMY.name} cast ${spell.name}  (-${spell.damage})`);

    this.playerHp -= spell.damage;
    this.updateHpBar(this.playerBar, this.playerHp, PLAYER.maxHp, true);
    this.hitEffect(this.playerShape, PLAYER.color, this.playerBaseX);

    if (this.playerHp <= 0) {
      this.endBattle(false);
      return;
    }
    this.time.delayedCall(RETURN_DELAY_MS, () => this.startPlayerTurn());
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

  private endBattle(won: boolean): void {
    this.turn = "over";
    this.voice.stop();
    this.banner.setText("");

    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.72).setOrigin(0, 0).setDepth(100);
    this.add
      .text(width / 2, height / 2 - 16, won ? "YOU WIN" : "YOU LOSE", {
        fontFamily: "monospace",
        fontSize: "56px",
        color: won ? "#58e39b" : "#ff6b4a",
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.add
      .text(width / 2, height / 2 + 40, "Refresh to play again", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#9a92c7",
      })
      .setOrigin(0.5)
      .setDepth(100);
  }
}

/** Keep only the last n whitespace-separated words of a string. */
function tailWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}
