"use client";

interface Props {
  /** centipawns, white POV; undefined = no eval yet */
  cp?: number;
}

const CLAMP = 800;

export default function EvalBar({ cp }: Props) {
  // fraction of the bar that is white, 0.5 = equal
  const frac =
    cp === undefined
      ? 0.5
      : 0.5 + (Math.max(-CLAMP, Math.min(CLAMP, cp)) / CLAMP) * 0.45;

  const label =
    cp === undefined
      ? ""
      : Math.abs(cp) >= 9000
        ? cp > 0
          ? "M"
          : "-M"
        : (cp / 100).toFixed(1);

  return (
    <div
      className="relative w-5 shrink-0 self-stretch overflow-hidden rounded border border-[var(--border)] bg-neutral-800"
      title={cp === undefined ? "no evaluation" : `eval ${label}`}
    >
      <div
        className="absolute bottom-0 left-0 right-0 bg-white transition-[height] duration-300"
        style={{ height: `${frac * 100}%` }}
      />
      {label && (
        <span
          className={`absolute left-0 right-0 text-center text-[9px] leading-tight ${
            (cp ?? 0) >= 0 ? "bottom-0.5 text-neutral-600" : "top-0.5 text-neutral-200"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}
