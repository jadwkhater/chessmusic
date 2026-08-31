"use client";

interface Props {
  /** centipawns, white POV, one per ply */
  cps: number[];
  ply: number;
  onSeek: (ply: number) => void;
}

const H = 48;
const CLAMP = 600; // cp mapped to full height

export default function EvalSparkline({ cps, ply, onSeek }: Props) {
  if (cps.length === 0) return null;
  const w = 100; // viewBox units, scales to container
  const x = (i: number) => ((i + 1) / cps.length) * w;
  const y = (cp: number) =>
    H / 2 - (Math.max(-CLAMP, Math.min(CLAMP, cp)) / CLAMP) * (H / 2 - 2);

  const path = cps
    .map((cp, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(cp).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${H}`}
      preserveAspectRatio="none"
      className="h-12 w-full cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-surface)]"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        onSeek(Math.round(frac * cps.length));
      }}
    >
      <line x1={0} y1={H / 2} x2={w} y2={H / 2} stroke="var(--border)" strokeWidth={0.5} />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      {ply > 0 && (
        <line
          x1={x(ply - 1)}
          y1={0}
          x2={x(ply - 1)}
          y2={H}
          stroke="var(--text-dim)"
          strokeWidth={0.6}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
