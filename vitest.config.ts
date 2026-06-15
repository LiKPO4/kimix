import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    deps: {
      inline: [/@\/types/],
    },
  },
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
});
