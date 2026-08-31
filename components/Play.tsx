"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import Board from "./Board";
import type { AnnotatedMove } from "@/lib/chesscom";
import { EB_G_JAZZ } from "@/lib/music/config";
import { initAudio, playMove } from "@/lib/music/engine";
import {
  formatMs,
  makeClock,
  pressClock,
  readClock,
  useClockDisplay,
  type ClockState,
} from "@/lib/clock";
import {
  TIME_CONTROLS,
  getPlayerId,
  joinRoom,
  makeRoomCode,
  supabaseConfigured,
  type Room,
  type RoomMsg,
  type TimeControl,
} from "@/lib/realtime";

type Phase =
  | { p: "lobby" }
  | { p: "waiting"; code: string; isHost: boolean; tc: TimeControl }
  | { p: "playing"; code: string }
  | { p: "over"; code: string; reason: string };

export default function Play() {
  const searchParams = useSearchParams();

  const [phase, setPhase] = useState<Phase>({ p: "lobby" });
  const [joinCode, setJoinCode] = useState("");
  const [tc, setTc] = useState<TimeControl>(TIME_CONTROLS[1]);
  const [myColor, setMyColor] = useState<"w" | "b" | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [clock, setClock] = useState<ClockState>(() => makeClock(0));
  const [opponentHere, setOpponentHere] = useState(false);
  const [drawOffered, setDrawOffered] = useState<"byMe" | "byThem" | null>(null);
  const [sonify, setSonify] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const chessRef = useRef(new Chess());
  const roomRef = useRef<Room | null>(null);
  const playerIdRef = useRef<string>("");
  const tcRef = useRef<TimeControl>(tc);
  const myColorRef = useRef<"w" | "b" | null>(null);
  const isHostRef = useRef(false);
  const sonifyRef = useRef(false);
  useEffect(() => {
    sonifyRef.current = sonify;
  }, [sonify]);

  // latest clock state, readable from message handlers
  const clockStateRef = useRef<ClockState>(makeClock(0));
  useEffect(() => {
    clockStateRef.current = clock;
  }, [clock]);

  const configured = supabaseConfigured();

  useEffect(() => {
    playerIdRef.current = getPlayerId();
    return () => roomRef.current?.leave();
  }, []);

  const sonifyMove = useCallback(
    (mv: {
      color: "w" | "b";
      piece: string;
      from: string;
      to: string;
      san: string;
      captured?: string;
      promotion?: string;
      isKingsideCastle: () => boolean;
      isQueensideCastle: () => boolean;
    }) => {
      if (!sonifyRef.current) return;
      const annotated: AnnotatedMove = {
        ply: chessRef.current.history().length,
        color: mv.color,
        piece: mv.piece as AnnotatedMove["piece"],
        from: mv.from,
        to: mv.to,
        san: mv.san,
        isCapture: mv.captured !== undefined,
        isCastle: mv.isKingsideCastle() ? "k" : mv.isQueensideCastle() ? "q" : null,
        promotion: mv.promotion as AnnotatedMove["promotion"],
        isCheck: chessRef.current.isCheck(),
        fenAfter: chessRef.current.fen(),
        clockTenths: null,
        thinkMs: null,
      };
      playMove(annotated, EB_G_JAZZ);
    },
    [],
  );

  const endGame = useCallback((code: string, reason: string) => {
    setClock((c) => ({ ...readClock(c), running: null, lastTickAt: Date.now() }));
    setPhase({ p: "over", code, reason });
  }, []);

  const checkGameEnd = useCallback(
    (code: string): boolean => {
      const c = chessRef.current;
      if (c.isCheckmate()) {
        endGame(code, `checkmate — ${c.turn() === "w" ? "black" : "white"} wins`);
        return true;
      }
      if (c.isStalemate()) {
        endGame(code, "draw — stalemate");
        return true;
      }
      if (c.isDraw()) {
        endGame(code, "draw");
        return true;
      }
      return false;
    },
    [endGame],
  );

  const handleMessage = useCallback(
    (msg: RoomMsg, code: string) => {
      const me = playerIdRef.current;
      switch (msg.t) {
        case "start": {
          const color = msg.whiteId === me ? "w" : "b";
          setMyColor(color);
          myColorRef.current = color;
          tcRef.current = msg.tc;
          chessRef.current = new Chess();
          setFen(chessRef.current.fen());
          setLastMove(null);
          setDrawOffered(null);
          setClock({ ...makeClock(msg.tc.baseMs), running: "w", lastTickAt: Date.now() });
          setPhase({ p: "playing", code });
          break;
        }
        case "move": {
          try {
            const mv = chessRef.current.move({
              from: msg.from,
              to: msg.to,
              promotion: msg.promotion,
            });
            setFen(chessRef.current.fen());
            setLastMove({ from: msg.from, to: msg.to });
            setClock((c) => pressClock(c, mv.color, tcRef.current.incMs, msg.clockMs));
            sonifyMove(mv);
            checkGameEnd(code);
          } catch {
            roomRef.current?.send({ t: "syncReq", playerId: me });
          }
          break;
        }
        case "resign":
          if (msg.playerId !== me) {
            endGame(code, "opponent resigned — you win");
          }
          break;
        case "drawOffer":
          if (msg.playerId !== me) setDrawOffered("byThem");
          break;
        case "drawAccept":
          endGame(code, "draw — by agreement");
          break;
        case "drawDecline":
          setDrawOffered(null);
          setStatus("draw declined");
          break;
        case "flag":
          endGame(
            code,
            `${msg.flagged === "w" ? "white" : "black"} flagged — ${msg.flagged === myColorRef.current ? "you lose" : "you win"} on time`,
          );
          break;
        case "syncReq": {
          const color = myColorRef.current;
          if (!color) break;
          const read = readClock(clockStateRef.current);
          roomRef.current?.send({
            t: "sync",
            playerId: me,
            fen: chessRef.current.fen(),
            ply: chessRef.current.history().length,
            clocks: read,
            whiteId: color === "w" ? me : "opponent",
            blackId: color === "b" ? me : "opponent",
            tc: tcRef.current,
            turn: chessRef.current.turn(),
          });
          break;
        }
        case "sync": {
          if (msg.playerId === me) break;
          if (msg.ply > chessRef.current.history().length) {
            chessRef.current.load(msg.fen);
            setFen(msg.fen);
            tcRef.current = msg.tc;
            const color = msg.whiteId === me ? "w" : msg.blackId === me ? "b" : myColorRef.current;
            if (color) {
              setMyColor(color);
              myColorRef.current = color;
            }
            setClock({
              w: msg.clocks.w,
              b: msg.clocks.b,
              running: msg.turn,
              lastTickAt: Date.now(),
            });
            setPhase({ p: "playing", code });
          }
          break;
        }
      }
    },
    [checkGameEnd, endGame, sonifyMove],
  );

  const connect = useCallback(
    (code: string, isHost: boolean, timeControl: TimeControl) => {
      isHostRef.current = isHost;
      tcRef.current = timeControl;
      const me = playerIdRef.current;
      roomRef.current?.leave();
      roomRef.current = joinRoom(code, me, {
        onMessage: (msg) => handleMessage(msg, code),
        onPresence: (ids) => {
          const others = ids.filter((id) => id !== me);
          setOpponentHere(others.length > 0);
          if (others.length > 0 && isHostRef.current && myColorRef.current === null) {
            // host assigns colors once both players are present
            const hostIsWhite = Math.random() < 0.5;
            const startMsg: RoomMsg = {
              t: "start",
              whiteId: hostIsWhite ? me : others[0],
              blackId: hostIsWhite ? others[0] : me,
              tc: tcRef.current,
            };
            roomRef.current?.send(startMsg);
            handleMessage(startMsg, code); // broadcast(self:false) → apply locally
          }
        },
        onSubscribed: () => {
          if (!isHostRef.current) {
            roomRef.current?.send({ t: "hello", playerId: me });
            roomRef.current?.send({ t: "syncReq", playerId: me });
          }
        },
      });
      setPhase({ p: "waiting", code, isHost, tc: timeControl });
    },
    [handleMessage],
  );

  // auto-join via ?room=CODE
  useEffect(() => {
    const room = searchParams.get("room");
    if (room && phase.p === "lobby" && configured) {
      connect(room.toUpperCase(), false, TIME_CONTROLS[1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, configured]);

  const onFlag = useCallback(
    (side: "w" | "b") => {
      if (phase.p !== "playing") return;
      roomRef.current?.send({ t: "flag", playerId: playerIdRef.current, flagged: side });
      endGame(phase.code, `${side === "w" ? "white" : "black"} flagged — ${side === myColorRef.current ? "you lose" : "you win"} on time`);
    },
    [phase, endGame],
  );

  const display = useClockDisplay(clock, onFlag);

  const onDrop = useCallback(
    ({ sourceSquare, targetSquare, piece }: PieceDropHandlerArgs): boolean => {
      if (phase.p !== "playing" || !targetSquare || !myColor) return false;
      if (chessRef.current.turn() !== myColor) return false;
      if (!piece.pieceType.startsWith(myColor)) return false;

      let mv;
      try {
        mv = chessRef.current.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q", // auto-queen
        });
      } catch {
        return false;
      }

      const nextClock = pressClock(clock, mv.color, tcRef.current.incMs);
      setClock(nextClock);
      setFen(chessRef.current.fen());
      setLastMove({ from: mv.from, to: mv.to });
      setDrawOffered(null);

      roomRef.current?.send({
        t: "move",
        playerId: playerIdRef.current,
        ply: chessRef.current.history().length,
        from: mv.from,
        to: mv.to,
        promotion: mv.promotion as "q" | undefined,
        fenAfter: chessRef.current.fen(),
        clockMs: nextClock[mv.color],
      });

      if (sonifyRef.current) initAudio(EB_G_JAZZ.instrument).then(() => sonifyMove(mv));
      checkGameEnd(phase.code);
      return true;
    },
    [phase, myColor, clock, checkGameEnd, sonifyMove],
  );

  if (!configured) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6 font-mono text-sm text-[var(--text-dim)]">
        live play isn&apos;t configured on this deployment — set{" "}
        <code className="text-[var(--accent)]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="text-[var(--accent)]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
      </div>
    );
  }

  if (phase.p === "lobby") {
    return (
      <div className="max-w-md space-y-6">
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="font-mono text-sm text-[var(--text-primary)]">create a game</h3>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-dim)]">time control</span>
            <select
              value={tc.label}
              onChange={(e) =>
                setTc(TIME_CONTROLS.find((t) => t.label === e.target.value)!)
              }
            >
              {TIME_CONTROLS.map((t) => (
                <option key={t.label}>{t.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => connect(makeRoomCode(), true, tc)}
            className="rounded-md border border-[var(--accent)] px-4 py-2 font-mono text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--bg)]"
          >
            create room
          </button>
        </div>

        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="font-mono text-sm text-[var(--text-primary)]">join a game</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="room code"
              maxLength={5}
              className="w-32 uppercase"
            />
            <button
              onClick={() => joinCode.length === 5 && connect(joinCode, false, tc)}
              className="rounded-md border border-[var(--border)] px-4 py-1.5 font-mono text-sm text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              join
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase.p === "waiting") {
    const link =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}?mode=play&room=${phase.code}`
        : "";
    return (
      <div className="max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6">
        <p className="font-mono text-sm text-[var(--text-dim)]">
          room <span className="text-[var(--accent)]">{phase.code}</span> ·{" "}
          {phase.tc.label} · waiting for opponent…
        </p>
        {phase.isHost && (
          <button
            onClick={() => navigator.clipboard?.writeText(link)}
            className="break-all rounded-md border border-[var(--border)] px-3 py-2 text-left font-mono text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--accent)]"
            title="click to copy"
          >
            {link} ⧉
          </button>
        )}
        <button
          onClick={() => {
            roomRef.current?.leave();
            setMyColor(null);
            myColorRef.current = null;
            setPhase({ p: "lobby" });
          }}
          className="block font-mono text-xs text-[var(--text-dim)] underline hover:text-[var(--accent)]"
        >
          cancel
        </button>
      </div>
    );
  }

  // playing / over
  const opponentColor = myColor === "w" ? "b" : "w";
  const clockBox = (side: "w" | "b") => (
    <div
      className={`rounded-md border px-3 py-1.5 font-mono text-lg tabular-nums ${
        clock.running === side && phase.p === "playing"
          ? "border-[var(--accent)] text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-dim)]"
      }`}
    >
      {formatMs(display[side])}
    </div>
  );

  return (
    <div className="flex max-w-md flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-[var(--text-dim)]">
          opponent {opponentHere ? "●" : "○ (disconnected)"}
        </span>
        {clockBox(opponentColor ?? "b")}
      </div>

      <Board
        fen={fen}
        lastMove={lastMove}
        orientation={myColor === "b" ? "black" : "white"}
        interactive={phase.p === "playing"}
        onDrop={onDrop}
      />

      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-[var(--text-dim)]">
          you ({myColor === "w" ? "white" : "black"})
        </span>
        {clockBox(myColor ?? "w")}
      </div>

      {phase.p === "over" ? (
        <div className="space-y-2 rounded-md border border-[var(--accent)] p-3 text-center">
          <p className="font-mono text-sm text-[var(--accent)]">{phase.reason}</p>
          <button
            onClick={() => {
              roomRef.current?.leave();
              setMyColor(null);
              myColorRef.current = null;
              setOpponentHere(false);
              setPhase({ p: "lobby" });
            }}
            className="font-mono text-xs text-[var(--text-dim)] underline hover:text-[var(--accent)]"
          >
            back to lobby
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              roomRef.current?.send({ t: "resign", playerId: playerIdRef.current });
              endGame(phase.code, "you resigned");
            }}
            className="rounded-md border border-[var(--border)] px-3 py-1 font-mono text-xs text-[var(--text-dim)] hover:border-red-400 hover:text-red-400"
          >
            resign
          </button>
          {drawOffered === "byThem" ? (
            <>
              <span className="font-mono text-xs text-[var(--accent)]">draw offered:</span>
              <button
                onClick={() => {
                  roomRef.current?.send({ t: "drawAccept", playerId: playerIdRef.current });
                  endGame(phase.code, "draw — by agreement");
                }}
                className="rounded-md border border-[var(--border)] px-3 py-1 font-mono text-xs text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                accept
              </button>
              <button
                onClick={() => {
                  roomRef.current?.send({ t: "drawDecline", playerId: playerIdRef.current });
                  setDrawOffered(null);
                }}
                className="rounded-md border border-[var(--border)] px-3 py-1 font-mono text-xs text-[var(--text-dim)] hover:border-red-400 hover:text-red-400"
              >
                decline
              </button>
            </>
          ) : (
            <button
              disabled={drawOffered === "byMe"}
              onClick={() => {
                roomRef.current?.send({ t: "drawOffer", playerId: playerIdRef.current });
                setDrawOffered("byMe");
              }}
              className="rounded-md border border-[var(--border)] px-3 py-1 font-mono text-xs text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
            >
              {drawOffered === "byMe" ? "draw offered…" : "offer draw"}
            </button>
          )}
          <label className="ml-auto flex items-center gap-1.5 font-mono text-xs text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={sonify}
              onChange={async (e) => {
                setSonify(e.target.checked);
                if (e.target.checked) await initAudio(EB_G_JAZZ.instrument);
              }}
            />
            ♪ sonify
          </label>
        </div>
      )}
      {status && <p className="font-mono text-xs text-[var(--text-dim)]">{status}</p>}
    </div>
  );
}
