"use client";
import {
  CHORD_PIECES,
  INSTRUMENTS,
  PRESETS,
  clonePreset,
  type ChordPiece,
  type MusicConfig,
} from "@/lib/music/config";
import {
  MODES,
  PITCH_CLASSES,
  QUALITIES,
  type Mode,
  type PitchClass,
  type Quality,
} from "@/lib/music/theory";

const PIECE_NAMES: Record<ChordPiece, string> = {
  r: "rook",
  n: "knight",
  b: "bishop",
  q: "queen",
  k: "king",
};

interface Props {
  config: MusicConfig;
  onChange: (next: MusicConfig) => void;
  /** hide eval controls (live play mode) */
  showEval?: boolean;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] text-[var(--text-dim)]">
      {children}
    </span>
  );
}

export default function MappingControls({ config, onChange, showEval = true }: Props) {
  const update = (fn: (draft: MusicConfig) => void) => {
    const next = JSON.parse(JSON.stringify(config)) as MusicConfig;
    fn(next);
    onChange(next);
  };

  const sideEditor = (side: "white" | "black") => {
    const s = config[side];
    return (
      <div className="flex-1 space-y-2">
        <div className="text-xs text-[var(--accent)]">{side}</div>
        <div className="flex items-center gap-2">
          <Label>key</Label>
          <select
            value={s.key}
            onChange={(e) =>
              update((d) => (d[side].key = e.target.value as PitchClass))
            }
          >
            {PITCH_CLASSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <Label>pawns</Label>
          <select
            value={s.pawnMode}
            onChange={(e) =>
              update((d) => (d[side].pawnMode = e.target.value as Mode))
            }
          >
            {MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        {CHORD_PIECES.map((p) => (
          <div key={p} className="flex items-center gap-2">
            <span className="w-14 text-[11px] text-[var(--text-dim)]">
              {PIECE_NAMES[p]}
            </span>
            <select
              value={s.pieces[p].degree}
              onChange={(e) =>
                update(
                  (d) =>
                    (d[side].pieces[p].degree = Number(
                      e.target.value,
                    ) as 1 | 2 | 3 | 4 | 5 | 6 | 7),
                )
              }
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  deg {n}
                </option>
              ))}
            </select>
            <select
              value={s.pieces[p].quality}
              onChange={(e) =>
                update(
                  (d) => (d[side].pieces[p].quality = e.target.value as Quality),
                )
              }
            >
              {QUALITIES.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label>preset</Label>
        <select
          defaultValue=""
          onChange={(e) => {
            const p = PRESETS.find((x) => x.name === e.target.value);
            if (p) onChange({ ...clonePreset({ ...p }), eval: config.eval });
          }}
        >
          <option value="" disabled>
            load preset…
          </option>
          {PRESETS.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
        <Label>instrument</Label>
        <select
          value={config.instrument}
          onChange={(e) =>
            update((d) => (d.instrument = e.target.value as MusicConfig["instrument"]))
          }
        >
          {INSTRUMENTS.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={config.captureAccent}
            onChange={(e) => update((d) => (d.captureAccent = e.target.checked))}
          />
          capture #13
        </label>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        {sideEditor("white")}
        {sideEditor("black")}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
        <Label>pacing</Label>
        <select
          value={config.pacing.mode}
          onChange={(e) =>
            update((d) => (d.pacing.mode = e.target.value as "fixed" | "timestamps"))
          }
        >
          <option value="fixed">fixed tempo</option>
          <option value="timestamps">real move times</option>
        </select>
        {config.pacing.mode === "fixed" ? (
          <label className="flex items-center gap-2">
            <Label>bpm {config.pacing.bpm}</Label>
            <input
              type="range"
              min={30}
              max={240}
              value={config.pacing.bpm}
              onChange={(e) => update((d) => (d.pacing.bpm = Number(e.target.value)))}
            />
          </label>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <Label>speed {config.pacing.speed.toFixed(1)}×</Label>
              <input
                type="range"
                min={0.5}
                max={16}
                step={0.5}
                value={config.pacing.speed}
                onChange={(e) => update((d) => (d.pacing.speed = Number(e.target.value)))}
              />
            </label>
            <label className="flex items-center gap-2">
              <Label>max pause</Label>
              <select
                value={config.pacing.maxGapMs}
                onChange={(e) =>
                  update((d) => (d.pacing.maxGapMs = Number(e.target.value)))
                }
              >
                <option value={2000}>2s</option>
                <option value={4000}>4s</option>
                <option value={8000}>8s</option>
                <option value={15000}>15s</option>
                <option value={600000}>true to life</option>
              </select>
            </label>
          </>
        )}
      </div>

      {showEval && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={config.eval.enabled}
              onChange={(e) => update((d) => (d.eval.enabled = e.target.checked))}
            />
            stockfish eval
          </label>
          {config.eval.enabled && (
            <>
              {(["tension", "dynamics", "blunderAccent"] as const).map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)]"
                >
                  <input
                    type="checkbox"
                    checked={config.eval[k]}
                    onChange={(e) => update((d) => (d.eval[k] = e.target.checked))}
                  />
                  {k === "blunderAccent" ? "blunder accent" : k}
                </label>
              ))}
              <label className="flex items-center gap-2">
                <Label>depth {config.eval.depth}</Label>
                <input
                  type="range"
                  min={6}
                  max={18}
                  value={config.eval.depth}
                  onChange={(e) => update((d) => (d.eval.depth = Number(e.target.value)))}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
