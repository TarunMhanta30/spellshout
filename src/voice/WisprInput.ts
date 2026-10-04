/**
 * WisprInput — the Wispr Flow input engine.
 *
 * Wispr Flow is an external dictation app that types the user's speech into
 * whatever has keyboard focus. So we render a text bar at the bottom of the
 * screen and keep it focused (refocusing if it ever loses focus). 300ms after
 * typing stops, the text is lowercased, stripped of punctuation, emitted (to be
 * matched exactly like a speech transcript), and the bar is cleared.
 */

const DEBOUNCE_MS = 300;
const FOCUS_GUARD_MS = 400;

export class WisprInput {
  private readonly el: HTMLInputElement;
  private timer: number | null = null;
  private focusGuard: number | null = null;
  private visible = false;

  constructor(private readonly onFinal: (text: string) => void) {
    this.el = document.createElement("input");
    this.el.type = "text";
    this.el.autocomplete = "off";
    this.el.spellcheck = false;
    this.el.setAttribute("aria-label", "Wispr Flow input");
    this.el.placeholder = "Wispr Flow types here…";
    Object.assign(this.el.style, {
      position: "fixed",
      left: "50%",
      bottom: "12px",
      transform: "translateX(-50%)",
      width: "min(640px, 80vw)",
      padding: "12px 16px",
      boxSizing: "border-box",
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      fontSize: "18px",
      color: "#e9e4ff",
      background: "rgba(20,18,31,0.92)",
      border: "2px solid #7c6cff",
      borderRadius: "10px",
      outline: "none",
      zIndex: "9999",
      textAlign: "center",
      display: "none",
    } as Partial<CSSStyleDeclaration>);

    this.el.addEventListener("input", () => this.onInput());
    this.el.addEventListener("blur", () => this.refocusSoon());
    document.body.appendChild(this.el);
  }

  /** Show the bar and start keeping it focused. */
  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.el.style.display = "block";
    this.el.value = "";
    this.focus();
    this.focusGuard = window.setInterval(() => {
      if (this.visible && document.activeElement !== this.el) this.focus();
    }, FOCUS_GUARD_MS);
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = "none";
    if (this.focusGuard !== null) {
      clearInterval(this.focusGuard);
      this.focusGuard = null;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private focus(): void {
    try {
      this.el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  private refocusSoon(): void {
    if (this.visible) window.setTimeout(() => this.focus(), 0);
  }

  private onInput(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.commit(), DEBOUNCE_MS);
  }

  private commit(): void {
    this.timer = null;
    const text = this.el.value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "") // strip punctuation
      .replace(/\s+/g, " ")
      .trim();
    if (text) this.onFinal(text); // show in heard line + match…
    this.el.value = ""; // …then clear the bar
  }
}
