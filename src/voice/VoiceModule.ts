/**
 * VoiceModule — owns the Web Speech API.
 *
 * Starts continuous recognition with interim results in en-IN and emits
 * transcript updates. Chrome ends recognition on its own after a silence, so
 * this module restarts it automatically while the caller wants to be listening.
 *
 * It knows nothing about spells or game rules — consumers wire the transcript
 * into the Matcher. Chrome only.
 */

export interface TranscriptUpdate {
  /** Accumulated finalized text for the current listening session. */
  final: string;
  /** The in-progress (interim) text not yet finalized. */
  interim: string;
}

export type TranscriptListener = (update: TranscriptUpdate) => void;
export type VoiceErrorListener = (error: string) => void;

export class VoiceModule {
  private readonly lang = "en-IN";
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private finalText = "";
  private onTranscript: TranscriptListener | null = null;
  private onError: VoiceErrorListener | null = null;

  /** True when the Web Speech API is available in this browser (Chrome). */
  static isSupported(): boolean {
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  }

  /** Recognition locale (en-IN). */
  get language(): string {
    return this.lang;
  }

  /** True while the module intends to keep listening (survives auto-restarts). */
  get isListening(): boolean {
    return this.listening;
  }

  start(onTranscript: TranscriptListener, onError?: VoiceErrorListener): void {
    // Already running (e.g. started on the title screen): just swap the
    // listeners so the new scene receives transcripts, without spawning a
    // second recognition instance.
    if (this.listening) {
      this.onTranscript = onTranscript;
      this.onError = onError ?? null;
      return;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      onError?.("Web Speech API not supported (use Chrome).");
      return;
    }

    this.onTranscript = onTranscript;
    this.onError = onError ?? null;
    this.finalText = "";
    this.listening = true;

    const recognition = new Ctor();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => this.handleResult(event);

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are routine; surface the rest.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.onError?.(event.error);
      }
    };

    // Chrome stops after silence; restart while we still want to listen.
    recognition.onend = () => {
      if (this.listening) {
        this.restart();
      }
    };

    this.recognition = recognition;
    this.safeStart();
  }

  stop(): void {
    this.listening = false;
    this.recognition?.stop();
  }

  private handleResult(event: SpeechRecognitionEvent): void {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;
      if (result.isFinal) {
        this.finalText += text;
      } else {
        interim += text;
      }
    }
    this.onTranscript?.({ final: this.finalText.trim(), interim: interim.trim() });
  }

  private safeStart(): void {
    try {
      this.recognition?.start();
    } catch {
      // start() throws if called while already starting; the onend handler
      // will retry, so this is safe to swallow.
    }
  }

  private restart(): void {
    // A short defer avoids "recognition has already started" races in Chrome.
    window.setTimeout(() => {
      if (this.listening) {
        this.safeStart();
      }
    }, 150);
  }
}
