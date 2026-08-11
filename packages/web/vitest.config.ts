import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules", "e2e"],
  },
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: path.resolve(__dirname, "./src/") + "/",
      },
    ],
  },
});
