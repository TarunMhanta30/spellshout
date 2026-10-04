/**
 * Shout Power — maps peak mic loudness (relative to the calibrated baseline) to
 * a damage multiplier, and the live loudness to a gauge fill.
 */

export interface PowerResult {
  mult: number;
  label: string;
  crit: boolean;
}

/** Loudness (as a multiple of baseline) at the very top of the gauge = crit. */
export const GAUGE_TOP_RATIO = 2.0;

export function powerMultiplier(peak: number, baseline: number): PowerResult {
  if (baseline <= 0 || peak <= 0) return { mult: 1, label: "normal", crit: false };
  const r = peak / baseline;
  if (r >= GAUGE_TOP_RATIO) return { mult: 1.6, label: "SHOUT CRIT", crit: true };
  if (r >= 1.3) return { mult: 1.3, label: "loud", crit: false };
  if (r >= 0.8) return { mult: 1.0, label: "normal", crit: false };
  return { mult: 0.8, label: "weak", crit: false };
}

/** 0..1 fill for the power gauge: baseline sits at 1/GAUGE_TOP_RATIO of the bar. */
export function gaugeFill(loudness: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, Math.min(1, loudness / (baseline * GAUGE_TOP_RATIO)));
}
