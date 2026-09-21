import { useMemo } from "react";
import type { Candidate, Recording } from "../types/audio";

function timeLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function QuickMinimap({
  recording,
  candidates,
  currentId,
  selected,
  ignored,
  onSelect,
}: {
  recording: Recording | undefined;
  candidates: Candidate[];
  currentId: number | undefined;
  selected: Set<number>;
  ignored: Set<number>;
  onSelect: (id: number) => void;
}) {
  const overview = recording?.overview;
  const frames =
    overview?.frames ??
    Math.round(
      (recording?.stats.duration_seconds ?? 0) *
        (recording?.stats.sample_rate ?? 0),
    );
  const ordered = useMemo(
    () =>
      [...candidates].sort(
        (a, b) => a.sample_index - b.sample_index || a.id - b.id,
      ),
    [candidates],
  );
  const path = useMemo(() => {
    if (!overview?.buckets.length) return "";
    const scale = Math.max(1, ...overview.buckets.flat().map(Math.abs));
    return overview.buckets
      .map(([min, max], i) => {
        const x = ((i + 0.5) / overview.buckets.length) * 1000;
        return `M${x.toFixed(2)},${(50 - (max / scale) * 44).toFixed(2)}V${(50 - (min / scale) * 44).toFixed(2)}`;
      })
      .join(" ");
  }, [overview]);
  return (
    <section className="quick-minimap" aria-label="Recording overview">
      <div className="minimap-heading">
        <span>
          ● Candidate <span className="minimap-staged-key">◆ Staged</span>
          <span className="minimap-ignored-key">× Ignored</span>
        </span>
      </div>
      <div className="minimap-track">
        <svg
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="minimap-waveform"
        >
          <line x1="0" y1="50" x2="1000" y2="50" className="minimap-baseline" />
          <path d={path} vectorEffect="non-scaling-stroke" />
        </svg>
        {!path && (
          <span className="minimap-fallback">
            Waveform overview unavailable
          </span>
        )}
        <div
          className="minimap-markers"
          role="group"
          aria-label="Candidate markers. Use arrow keys to select and play candidates."
        >
          {ordered.map((candidate, index) => {
            const active = candidate.id === currentId;
            const staged = selected.has(candidate.id);
            const isIgnored = !staged && ignored.has(candidate.id);
            const label = `Candidate ${candidate.id + 1} at ${candidate.timestamp}, ${candidate.level} confidence${staged ? ", staged for repair" : isIgnored ? ", ignored" : ""}`;
            return (
              <button
                key={candidate.id}
                type="button"
                className="minimap-marker"
                data-staged={staged}
                data-ignored={isIgnored}
                aria-current={active ? "true" : undefined}
                aria-label={label}
                title={label}
                style={{
                  left: `${Math.max(0, Math.min(1, candidate.sample_index / Math.max(1, frames - 1))) * 100}%`,
                }}
                onClick={() => onSelect(candidate.id)}
                onKeyDown={(event) => {
                  if (
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.repeat
                  )
                    return;
                  let next = index;
                  if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
                  else if (event.key === "ArrowRight")
                    next = Math.min(ordered.length - 1, index + 1);
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = ordered.length - 1;
                  else return;
                  event.preventDefault();
                  event.stopPropagation();
                  const buttons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      "button",
                    );
                  buttons?.[next]?.focus({ preventScroll: true });
                  if (next !== index) onSelect(ordered[next].id);
                }}
              >
                <span aria-hidden="true">
                  {staged ? "◆" : isIgnored ? "×" : "●"}
                </span>
              </button>
            );
          })}
        </div>
        {!ordered.length && (
          <span className="minimap-empty">No candidates match this filter</span>
        )}
      </div>
      <div className="minimap-times mono">
        <span>0:00</span>
        <span>{timeLabel(recording?.stats.duration_seconds ?? 0)}</span>
      </div>
    </section>
  );
}
