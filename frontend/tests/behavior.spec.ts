import { test, expect } from "@playwright/test";
import {
  candidates,
  mockApi,
  openDetail,
  recordings,
  snapshot,
  syntheticWav,
  waveform,
} from "./fixtures";

test("uses the system theme by default and preserves an explicit theme choice", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(18, 18, 18)",
  );
  await expect(page.locator("#theme-toggle")).toHaveAccessibleName(
    "Switch to light mode",
  );

  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("declick-theme"))).toBe(
    "light",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("filters, ordering, per-file selections, and shared export panel", async ({
  page,
}) => {
  const model = await mockApi(page);
  await openDetail(page);
  await expect(page.locator("#export")).toHaveCount(0);
  await expect(page.locator(".candidate-button.selected")).toContainText(
    candidates[1].timestamp,
  );
  await page.locator("#confidence-filter").selectOption("medium");
  await page.locator("#select-shown").click();
  await page.locator("#confidence-filter").selectOption("high");
  await page.locator("#select-shown").click();
  await expect(page.locator("#selection-summary")).toHaveText(
    "3 candidates selected for repair",
  );
  await page.locator("#sort-order").selectOption("score");
  await expect(page.locator(".candidate-button").first()).toContainText(
    candidates[1].timestamp,
  );
  await page.locator(".file-button").nth(1).click();
  await expect(page.locator("#selection-summary")).toHaveText(
    "No candidates selected",
  );
  await page.locator(".file-button").first().click();
  await expect(page.locator("#selection-summary")).toHaveText(
    "3 candidates selected for repair",
  );
  await page.locator("#confidence-filter").selectOption("low");
  await expect(page.locator(".candidate-check")).toBeDisabled();
  await expect(page.locator("#preview-repair")).toBeDisabled();
  await expect(page.locator("#select-shown")).toBeDisabled();
  await page.locator("#repair-export").click();
  await expect(page.locator("#repair-result")).toContainText(
    "Saved 3 repairs to a new WAV file.",
  );
  expect(model.repairs).toEqual([{ file: "one", selected: [2, 0, 1] }]);
  await expect(page.getByText("Download verification report")).toHaveAttribute(
    "href",
    "/api/download/report",
  );
  await page.locator("#go-quick").click();
  await expect(page.locator("#quick-repair-slot #repair-result")).toBeVisible();
  await page.locator("#go-detail").click();
  await page.locator("#clear-selection").click();
  await expect(page.locator("#repair-result")).toBeHidden();
  await expect(page.locator("#repair-export")).toBeDisabled();
});

test("quick keyboard review, previous, revised decisions, replay and completion", async ({
  page,
}) => {
  const model = await mockApi(page);
  await openDetail(page);
  await page.locator("#quick-start").click();
  await expect(page.locator("#quick-progress")).toHaveText("1 / 4");
  await page.keyboard.press("y");
  await expect(page.locator("#quick-progress")).toHaveText("2 / 4");
  await page.keyboard.press("n");
  await page.keyboard.press("p");
  await expect(page.locator("#quick-progress")).toHaveText("2 / 4");
  await page.keyboard.press("y");
  await expect(page.locator("#selection-summary")).toHaveText(
    "2 candidates selected for repair",
  );
  await expect.poll(() => model.audio.length).toBeGreaterThan(0);
  const count = model.audio.length;
  await page.keyboard.press("m");
  await expect.poll(() => model.audio.length).toBeGreaterThan(count);
  expect(
    model.audio.every(
      (query) => new URLSearchParams(query).get("repaired") === "0",
    ),
  ).toBe(true);
  await page.keyboard.press("n");
  await expect(page.locator("#quick-yes")).toBeDisabled();
  await page.keyboard.press("y");
  await expect(page.locator("#quick-status")).toContainText("too long");
  await page.keyboard.press("n");
  await expect(page.locator("#quick-progress")).toHaveText(
    "Review complete · 4 candidates reviewed",
  );
  await expect(page.locator("#quick-time")).toHaveText("2 staged for repair");
  await expect(page.locator("#quick-restart")).toBeFocused();
  await page.keyboard.press("p");
  await expect(page.locator("#quick-progress")).toHaveText("4 / 4");
  await page.locator("#quick-filter").selectOption("high");
  await expect(page.locator("#quick-progress")).toHaveText("1 / 2");
  await expect(page.locator("#selection-summary")).toHaveText(
    "2 candidates selected for repair",
  );
  await page.locator("#go-home").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "home");
  await page.locator("#continue-review").click();
  await expect(page.locator("#quick-progress")).toHaveText("1 / 2");
});

test("waveform controls, hover, timestamp copy and arrow navigation", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const model = await mockApi(page);
  await openDetail(page);
  await page.locator("#preview-repair").check();
  await expect(page.locator("#audio-preview")).toHaveAttribute(
    "src",
    /repaired=1/,
  );
  await expect(page.locator("#repair-preview-note")).toContainText(
    "Proposed repair in colour",
  );
  await page.locator("#context-size").selectOption("100");
  await expect.poll(() => model.waveforms.at(-1)).toContain("context=100");
  await page.locator("#sample-zoom").selectOption("96");
  await page.locator("#sample-chart").hover();
  await expect(page.locator("#sample-readout")).toContainText("Ch 1:");
  await page.locator("#copy-time").click();
  await expect(page.locator("#copy-time")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    candidates[1].timestamp,
  );
  await page.locator("#recording-name").click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#event-time")).toHaveText(candidates[2].timestamp);
  await page.locator("#previous").click();
  await expect(page.locator("#event-time")).toHaveText(candidates[1].timestamp);
});

