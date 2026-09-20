import { InspectorContext } from "./InspectorContext";
import { useInspector } from "../hooks/useInspector";
import { Header } from "../components/Header";
import { Home } from "../components/Home";
import { Sidebar } from "../components/Sidebar";
import { RepairPanel } from "../components/RepairPanel";
import { EmptyState } from "../components/EmptyState";
import { Detail } from "../components/Detail";
import { QuickReview } from "../components/QuickReview";

export function App() {
  const m = useInspector();
  const { s } = m;
  return (
    <InspectorContext.Provider value={m}>
      <Header />
      <main>
        <Home />
        <nav id="view-nav" className="view-nav">
          <button
            id="go-home"
            className="button secondary small"
            onClick={() => m.patch({ view: "home" })}
          >
            ← Choose recording
          </button>
          <div>
            <button
              id="go-quick"
              onClick={m.goQuick}
              className={`button ${s.view === "quick" ? "primary" : "secondary"} small`}
              aria-pressed={s.view === "quick"}
            >
              Quick review
            </button>
            <button
              id="go-detail"
              onClick={() => m.patch({ view: "detail" })}
              className={`button ${s.view === "detail" ? "primary" : "secondary"} small`}
              aria-pressed={s.view === "detail"}
            >
              Detailed analysis
            </button>
          </div>
        </nav>
        <QuickReview />
        <section className="intro">
          <div>
            <p className="eyebrow">A CLOSER LISTEN</p>
            <h1>Find the interruption.</h1>
            <p className="subtitle">
              Inspect the tiny details behind unwanted clicks and pops.
            </p>
          </div>
          <div className="source-note">
            <span aria-hidden="true">◈</span>
            <div>
              Repair to a new copy
              <small>Your source audio stays untouched.</small>
            </div>
          </div>
        </section>

        <form
          id="scan-form"
          className="scan-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void m.scan();
          }}
        >
          <div className="path-field">
            <label htmlFor="source-path">AUDIO FILE OR SESSION FOLDER</label>
            <input
              id="source-path"
              name="path"
              placeholder="/path/to/recording.aif or /path/to/session/"
              required
              spellCheck="false"
              autoComplete="off"
              value={s.sourcePath}
              onChange={(e) => m.patch({ sourcePath: e.target.value })}
            />
          </div>
          <div className="sensitivity-field">
            <label htmlFor="sensitivity">SENSITIVITY</label>
            <select
              id="sensitivity"
              value={s.sensitivity}
              onChange={(e) => m.patch({ sensitivity: e.target.value })}
            >
              <option value="conservative">Conservative</option>
              <option value="normal">Normal</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <button
            id="scan-button"
            className="button primary"
            type="submit"
            disabled={s.status === "scanning"}
          >
            <span aria-hidden="true">⌕</span> Scan audio
          </button>
        </form>
        <div className="scan-footer">
          <span>
            WAV &amp; AIFF · Folders are scanned recursively · All processing
            stays on this computer
          </span>
          <span id="scan-status" role="status" aria-live="polite">
            {s.scanStatus}
          </span>
        </div>
        <div
          id="error"
          role="alert"
          className={`error ${s.error ? "" : "hidden"}`}
        >
          {s.error}
        </div>

        <section className="workspace" aria-label="Detection results">
          <Sidebar />

          <section id="inspector" className="inspector">
            {s.view !== "quick" && <RepairPanel />}
            <EmptyState />
            <Detail />
          </section>
        </section>
        <footer className="page-foot">
          <span>
            Declick <span className="muted">/</span> A little closer to a clean
            take.
          </span>
          <span>LOCAL AUDIO ANALYSIS</span>
        </footer>
      </main>
    </InspectorContext.Provider>
  );
}
