"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Board from "./Board";
import MappingControls from "./MappingControls";
import EvalSparkline from "./EvalSparkline";
import EvalBar from "./EvalBar";
import { formatMs } from "@/lib/clock";
import { loadGame, parseGameRef, type LoadedGame } from "@/lib/chesscom";
import { EB_G_JAZZ, type MusicConfig } from "@/lib/music/config";
import { initAudio, moveGapMs, playMove, stopAll } from "@/lib/music/engine";
import { StockfishEvaluator } from "@/lib/eval/stockfish";

/** Real chess.com bullet games to try when you don't have one handy. */
interface ExampleGame {
  id: string;
  white: string;
  whiteElo: number;
  black: string;
  blackElo: number;
  /** "w" | "b" */
  winner: "w" | "b";
  ending: string;
  moves: number;
  date: string;
  opening: string;
}

const EXAMPLE_GAMES: ExampleGame[] = [
  { id: "183548311187", white: "Hikaru", whiteElo: 3423, black: "Oleksandr_Bortnyk", blackElo: 3255, winner: "w", ending: "on time", moves: 75, date: "Sep 12, 2026", opening: "Nimzo-Larsen Attack" },
  { id: "182334502199", white: "Hikaru", whiteElo: 3417, black: "nihalsarin", blackElo: 3340, winner: "w", ending: "by checkmate", moves: 38, date: "Aug 29, 2026", opening: "French Defense" },
  { id: "183548910743", white: "Njal28", whiteElo: 3143, black: "Hikaru", blackElo: 3418, winner: "b", ending: "by resignation", moves: 46, date: "Sep 12, 2026", opening: "Modern Defense" },
  { id: "174103536382", white: "Witty_Alien", whiteElo: 2870, black: "penguingm1", blackElo: 3150, winner: "b", ending: "by resignation", moves: 39, date: "Sep 6, 2026", opening: "Caro-Kann Defense" },
  { id: "173944087710", white: "Alex-11211", whiteElo: 2914, black: "Witty_Alien", blackElo: 2900, winner: "b", ending: "on time", moves: 55, date: "Sep 3, 2026", opening: "Vienna Game" },
  { id: "174405753758", white: "javicio", whiteElo: 2880, black: "Witty_Alien", blackElo: 2865, winner: "w", ending: "by checkmate", moves: 35, date: "Sep 13, 2026", opening: "Center Game" },
];

type EvalState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "done" };

