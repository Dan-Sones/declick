import { useInspectorContext } from "../app/InspectorContext";

export function Header() {
  const m = useInspectorContext();
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
      </div>
    </header>
  );
}
