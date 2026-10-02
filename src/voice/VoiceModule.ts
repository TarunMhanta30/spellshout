/**
 * VoiceModule — owns the Web Speech API.
 *
 * Responsibilities: start/stop continuous recognition and emit transcripts.
 * It knows nothing about spells or game rules — consumers (Phaser scenes) wire
 * transcripts into the Matcher. Chrome only, locale en-IN.
 *
 * STUB: scaffold only, no implementation yet (Tier 1).
 */

export type TranscriptListener = (transcript: string, isFinal: boolean) => void;

export class VoiceModule {
  private readonly lang = "en-IN";

  /** True when the Web Speech API is available in this browser (Chrome). */
  static isSupported(): boolean {
    return (
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window
    );
  }

  /** Recognition locale (en-IN). */
  get language(): string {
    return this.lang;
  }

  start(_onTranscript: TranscriptListener): void {
    // TODO(tier1): create SpeechRecognition, set lang/continuous/interim,
    // forward results to the listener.
    throw new Error("VoiceModule.start not implemented");
  }

  stop(): void {
    // TODO(tier1): stop recognition and release handlers.
  }
}
