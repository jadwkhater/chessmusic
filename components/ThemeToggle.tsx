"use client";
import { useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined") {
      const current = document.documentElement.dataset.theme;
      if (current === "light" || current === "dark") return current;
    }
    return "dark";
  });

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={`switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="ml-auto whitespace-nowrap rounded-md border border-[var(--border)] px-2.5 py-1 font-mono text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      suppressHydrationWarning
    >
      {theme === "dark" ? "sun" : "moon"}
    </button>
  );
}
