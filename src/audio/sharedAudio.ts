import { AudioModule } from "./AudioModule";

/**
 * A single AudioModule shared across the game. It's initialised once (on the
 * title-screen gesture) and keeps reading mic loudness regardless of which
 * input engine is active — so turning Chrome speech off in Wispr Mode does not
 * stop loudness.
 */
export const sharedAudio = new AudioModule();
