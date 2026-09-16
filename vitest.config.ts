import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    testTimeout: 10_000,
    coverage: {
      reporter: ["text", "json", "html"]
    }
  }
})
