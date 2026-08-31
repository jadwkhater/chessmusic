import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";

export interface TimeControl {
  baseMs: number;
  incMs: number;
  label: string;
}

export const TIME_CONTROLS: TimeControl[] = [
  { label: "1+0", baseMs: 60_000, incMs: 0 },
  { label: "3+2", baseMs: 180_000, incMs: 2_000 },
  { label: "5+0", baseMs: 300_000, incMs: 0 },
  { label: "10+0", baseMs: 600_000, incMs: 0 },
];

export type RoomMsg =
  | { t: "hello"; playerId: string }
  | { t: "start"; whiteId: string; blackId: string; tc: TimeControl }
  | {
      t: "move";
      playerId: string;
      ply: number;
      from: string;
      to: string;
      promotion?: "q" | "r" | "b" | "n";
      fenAfter: string;
      /** mover's remaining clock (ms) measured locally at move time */
      clockMs: number;
    }
  | { t: "resign"; playerId: string }
  | { t: "drawOffer" | "drawAccept" | "drawDecline"; playerId: string }
  | { t: "flag"; playerId: string; flagged: "w" | "b" }
  | { t: "syncReq"; playerId: string }
  | {
      t: "sync";
      playerId: string;
      fen: string;
      ply: number;
      clocks: { w: number; b: number };
      whiteId: string;
      blackId: string;
      tc: TimeControl;
      turn: "w" | "b";
    };

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { realtime: { params: { eventsPerSecond: 10 } } },
    );
  }
  return client;
}

export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function getPlayerId(): string {
  try {
    let id = sessionStorage.getItem("chess-player-id");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("chess-player-id", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export interface Room {
  channel: RealtimeChannel | null;
  send: (msg: RoomMsg) => void;
  leave: () => void;
}

/**
 * Fallback transport when Supabase isn't configured: BroadcastChannel,
 * which reaches other tabs of the same browser. Presence is emulated
 * with join/ping/bye messages.
 */
function joinLocalRoom(
  code: string,
  playerId: string,
  handlers: {
    onMessage: (msg: RoomMsg) => void;
    onPresence: (playerIds: string[]) => void;
    onSubscribed?: () => void;
  },
): Room {
  const bc = new BroadcastChannel(`chess:${code.toUpperCase()}`);
  const peers = new Map<string, number>(); // playerId -> last seen
  let closed = false;

  const emitPresence = () => {
    const now = Date.now();
    for (const [id, seen] of peers) if (now - seen > 7000) peers.delete(id);
    handlers.onPresence([playerId, ...peers.keys()]);
  };

  bc.onmessage = (e) => {
    const { kind, from, msg } = e.data as {
      kind: "msg" | "join" | "ping" | "bye";
      from: string;
      msg?: RoomMsg;
    };
    if (from === playerId) return;
    if (kind === "bye") {
      peers.delete(from);
      emitPresence();
      return;
    }
    const isNew = !peers.has(from);
    peers.set(from, Date.now());
    if (kind === "join") bc.postMessage({ kind: "ping", from: playerId });
    if (isNew) emitPresence();
    if (kind === "msg" && msg) handlers.onMessage(msg);
  };

  bc.postMessage({ kind: "join", from: playerId });
  const heartbeat = setInterval(() => {
    if (!closed) {
      bc.postMessage({ kind: "ping", from: playerId });
      emitPresence();
    }
  }, 3000);
  queueMicrotask(() => {
    handlers.onSubscribed?.();
    emitPresence();
  });

  return {
    channel: null,
    send: (msg) => {
      if (closed) return;
      try {
        bc.postMessage({ kind: "msg", from: playerId, msg });
      } catch {}
    },
    leave: () => {
      closed = true;
      clearInterval(heartbeat);
      try {
        bc.postMessage({ kind: "bye", from: playerId });
      } catch {}
      bc.close();
    },
  };
}

export function joinRoom(
  code: string,
  playerId: string,
  handlers: {
    onMessage: (msg: RoomMsg) => void;
    onPresence: (playerIds: string[]) => void;
    onSubscribed?: () => void;
  },
): Room {
  if (!supabaseConfigured()) {
    return joinLocalRoom(code, playerId, handlers);
  }
  const channel = getClient().channel(`chess:${code.toUpperCase()}`, {
    config: {
      broadcast: { self: false },
      presence: { key: playerId },
    },
  });

  channel
    .on("broadcast", { event: "msg" }, ({ payload }) => {
      handlers.onMessage(payload as RoomMsg);
    })
    .on("presence", { event: "sync" }, () => {
      handlers.onPresence(Object.keys(channel.presenceState()));
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ joinedAt: Date.now() });
        handlers.onSubscribed?.();
      }
    });

  return {
    channel,
    send: (msg) =>
      channel.send({ type: "broadcast", event: "msg", payload: msg }),
    leave: () => {
      getClient().removeChannel(channel);
    },
  };
}
