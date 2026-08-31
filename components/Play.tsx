"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs } from "react-chessboard";
import Board from "./Board";
import type { AnnotatedMove } from "@/lib/chesscom";
import { EB_G_JAZZ } from "@/lib/music/config";
import { audioReady, initAudio, playMove, stopAll } from "@/lib/music/engine";
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
  const [sonify, setSonify] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const chessRef = useRef(new Chess());
  const roomRef = useRef<Room | null>(null);
  const connectedCodeRef = useRef<string | null>(null);
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
    return () => {
      roomRef.current?.leave();
      roomRef.current = null;
      connectedCodeRef.current = null;
    };
  }, []);

  // every move of the current game, annotated for replay/sonification
  const recordedRef = useRef<AnnotatedMove[]>([]);
  const [recorded, setRecorded] = useState<AnnotatedMove[]>([]);
  const [replayPly, setReplayPly] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const replayTokenRef = useRef(0);

  const stopReplay = useCallback(() => {
    replayTokenRef.current++;
    setReplayPlaying(false);
    stopAll();
  }, []);

  const startReplay = useCallback(async (from?: number) => {
    const moves = recordedRef.current;
    if (moves.length === 0) return;
    await initAudio(EB_G_JAZZ.instrument);
    const token = ++replayTokenRef.current;
    setReplayPlaying(true);
    let i = from ?? 0;
    if (i >= moves.length) i = 0;
    const step = () => {
      if (token !== replayTokenRef.current) return;
      playMove(moves[i], EB_G_JAZZ);
      i++;
      setReplayPly(i);
      if (i < moves.length) {
        setTimeout(step, 900);
      } else {
        setReplayPlaying(false);
      }
    };
    step();
  }, []);

  const recordMove = useCallback(
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
      recordedRef.current.push(annotated);
      setRecorded([...recordedRef.current]);
      if (sonifyRef.current) {
        if (audioReady()) {
          playMove(annotated, EB_G_JAZZ);
        } else {
          // audio unlocks on the first user gesture; play only the latest
          // move then so a silent backlog doesn't burst out at once
          void initAudio(EB_G_JAZZ.instrument)
            .then(() => {
              if (recordedRef.current.at(-1) === annotated) {
                playMove(annotated, EB_G_JAZZ);
              }
            })
            .catch(() => {});
        }
      }
    },
    [],
  );

  const endGame = useCallback((code: string, reason: string) => {
    setClock((c) => ({ ...readClock(c), running: null, lastTickAt: Date.now() }));
    setReplayPly(recordedRef.current.length);
    setPhase({ p: "over", code, reason });
  }, []);

  const checkGameEnd = useCallback(
    (code: string): boolean => {
      const c = chessRef.current;
      if (c.isCheckmate()) {
        endGame(code, `checkmate, ${c.turn() === "w" ? "black" : "white"} wins`);
        return true;
      }
      if (c.isStalemate()) {
        endGame(code, "stalemate");
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
          // ignore duplicate starts once moves have been made
          if (myColorRef.current !== null && chessRef.current.history().length > 0) break;
          // a resent start may carry an "opponent" placeholder for our id
          const color: "w" | "b" =
            msg.whiteId === me
              ? "w"
              : msg.blackId === me
                ? "b"
                : msg.whiteId === "opponent"
                  ? "w"
                  : "b";
          setMyColor(color);
          myColorRef.current = color;
          tcRef.current = msg.tc;
          chessRef.current = new Chess();
          recordedRef.current = [];
          setRecorded([]);
          replayTokenRef.current++;
          setReplayPlaying(false);
          setReplayPly(0);
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
            recordMove(mv);
            checkGameEnd(code);
          } catch {
            roomRef.current?.send({ t: "syncReq", playerId: me });
          }
          break;
        }
        case "resign":
          if (msg.playerId !== me) {
            endGame(code, "opponent resigned, you win");
          }
          break;
        case "drawOffer":
          if (msg.playerId !== me) setDrawOffered("byThem");
          break;
        case "drawAccept":
          endGame(code, "draw agreed");
          break;
        case "drawDecline":
          setDrawOffered(null);
          setStatus("draw declined");
          break;
        case "flag":
          endGame(
            code,
            `${msg.flagged === "w" ? "white" : "black"} flagged, ${msg.flagged === myColorRef.current ? "you lose" : "you win"} on time`,
          );
          break;
        case "syncReq": {
          const color = myColorRef.current;
          if (!color) break;
          if (chessRef.current.history().length === 0) {
            // game just started (or joiner missed the start): resend it
            roomRef.current?.send({
              t: "start",
              whiteId: color === "w" ? me : "opponent",
              blackId: color === "b" ? me : "opponent",
              tc: tcRef.current,
            });
            break;
          }
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
          if (msg.ply > chessRef.current.history().length || myColorRef.current === null) {
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
    [checkGameEnd, endGame, recordMove],
  );

  const connect = useCallback(
    (code: string, isHost: boolean, timeControl: TimeControl) => {
      if (connectedCodeRef.current === code && roomRef.current) return;
      connectedCodeRef.current = code;
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
    if (room && phase.p === "lobby") {
      connect(room.toUpperCase(), false, TIME_CONTROLS[1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, configured]);

  const onFlag = useCallback(
    (side: "w" | "b") => {
      if (phase.p !== "playing") return;
      roomRef.current?.send({ t: "flag", playerId: playerIdRef.current, flagged: side });
      endGame(phase.code, `${side === "w" ? "white" : "black"} flagged, ${side === myColorRef.current ? "you lose" : "you win"} on time`);
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

      recordMove(mv);
      checkGameEnd(phase.code);
      return true;
    },
    [phase, myColor, clock, checkGameEnd, recordMove],
  );

  if (phase.p === "lobby") {
    return (
      <div className="max-w-md space-y-6">
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="text-sm text-[var(--text-primary)]">create a game</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-dim)]">time control</span>
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
            className="rounded-md border border-[var(--accent)] px-4 py-2 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--bg)]"
          >
            create room
          </button>
        </div>

        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="text-sm text-[var(--text-primary)]">join a game</h3>
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
              className="rounded-md border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              join
            </button>
          </div>
        </div>

        {!configured && (
          <p className="text-xs text-[var(--text-dim)]">
            no realtime keys set, so rooms only reach other tabs of this
            browser. add Supabase keys for online play.
          </p>
        )}
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
        <p className="text-sm text-[var(--text-dim)]">
          room <span className="text-[var(--accent)]">{phase.code}</span> ·{" "}
          {phase.tc.label} · waiting for opponent…
        </p>
        {phase.isHost && (
          <button
            onClick={() => navigator.clipboard?.writeText(link)}
            className="break-all rounded-md border border-[var(--border)] px-3 py-2 text-left text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--accent)]"
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
          className="block text-xs text-[var(--text-dim)] underline hover:text-[var(--accent)]"
        >
          cancel
        </button>
      </div>
    );
  }

  // playing / over
  const opponentColor = myColor === "w" ? "b" : "w";
  const inReplay = phase.p === "over" && recorded.length > 0;
  const boardFen =
    inReplay && replayPly < recorded.length
      ? replayPly === 0
        ? new Chess().fen()
        : recorded[replayPly - 1].fenAfter
      : fen;
  const boardLastMove =
    inReplay && replayPly < recorded.length
      ? replayPly === 0
        ? null
        : recorded[replayPly - 1]
      : lastMove;
  const clockBox = (side: "w" | "b") => (
    <div
      className={`rounded-md border px-3 py-1.5 text-lg tabular-nums ${
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
        <span className="text-xs text-[var(--text-dim)]">
          opponent {opponentHere ? "●" : "○ (disconnected)"}
        </span>
        {clockBox(opponentColor ?? "b")}
      </div>

      <Board
        fen={boardFen}
        lastMove={boardLastMove}
        orientation={myColor === "b" ? "black" : "white"}
        interactive={phase.p === "playing"}
        onDrop={onDrop}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-dim)]">
          you ({myColor === "w" ? "white" : "black"})
        </span>
        {clockBox(myColor ?? "w")}
      </div>

      {phase.p === "over" ? (
        <div className="space-y-3 rounded-md border border-[var(--accent)] p-3 text-center">
          <p className="text-sm text-[var(--accent)]">{phase.reason}</p>
          {recorded.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  replayPlaying
                    ? stopReplay()
                    : startReplay(replayPly >= recorded.length ? 0 : replayPly)
                }
                className="w-24 rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                {replayPlaying ? "pause" : "♪ replay"}
              </button>
              <input
                type="range"
                min={0}
                max={recorded.length}
                value={replayPly}
                onChange={(e) => {
                  stopReplay();
                  setReplayPly(Number(e.target.value));
                }}
                className="flex-1"
              />
              <span className="text-xs tabular-nums text-[var(--text-dim)]">
                {replayPly}/{recorded.length}
              </span>
            </div>
          )}
          <button
            onClick={() => {
              stopReplay();
              roomRef.current?.leave();
              connectedCodeRef.current = null;
              setMyColor(null);
              myColorRef.current = null;
              setOpponentHere(false);
              setPhase({ p: "lobby" });
            }}
            className="text-xs text-[var(--text-dim)] underline hover:text-[var(--accent)]"
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
            className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-red-400 hover:text-red-600"
          >
            resign
          </button>
          {drawOffered === "byThem" ? (
            <>
              <span className="text-xs text-[var(--accent)]">draw offered:</span>
              <button
                onClick={() => {
                  roomRef.current?.send({ t: "drawAccept", playerId: playerIdRef.current });
                  endGame(phase.code, "draw agreed");
                }}
                className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                accept
              </button>
              <button
                onClick={() => {
                  roomRef.current?.send({ t: "drawDecline", playerId: playerIdRef.current });
                  setDrawOffered(null);
                }}
                className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-red-400 hover:text-red-600"
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
              className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
            >
              {drawOffered === "byMe" ? "draw offered…" : "offer draw"}
            </button>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
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
      {status && <p className="text-xs text-[var(--text-dim)]">{status}</p>}
    </div>
  );
}
