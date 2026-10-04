import { sharedVoice } from "./sharedVoice";
import { WisprInput } from "./WisprInput";

export type InputMode = "chrome" | "wispr";

/**
 * A phrase from whichever engine is active. `canCast` is true when the phrase
 * is a firm enough trigger to act on — a live interim transcript (Chrome) or a
 * debounced committed line (Wispr) — versus a stale final-only update.
 */
export type PhraseHandler = (text: string, canCast: boolean) => void;

function tailWords(text: string, n: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}

/**
 * InputRouter — one place that owns the active voice engine.
 *
 * Chrome mode drives phrases from the Web Speech API (the shared VoiceModule);
 * Wispr mode drives them from the on-screen text bar (WisprInput) and turns
 * Chrome recognition off so nothing casts twice. Scenes just call `listen()`
 * with a handler; switching modes re-routes the same handler live.
 */
class InputRouter {
  private mode: InputMode = "chrome";
  private wispr?: WisprInput;
  private handler?: PhraseHandler;
  private onError?: (error: string) => void;
  private readonly modeListeners = new Set<(mode: InputMode) => void>();

  getMode(): InputMode {
    return this.mode;
  }

  onModeChange(cb: (mode: InputMode) => void): () => void {
    this.modeListeners.add(cb);
    return () => this.modeListeners.delete(cb);
  }

  setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeListeners.forEach((cb) => cb(mode));
    if (this.handler) this.startEngine();
  }

  /** Route phrases to `handler` using the active engine (call per scene). */
  listen(handler: PhraseHandler, onError?: (error: string) => void): void {
    this.handler = handler;
    this.onError = onError;
    this.startEngine();
  }

  private startEngine(): void {
    if (this.mode === "chrome") {
      this.wispr?.hide();
      sharedVoice.start(
        (u) => this.handler?.(u.interim || tailWords(u.final, 3), u.interim.length > 0),
        this.onError,
      );
    } else {
      // Wispr Mode: Chrome recognition off; the text bar drives input.
      sharedVoice.stop();
      if (!this.wispr) this.wispr = new WisprInput((text) => this.handler?.(text, true));
      this.wispr.show();
    }
  }
}

export const inputRouter = new InputRouter();
