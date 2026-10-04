/**
 * SoundModule — all sound effects synthesized in code with the Web Audio API
 * (no audio files). Also tracks a "mic-bleed" window: while a transient sound
 * plays (plus 150ms after), input should be ignored so the game's own output
 * never counts as player loudness or speech.
 *
 * The continuous ambient drone is exempt from the bleed window (it's quiet and
 * always on, so blocking during it would make the game unplayable).
 */

const BLEED_TAIL_MS = 150;

type SfxElement = "fire" | "water" | "nature" | "void" | "shadow";

export class SoundModule {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private blockUntil = 0; // performance.now() ms
  private droneGain: GainNode | null = null;

  /** Create/resume the audio context — must be called from a user gesture. */
  resume(): void {
    this.ensure();
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** True while a transient game sound is sounding (plus the 150ms tail). */
  isInputBlocked(): boolean {
    return performance.now() < this.blockUntil;
  }

  /** Extend the bleed window. No-op when muted (no speaker output = no bleed). */
  private markActive(durationSec: number): void {
    if (this.muted) return;
    this.blockUntil = Math.max(this.blockUntil, performance.now() + durationSec * 1000 + BLEED_TAIL_MS);
  }

  private noise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private env(ctx: AudioContext, peak: number, dur: number, attack = 0.01): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  /** The attack sound, with a distinct, punchy character per element:
   *   - fire: a crackling roar with a low boom
   *   - water: a splashing sweep with bubbly blips
   *   - nature: a whip crack with a rustle
   *   - shadow / void: a deep whoosh with a reverse swell
   */
  whoosh(element: SfxElement): void {
    switch (element) {
      case "fire":
        this.fireRoar();
        break;
      case "water":
        this.waterSplash();
        break;
      case "nature":
        this.natureWhip();
        break;
      case "shadow":
        this.shadowWhoosh(false);
        break;
      case "void":
      default:
        this.shadowWhoosh(true);
        break;
    }
  }

  /** Fire: a filtered-noise roar with crackle pops over a low boom. */
  private fireRoar(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const dur = 0.42;

    const src = this.noise(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.linearRampToValueAtTime(1400, t + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.env(ctx, 0.3, dur, 0.02);
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    src.stop(t + dur);

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const bg = this.env(ctx, 0.5, 0.34, 0.005);
    boom.connect(bg).connect(this.master!);
    boom.start();
    boom.stop(t + 0.34);

    for (let i = 0; i < 6; i++) {
      const ct = t + 0.03 + Math.random() * dur * 0.8;
      const cn = this.noise(ctx, 0.04);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2000;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, ct);
      cg.gain.exponentialRampToValueAtTime(0.12, ct + 0.004);
      cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.03);
      cn.connect(hp).connect(cg).connect(this.master!);
      cn.start(ct);
      cn.stop(ct + 0.04);
    }
    this.markActive(dur);
  }

  /** Water: a downward lowpass sweep (splash) with rising sine blips (bubbles). */
  private waterSplash(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const dur = 0.4;

    const src = this.noise(ctx, dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = this.env(ctx, 0.26, dur, 0.01);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    src.stop(t + dur);

    for (let i = 0; i < 5; i++) {
      const bt = t + 0.05 + i * 0.06;
      const o = ctx.createOscillator();
      o.type = "sine";
      const f = 500 + i * 160 + Math.random() * 80;
      o.frequency.setValueAtTime(f * 0.8, bt);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, bt + 0.05);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.exponentialRampToValueAtTime(0.1, bt + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.06);
      o.connect(bg).connect(this.master!);
      o.start(bt);
      o.stop(bt + 0.07);
    }
    this.markActive(dur);
  }

  /** Nature: a short bright whip crack over a soft sustained rustle. */
  private natureWhip(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const crackDur = 0.09;
    const cn = this.noise(ctx, crackDur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + crackDur);
    const cg = this.env(ctx, 0.3, crackDur, 0.002);
    cn.connect(bp).connect(cg).connect(this.master!);
    cn.start();
    cn.stop(t + crackDur);

    const rDur = 0.4;
    const rn = this.noise(ctx, rDur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.09, t + 0.08);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + rDur);
    rn.connect(hp).connect(lp).connect(rg).connect(this.master!);
    rn.start();
    rn.stop(t + rDur);
    this.markActive(rDur);
  }

  /** Shadow/void: a deep whoosh whose gain swells in then cuts, over a sub tone.
   *  `deeper` (void) drops it an extra bit lower. */
  private shadowWhoosh(deeper: boolean): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const dur = 0.5;

