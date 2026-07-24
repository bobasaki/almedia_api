import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // react-grid-layout pulls in CJS deps (react-draggable, react-resizable) that
  // must share the app's single React instance, or hooks throw "multiple copies".
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react-grid-layout"],
  },
  build: {
    outDir: resolve(import.meta.dirname, "../dist/dashboard"),
    emptyOutDir: true,
  },
});
