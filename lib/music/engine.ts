import * as Tone from "tone";
import type { AnnotatedMove } from "@/lib/chesscom";
import type { Instrument, MusicConfig } from "./config";
import {
  chordMidi,
  midiToFreq,
  pawnNoteMidi,
  FLAT_9,
  SHARP_13,
} from "./theory";

interface Voices {
  white: Tone.PolySynth;
  black: Tone.PolySynth;
  accent: Tone.MembraneSynth;
  instrument: Instrument;
}

let voices: Voices | null = null;

function synthOptions(instrument: Instrument) {
  switch (instrument) {
    case "fm":
      return {
        harmonicity: 2,
        modulationIndex: 8,
        envelope: { attack: 0.01, decay: 0.4, sustain: 0.3, release: 1.2 },
      };
    case "pluck":
      return {
        oscillator: { type: "triangle" as const },
        envelope: { attack: 0.005, decay: 0.35, sustain: 0.05, release: 0.6 },
      };
    default:
      return {
        oscillator: { type: "fatsine" as const, spread: 12, count: 3 },
        envelope: { attack: 0.03, decay: 0.5, sustain: 0.4, release: 1.6 },
      };
  }
}

function buildVoices(instrument: Instrument): Voices {
  const reverb = new Tone.Reverb({ decay: 3.2, wet: 0.35 }).toDestination();
  const limiter = new Tone.Limiter(-3).connect(reverb);

  const make = (pan: number) => {
    const poly =
      instrument === "fm"
        ? new Tone.PolySynth(Tone.FMSynth, synthOptions(instrument))
        : new Tone.PolySynth(Tone.Synth, synthOptions(instrument));
    poly.maxPolyphony = 24;
    poly.volume.value = -10;
    poly.chain(new Tone.Panner(pan), limiter);
    return poly;
  };

  const accent = new Tone.MembraneSynth({
    pitchDecay: 0.08,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 1 },
  });
  accent.volume.value = -8;
  accent.connect(limiter);

  return { white: make(-0.3), black: make(0.3), accent, instrument };
}

/** Must be called from a user gesture before any playback. */
export async function initAudio(instrument: Instrument): Promise<void> {
  await Tone.start();
  if (!voices || voices.instrument !== instrument) {
    if (voices) {
      voices.white.dispose();
      voices.black.dispose();
      voices.accent.dispose();
    }
    voices = buildVoices(instrument);
  }
}

/** True once the synths exist and the AudioContext is actually running. */
export function audioReady(): boolean {
  return voices !== null && Tone.getContext().state === "running";
}

export function stopAll(): void {
  voices?.white.releaseAll();
  voices?.black.releaseAll();
}

/**
 * Sonify one move per the config. Returns the notes played (midi) so the
 * UI can visualize them.
 */
export function playMove(move: AnnotatedMove, cfg: MusicConfig): number[] {
  if (!voices) return [];
  const side = move.color === "w" ? cfg.white : cfg.black;
  const synth = move.color === "w" ? voices.white : voices.black;

  // eval, from the mover's perspective (evalCp is white POV)
  const moverEval =
    move.evalCp !== undefined
      ? move.color === "w"
        ? move.evalCp
        : -move.evalCp
      : undefined;
  const swing =
    move.evalSwingCp !== undefined
      ? move.color === "w"
        ? move.evalSwingCp
        : -move.evalSwingCp
      : undefined;

  let velocity = 0.6;
  let duration = 1.1;
  const extra: number[] = [];

  if (move.isCapture && cfg.captureAccent) {
    extra.push(SHARP_13);
    velocity = 0.85;
    duration = 1.5;
  }
  if (move.isCheck) velocity = Math.min(1, velocity + 0.1);

  if (cfg.eval.enabled && moverEval !== undefined) {
    if (cfg.eval.tension && moverEval < -80) {
      // the mover is worse: add dissonance, more as it gets uglier
      extra.push(FLAT_9);
      if (moverEval < -300) extra.push(SHARP_13 - 12); // #6 crunch
    }
    if (cfg.eval.dynamics) {
      const mag = Math.min(Math.abs(move.evalCp ?? 0), 600) / 600;
      velocity = Math.min(1, velocity + mag * 0.25);
    }
    if (cfg.eval.blunderAccent && swing !== undefined && swing < -150) {
      // the mover just made things much worse for themselves
      const root = 12 * 2 + (move.color === "w" ? 3 : 7); // low Eb / G-ish thud
      voices.accent.triggerAttackRelease(midiToFreq(root), 0.8, undefined, 0.9);
      duration += 0.6;
    }
  }

  let midis: number[];
  if (move.piece === "p" && !move.promotion) {
    midis = [pawnNoteMidi(side.key, side.pawnMode, move.to, move.color)];
    velocity *= 0.85;
    duration *= 0.7;
  } else {
    const piece = (move.promotion ?? move.piece) as
      | "r" | "n" | "b" | "q" | "k";
    const mapping = side.pieces[piece];
    const rank = parseInt(move.to[1], 10);
    const advanced = move.color === "w" ? rank - 1 : 8 - rank;
    const inversion = Math.max(0, Math.min(advanced, 6));
    midis = chordMidi(side.key, mapping.degree, mapping.quality, inversion, 3, extra);
    if (move.promotion) {
      velocity = Math.min(1, velocity + 0.15);
      duration += 0.4;
    }
    if (move.isCastle) {
      // castling: layer the rook chord above the king chord, quieter
      const rookMap = side.pieces.r;
      const rookChord = chordMidi(side.key, rookMap.degree, rookMap.quality, inversion + 1, 4);
      synth.triggerAttackRelease(
        rookChord.map(midiToFreq),
        duration * 0.8,
        undefined,
        velocity * 0.5,
      );
    }
  }

  synth.triggerAttackRelease(midis.map(midiToFreq), duration, undefined, velocity);
  return midis;
}

/** Gap in ms before the NEXT move after `move` plays. */
export function moveGapMs(move: AnnotatedMove | null, cfg: MusicConfig): number {
  const { mode, bpm, speed, maxGapMs } = cfg.pacing;
  if (mode === "timestamps" && move?.thinkMs != null) {
    return Math.max(150, Math.min(move.thinkMs, maxGapMs)) / speed;
  }
  return 60000 / bpm / speed;
}

/** A demo chord for the "test sound" button. */
export function playTestChord(cfg: MusicConfig): void {
  if (!voices) return;
  const midis = chordMidi(cfg.white.key, 1, cfg.white.pieces.r.quality, 0, 3);
  voices.white.triggerAttackRelease(midis.map(midiToFreq), 1.2, undefined, 0.7);
}
