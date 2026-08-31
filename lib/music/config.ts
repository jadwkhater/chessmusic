import type { Mode, PitchClass, Quality } from "./theory";

export type ChordPiece = "r" | "n" | "b" | "q" | "k";
export const CHORD_PIECES: ChordPiece[] = ["r", "n", "b", "q", "k"];

export interface PieceMapping {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  quality: Quality;
}

export interface SideMapping {
  key: PitchClass;
  pawnMode: Mode;
  pieces: Record<ChordPiece, PieceMapping>;
}

export type Instrument = "soft" | "fm" | "pluck";
export const INSTRUMENTS: Instrument[] = ["soft", "fm", "pluck"];

export interface EvalConfig {
  enabled: boolean;
  /** stockfish search depth per position */
  depth: number;
  /** worse eval for the moving side → dissonant tones added to its chords */
  tension: boolean;
  /** |eval| → velocity swell */
  dynamics: boolean;
  /** big eval swings get a dramatic low accent */
  blunderAccent: boolean;
}

export interface MusicConfig {
  white: SideMapping;
  black: SideMapping;
  pacing: {
    mode: "fixed" | "timestamps";
    bpm: number;
    speed: number;
    maxGapMs: number;
  };
  captureAccent: boolean;
  instrument: Instrument;
  eval: EvalConfig;
}

export interface Preset {
  name: string;
  config: MusicConfig;
}

const defaultEval: EvalConfig = {
  enabled: false,
  depth: 12,
  tension: true,
  dynamics: true,
  blunderAccent: true,
};

/** The original video's ruleset: white in Eb, black in G, jazz chords. */
export const EB_G_JAZZ: MusicConfig = {
  white: {
    key: "Eb",
    pawnMode: "mixolydian",
    pieces: {
      r: { degree: 1, quality: "maj7" },
      n: { degree: 2, quality: "min9" },
      b: { degree: 3, quality: "min7" },
      q: { degree: 4, quality: "maj7#11" },
      k: { degree: 5, quality: "dom7#9#13" },
    },
  },
  black: {
    key: "G",
    pawnMode: "mixolydian",
    pieces: {
      r: { degree: 1, quality: "maj7" },
      n: { degree: 2, quality: "min9" },
      b: { degree: 3, quality: "min7" },
      q: { degree: 4, quality: "maj7#11" },
      k: { degree: 5, quality: "dom7#9#13" },
    },
  },
  pacing: { mode: "fixed", bpm: 60, speed: 1, maxGapMs: 4000 },
  captureAccent: true,
  instrument: "soft",
  eval: { ...defaultEval },
};

const DORIAN_DUSK: MusicConfig = {
  ...EB_G_JAZZ,
  white: {
    key: "D",
    pawnMode: "dorian",
    pieces: {
      r: { degree: 1, quality: "min9" },
      n: { degree: 4, quality: "dom7" },
      b: { degree: 3, quality: "maj7" },
      q: { degree: 7, quality: "min7" },
      k: { degree: 5, quality: "min11" },
    },
  },
  black: {
    key: "A",
    pawnMode: "dorian",
    pieces: {
      r: { degree: 1, quality: "min9" },
      n: { degree: 4, quality: "dom7" },
      b: { degree: 3, quality: "maj7" },
      q: { degree: 7, quality: "min7" },
      k: { degree: 5, quality: "min11" },
    },
  },
  eval: { ...defaultEval },
};

const PENTATONIC_AIR: MusicConfig = {
  ...EB_G_JAZZ,
  white: {
    key: "C",
    pawnMode: "majorPentatonic",
    pieces: {
      r: { degree: 1, quality: "triad" },
      n: { degree: 6, quality: "sus4" },
      b: { degree: 3, quality: "minTriad" },
      q: { degree: 4, quality: "maj9" },
      k: { degree: 5, quality: "sus4" },
    },
  },
  black: {
    key: "A",
    pawnMode: "minorPentatonic",
    pieces: {
      r: { degree: 1, quality: "minTriad" },
      n: { degree: 6, quality: "sus4" },
      b: { degree: 3, quality: "triad" },
      q: { degree: 4, quality: "min9" },
      k: { degree: 5, quality: "sus4" },
    },
  },
  instrument: "pluck",
  eval: { ...defaultEval },
};

export const PRESETS: Preset[] = [
  { name: "eb/g jazz (original)", config: EB_G_JAZZ },
  { name: "dorian dusk", config: DORIAN_DUSK },
  { name: "pentatonic air", config: PENTATONIC_AIR },
];

export function clonePreset(p: Preset): MusicConfig {
  return JSON.parse(JSON.stringify(p.config)) as MusicConfig;
}
