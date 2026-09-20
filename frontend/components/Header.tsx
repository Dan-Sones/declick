import { useInspectorContext } from "../app/InspectorContext";

export function Header() {
  const m = useInspectorContext();
  const { s } = m;
  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        aria-label="Declick home"
        onClick={(e) => {
          e.preventDefault();
          m.patch({ view: "home" });
        }}
      >
        <span className="brand-mark" aria-hidden="true">
          ⌁
        </span>
        <span>
          Declick <span className="brand-sub">AUDIO INSPECTOR</span>
        </span>
      </a>
      <div className="topbar-right">
        <span className="local-indicator">Local workspace</span>
        <a
          id="export"
          href="/api/report.csv"
          download
          className={`button secondary small ${s.files.length ? "" : "disabled"}`}
          aria-disabled={!s.files.length}
        >
          ↓ Export CSV
        </a>
      </div>
    </header>
  );
}
