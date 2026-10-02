import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 240_000,
  reporter: [["list"]],
  use: { browserName: "chromium", headless: true },
});