    const src = this.noise(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(deeper ? 240 : 360, t);
    bp.frequency.linearRampToValueAtTime(deeper ? 520 : 760, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28, t + dur * 0.85); // reverse swell in
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur); // then cut
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    src.stop(t + dur);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(deeper ? 50 : 70, t);
    o.frequency.exponentialRampToValueAtTime(deeper ? 34 : 46, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.4, t + dur * 0.8);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(this.master!);
    o.start();
    o.stop(t + dur);
    this.markActive(dur);
  }

  /** Heavy layered boom laid under a mega attack. */
  megaBoom(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const dur = 0.7;
    for (const [f0, f1, vol] of [
      [120, 38, 0.5],
      [80, 30, 0.45],
      [180, 60, 0.3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = this.env(ctx, vol, dur, 0.004);
      o.connect(g).connect(this.master!);
      o.start();
      o.stop(t + dur);
    }
    const n = this.noise(ctx, 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    const ng = this.env(ctx, 0.4, 0.12, 0.002);
    n.connect(lp).connect(ng).connect(this.master!);
    n.start();
    n.stop(t + 0.12);
    this.markActive(dur);
  }

  /** Rising bell chime for a heal. */
  heal(): void {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      for (const [mul, vol] of [
        [1, 0.14],
        [2, 0.05],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f * mul, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(this.master!);
        o.start(t);
        o.stop(t + 0.55);
      }
    });
    this.markActive(notes.length * 0.09 + 0.5);
  }

  /** Short, bright burst when an enemy is defeated. */
  winBurst(): void {
    this.arpeggio([784, 1047, 1319], 0.08, 0.16, "triangle");
  }

  /** Full triumphant fanfare for the final victory. */
  fanfare(): void {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    const melody = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    melody.forEach((f, i) => {
      const t = t0 + i * 0.14;
      for (const [type, vol] of [
        ["sawtooth", 0.1],
        ["square", 0.05],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g).connect(this.master!);
        o.start(t);
        o.stop(t + 0.45);
      }
    });
    const ct = t0 + melody.length * 0.14;
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, ct);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ct);
      g.gain.exponentialRampToValueAtTime(0.12, ct + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.9);
      o.connect(g).connect(this.master!);
      o.start(ct);
      o.stop(ct + 1.0);
    }
    this.markActive(melody.length * 0.14 + 1.0);
  }

  /** Impact thud + crack; heavier (lower, louder, longer) with damage. */
  impact(damage: number): void {
    const ctx = this.ensure();
    const d = Math.min(1, damage / 45);
    const dur = 0.18 + d * 0.22;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f0 = 180 - d * 110;
    osc.frequency.setValueAtTime(f0 * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.5), t + dur);
    const og = this.env(ctx, 0.25 + d * 0.3, dur, 0.004);
    osc.connect(og).connect(this.master!);
    osc.start();
    osc.stop(t + dur);

    const n = this.noise(ctx, 0.08);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200 + d * 1800;
    const ng = this.env(ctx, 0.18 + d * 0.2, 0.08, 0.002);
    n.connect(lp).connect(ng).connect(this.master!);
    n.start();
    n.stop(t + 0.08);

    this.markActive(dur);
  }

  /** Bright rising sting for a shout crit. */
  crit(): void {
    const ctx = this.ensure();
    const dur = 0.5;
    const t = ctx.currentTime;
    for (const [type, mul, vol] of [
      ["sawtooth", 1, 0.14],
      ["square", 1.5, 0.07],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(420 * mul, t);
      o.frequency.exponentialRampToValueAtTime(1500 * mul, t + dur);
      const g = this.env(ctx, vol, dur, 0.02);
      o.connect(g).connect(this.master!);
      o.start();
      o.stop(t + dur);
    }
    this.markActive(dur);
  }

  /** Short UI blip. */
  blip(freq = 880): void {
    const ctx = this.ensure();
    const dur = 0.07;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(freq, t);
    const g = this.env(ctx, 0.12, dur, 0.003);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(t + dur);
    this.markActive(dur);
  }

  victory(): void {
    this.arpeggio([523, 659, 784, 1047], 0.13, 0.16);
  }

  defeat(): void {
    this.arpeggio([392, 311, 262, 196], 0.2, 0.14, "triangle");
  }

  private arpeggio(freqs: number[], step: number, vol: number, type: OscillatorType = "sine"): void {
    const ctx = this.ensure();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const t = t0 + i * step;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.4);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + step * 1.5);
    });
    this.markActive(freqs.length * step + 0.2);
  }

  /** Quiet continuous ambient drone (exempt from the mic-bleed window). */
  startDrone(): void {
    if (this.droneGain) return;
    const ctx = this.ensure();
    const gain = ctx.createGain();
    gain.gain.value = 0.045;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    lp.connect(gain).connect(this.master!);
    for (const f of [55, 58.2, 110]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    this.droneGain = gain;
  }
}
