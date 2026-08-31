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

  const load = async () => {
    const ref = parseGameRef(input);
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
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="chess.com game url or id, e.g. 172385979790"
          className="flex-1 !py-2 !text-sm"
        />
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-[var(--accent)] px-4 py-2 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--bg)] disabled:opacity-50"
        >
          {loading ? "fetching…" : "load game"}
        </button>
      </div>

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
          paste a chess.com game link — every move becomes a chord. pieces are
          jazz voicings, pawns are scale tones, captures add tension, and the
          board sings the whole game back to you.
        </p>
      )}
    </div>
  );
}
