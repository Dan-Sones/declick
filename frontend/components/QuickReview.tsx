import { useInspectorContext } from "../app/InspectorContext";
import type { Confidence } from "../types/audio";
import { WaveformCanvas } from "./WaveformCanvas";
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
        <div>
          <p className="eyebrow">LISTEN. DECIDE. NEXT.</p>
          <h2 id="quick-title">Quick review</h2>
          <p id="quick-recording">{recording?.name}</p>
        </div>
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
      <div className="quick-pills">
        <span id="quick-progress" className="pill">
          {quickItem
            ? `${s.quickIndex + 1} / ${s.queue.length}`
            : `Review complete · ${s.queue.length} candidates reviewed`}
        </span>
        <span id="quick-time" className="pill mono">
          {quickItem
            ? quickItem.timestamp
            : `${selected.size} staged for repair`}
        </span>
        <span
          id="quick-confidence"
          data-confidence={quickItem?.level}
          className={`pill ${quickItem ? "" : "hidden"}`}
        >
          {quickItem &&
            `${quickItem.level} confidence · ${quickItem.confidence.toFixed(3)}`}
        </span>
        <span
          id="quick-duration"
          className={`pill ${quickItem ? "" : "hidden"}`}
        >
          {quickItem &&
            `${quickItem.duration_ms.toFixed(3)} ms · Ch ${quickItem.channels.join(", ")}`}
        </span>
        <span className="pill safe-pill">Original protected</span>
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
          <p id="quick-fix-note">
            {m.wave?.repair_error ||
              (!m.wave
                ? "Loading waveform…"
                : "Only the shaded samples change. Dashed line shows the original.")}
          </p>
        </article>
      </div>
      <p id="quick-status" role="status" aria-live="polite">
        {quickItem
          ? m.quickStatus
          : "All done. Export your selected repairs below as a separate copy. Nothing has been exported yet."}
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
      <p>
        P goes back · Y stages · N leaves unchanged · M replays original. Going
        back keeps your decisions; press Y or N to revise them. Export a new
        copy when ready.
      </p>
      <button
        id="quick-restart"
        className="button secondary small"
        ref={m.quickRestart}
        onClick={() => m.startQuickReview()}
      >
        Review again
      </button>
      <div id="quick-repair-slot">{s.view === "quick" && <RepairPanel />}</div>
    </section>
  );
}