test("late waveform responses cannot overwrite a newer candidate", async ({
  page,
}) => {
  await mockApi(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/waveform?*", async (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get("event"));
    if (id === 1) await pending;
    await route
      .fulfill({
        json: {
          ...waveform(id),
          repair_error: id === 1 ? "Stale error" : undefined,
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.locator("#advanced-open").click();
  await page.locator(".candidate-button").first().click();
  await expect(page.locator("#plot-status")).toHaveText("");
  release();
  await expect(page.locator("#event-time")).toHaveText(candidates[0].timestamp);
  await expect(page.locator("#preview-repair")).toBeEnabled();
  await expect(page.locator("#plot-status")).not.toContainText("Stale");
});

test("file picker, path scan, and drop import validate and reset selections", async ({
  page,
}) => {
  const model = await mockApi(page, snapshot([]));
  await page.goto("/");
  await page.locator("#audio-file").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator("#import-status")).toHaveText(
    "Choose an AIFF or WAV file.",
  );
  await page.locator("#audio-file").setInputFiles({
    name: "synthetic.wav",
    mimeType: "audio/wav",
    buffer: syntheticWav(),
  });
  await expect(page.locator("body")).toHaveAttribute("data-view", "quick");
  expect(model.imports).toHaveLength(1);
  await page.keyboard.press("y");
  await page.locator("#go-detail").click();
  await page.locator("#source-path").fill("/example/session/");
  await page.locator("#sensitivity").selectOption("aggressive");
  await page.locator("#scan-button").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "quick");
  expect(model.scans).toEqual([
    { path: "/example/session/", sensitivity: "aggressive" },
  ]);
  await expect(page.locator("#selection-summary")).toHaveText(
    "No candidates selected",
  );
  await page.locator("#go-home").click();
  const transfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["synthetic"], "dropped.wav", { type: "audio/wav" }),
    );
    return transfer;
  });
  await page
    .locator("#file-drop-zone")
    .dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(page.locator("#file-drop-zone")).toHaveClass(/drag-over/);
  await page
    .locator("#file-drop-zone")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator("body")).toHaveAttribute("data-view", "quick");
  expect(model.imports).toHaveLength(2);
});

test("empty states, server errors, waveform and repair failures stay actionable", async ({
  page,
}) => {
  const model = await mockApi(
    page,
    snapshot([{ ...recordings[0], events: [] }]),
  );
  await page.goto("/");
  await page.locator("#advanced-open").click();
  await expect(page.locator("#empty-state h2")).toHaveText(
    "A clean view at this sensitivity.",
  );
  model.snapshot = {
    ...snapshot(),
    revision: 2,
    errors: ["A synthetic file could not be scanned."],
  };
  await expect(page.locator("#error")).toContainText("could not be scanned");
  await page.locator(".file-button").first().click();
  await page.route("**/api/repair", (route) =>
    route.fulfill({
      status: 400,
      json: { error: "Source changed; scan again." },
    }),
  );
  await page.locator("#select-shown").click();
  await page.locator("#repair-export").click();
  await expect(page.locator("#error")).toHaveText(
    "Source changed; scan again.",
  );
  await expect(page.locator("#repair-export")).toBeEnabled();
  await page.route("**/api/waveform?*", (route) =>
    route.fulfill({ status: 400, json: { error: "Waveform unavailable." } }),
  );
  await page.locator("#next").click();
  await expect(page.locator("#plot-status")).toHaveText(
    "Could not load waveform: Waveform unavailable.",
  );
});

test("real server imports synthetic audio and exports a verified new copy", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#audio-file").setInputFiles({
    name: "synthetic-browser-test.wav",
    mimeType: "audio/wav",
    buffer: syntheticWav(),
  });
  await expect(page.locator("body")).toHaveAttribute("data-view", "quick", {
    timeout: 15000,
  });
  await expect(page.locator("#quick-progress")).toHaveText("1 / 1");
  await page.locator("#quick-yes").click();
  await page.locator("#repair-export").click();
  await expect(page.locator("#repair-result")).toContainText(
    "original checksum unchanged",
  );
  const report = await page
    .getByText("Download verification report")
    .getAttribute("href");
  const response = await page.request.get(report!);
  expect(response.ok()).toBe(true);
  expect(errors).toEqual([]);
});

test("switching recordings starts a review for the selected file", async ({
  page,
}) => {
  await mockApi(page);
  await openDetail(page);
  await page.locator("#quick-start").click();
  await page.keyboard.press("y");
  await page.locator("#go-detail").click();
  await page.locator(".file-button").nth(1).click();
  await page.locator("#go-quick").click();
  await expect(page.locator("#quick-progress")).toHaveText("1 / 1");
  await expect(page.locator("#quick-recording")).toHaveText(
    "Second synthetic.wav",
  );
  await expect(page.locator("#selection-summary")).toHaveText(
    "No candidates selected",
  );
});
