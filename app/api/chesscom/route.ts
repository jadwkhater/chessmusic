import { NextRequest, NextResponse } from "next/server";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface UpstreamGame {
  moveList?: string;
  moveTimestamps?: string;
  pgnHeaders?: Record<string, string | number>;
  baseTime1?: number;
  timeIncrement1?: number;
  resultMessage?: string;
  initialSetup?: string;
}

async function fetchGame(type: "live" | "daily", id: string) {
  const res = await fetch(`https://www.chess.com/callback/${type}/game/${id}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json?.game?.moveList) return null;
  return json.game as UpstreamGame;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const typeHint = req.nextUrl.searchParams.get("type");

  if (!/^\d{1,20}$/.test(id)) {
    return NextResponse.json({ error: "invalid game id" }, { status: 400 });
  }

  const types: ("live" | "daily")[] =
    typeHint === "daily" ? ["daily"] : typeHint === "live" ? ["live"] : ["live", "daily"];

  for (const type of types) {
    const game = await fetchGame(type, id);
    if (game) {
      return NextResponse.json({
        type,
        moveList: game.moveList,
        moveTimestamps: game.moveTimestamps ?? null,
        pgnHeaders: game.pgnHeaders ?? {},
        baseTime1: game.baseTime1 ?? null,
        timeIncrement1: game.timeIncrement1 ?? null,
        resultMessage: game.resultMessage ?? null,
        initialSetup: game.initialSetup ?? null,
      });
    }
  }

  return NextResponse.json(
    { error: "game not found on chess.com" },
    { status: 404 },
  );
}
