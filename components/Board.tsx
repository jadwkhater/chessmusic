"use client";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";

interface BoardProps {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  orientation?: "white" | "black";
  interactive?: boolean;
  onDrop?: (args: PieceDropHandlerArgs) => boolean;
}

export default function Board({
  fen,
  lastMove,
  orientation = "white",
  interactive = false,
  onDrop,
}: BoardProps) {
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: "var(--board-highlight)" };
    squareStyles[lastMove.to] = { background: "var(--board-highlight)" };
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: interactive,
          onPieceDrop: onDrop,
          squareStyles,
          animationDurationInMs: 200,
          darkSquareStyle: { backgroundColor: "var(--board-dark)" },
          lightSquareStyle: { backgroundColor: "var(--board-light)" },
          dropSquareStyle: { boxShadow: "inset 0 0 0 2px var(--accent)" },
          darkSquareNotationStyle: { color: "var(--text-dim)", fontSize: "10px" },
          lightSquareNotationStyle: { color: "var(--text-dim)", fontSize: "10px" },
          boardStyle: { fontFamily: "var(--font-geist-mono), monospace" },
        }}
      />
    </div>
  );
}
