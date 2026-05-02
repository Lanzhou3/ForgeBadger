import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules", "e2e"],
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
