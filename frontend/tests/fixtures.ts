import { expect, type Page } from "@playwright/test";
import type { Candidate, Recording, Snapshot, Waveform } from "../types/audio";

export const candidates: Candidate[] = [
  {
    id: 0,
    sample_index: 19000,
    timestamp: "00:00.395833",
    channels: [2],
    confidence: 0.91,
    level: "high",
    duration_samples: 8,
    duration_ms: 0.167,
    kind: "exact-zero dropout",
    evidence: { zero_run_samples: 8, interpolation_residual_mad: 12.5 },
    spans: [[2, 19000, 19007]],
  },
  {
    id: 1,
    sample_index: 29000,
    timestamp: "00:00.604167",
    channels: [1],
    confidence: 0.96,
    level: "high",
    duration_samples: 1,
    duration_ms: 0.021,
    kind: "short discontinuity",
    evidence: { hf_burst_db: 8.1 },
  },
  {
    id: 2,
    sample_index: 39000,
    timestamp: "00:00.812500",
    channels: [1, 2],
    confidence: 0.62,
    level: "medium",
    duration_samples: 4,
    duration_ms: 0.083,
    kind: "short discontinuity",
    evidence: { isolation_score: 3.4 },
  },
  {
    id: 3,
    sample_index: 45000,
    timestamp: "00:00.937500",
    channels: [1],
    confidence: 0.33,
    level: "low",
    duration_samples: 96,
    duration_ms: 2,
    kind: "short discontinuity",
    evidence: {},
    repair_error: "Candidate is too long for a safe repair.",
  },
];
export const recordings: Recording[] = [
  {
    id: "one",
    name: "Synthetic recording.wav",
    path: "/example/recording.wav",
    events: candidates,
    stats: {
      sample_rate: 48000,
      channels: 2,
      bit_depth: 24,
      subtype: "PCM_24",
      duration_seconds: 1,
      peak_dbfs: -6.02,
    },
  },
  {
    id: "two",
    name: "Second synthetic.wav",
    path: "/example/second.wav",
    events: [candidates[0]],
    stats: {
      sample_rate: 48000,
      channels: 1,
      bit_depth: 16,
      subtype: "PCM_16",
      duration_seconds: 2,
      peak_dbfs: -12.04,
    },
  },
];
export function snapshot(files = recordings): Snapshot {
  return {
    status: "done",
    revision: 1,
    files,
    path: "/example/recording.wav",
    sensitivity: "conservative",
    completed: files.length,
    total: files.length,
    current: "",
    errors: [],
  };
}
export function waveform(event = 1): Waveform {
  const center = candidates[event]?.sample_index || 19000;
  const original = Array.from(
    { length: 241 },
    (_, i) => 0.2 * Math.sin(i * 0.12),
  );
  const repaired = [...original];
  original[120] = 0;
  return {
    start_sample: center - 120,
    center_sample: center,
    sample_rate: 48000,
    channels: [original, [...original]],
    repaired_channels: [repaired, [...repaired]],
  };
}
// All audio used by tests is generated here; no source recordings are imported.
export function syntheticWav() {
  const frames = 48000,
    data = Buffer.alloc(44 + frames * 4);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(48000 * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(6500 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    data.writeInt16LE(value, 44 + i * 4);
    data.writeInt16LE(i >= 19000 && i < 19008 ? 0 : value, 46 + i * 4);
  }
  return data;
}
export async function mockApi(page: Page, initial = snapshot()) {
  const model = {
    snapshot: initial,
    repairs: [] as { file: string; selected: number[] }[],
    imports: [] as Buffer[],
    scans: [] as unknown[],
    audio: [] as string[],
    waveforms: [] as string[],
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/state") return route.fulfill({ json: model.snapshot });
    if (path === "/api/waveform") {
      model.waveforms.push(url.search);
      return route.fulfill({
        json: waveform(Number(url.searchParams.get("event"))),
      });
    }
    if (path === "/api/audio") {
      model.audio.push(url.search);
      return route.fulfill({ contentType: "audio/wav", body: syntheticWav() });
    }
    if (path === "/api/repair") {
      const body = route.request().postDataJSON();
      model.repairs.push(body);
      return route.fulfill({
        json: {
          repaired_candidates: body.selected.length,
          format: "WAV",
          output: "/example/exports/repaired.wav",
          download_url: "/api/download/audio",
          report_url: "/api/download/report",
        },
      });
    }
    if (path === "/api/import") {
      model.imports.push(route.request().postDataBuffer()!);
      model.snapshot = { ...snapshot(), revision: model.snapshot.revision + 1 };
      return route.fulfill({
        status: 202,
        json: { path: "/example/imports/recording.wav" },
      });
    }
    if (path === "/api/scan") {
      model.scans.push(route.request().postDataJSON());
      model.snapshot = { ...snapshot(), revision: model.snapshot.revision + 1 };
      return route.fulfill({ status: 202, json: {} });
    }
    if (path === "/api/report.csv")
      return route.fulfill({
        contentType: "text/csv",
        body: "file,timestamp\nsynthetic.wav,0.395833\n",
        headers: { "Content-Disposition": 'attachment; filename="report.csv"' },
      });
    return route.fulfill({
      body: "synthetic export",
      headers: { "Content-Disposition": 'attachment; filename="export.txt"' },
    });
  });
  return model;
}
export async function openDetail(page: Page) {
  await page.goto("/");
  await expect(page.locator("#file-count")).toHaveText("2");
  await page.locator("#advanced-open").click();
  await expect(page.locator("#event-time")).toHaveText(candidates[1].timestamp);
  await expect(page.locator("#plot-status")).toHaveText("");
}
