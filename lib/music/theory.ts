export type PitchClass =
  | "C" | "Db" | "D" | "Eb" | "E" | "F"
  | "Gb" | "G" | "Ab" | "A" | "Bb" | "B";

export const PITCH_CLASSES: PitchClass[] = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
];

const PC_SEMITONE: Record<PitchClass, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

export type Mode =
  | "major"
  | "mixolydian"
  | "dorian"
  | "lydian"
  | "aeolian"
  | "majorPentatonic"
  | "minorPentatonic";

export const MODES: Mode[] = [
  "major", "mixolydian", "dorian", "lydian", "aeolian",
  "majorPentatonic", "minorPentatonic",
];

export const SCALE_INTERVALS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

export type Quality =
  | "triad"
  | "minTriad"
  | "maj7"
  | "min7"
  | "min9"
  | "min11"
  | "dom7"
  | "dom7#9#13"
  | "maj7#11"
  | "maj9"
  | "sus4";

export const QUALITIES: Quality[] = [
  "triad", "minTriad", "maj7", "min7", "min9", "min11",
  "dom7", "dom7#9#13", "maj7#11", "maj9", "sus4",
];

export const QUALITY_INTERVALS: Record<Quality, number[]> = {
  triad: [0, 4, 7],
  minTriad: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  min9: [0, 3, 7, 10, 14],
  min11: [0, 3, 7, 10, 14, 17],
  dom7: [0, 4, 7, 10],
  "dom7#9#13": [0, 4, 7, 10, 15, 21],
  "maj7#11": [0, 4, 7, 11, 18],
  maj9: [0, 4, 7, 11, 14],
  sus4: [0, 5, 7, 10],
};

/** #13 tension tone (21 semitones above the root) used as capture accent */
export const SHARP_13 = 21;
/** b9 (13 semitones) — dissonance tone for eval tension */
export const FLAT_9 = 13;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Root midi note of `degree` (1-7) of the major scale of `key`,
 * around octave `baseOctave` (midi octave, C4 = 60).
 */
export function degreeRootMidi(
  key: PitchClass,
  degree: number,
  baseOctave = 4,
): number {
  const major = SCALE_INTERVALS.major;
  const step = major[(degree - 1) % major.length];
  return 12 * (baseOctave + 1) + PC_SEMITONE[key] + step;
}

/**
 * Build a chord as midi notes: root from key+degree, quality intervals,
 * then apply `inversion` (rotate lowest notes up an octave; overflow
 * shifts the whole chord up).
 */
export function chordMidi(
  key: PitchClass,
  degree: number,
  quality: Quality,
  inversion: number,
  baseOctave = 3,
  extraIntervals: number[] = [],
): number[] {
  const root = degreeRootMidi(key, degree, baseOctave);
  const intervals = [...QUALITY_INTERVALS[quality], ...extraIntervals];
  const notes = intervals.map((i) => root + i).sort((a, b) => a - b);

  const octaveShift = Math.floor(inversion / notes.length);
  const rot = inversion % notes.length;
  const inverted = [
    ...notes.slice(rot).map((n) => n + octaveShift * 12),
    ...notes.slice(0, rot).map((n) => n + (octaveShift + 1) * 12),
  ];
  return inverted.sort((a, b) => a - b);
}

const FILES = "abcdefgh";

/**
 * Pawn single note: scale degree from file, octave from rank advanced
 * (ranks are mirrored for black so advancing always rises in pitch).
 */
export function pawnNoteMidi(
  key: PitchClass,
  mode: Mode,
  square: string,
  color: "w" | "b",
  baseOctave = 4,
): number {
  const file = FILES.indexOf(square[0]);
  const rank = parseInt(square[1], 10);
  const advanced = color === "w" ? rank - 2 : 7 - rank; // 0..6-ish
  const scale = SCALE_INTERVALS[mode];
  const idx = file % scale.length;
  const octaveBump = Math.floor(advanced / 3) + Math.floor(file / scale.length);
  return (
    12 * (baseOctave + 1 + octaveBump) + PC_SEMITONE[key] + scale[idx]
  );
}
