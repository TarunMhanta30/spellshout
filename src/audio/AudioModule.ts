/**
 * AudioModule — owns the Web Audio API.
 *
 * Responsibilities: capture the microphone, measure loudness, and hold the
 * per-player calibration baseline. Emits a normalized loudness value that the
 * game maps to spell power. Framework-agnostic — no Phaser, no game rules.
 *
 * STUB: scaffold only, no implementation yet (Tier 2).
 */

export class AudioModule {
  /** Calibrated per-player baseline loudness; null until calibrated. */
  private baseline: number | null = null;

  async init(): Promise<void> {
    // TODO(tier2): getUserMedia, build AnalyserNode graph.
    throw new Error("AudioModule.init not implemented");
  }

  /** Current instantaneous loudness, 0..1. */
  getLoudness(): number {
    // TODO(tier2): read analyser, return normalized amplitude.
    return 0;
  }

  /** Record the quiet-room baseline so scaling is fair per environment. */
  calibrate(baseline: number): void {
    this.baseline = baseline;
  }

  getBaseline(): number | null {
    return this.baseline;
  }
}
