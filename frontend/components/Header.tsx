import { useInspectorContext } from "../app/InspectorContext";
import type { Theme } from "../hooks/useTheme";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: Props) {
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
        <button
          id="theme-toggle"
          className="button secondary small theme-toggle"
          type="button"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-pressed={theme === "dark"}
          onClick={onToggleTheme}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </header>
  );
}