export default function Sonify() {
  const [input, setInput] = useState("");
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<MusicConfig>(EB_G_JAZZ);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // ply = number of moves already played (0 = start position)
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playTokenRef = useRef(0);

  const [evalState, setEvalState] = useState<EvalState>({ status: "idle" });
  const evaluatorRef = useRef<StockfishEvaluator | null>(null);

  const stop = useCallback(() => {
    playTokenRef.current++;
    setPlaying(false);
    stopAll();
  }, []);

  useEffect(() => {
    const tokens = playTokenRef;
    const evals = evaluatorRef;
    return () => {
      tokens.current++;
      evals.current?.dispose();
    };
  }, []);

  const load = async (source: string = input) => {
    const ref = parseGameRef(source);
    if (!ref) {
      setError("that doesn't look like a chess.com game id or url");
      return;
    }
    stop();
    setLoading(true);
    setError(null);
    setGame(null);
    setPly(0);
    setEvalState({ status: "idle" });
    try {
      const g = await loadGame(ref);
      if (g.moves.length === 0) throw new Error("game has no moves");
      setGame(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load game");
    } finally {
      setLoading(false);
    }
  };

  // run stockfish analysis when eval is switched on for a loaded game
  useEffect(() => {
    if (!config.eval.enabled || !game) return;
    let cancelled = false;
    const total = game.moves.length;
    if (game.moves[0]?.evalCp !== undefined) {
      queueMicrotask(() => {
        if (!cancelled) setEvalState((s) => (s.status === "done" ? s : { status: "done" }));
      });
      return () => {
        cancelled = true;
      };
    }
    const evaluator = new StockfishEvaluator();
    evaluatorRef.current?.dispose();
    evaluatorRef.current = evaluator;
    queueMicrotask(() => {
      if (!cancelled) setEvalState({ status: "running", done: 0, total });
    });

    evaluator
      .evalPositions(
        game.moves.map((m) => m.fenAfter),
        config.eval.depth,
        (done, total) => {
          if (!cancelled) setEvalState({ status: "running", done, total });
        },
      )
      .then((cps) => {
        if (cancelled) return;
        setGame((g) => {
          if (!g) return g;
          const moves = g.moves.map((m, i) => ({
            ...m,
            evalCp: cps[i],
            evalSwingCp: cps[i] - (i > 0 ? cps[i - 1] : 0),
          }));
          return { ...g, moves };
        });
        setEvalState({ status: "done" });
      })
      .catch(() => {
        if (!cancelled) setEvalState({ status: "idle" });
      });

    return () => {
      cancelled = true;
      evaluator.dispose();
      if (evaluatorRef.current === evaluator) evaluatorRef.current = null;
    };
  }, [config.eval.enabled, config.eval.depth, game]);

  const play = async (fromPly?: number) => {
    if (!game) return;
    await initAudio(configRef.current.instrument);
    const token = ++playTokenRef.current;
    setPlaying(true);

    let i = fromPly ?? ply;
    if (i >= game.moves.length) i = 0;

    const step = () => {
      if (token !== playTokenRef.current) return;
      if (i >= game.moves.length) {
        setPlaying(false);
        return;
      }
      const move = game.moves[i];
      playMove(move, configRef.current);
      i++;
      setPly(i);
      const next = i < game.moves.length ? game.moves[i] : null;
      if (next) {
        setTimeout(step, moveGapMs(next, configRef.current));
      } else {
        setPlaying(false);
      }
    };
    step();
  };

  const seek = (n: number) => {
    stop();
    setPly(n);
  };

  const currentFen =
    game === null ? undefined : ply === 0 ? game.startFen : game.moves[ply - 1].fenAfter;
  const lastMove = game && ply > 0 ? game.moves[ply - 1] : null;

  const white = String(game?.headers.White ?? "white");
  const black = String(game?.headers.Black ?? "black");

  // remaining clock (tenths of seconds) for a side at the current ply
  const clockAtPly = (color: "w" | "b"): number | null => {
    if (!game) return null;
    for (let i = Math.min(ply, game.moves.length) - 1; i >= 0; i--) {
      if (game.moves[i].color === color) return game.moves[i].clockTenths;
    }
    return game.baseTimeTenths;
  };
  const sideToMove: "w" | "b" = ply % 2 === 0 ? "w" : "b";
  const gameOngoing = game !== null && ply < game.moves.length;

  const clockChip = (color: "w" | "b") => {
    const tenths = clockAtPly(color);
    if (tenths === null) return null;
    const active = gameOngoing && sideToMove === color;
    return (
      <span
        className={`rounded border px-2 py-0.5 font-mono text-xs tabular-nums ${
          active
            ? "border-[var(--accent)] text-[var(--accent)]"
            : "border-[var(--border)] text-[var(--text-dim)]"
        }`}
      >
        {formatMs(tenths * 100)}
      </span>
    );
  };

  const currentCp =
    game === null || !config.eval.enabled
      ? undefined
      : ply === 0
        ? evalState.status === "done"
          ? 0
          : undefined
        : game.moves[ply - 1].evalCp;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
          placeholder="chess.com game url or id, e.g. 172385979790"
          className="flex-1 !py-2 !text-sm"
        />
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-[var(--accent)] px-4 py-2 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--bg)] disabled:opacity-50"
        >
          {loading ? "fetching…" : "load game"}
        </button>
      </div>

      {!game && !loading && (
        <section aria-labelledby="examples-heading" className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 id="examples-heading" className="text-sm font-medium text-[var(--text-primary)]">
              No game handy? Try one of these
            </h2>
            <span className="text-xs text-[var(--text-dim)]">real 1+0 bullet games</span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLE_GAMES.map((g) => {
              const players: { name: string; elo: number; side: "w" | "b" }[] = [
                { name: g.white, elo: g.whiteElo, side: "w" },
                { name: g.black, elo: g.blackElo, side: "b" },
              ];
              const winnerName = g.winner === "w" ? g.white : g.black;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setInput(g.id);
                      void load(g.id);
                    }}
                    className="group w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-white focus:outline-none focus-visible:border-[var(--accent)]"
                  >
                    <div className="space-y-1">
                      {players.map((p) => (
                        <div key={p.side} className="flex items-center gap-2 text-sm">
                          <span
                            aria-hidden
                            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-[var(--border)] ${
                              p.side === "w" ? "bg-white" : "bg-[var(--text-primary)]"
                            }`}
                          />
                          <span
                            className={`truncate ${
                              p.side === g.winner
                                ? "font-semibold text-[var(--text-primary)]"
                                : "text-[var(--text-dim)]"
                            }`}
                          >
                            {p.name}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-xs text-[var(--text-dim)]">
                            {p.elo}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-dim)]">
                      <span className="text-[var(--text-primary)]">
                        {winnerName} won {g.ending}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{g.moves} moves</span>
                      <span aria-hidden>·</span>
                      <span>{g.opening}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-[var(--accent-dim)]">
                      <span>{g.date}</span>
                      <span className="text-[var(--accent)] opacity-0 transition-opacity group-hover:opacity-100">
                        load &rarr;
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          error: {error}
        </p>
      )}

      {game && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="w-full max-w-md space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-dim)]">
              <span className="truncate">{black}</span>
              {clockChip("b")}
            </div>
            <div className="flex items-stretch gap-2">
              {config.eval.enabled && <EvalBar cp={currentCp} />}
              <div className="min-w-0 flex-1">
                <Board fen={currentFen!} lastMove={lastMove} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-dim)]">
              <span className="truncate">{white}</span>
              {clockChip("w")}
            </div>
            <div className="flex justify-between text-xs text-[var(--text-dim)]">
              <span>{String(game.headers.Result ?? "")}</span>
              <span>
                {ply}/{game.moves.length}
                {lastMove ? ` · ${lastMove.san}` : ""}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => (playing ? stop() : play())}
                className="w-20 rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--bg)]"
              >
                {playing ? "pause" : ply >= game.moves.length ? "replay" : "play"}
              </button>
              <input
                type="range"
                min={0}
                max={game.moves.length}
                value={ply}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1"
              />
            </div>

            {config.eval.enabled && (
              <div className="space-y-1">
                {evalState.status === "running" && (
                  <p className="text-[11px] text-[var(--text-dim)]">
                    analyzing… {evalState.done}/{evalState.total}
                  </p>
                )}
                {evalState.status === "done" && (
                  <EvalSparkline
                    cps={game.moves.map((m) => m.evalCp ?? 0)}
                    ply={ply}
                    onSeek={seek}
                  />
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <MappingControls config={config} onChange={setConfig} />
          </div>
        </div>
      )}

      {!game && !error && (
        <p className="text-sm text-[var(--text-dim)]">
          paste a game link or id to start
        </p>
      )}
    </div>
  );
}
