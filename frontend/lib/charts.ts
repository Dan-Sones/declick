import type { Candidate, Waveform } from "../types/audio";

export const colors = [
  "#39765f",
  "#588db0",
  "#9e81b1",
  "#b48b39",
  "#778f40",
  "#b36c88",
];

function chartColor(name: string, fallback: string) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

export function chartGeometry(
  canvas: HTMLCanvasElement,
  wave: Waveform | null,
  zoom: boolean,
  radius: number,
) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!wave || !wave.channels.length || !width || !height) return null;
  const center = wave.center_sample - wave.start_sample;
  const first = zoom ? Math.max(0, center - radius) : 0;
  const last = zoom
    ? Math.min(wave.channels[0].length - 1, center + radius)
    : wave.channels[0].length - 1;
  if (last <= first) return null;
  let min = 0,
    max = 0;
  for (const channel of wave.channels)
    for (let i = first; i <= last; i++) {
      min = Math.min(min, channel[i]);
      max = Math.max(max, channel[i]);
    }
  const margin = Math.max((max - min) * 0.18, 0.00001);
  min -= margin;
  max += margin;
  const left = 58,
    right = width - 18,
    top = 15,
    bottom = height - 37;
  return {
    width,
    height,
    center,
    first,
    last,
    min,
    max,
    left,
    right,
    top,
    bottom,
    x: (i: number) => left + ((i - first) / (last - first)) * (right - left),
    y: (value: number) =>
      bottom - ((value - min) / (max - min)) * (bottom - top),
  };
}

export function drawChart(
  canvas: HTMLCanvasElement,
  wave: Waveform | null,
  item: Candidate | undefined,
  zoom: boolean,
  radius: number,
  preview: boolean,
  hoverIndex: number | null = null,
  mode = "auto",
) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const g = chartGeometry(canvas, wave, zoom, radius);
  if (!g || !wave || !item) return;
  const { first, last, center, min, max, left, right, top, bottom, x, y } = g;
  const grid = chartColor("--chart-grid", "#eef1e9");
  const gridVertical = chartColor("--chart-grid-vertical", "#f2f4ef");
  const axisLabel = chartColor("--chart-label", "#89967f");
  const caption = chartColor("--chart-caption", "#929d89");
  const region = chartColor("--chart-region", "rgba(195,101,81,.11)");
  const original = chartColor("--chart-original", "#bbc4b7");
  const hover = chartColor("--chart-hover", "#86957c");
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick++) {
    const value = min + ((max - min) * tick) / 4;
    const yy = y(value);
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.fillStyle = axisLabel;
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(max - min < 0.003 ? 5 : 3), left - 9, yy + 3);
  }
  for (let tick = 0; tick <= 4; tick++) {
    const index = first + ((last - first) * tick) / 4;
    const xx = x(index);
    ctx.strokeStyle = gridVertical;
    ctx.beginPath();
    ctx.moveTo(xx, top);
    ctx.lineTo(xx, bottom);
    ctx.stroke();
    ctx.fillStyle = axisLabel;
    ctx.textAlign = "center";
    const label = zoom
      ? String(Math.round(index - center))
      : ((wave.start_sample + index) / wave.sample_rate).toFixed(3);
    ctx.fillText(label, xx, bottom + 17);
  }
  ctx.fillStyle = caption;
  ctx.textAlign = "center";
  ctx.fillText(
    zoom ? "Samples relative to detection" : "Time in source file (seconds)",
    (left + right) / 2,
    height - 3,
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  if (zoom) {
    ctx.fillStyle = region;
    for (const [, start, end] of item.spans || [
      [0, item.sample_index, item.sample_index + item.duration_samples - 1],
    ]) {
      const lo = start - wave.start_sample,
        hi = end - wave.start_sample;
      ctx.fillRect(x(lo), top, Math.max(2, x(hi) - x(lo)), bottom - top);
    }
  }
  const repaired =
    mode === "fixed"
      ? wave.repaired_channels
      : mode === "original"
        ? null
        : preview
          ? wave.repaired_channels
          : null;
  if (mode === "fixed" && !repaired) {
    ctx.restore();
    return;
  }
  if (repaired) {
    ctx.strokeStyle = original;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    wave.channels.forEach((channel) => {
      ctx.beginPath();
      for (let i = first; i <= last; i++) {
        if (i === first) ctx.moveTo(x(i), y(channel[i]));
        else ctx.lineTo(x(i), y(channel[i]));
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }
  (repaired || wave.channels).forEach((channel, channelIndex) => {
    ctx.strokeStyle = colors[channelIndex % colors.length];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = zoom ? 1.5 : 1.2;
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      if (i === first) ctx.moveTo(x(i), y(channel[i]));
      else ctx.lineTo(x(i), y(channel[i]));
    }
    ctx.stroke();
    if (zoom && last - first <= 192)
      for (let i = first; i <= last; i++) {
        ctx.beginPath();
        ctx.arc(x(i), y(channel[i]), 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
  });
  ctx.strokeStyle = "#c36551";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x(center), top);
  ctx.lineTo(x(center), bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  if (hoverIndex !== null) {
    ctx.strokeStyle = hover;
    ctx.beginPath();
    ctx.moveTo(x(hoverIndex), top);
    ctx.lineTo(x(hoverIndex), bottom);
    ctx.stroke();
  }
  ctx.restore();
}
