/**
 * A full-screen help overlay (DOM) listing every voice command. Toggled by
 * saying "help" from any scene; works across scenes since it lives on the page.
 */
export class HelpOverlay {
  private readonly el: HTMLDivElement;
  private visible = false;

  constructor() {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(10,9,16,0.93)",
      color: "#e9e4ff",
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      zIndex: "10000",
      display: "none",
      padding: "6vh 8vw",
      boxSizing: "border-box",
      overflow: "auto",
    } as Partial<CSSStyleDeclaration>);
    this.el.innerHTML = `
      <h2 style="color:#b79cff;margin:0 0 12px">VOICE COMMANDS</h2>
      <ul style="font-size:clamp(14px,2vw,20px);line-height:1.9;list-style:none;padding:0;margin:0">
        <li><b style="color:#ffd36b">Say a spell name</b> — cast it (say two names for a combo)</li>
        <li><b style="color:#ffd36b">When ULTIMATE READY</b> — describe your attack in one sentence</li>
        <li><b style="color:#ffd36b">"switch to &lt;name&gt;"</b> — change creature (uses your turn)</li>
        <li><b style="color:#ffd36b">"guard"</b> — halve the next hit (uses your turn)</li>
        <li><b style="color:#ffd36b">"rematch"</b> — play again (on the result screen)</li>
        <li><b style="color:#ffd36b">"whisper mode" / "chrome mode"</b> — switch voice engine (title)</li>
        <li><b style="color:#ffd36b">"mute" / "sound on"</b> — toggle sound</li>
        <li><b style="color:#ffd36b">"skip"</b> — skip the how-to screen</li>
        <li><b style="color:#ffd36b">"help"</b> — show or hide this</li>
      </ul>
      <p style="color:#9a92c7;margin-top:20px">Louder voice = stronger spell. Say "help" again to close.</p>`;
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? "block" : "none";
  }
}

export const sharedHelp = new HelpOverlay();
