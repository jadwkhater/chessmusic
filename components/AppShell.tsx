"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const Sonify = dynamic(() => import("./Sonify"), { ssr: false });
const Play = dynamic(() => import("./Play"), { ssr: false });

type Mode = "sonify" | "play";

const TABS: { id: Mode; label: string }[] = [
  { id: "sonify", label: "Sonify" },
  { id: "play", label: "Play" },
];

export default function AppShell() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get("mode") === "play" || searchParams.get("room")
      ? "play"
      : "sonify",
  );

  return (
    <main className="min-h-screen bg-white">
      <nav className="sticky top-0 z-30 border-b border-[var(--border)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto px-4 py-3 text-sm">
          <span className="mr-4 whitespace-nowrap font-semibold text-[var(--text-primary)]">
            Chess Music
          </span>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 transition-colors ${
                mode === t.id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-dim)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {mode === "sonify" ? (
          <section>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              Hear the game
            </h1>
            <p className="mt-1 mb-6 text-sm text-[var(--text-dim)]">
              Any chess.com game, played back as music.
            </p>
            <Sonify />
          </section>
        ) : (
          <section>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              Play a friend
            </h1>
            <p className="mt-1 mb-6 text-sm text-[var(--text-dim)]">
              Live chess with clocks. Share a link to start.
            </p>
            <Play />
          </section>
        )}
      </div>

      <footer className="border-t border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--accent-dim)]">
        built by Jad Khater · chord rules by{" "}
        <a
          href="https://www.instagram.com/matthewsinstagram"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[var(--accent)]"
        >
          @matthewsinstagram
        </a>
      </footer>
    </main>
  );
}
