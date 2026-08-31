"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const Sonify = dynamic(() => import("./Sonify"), { ssr: false });
const Play = dynamic(() => import("./Play"), { ssr: false });

type Mode = "sonify" | "play";

export default function AppShell() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get("mode") === "play" || searchParams.get("room")
      ? "play"
      : "sonify",
  );

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <nav className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 font-mono text-sm">
          <span className="mr-3 whitespace-nowrap text-[var(--accent)]">
            chess-music
          </span>
          {(["sonify", "play"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`whitespace-nowrap rounded-t-md border-b-2 px-3 py-1.5 transition-colors ${
                mode === m
                  ? "border-[var(--accent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
              }`}
            >
              ~/{m}
            </button>
          ))}
          <ThemeToggle />
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {mode === "sonify" ? (
          <section>
            <h1 className="font-mono text-xl text-[var(--text-primary)]">
              hear the game
            </h1>
            <p className="mt-1 mb-8 max-w-2xl font-mono text-sm text-[var(--text-dim)]">
              turn any chess.com game into music. tweak the keys, scales, and
              chord voicings — or let stockfish&apos;s evaluation bend the sound.
            </p>
            <Sonify />
          </section>
        ) : (
          <section>
            <h1 className="font-mono text-xl text-[var(--text-primary)]">
              play a friend
            </h1>
            <p className="mt-1 mb-8 max-w-2xl font-mono text-sm text-[var(--text-dim)]">
              live chess with real clocks. create a room, share the link, and
              optionally hear your game as you play it.
            </p>
            <Play />
          </section>
        )}
      </div>

      <footer className="border-t border-[var(--border)] px-4 py-8 text-center font-mono text-xs text-[var(--accent-dim)]">
        built by Jad Khater · {new Date().getFullYear()}
      </footer>
    </main>
  );
}
