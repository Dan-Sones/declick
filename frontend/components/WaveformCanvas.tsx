import { useLayoutEffect, useRef } from "react";
import { chartGeometry, drawChart } from "../lib/charts";
import { fmt } from "../lib/format";
import type { Candidate, Waveform } from "../types/audio";

interface Props {
  id: string;
  label: string;
  wave: Waveform | null;
  item: Candidate | undefined;
  zoom?: boolean;
  radius: string;
  preview: boolean;
  mode?: string;
  view: string;
  onReadout?: (text: string) => void;
}
export function WaveformCanvas({
  id,
  label,
  wave,
  item,
  zoom = false,
  radius,
  preview,
  mode = "auto",
  view,
  onReadout,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    const draw = () =>
      drawChart(canvas, wave, item, zoom, Number(radius), preview, null, mode);
    draw();
    onReadout?.("Hover to inspect a sample");
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [wave, item, zoom, radius, preview, mode, view, onReadout]);
  return (
    <canvas
      ref={ref}
      id={id}
      aria-label={label}
      onPointerMove={
        onReadout
          ? (pointer) => {
              const canvas = ref.current!,
                g = chartGeometry(canvas, wave, true, Number(radius));
              if (!g || !wave) return;
              const xx = pointer.clientX - canvas.getBoundingClientRect().left;
              const index = Math.max(
                g.first,
                Math.min(
                  g.last,
                  Math.round(
                    g.first +
                      ((xx - g.left) / (g.right - g.left)) * (g.last - g.first),
                  ),
                ),
              );
              drawChart(
                canvas,
                wave,
                item,
                true,
                Number(radius),
                preview,
                index,
              );
              onReadout(
                `Sample ${fmt(wave.start_sample + index)} · ${((preview && wave.repaired_channels) || wave.channels).map((channel, i) => `Ch ${i + 1}: ${channel[index].toFixed(7)}`).join(" · ")}`,
              );
            }
          : undefined
      }
      onPointerLeave={
        onReadout
          ? () => {
              drawChart(
                ref.current!,
                wave,
                item,
                true,
                Number(radius),
                preview,
              );
              onReadout("Hover to inspect a sample");
            }
          : undefined
      }
    />
  );
}
