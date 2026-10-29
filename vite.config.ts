import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
export default defineConfig({
  server: {
    watch: {
      ignored: ["**/src-tauri/**", "**/tmp/**", "**/release/**", "**/$null"],
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The package's browser entry touches document; its default entry is a
      // pure entity lookup table that also works inside our bundled worker.
      "decode-named-character-reference": createRequire(
        import.meta.url,
      ).resolve("decode-named-character-reference"),
    },
  },
});
