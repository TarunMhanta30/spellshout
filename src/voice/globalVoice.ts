import { handleSoundCommand } from "@audio/sharedSound";
import { sharedHelp } from "./HelpOverlay";
import { inputRouter } from "./InputRouter";
import { Matcher } from "@matcher/Matcher";
import { matchCommand } from "@matcher/command";

const helpMatcher = new Matcher(["help", "commands"], { threshold: 0.62 });
// Voice engine switches, usable during the game (the title uses buttons now).
const modeMatcher = new Matcher(["whisper mode", "wispr mode", "chrome mode"], { threshold: 0.62 });

/**
 * Global voice commands available in every scene: "help" (toggle the command
 * overlay), the sound commands ("mute" / "sound on"), and the voice-engine
 * switches ("whisper mode" / "chrome mode"). Returns true if the phrase was
 * handled so the scene can stop processing it.
 */
export function handleGlobalVoice(text: string): boolean {
  if (matchCommand(helpMatcher, text)) {
    sharedHelp.toggle();
    return true;
  }
  const mode = matchCommand(modeMatcher, text);
  if (mode) {
    inputRouter.setMode(mode.phrase === "chrome mode" ? "chrome" : "wispr");
    return true;
  }
  return handleSoundCommand(text);
}
