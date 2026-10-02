/**
 * AudioModule — owns the Web Audio API.
 *
 * Captures the microphone and exposes an instantaneous loudness value (0..1)
 * computed as RMS of the time-domain signal. Holds the per-player calibration
 * baseline used later to scale spell power. Framework-agnostic — no Phaser, no
 * game rules.
 *
 * The same microphone MediaStream can run alongside speech recognition, so the
 * volume meter and the transcript work at the same time.
 */

export class AudioModule {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private buffer: Uint8Array<ArrayBuffer> | null = null;

  /** Calibrated per-player baseline loudness; null until calibrated. */
  private baseline: number | null = null;

  /** Acquire the mic and build the analyser graph. Requires user gesture. */
  async init(): Promise<void> {
    if (this.context) return;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;

    const source = context.createMediaStreamSource(this.stream);
    source.connect(analyser);

    this.context = context;
    this.analyser = analyser;
    this.source = source;
    this.buffer = new Uint8Array(analyser.fftSize);
  }

  /** Current instantaneous loudness, 0..1 (RMS of the waveform). */
  getLoudness(): number {
    if (!this.analyser || !this.buffer) return 0;

    this.analyser.getByteTimeDomainData(this.buffer);

    let sumSquares = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      // Byte samples are centered at 128; normalize to -1..1.
      const sample = (this.buffer[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / this.buffer.length);

    // RMS rarely exceeds ~0.5 for speech; scale so normal talking fills more
    // of the meter, then clamp.
    return Math.min(1, rms * 2);
  }

  /** Record the quiet-room baseline so scaling is fair per environment. */
  calibrate(baseline: number): void {
    this.baseline = baseline;
  }

  getBaseline(): number | null {
    return this.baseline;
  }

  /** Release the mic and audio graph. */
  stop(): void {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.buffer = null;
  }
}
