# chess-music

Plays chess.com games back as music. Also lets two people play live chess with clocks.

The default chord rules come from [@matthewsinstagram](https://www.instagram.com/matthewsinstagram): white in Eb, black in G, each piece a jazz chord (rook maj7, knight min9, bishop min7, queen maj7#11, king 7#9#13), pawns as mixolydian notes, chords inverting as pieces advance, a #13 on captures.

## Sonify

Paste a chess.com game URL or ID. Moves come from chess.com's callback endpoint (TCN decoded with `chess-tcn`), replayed through chess.js, and played with Tone.js.

- Keys, pawn scales, and per-piece chord mappings are all editable in the UI.
- Pacing: fixed tempo, or the players' real think times from the game's clock data.
- Optional Stockfish analysis (WASM, runs in the browser) drives an eval bar, a clickable eval graph, dissonance for the losing side, and accents on blunders.

## Play

Room codes over Supabase Realtime broadcast. Time controls with increment, flag detection, resign, draw offers, rejoin. Needs:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

in `.env.local` and on Vercel. Sonify works without them.

## Development

```bash
npm install
npm run dev
```

`public/stockfish/` is vendored from the `stockfish.js` npm package.
