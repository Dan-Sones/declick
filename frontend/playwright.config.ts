import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8767",
    // Set PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome instead.
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    locale: "en-GB",
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command:
      "uv run click-detector-ui --port 8767 --no-browser --output-dir /tmp/click-detector-browser-tests",
    url: "http://127.0.0.1:8767",
    reuseExistingServer: false,
  },
});
