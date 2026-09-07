import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Override of the default exclude list; keep it explicit so local build
    // output (.next/standalone ships Next's own node_modules test files) is
    // never picked up by the unit test run.
    exclude: ["node_modules", "e2e", ".next"],
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
