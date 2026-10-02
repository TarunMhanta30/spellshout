import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@voice": fileURLToPath(new URL("./src/voice", import.meta.url)),
      "@audio": fileURLToPath(new URL("./src/audio", import.meta.url)),
      "@matcher": fileURLToPath(new URL("./src/matcher", import.meta.url)),
      "@scenes": fileURLToPath(new URL("./src/scenes", import.meta.url)),
      "@data": fileURLToPath(new URL("./src/data", import.meta.url)),
      "@animations": fileURLToPath(new URL("./src/animations", import.meta.url)),
      "@effects": fileURLToPath(new URL("./src/effects", import.meta.url)),
    },
  },
  server: {
    // Mic + Web Speech API require a secure context; localhost counts as secure.
    host: true,
  },
  build: {
    rollupOptions: {
      input: {
        // Root page is the game; the mic test is kept as a separate page.
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        micTest: fileURLToPath(new URL("./mic-test.html", import.meta.url)),
      },
    },
  },
});
