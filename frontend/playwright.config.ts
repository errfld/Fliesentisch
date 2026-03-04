import { defineConfig, type ReporterDescription } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const ciReporter: ReporterDescription[] = [
  ["github"],
  ["junit", { outputFile: "test-results/junit.xml" }],
  ["json", { outputFile: "test-results/results.json" }],
  ["html", { open: "never", outputFolder: "playwright-report" }]
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {
    timeout: 20_000
  },
  reporter: process.env.CI ? ciReporter : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["microphone", "camera"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
    }
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000
  }
});
