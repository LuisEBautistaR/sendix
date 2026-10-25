import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

const shared = resolve(import.meta.dirname, "src/shared");

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
    build: {
      rolldownOptions: {
        // The engine is a second entry: main forks it as a utilityProcess.
        input: {
          index: resolve(import.meta.dirname, "src/main/index.ts"),
          engine: resolve(import.meta.dirname, "src/engine/index.ts"),
        },
      },
    },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
    build: {
      // Sandboxed preloads must be a single CommonJS file with no node_modules imports.
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: { alias: { "@shared": shared } },
    plugins: [react()],
    // electron-vite leaves the renderer unminified by default; the installer ships it minified.
    build: { minify: true },
  },
});
