"use client";
import { useEffect, useRef, useState } from "react";

export interface ClockState {
  w: number; // ms remaining
  b: number;
  running: "w" | "b" | null;
  /** epoch ms when `running` side's countdown started/was last set */
  lastTickAt: number;
}

export function makeClock(baseMs: number): ClockState {
  return { w: baseMs, b: baseMs, running: null, lastTickAt: Date.now() };
}

/** Current displayed values, accounting for elapsed time on the running side. */
export function readClock(c: ClockState): { w: number; b: number } {
  if (!c.running) return { w: c.w, b: c.b };
  const elapsed = Date.now() - c.lastTickAt;
  return {
    w: c.running === "w" ? Math.max(0, c.w - elapsed) : c.w,
    b: c.running === "b" ? Math.max(0, c.b - elapsed) : c.b,
  };
}

/**
 * A side completed a move: bank its remaining time (+increment),
 * start the other side.
 */
export function pressClock(
  c: ClockState,
  mover: "w" | "b",
  incMs: number,
  /** authoritative remaining ms for the mover (from their message), optional */
  moverRemainingMs?: number,
): ClockState {
  const read = readClock(c);
  const remaining = moverRemainingMs ?? read[mover] + incMs;
  const other = mover === "w" ? "b" : "w";
  return {
    ...c,
    [mover]: remaining,
    [other]: read[other],
    running: other,
    lastTickAt: Date.now(),
  } as ClockState;
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (ms < 20_000) {
    return `${m}:${String(s).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Re-render ~4×/s while a clock runs; report flag fall once. */
export function useClockDisplay(
  clock: ClockState,
  onFlag?: (side: "w" | "b") => void,
): { w: number; b: number } {
  const [, setTick] = useState(0);
  const flaggedRef = useRef(false);

  useEffect(() => {
    flaggedRef.current = false;
  }, [clock]);

  useEffect(() => {
    if (!clock.running) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const read = readClock(clock);
      const side = clock.running!;
      if (read[side] <= 0 && !flaggedRef.current) {
        flaggedRef.current = true;
        onFlag?.(side);
      }
    }, 250);
    return () => clearInterval(id);
  }, [clock, onFlag]);

  return readClock(clock);
}
