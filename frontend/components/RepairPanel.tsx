import { useInspectorContext } from "../app/InspectorContext";

export function RepairPanel() {
  const m = useInspectorContext();
  const { s, recording, selected } = m;
  return (
    <section
      id="repair-panel"
      aria-label="Repair selected candidates"
      className={`repair-panel ${recording ? "" : "hidden"}`}
    >
      <div className="repair-toolbar">
        <div>
          <p className="eyebrow">SELECTIVE REPAIR</p>
          <h3 id="selection-summary">
            {selected.size
              ? `${selected.size} candidate${selected.size === 1 ? "" : "s"} selected for repair`
              : "No candidates selected"}
          </h3>
          <p id="repair-scope">
            {recording?.repair_error ||
              `${(recording?.events.length || 0) - selected.size} left unchanged in this recording. Selections include candidates hidden by filters.`}
          </p>
        </div>
        <button
          id="repair-export"
          type="button"
          className="button primary"
          disabled={
            !selected.size ||
            s.exporting ||
            s.status === "scanning" ||
            !!recording?.repair_error
          }
          onClick={() => void m.exportRepair()}
        >
          {s.exporting ? "Exporting & verifying…" : "Export repaired copy"}
        </button>
      </div>
      <p className="repair-note">
        New file, same format, sample rate, bit depth, channels, timing, and
        embedded metadata. Interpolation estimates missing audio; audition the
        result.
      </p>
      <div
        id="repair-result"
        role="status"
        aria-live="polite"
        className={s.exported?.fileId === s.fileId ? "" : "hidden"}
      >
        {s.exported?.fileId === s.fileId && s.exported && (
          <>
            <strong>{`Saved ${s.exported.repaired_candidates} repairs to a new ${s.exported.format} file.`}</strong>
            <span className="output-path">{s.exported.output}</span>
            <p>
              Verified: original checksum unchanged; every byte outside the
              selected repairs is identical.
            </p>
            <a href={s.exported.download_url} download>
              Download repaired audio
            </a>
            <a href={s.exported.report_url} download>
              Download verification report
            </a>
          </>
        )}
      </div>
    </section>
  );
}
