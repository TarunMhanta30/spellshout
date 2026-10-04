import { SoundModule } from "./SoundModule";
import { Matcher } from "@matcher/Matcher";
import { matchCommand } from "@matcher/command";

/** One SoundModule shared across the game. */
export const sharedSound = new SoundModule();

const muteMatcher = new Matcher(["mute", "sound off", "sound on", "unmute"], { threshold: 0.62 });

/**
 * Handle the global "mute" / "sound on" voice commands. Returns true if the
 * phrase was a sound command (so the caller can stop processing it).
 */
export function handleSoundCommand(text: string): boolean {
  const m = matchCommand(muteMatcher, text);
  if (!m) return false;
  const off = m.phrase === "mute" || m.phrase === "sound off";
  sharedSound.setMuted(off);
  return true;
}
