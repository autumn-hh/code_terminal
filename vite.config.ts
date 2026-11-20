import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Syntax minification miscompiles xterm 6's mode-query enum initialization,
    // throwing on Codex startup queries. Keep identifier/whitespace minification.
    minifySyntax: false,
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-icons": ["lucide-react"],
          "vendor-react": ["react", "react-dom", "react/jsx-runtime"],
          "vendor-terminal": ["@xterm/addon-fit", "@xterm/xterm"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
