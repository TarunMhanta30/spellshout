import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@voice": fileURLToPath(new URL("./src/voice", import.meta.url)),
      "@audio": fileURLToPath(new URL("./src/audio", import.meta.url)),
      "@matcher": fileURLToPath(new URL("./src/matcher", import.meta.url)),
      "@scenes": fileURLToPath(new URL("./src/scenes", import.meta.url)),
    },
  },
  server: {
    // Mic + Web Speech API require a secure context; localhost counts as secure.
    host: true,
  },
});
