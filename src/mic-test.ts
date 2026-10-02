/**
 * Mic Test page — Milestone 1.
 *
 * Wires the VoiceModule (Web Speech transcript) and the AudioModule (live
 * volume meter) to the DOM. Both run from a single Start gesture and operate
 * at the same time off the same microphone permission.
 */
import { VoiceModule } from "@voice/VoiceModule";
import { AudioModule } from "@audio/AudioModule";

const startBtn = document.getElementById("start") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const transcriptEl = document.getElementById("transcript") as HTMLDivElement;
const meterEl = document.getElementById("meter") as HTMLDivElement;
const volPctEl = document.getElementById("volPct") as HTMLSpanElement;

const voice = new VoiceModule();
const audio = new AudioModule();

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function renderTranscript(final: string, interim: string): void {
  if (!final && !interim) {
    transcriptEl.innerHTML =
      '<span class="placeholder">Your words will appear here…</span>';
    return;
  }
  const finalNode = document.createTextNode(final ? final + " " : "");
  const interimSpan = document.createElement("span");
  interimSpan.className = "interim";
  interimSpan.textContent = interim;
  transcriptEl.replaceChildren(finalNode, interimSpan);
}

function pumpMeter(): void {
  const loudness = audio.getLoudness();
  const pct = Math.round(loudness * 100);
  meterEl.style.width = `${pct}%`;
  volPctEl.textContent = `${pct}%`;
  requestAnimationFrame(pumpMeter);
}

async function start(): Promise<void> {
  startBtn.disabled = true;

  if (!VoiceModule.isSupported()) {
    setStatus("Web Speech API not available — please use Chrome.");
    startBtn.disabled = false;
    return;
  }

  try {
    // Mic for the volume meter (also satisfies the permission prompt).
    await audio.init();
    pumpMeter();
  } catch {
    setStatus("Microphone access denied. Allow it and reload.");
    startBtn.disabled = false;
    return;
  }

  // Speech recognition for the transcript — auto-restarts after silence.
  voice.start(
    ({ final, interim }) => renderTranscript(final, interim),
    (err) => setStatus(`Recognition error: ${err}`),
  );

  setStatus("Listening… speak into your mic. (Recognition restarts after silence.)");
  startBtn.textContent = "Listening…";
}

startBtn.addEventListener("click", () => {
  void start();
});
