import { useInspectorContext } from "../app/InspectorContext";
import { fmt } from "../lib/format";
import { WaveformCanvas } from "./WaveformCanvas";
import { useState } from "react";

const measures: [string, string, (n: number) => string][] = [
  ["zero_run_samples", "Exact zero run", (n) => `${n} samples`],
  [
    "interpolation_residual_mad",
    "Interpolation residual",
    (n) => `${n.toFixed(1)} MAD`,
  ],
  [
    "neighbour_discontinuity_mad",
    "Neighbour discontinuity",
    (n) => `${n.toFixed(1)} MAD`,
  ],
  ["isolation_score", "Curvature isolation", (n) => `${n.toFixed(1)}×`],
  [
    "curvature_concentration",
    "Curvature concentration",
    (n) => `${(100 * n).toFixed(1)}%`,
  ],
  [
    "hf_burst_db",
    "HF energy vs. surroundings",
    (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} dB`,
  ],
];

export function Detail() {
  const m = useInspectorContext();
  const { s, recording, item, events } = m;
  const stats = recording?.stats;
  const position = events.findIndex((candidate) => candidate.id === item?.id);
  const [readout, setReadout] = useState("Hover to inspect a sample");
  return (
    <div id="detail" className={item ? "" : "hidden"}>
      <div className="detail-heading">
        <div className="detail-title">
          <p className="eyebrow">WAVEFORM INSPECTOR</p>
          <h2 id="recording-name">{recording?.name}</h2>
          <p id="recording-meta" className="mono muted">
            {stats
              ? `${fmt(stats.sample_rate)} Hz · ${stats.bit_depth ? `${stats.bit_depth}-bit` : stats.subtype} · ${stats.channels === 1 ? "Mono" : `${stats.channels} channels`} · ${fmt(stats.duration_seconds, 2)} s · Peak ${stats.peak_dbfs.toFixed(2)} dBFS`
              : ""}
          </p>
        </div>
        <div className="candidate-nav">
          <button
            id="previous"
            className="icon-button"
            aria-label="Previous candidate"
            onClick={() => m.navigate(-1)}
            disabled={position <= 0}
          >
            ←
          </button>
          <span
            id="position"
            className="mono"
          >{`${position + 1} / ${events.length}`}</span>
          <button
            id="next"
            className="icon-button"
            aria-label="Next candidate"
            onClick={() => m.navigate(1)}
            disabled={position >= events.length - 1}
          >
            →
          </button>
        </div>
      </div>
      <div className="event-summary">
        <div className="time-summary">
          <span className="eyebrow">FILE POSITION</span>
          <div>
            <span id="event-time" className="event-time mono" ref={m.timestamp}>
              {item?.timestamp}
            </span>
            <button
              id="copy-time"
              className="copy-button"
              aria-label="Copy timestamp"
              title="Copy timestamp"
              onClick={() => void m.copyTime()}
            >
              {m.copyLabel}
            </button>
          </div>
          <span id="event-sample" className="mono muted">
            {item && `Sample ${fmt(item.sample_index)} · zero-based`}
          </span>
        </div>
        <div className="event-metric">
          <span className="eyebrow">CONFIDENCE</span>
          <strong id="event-confidence">
            {item && (
              <>
                <span className="mono">{item.confidence.toFixed(3)}</span>
                <span className="level-tag">{item.level.toUpperCase()}</span>
              </>
            )}
          </strong>
          <small>Heuristic score</small>
        </div>
        <div className="event-metric">
          <span className="eyebrow">DURATION</span>
          <strong id="event-duration" className="mono">
            {item && `${item.duration_ms.toFixed(3)} ms`}
          </strong>
          <small id="event-length">
            {item &&
              `${item.duration_samples} sample${item.duration_samples === 1 ? "" : "s"}`}
          </small>
        </div>
        <div className="event-metric">
          <span className="eyebrow">CHANNELS</span>
          <strong id="event-channels" className="mono">
            {item?.channels.join(", ")}
          </strong>
          <small id="event-kind">{item?.kind}</small>
        </div>
      </div>

      <div className="repair-preview-controls">
        <label>
          <input
            type="checkbox"
            id="preview-repair"
            checked={s.preview}
            disabled={!item || !!item.repair_error}
            onChange={(e) => m.patch({ preview: e.target.checked })}
          />{" "}
          Preview proposed repair
        </label>
        <span id="repair-preview-note">
          {item?.repair_error ||
            (s.preview
              ? "Proposed repair in colour · original in grey"
              : "Original waveform")}
        </span>
      </div>
      <div id="plot-status" role="status" className="plot-status">
        {m.plotStatus}
      </div>
      <article className="plot-card">
        <div className="plot-heading">
          <div>
            <h3>Waveform context</h3>
            <span className="plot-caption">
              The event in its musical surroundings
            </span>
          </div>
          <label className="inline-control">
            Window{" "}
            <select
              id="context-size"
              aria-label="Waveform context window"
              value={s.contextSize}
              onChange={(e) => m.patch({ contextSize: e.target.value })}
            >
              <option value="20">20 ms</option>
              <option value="50">50 ms</option>
              <option value="100">100 ms</option>
            </select>
          </label>
        </div>
        <div className="canvas-wrap">
          <WaveformCanvas
            id="context-chart"
            label="Audio waveform around the selected candidate"
            wave={m.wave}
            item={item}
            zoom={false}
            radius={s.sampleZoom}
            preview={s.preview}
            mode="auto"
            view={s.view}
          />
        </div>
        <div className="plot-footer">
          <span id="channel-legend">
            {Array.from({ length: stats?.channels || 0 }, (_, index) => (
              <span key={index} className={`channel-key c${index % 6}`}>
                Ch {index + 1}
              </span>
            ))}
          </span>
          <span>
            <i className="event-line"></i>Detected position
          </span>
        </div>
      </article>

      <article className="plot-card">
        <div className="plot-heading">
          <div>
            <h3>Sample-level detail</h3>
            <span className="plot-caption">
              Individual samples reveal the shape of the interruption
            </span>
          </div>
          <label className="inline-control">
            Zoom{" "}
            <select
              id="sample-zoom"
              aria-label="Sample-level zoom"
              value={s.sampleZoom}
              onChange={(e) => m.patch({ sampleZoom: e.target.value })}
            >
              <option value="24">±24 samples</option>
              <option value="48">±48 samples</option>
              <option value="96">±96 samples</option>
              <option value="192">±192 samples</option>
            </select>
          </label>
        </div>
        <div className="canvas-wrap">
          <WaveformCanvas
            id="sample-chart"
            label="Individual audio samples around the selected candidate"
            wave={m.wave}
            item={item}
            zoom={true}
            radius={s.sampleZoom}
            preview={s.preview}
            mode="auto"
            view={s.view}
            onReadout={setReadout}
          />
        </div>
        <div className="plot-footer">
          <span id="sample-readout" className="mono">
            {readout}
          </span>
          <span>
            <i className="region-swatch"></i>Approximate event span
          </span>
        </div>
      </article>

      <div className="lower-grid">
        <article className="listen-card">
          <p className="eyebrow">LISTEN &amp; VERIFY</p>
          <h3>Hear it in context.</h3>
          <p>Original level. Up to one second either side of the candidate.</p>
          <audio
            id="audio-preview"
            controls
            preload="none"
            aria-label="Audio preview of selected candidate"
            ref={m.audioRef}
            onError={() => {
              if (item)
                m.setPlotStatus(
                  "Preview could not be loaded. The source may have moved or changed; try scanning again.",
                );
            }}
          ></audio>
          <p className="fine-print">
            {s.preview
              ? "Proposed repair preview with 10 ms edge fades. Export uses exactly the checked candidates, without fades."
              : "Original audio with 10 ms preview-only edge fades. No normalization."}
          </p>
        </article>
        <article className="evidence-card">
          <div className="evidence-title">
            <h3>Why this candidate?</h3>
            <span className="eyebrow">SIGNAL EVIDENCE</span>
          </div>
          <dl id="evidence">
            {measures
              .filter(([key]) => item?.evidence[key] !== undefined)
              .map(([key, label, format]) => (
                <div key={key} className="evidence-row">
                  <dt>{label}</dt>
                  <dd>{format(Number(item!.evidence[key]))}</dd>
                </div>
              ))}
          </dl>
        </article>
      </div>
      <div className="detail-foot">
        <span>
          Times are relative to the source file. Account for region offsets in
          Logic.
        </span>
        <span>
          <kbd>←</kbd> <kbd>→</kbd> Browse candidates
        </span>
      </div>
    </div>
  );
}
