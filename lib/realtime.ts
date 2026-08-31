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
  channel: RealtimeChannel;
  send: (msg: RoomMsg) => void;
  leave: () => void;
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
