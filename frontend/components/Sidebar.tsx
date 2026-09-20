import { useInspectorContext } from "../app/InspectorContext";
import { fmt } from "../lib/format";
import type { Confidence } from "../types/audio";

export function Sidebar() {
  const m = useInspectorContext();
  const { s, recording, events, selected } = m;
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <h2>Recordings</h2>
        <span id="file-count" className="count">
          {s.files.length}
        </span>
      </div>
      <div id="files" className="file-list">
        {s.files.length ? (
          s.files.map((file) => (
            <button
              key={file.id}
              className={`file-button ${file.id === s.fileId ? "selected" : ""}`}
              aria-pressed={file.id === s.fileId}
              title={file.path}
              onClick={() => m.selectFile(file.id)}
            >
              <span className="file-name">{file.name}</span>
              <span className="file-meta">
                {`${file.events.length} candidates · ${fmt(file.stats.sample_rate / 1000, 1)} kHz · ${file.stats.channels === 1 ? "Mono" : `${file.stats.channels} channels`}`}
              </span>
            </button>
          ))
        ) : (
          <p className="sidebar-empty">
            {s.status === "scanning"
              ? "Analysing the waveform…"
              : "Your scanned recordings will appear here."}
          </p>
        )}
      </div>
      <div className="candidate-heading">
        <div className="sidebar-heading">
          <h2>Candidates</h2>
          <span id="candidate-count" className="count">
            {events.length}
          </span>
        </div>
        <div className="filters">
          <select
            id="confidence-filter"
            aria-label="Filter candidates by confidence"
            value={s.confidence}
            onChange={(e) => m.filter(e.target.value as Confidence)}
          >
            <option value="all">All confidence levels</option>
            <option value="high">High confidence</option>
            <option value="medium">Medium confidence</option>
            <option value="low">Low confidence</option>
          </select>
          <select
            id="sort-order"
            aria-label="Sort candidates"
            value={s.sort}
            onChange={(e) => m.filter(s.confidence, e.target.value)}
          >
            <option value="time">Time ↑</option>
            <option value="score">Score ↓</option>
          </select>
        </div>
      </div>
      <div className="selection-tools">
        <button
          id="select-shown"
          type="button"
          title="Select all repairable candidates matching the active confidence filter. Existing selections are kept."
          onClick={() => m.selectShown()}
          disabled={s.exporting || !events.some((item) => !item.repair_error)}
        >
          Select all
        </button>
        <button
          id="clear-selection"
          type="button"
          onClick={() => m.selectShown(true)}
          disabled={s.exporting || !selected.size}
        >
          Clear selections
        </button>
        <span>Checked = repair · Select all respects the filter</span>
      </div>
      <button
        id="quick-start"
        className="button secondary small"
        type="button"
        onClick={() => m.startQuickReview()}
        disabled={s.exporting || s.status === "scanning" || !events.length}
      >
        Quick review · Y / N
      </button>
      <div id="candidates" className="candidate-list" ref={m.candidateList}>
        {events.length ? (
          events.map((item) => (
            <div
              key={item.id}
              className={`candidate-row ${selected.has(item.id) ? "chosen" : ""}`}
            >
              <button
                className={`candidate-button ${item.id === s.eventId ? "selected" : ""}`}
                aria-pressed={item.id === s.eventId}
                aria-label={`${item.timestamp}, ${item.level} confidence ${item.confidence.toFixed(3)}`}
                onClick={() => m.selectEvent(item.id)}
              >
                <span className="candidate-top">
                  <span className="candidate-time">{item.timestamp}</span>
                  <span className={`candidate-score ${item.level}`}>
                    {item.confidence.toFixed(3)}
                  </span>
                </span>
                <span className="candidate-bottom">
                  <span>
                    {item.kind === "exact-zero dropout"
                      ? "Zero-sample dropout"
                      : "Short discontinuity"}
                  </span>
                  <span className="mono">{item.duration_ms.toFixed(3)} ms</span>
                </span>
              </button>
              <input
                type="checkbox"
                className="candidate-check"
                checked={selected.has(item.id)}
                disabled={!!item.repair_error || s.exporting}
                aria-label={`Repair candidate at ${item.timestamp}`}
                title={
                  item.repair_error ||
                  "Check to include this candidate in the repaired copy"
                }
                onChange={(e) => m.toggleRepair(item.id, e.target.checked)}
              />
            </div>
          ))
        ) : (
          <p className="sidebar-empty">
            {recording
              ? "No candidates match this view."
              : "Select a recording to inspect its candidates."}
          </p>
        )}
      </div>
      <div className="sidebar-foot">
        <span className="legend-dot"></span> Candidates need listening
        validation.
      </div>
    </aside>
  );
}
