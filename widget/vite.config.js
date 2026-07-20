import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "../server/public/widget"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.js"),
      name: "KCChatbotLib",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        exports: "named",
        assetFileNames: "widget.[ext]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
