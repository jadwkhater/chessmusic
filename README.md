# chess-music

Turn any chess.com game into music — and play live chess with a friend, with real clocks, and hear the game as you play it.

## Sonify

Paste a chess.com game URL or ID. The game is fetched (via chess.com's callback endpoint), its TCN move list decoded, and every move becomes sound:

- **Pieces are jazz chords** built on scale degrees of each side's key. The default preset (from the ruleset that inspired this): white plays in Eb, black in G — rook = maj7 on the I, knight = min9 on the ii, bishop = min7 on the iii, queen = maj7#11 on the IV, king = 7#9#13 on the V.
- **Pawns are single notes** from a configurable scale (mixolydian by default), pitched by square.
- **Chords invert upward** as a piece advances up the board.
- **Captures add a #13** tension tone; checks get a velocity bump; castling layers the rook chord over the king's.
- **Pacing** is either a fixed tempo or the players' real think times (from chess.com's move timestamps).
- **Everything is configurable**: keys, pawn scales, per-piece scale degree and chord quality, instrument — explore your own sound.

### Stockfish evaluation → music

Toggle **stockfish eval** and the game is analyzed in-browser (stockfish.js WASM in a Web Worker). The evaluation then bends the music:

- **tension** — the side that's worse gets dissonant tones (b9, and more as it gets uglier)
- **dynamics** — bigger advantages swell louder
- **blunder accent** — a big eval swing lands a low percussive hit

An eval sparkline renders under the board; click it to seek.

## Play

Live chess against a friend on two devices. Create a room with a time control (1+0, 3+2, 5+0, 10+0), share the link, play with real clocks — resign, draw offers, flag detection, reconnect handling. Toggle **♪ sonify** to hear your moves as you make them.

Transport is Supabase Realtime broadcast (no database, no accounts). Set:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

in `.env.local` (and in your Vercel project). Without them, the Sonify mode still fully works.

## Development

```bash
npm install
npm run dev
```

`public/stockfish/` contains the vendored [stockfish.js](https://www.npmjs.com/package/stockfish.js) WASM worker (from `node_modules/stockfish.js/`).

## Stack

Next.js (App Router) · chess.js · chess-tcn · react-chessboard · Tone.js · stockfish.js · Supabase Realtime
