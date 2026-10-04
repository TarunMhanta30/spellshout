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

  /** Airy whoosh, pitched per element. */
  whoosh(element: SfxElement): void {
    const ctx = this.ensure();
    const dur = 0.32;
    const base =
      element === "fire" ? 1700 : element === "water" ? 650 : element === "nature" ? 1050 : 900;
    const src = this.noise(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    const t = ctx.currentTime;
    bp.frequency.setValueAtTime(base * 0.55, t);
    bp.frequency.exponentialRampToValueAtTime(base * 1.7, t + dur);
    const g = this.env(ctx, 0.22, dur, 0.05);
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    src.stop(t + dur);
    this.markActive(dur);
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
