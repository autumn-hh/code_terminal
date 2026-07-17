import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
