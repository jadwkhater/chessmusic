import { Chess, type Color, type PieceSymbol } from "chess.js";
import { decodeTCN } from "chess-tcn";

export interface AnnotatedMove {
  ply: number; // 1-based
  color: Color;
  piece: PieceSymbol; // piece that moved (pre-promotion)
  from: string;
  to: string;
  san: string;
  isCapture: boolean;
  isCastle: "k" | "q" | null;
  promotion?: PieceSymbol;
  isCheck: boolean;
  fenAfter: string;
  /** remaining clock after this move, tenths of seconds (null if unknown) */
  clockTenths: number | null;
  /** think time for this move in ms (null if unknown) */
  thinkMs: number | null;
  /** centipawn eval (white POV) after this move; filled by analysis */
  evalCp?: number;
  /** eval change vs previous ply (white POV) */
  evalSwingCp?: number;
}

export interface LoadedGame {
  id: string;
  type: "live" | "daily";
  headers: Record<string, string | number>;
  startFen: string;
  moves: AnnotatedMove[];
  baseTimeTenths: number | null;
  incrementTenths: number | null;
  resultMessage: string | null;
}

export interface GameRef {
  id: string;
  type?: "live" | "daily";
}

/**
 * Accepts a raw numeric ID or any common chess.com game URL:
 *   chess.com/game/live/123, chess.com/game/daily/123,
 *   chess.com/live/game/123, chess.com/analysis/game/live/123?...
 */
export function parseGameRef(input: string): GameRef | null {
  const s = input.trim();
  if (/^\d{1,20}$/.test(s)) return { id: s };

  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)chess\.com$/.test(url.hostname)) return null;

  const m = url.pathname.match(/\b(live|daily)\b[^\d]*\/(\d{1,20})(?:\/|$)/);
  if (m) return { id: m[2], type: m[1] as "live" | "daily" };

  const tail = url.pathname.match(/\/(\d{5,20})(?:\/|$)/);
  if (tail) return { id: tail[1] };
  return null;
}

export async function loadGame(ref: GameRef): Promise<LoadedGame> {
  const params = new URLSearchParams({ id: ref.id });
  if (ref.type) params.set("type", ref.type);
  const res = await fetch(`/api/chesscom?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "failed to fetch game");

  const headers: Record<string, string | number> = data.pgnHeaders ?? {};
  const startFen =
    typeof headers.FEN === "string" && headers.FEN.length > 0
      ? headers.FEN
      : new Chess().fen();

  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    throw new Error("unsupported starting position (variant game?)");
  }

  const decoded = decodeTCN(data.moveList);
  const timestamps: number[] | null =
    typeof data.moveTimestamps === "string" && data.moveTimestamps.length > 0
      ? data.moveTimestamps.split(",").map(Number)
      : null;
  // chess.com pads the list to an even length; extra trailing entry is unused
  const tsValid = timestamps !== null && timestamps.length >= decoded.length;
  const inc: number = data.timeIncrement1 ?? 0;
  const base: number | null = data.baseTime1 ?? null;

  const moves: AnnotatedMove[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const d = decoded[i];
    if (!d.from) throw new Error("unsupported game (piece drops?)");
    let mv;
    try {
      mv = chess.move({ from: d.from, to: d.to, promotion: d.promotion });
    } catch {
      throw new Error(`failed to replay game at move ${i + 1}`);
    }

    let clockTenths: number | null = null;
    let thinkMs: number | null = null;
    if (tsValid) {
      clockTenths = timestamps[i];
      const prevSameSide = i >= 2 ? timestamps[i - 2] : base;
      if (prevSameSide !== null && !Number.isNaN(prevSameSide)) {
        thinkMs = Math.max(0, (prevSameSide - clockTenths + inc) * 100);
      }
    }

    moves.push({
      ply: i + 1,
      color: mv.color,
      piece: mv.piece,
      from: mv.from,
      to: mv.to,
      san: mv.san,
      isCapture: mv.captured !== undefined,
      isCastle: mv.isKingsideCastle() ? "k" : mv.isQueensideCastle() ? "q" : null,
      promotion: mv.promotion,
      isCheck: chess.isCheck(),
      fenAfter: chess.fen(),
      clockTenths,
      thinkMs,
    });
  }

  return {
    id: ref.id,
    type: data.type,
    headers,
    startFen,
    moves,
    baseTimeTenths: base,
    incrementTenths: data.timeIncrement1 ?? null,
    resultMessage: data.resultMessage ?? null,
  };
}
