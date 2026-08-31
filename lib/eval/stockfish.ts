/**
 * Thin wrapper around a stockfish.js (SF10 wasm) Web Worker served from
 * /public/stockfish/. Evaluates a list of FENs sequentially at fixed depth.
 */

export interface EvalResult {
  /** centipawns from WHITE's point of view; mate mapped to ±10000-ish */
  cp: number;
}

export class StockfishEvaluator {
  private worker: Worker;
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private aborted = false;

  constructor() {
    this.worker = new Worker("/stockfish/stockfish.wasm.js");
    this.ready = new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (String(e.data).startsWith("uciok")) {
          this.worker.removeEventListener("message", onMsg);
          resolve();
        }
      };
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage("uci");
    });
  }

  abort(): void {
    this.aborted = true;
    this.worker.postMessage("stop");
  }

  dispose(): void {
    this.aborted = true;
    this.worker.terminate();
  }

  private evalOne(fen: string, depth: number): Promise<EvalResult> {
    const run = async (): Promise<EvalResult> => {
      await this.ready;
      if (this.aborted) throw new Error("aborted");
      const sideToMove = fen.split(" ")[1] === "b" ? -1 : 1;

      return new Promise<EvalResult>((resolve, reject) => {
        let lastCp = 0;
        const onMsg = (e: MessageEvent) => {
          const line = String(e.data);
          const score = line.match(/score (cp|mate) (-?\d+)/);
          if (score) {
            lastCp =
              score[1] === "cp"
                ? parseInt(score[2], 10)
                : Math.sign(parseInt(score[2], 10) || 1) *
                  (10000 - Math.min(Math.abs(parseInt(score[2], 10)), 100) * 10);
          }
          if (line.startsWith("bestmove")) {
            this.worker.removeEventListener("message", onMsg);
            resolve({ cp: lastCp * sideToMove });
          }
        };
        this.worker.addEventListener("message", onMsg);
        try {
          this.worker.postMessage(`position fen ${fen}`);
          this.worker.postMessage(`go depth ${depth}`);
        } catch (err) {
          this.worker.removeEventListener("message", onMsg);
          reject(err);
        }
      });
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * Evaluate positions in order; calls onProgress(index, cp) as each
   * finishes. Returns cps (white POV) aligned with `fens`.
   */
  async evalPositions(
    fens: string[],
    depth: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < fens.length; i++) {
      if (this.aborted) throw new Error("aborted");
      const { cp } = await this.evalOne(fens[i], depth);
      out.push(cp);
      onProgress?.(i + 1, fens.length);
    }
    return out;
  }
}
