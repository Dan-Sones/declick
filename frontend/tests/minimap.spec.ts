import { test, expect } from "@playwright/test";
import {
  candidates,
  mockApi,
  openDetail,
  recordings,
  snapshot,
} from "./fixtures";

test("marker jumps play original audio and preserve selections through completion", async ({
  page,
}) => {
  const model = await mockApi(page);
  await openDetail(page);
  await page.locator("#quick-start").click();
  const markers = page.locator(".minimap-marker");
  await expect(markers).toHaveCount(4);
  await page.keyboard.press("y");
  await expect(markers.nth(0)).toHaveAttribute("data-staged", "true");
  await markers.nth(3).click();
  await expect(page.locator("#quick-progress")).toHaveText("4 / 4");
  await expect(markers.nth(3)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => model.audio.at(-1)).toContain("event=3");
  await expect.poll(() => model.waveforms.at(-1)).toContain("event=3");
  await expect(page.locator("#quick-time")).toHaveText(candidates[3].timestamp);
  await page.keyboard.press("n");
  await expect(page.locator("#quick-progress")).toContainText(
    "End of review queue",
  );
  await expect(page.locator(".quick-minimap")).toBeVisible();
  await expect(page.locator("#quick-time")).toHaveText("1 staged for repair");
  await markers.nth(0).click();
  await expect(page.locator("#quick-progress")).toHaveText("1 / 4");
  await expect(markers.nth(0)).toHaveAttribute("data-staged", "true");
  const count = model.audio.length;
  await markers.nth(0).click();
  await expect.poll(() => model.audio.length).toBeGreaterThan(count);
  await page.locator("#quick-filter").selectOption("medium");
  await expect(markers).toHaveCount(1);
  await expect(markers).toHaveAccessibleName(/Candidate 3/);
  await expect(page.locator("#selection-summary")).toHaveText(
    "1 candidate selected for repair",
  );
});

test("keyboard can reach coincident markers without focus being stolen", async ({
  page,
}) => {
  const file = {
    ...recordings[0],
    events: candidates.map((candidate) => ({
      ...candidate,
      sample_index: 24000,
    })),
  };
  await mockApi(page, snapshot([file, recordings[1]]));
  await openDetail(page);
  await page.locator("#quick-start").click();
  const markers = page.locator(".minimap-marker");
  await markers.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(markers.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#quick-progress")).toHaveText("2 / 4");
  await expect(markers.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(markers.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(markers.first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(markers.first()).toBeFocused();
});

test("boundary markers align, and changing files clears the old overview", async ({
  page,
}) => {
  const file = {
    ...recordings[0],
    events: [
      { ...candidates[0], sample_index: 0 },
      { ...candidates[1], sample_index: 47999 },
    ],
  };
  await mockApi(page, snapshot([file, recordings[1]]));
  await openDetail(page);
  await page.locator("#quick-start").click();
  const track = await page.locator(".minimap-track").boundingBox();
  const markers = page.locator(".minimap-marker");
  const first = await markers.first().boundingBox();
  const last = await markers.last().boundingBox();
  expect(first!.x + first!.width / 2).toBeCloseTo(track!.x, 0);
  expect(last!.x + last!.width / 2).toBeCloseTo(track!.x + track!.width, 0);
  await expect(page.locator(".minimap-waveform path")).not.toHaveAttribute(
    "d",
    "",
  );
  await page.locator("#go-detail").click();
  await page.locator(".file-button").nth(1).click();
  await page.locator("#quick-start").click();
  await expect(markers).toHaveCount(1);
  await expect(page.locator(".minimap-fallback")).toBeVisible();
  await expect(page.locator(".minimap-waveform path")).toHaveAttribute("d", "");
  await page.locator("#quick-filter").selectOption("low");
  await expect(markers).toHaveCount(0);
  await expect(page.locator(".minimap-empty")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1440]) {
    test(`minimap layout at ${width}px in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await mockApi(page);
      await openDetail(page);
      await page.locator("#quick-start").click();
      const minimap = page.locator(".quick-minimap");
      const box = await minimap.boundingBox();
      const charts = await page.locator(".comparison-grid").boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(120);
      expect(box!.height).toBeLessThanOrEqual(170);
      expect(box!.y + box!.height).toBeLessThan(charts!.y);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.locator(".minimap-marker").nth(2).click();
      await expect(page.locator("#quick-progress")).toHaveText("3 / 4");
      await page.screenshot({
        path: testInfo.outputPath("quick-minimap.png"),
        fullPage: true,
      });
    });
  }
}
