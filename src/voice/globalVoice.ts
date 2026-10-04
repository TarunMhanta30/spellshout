import { handleSoundCommand } from "@audio/sharedSound";
import { sharedHelp } from "./HelpOverlay";
import { Matcher } from "@matcher/Matcher";
import { matchCommand } from "@matcher/command";

const helpMatcher = new Matcher(["help", "commands"], { threshold: 0.62 });

/**
 * Global voice commands available in every scene: "help" (toggle the command
 * overlay) and the sound commands ("mute" / "sound on"). Returns true if the
 * phrase was handled so the scene can stop processing it.
 */
export function handleGlobalVoice(text: string): boolean {
  if (matchCommand(helpMatcher, text)) {
    sharedHelp.toggle();
    return true;
  }
  return handleSoundCommand(text);
}
