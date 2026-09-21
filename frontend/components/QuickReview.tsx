import { useInspectorContext } from "../app/InspectorContext";
import type { Confidence } from "../types/audio";
import { WaveformCanvas } from "./WaveformCanvas";
import { QuickMinimap } from "./QuickMinimap";
import { RepairPanel } from "./RepairPanel";

export function QuickReview() {
  const m = useInspectorContext();
  const { s, recording, item, selected, quickItem } = m;
  return (
    <section
      id="quick-dialog"
      aria-labelledby="quick-title"
      className="quick-page"
    >
      <div className="quick-heading">
        <h2 id="quick-title">{recording?.name || "Choose a recording"}</h2>
        <label>
          {"Confidence "}
          <select
            id="quick-filter"
            value={s.confidence}
            onChange={(e) => m.startQuickReview(e.target.value as Confidence)}
          >
            <option value="all">All confidence levels</option>
            <option value="high">High confidence</option>
            <option value="medium">Medium confidence</option>
            <option value="low">Low confidence</option>
          </select>
        </label>
      </div>
      <QuickMinimap
        recording={recording}
        candidates={s.queue}
        currentId={quickItem?.id}
        selected={selected}
        ignored={m.ignored}
        onSelect={m.jumpQuick}
      />
      <div className="quick-details">
        <span id="quick-progress" className="quick-detail">
          {quickItem
            ? `${s.quickIndex + 1} / ${s.queue.length}`
            : `End of review queue · ${s.queue.length} candidates`}
        </span>
        <span id="quick-time" className="mono">
          {quickItem
            ? quickItem.timestamp
            : `${selected.size} staged for repair`}
        </span>
        <span
          id="quick-confidence"
          data-confidence={quickItem?.level}
          className={`quick-detail ${quickItem ? "" : "hidden"}`}
        >
          {quickItem &&
            `${quickItem.level} confidence · ${quickItem.confidence.toFixed(3)}`}
        </span>
        <span
          id="quick-duration"
          className={`quick-detail ${quickItem ? "" : "hidden"}`}
        >
          {quickItem &&
            `${quickItem.duration_ms.toFixed(3)} ms · Ch ${quickItem.channels.join(", ")}`}
        </span>
        <span className="quick-protected">Original protected</span>
        {quickItem && (
          <label className="inline-control">
            Graph scale{" "}
            <select
              id="quick-sample-zoom"
              aria-label="Quick review graph scale"
              value={s.sampleZoom}
              onChange={(e) => m.patch({ sampleZoom: e.target.value })}
            >
              <option value="24">±24 samples</option>
              <option value="48">±48 samples</option>
              <option value="96">±96 samples</option>
              <option value="192">±192 samples</option>
            </select>
          </label>
        )}
      </div>
      <div className={`comparison-grid ${quickItem ? "" : "hidden"}`}>
        <article className="plot-card">
          <div className="plot-heading">
            <h3>Original</h3>
            <span className="pill">As recorded</span>
          </div>
          <div className="canvas-wrap">
            <WaveformCanvas
              id="quick-chart"
              label="Original sample waveform"
              wave={m.wave}
              item={item}
              zoom={true}
              radius={s.sampleZoom}
              preview={s.preview}
              mode="original"
              view={s.view}
            />
          </div>
        </article>
        <article className="plot-card">
          <div className="plot-heading">
            <h3>Suggested fix</h3>
            <span className="pill safe-pill">Estimated repair</span>
          </div>
          <div className="canvas-wrap">
            <WaveformCanvas
              id="quick-fixed-chart"
              label="Suggested repair waveform"
              wave={m.wave}
              item={item}
              zoom={true}
              radius={s.sampleZoom}
              preview={s.preview}
              mode="fixed"
              view={s.view}
            />
          </div>
          <p
            id="quick-fix-note"
            className={
              m.wave && !m.wave.repair_error ? "quick-chart-key" : undefined
            }
          >
            {m.wave?.repair_error ||
              (!m.wave
                ? "Loading waveform…"
                : "Only the shaded samples change. Dashed line shows the original.")}
          </p>
        </article>
      </div>
      <p
        id="quick-status"
        ref={m.quickStatusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
      >
        {quickItem
          ? m.quickStatus
          : "End of review queue. Revisit candidates using the timeline, or export your selected repairs below as a separate copy. Nothing has been exported yet."}
      </p>
      <div className="quick-actions">
        <button
          id="quick-back"
          className="button secondary"
          disabled={s.quickIndex <= 0}
          onClick={m.previousQuick}
        >
          P · Previous
        </button>
        <button
          id="quick-yes"
          className="button primary"
          disabled={!quickItem || !!quickItem.repair_error}
          title={quickItem?.repair_error || "Stage this candidate for repair"}
          onClick={() => m.decideQuick(true)}
        >
          Y · Stage repair
        </button>
        <button
          id="quick-no"
          className="button secondary"
          disabled={!quickItem}
          ref={m.quickNo}
          onClick={() => m.decideQuick(false)}
        >
          N · Ignore
        </button>
        <button
          id="quick-replay"
          className="button secondary"
          disabled={!quickItem}
          onClick={m.replayQuick}
        >
          M · Replay
        </button>
      </div>
      <div id="quick-repair-slot">{s.view === "quick" && <RepairPanel />}</div>
    </section>
  );
}
