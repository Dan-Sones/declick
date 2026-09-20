import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { mockApi } from "./fixtures";

// Optional migration check: point at an archived index.html/app.js/style.css.
// Screenshots are generated from synthetic fixtures, never personal recordings.
const baseline = process.env.FRONTEND_BASELINE_DIR;
for (const width of [1440, 900, 390]) {
  test(`unchanged home, detailed and quick screens at ${width}px`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      !baseline,
      "Set FRONTEND_BASELINE_DIR to compare against the previous frontend.",
    );
    const legacy = await browser.newPage({
      viewport: { width, height: 1000 },
      locale: "en-GB",
    });
    const react = await browser.newPage({
      viewport: { width, height: 1000 },
      locale: "en-GB",
    });
    for (const page of [legacy, react]) await mockApi(page);
    for (const [url, name, contentType] of [
      ["/", "index.html", "text/html"],
      ["/app.js", "app.js", "text/javascript"],
      ["/style.css", "style.css", "text/css"],
    ]) {
      await legacy.route(`http://127.0.0.1:8767${url}`, async (route) =>
        route.fulfill({
          body: await readFile(join(baseline!, name)),
          contentType,
        }),
      );
    }
    async function compare(name: string) {
      // Remove hover differences caused by the last clicked element.
      for (const page of [legacy, react]) await page.mouse.move(0, 0);
      const [before, after] = await Promise.all([
        legacy.screenshot({ fullPage: true, animations: "disabled" }),
        react.screenshot({ fullPage: true, animations: "disabled" }),
      ]);
      const a = PNG.sync.read(before),
        b = PNG.sync.read(after);
      if (a.width !== b.width || a.height !== b.height) {
        await testInfo.attach(`${name}-before`, {
          body: before,
          contentType: "image/png",
        });
        await testInfo.attach(`${name}-after`, {
          body: after,
          contentType: "image/png",
        });
      }
      expect({ width: b.width, height: b.height }, name).toEqual({
        width: a.width,
        height: a.height,
      });
      const diff = new PNG({ width: a.width, height: a.height });
      const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
        threshold: 0.1,
      });
      if (changed) {
        await testInfo.attach(`${name}-before`, {
          body: before,
          contentType: "image/png",
        });
        await testInfo.attach(`${name}-after`, {
          body: after,
          contentType: "image/png",
        });
        await testInfo.attach(`${name}-diff`, {
          body: PNG.sync.write(diff),
          contentType: "image/png",
        });
      }
      expect(changed, `${name}: changed pixels`).toBe(0);
    }
    async function both(action: (page: Page) => Promise<unknown>) {
      await Promise.all([action(legacy), action(react)]);
    }
    await both((page) => page.goto("http://127.0.0.1:8767/"));
    await both((page) => expect(page.locator("#file-count")).toHaveText("2"));
    await compare("home");
    await both((page) => page.locator("#advanced-open").click());
    await both((page) => expect(page.locator("#plot-status")).toHaveText(""));
    await compare("detail");
    await both((page) => page.locator("#select-shown").click());
    await both((page) => page.locator("#preview-repair").check());
    await compare("detail-preview-selected");
    await both((page) => page.locator("#quick-start").click());
    // Audio completion is deterministic even when the browser blocks autoplay.
    await both((page) =>
      expect(page.locator("#quick-status")).toContainText("P to go back", {
        timeout: 10000,
      }),
    );
    await compare("quick");
    await both(async (page) => {
      for (let i = 0; i < 4; i++) await page.locator("#quick-no").click();
    });
    await compare("quick-complete");
    await legacy.close();
    await react.close();
  });
}
