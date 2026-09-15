import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "src/**/*.test.ts",
      "shared/**/*.test.ts",
      "preview/**/*.test.ts",
    ],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
