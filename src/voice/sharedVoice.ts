import { VoiceModule } from "./VoiceModule";

/**
 * A single VoiceModule shared across scenes. The mic is enabled once (by a user
 * gesture on the title screen) and recognition keeps running as the game moves
 * from title → battle → rematch. Each scene calls `start()` to swap in its own
 * transcript handler without restarting recognition.
 */
export const sharedVoice = new VoiceModule();
