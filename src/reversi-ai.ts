/**
 * 黑白棋的参考分：给伙伴「看提示」与「不留情」两档用。
 *
 * 这两档都不代替伙伴落子——分数只是写进事件里的参考，它想怎么下还是它的事。
 * 口径：静态评估 = 子数差 + 角（+100）+ X 位（−40）+ 机动性（×2）。
 * 「看提示」直接用落子后的静态分；「不留情」用 3 层 minimax 的分数。
 */

import {
  applyMove,
  cellAt,
  cloneBoard,
  flipsFor,
  legalMoves,
  opponent,
  SIZE,
  toLabel,
  type Board,
  type Disc,
  type Move,
} from './reversi.ts';

export type ReversiLevel = 1 | 2 | 3;

export const LEVEL_DEFAULTS: ReversiLevel = 2;

export const LEVEL_LABELS: Record<ReversiLevel, string> = {
  1: '伙伴自己来',
  2: '伙伴看提示',
  3: '伙伴不留情',
};

export const LEVEL_HINTS: Record<ReversiLevel, string> = {
  1: '只把棋盘和可落点给它，它自己算。',
  2: '每个可落点附一个贪心参考分。',
  3: '每个可落点附一个 3 层搜索的参考分。',
};

export const CORNER_WEIGHT = 100;
export const X_SQUARE_WEIGHT = -40;
export const MOBILITY_WEIGHT = 2;

const CORNERS: readonly Move[] = [
  { row: 0, col: 0 },
  { row: 0, col: SIZE - 1 },
  { row: SIZE - 1, col: 0 },
  { row: SIZE - 1, col: SIZE - 1 },
];

const X_SQUARES: readonly Move[] = [
  { row: 1, col: 1 },
  { row: 1, col: SIZE - 2 },
  { row: SIZE - 2, col: 1 },
  { row: SIZE - 2, col: SIZE - 2 },
];

function discsAt(board: Board, squares: readonly Move[], disc: Disc): number {
  let count = 0;
  for (const square of squares) if (cellAt(board, square.row, square.col) === disc) count += 1;
  return count;
}

function material(board: Board, disc: Disc): number {
  let mine = 0;
  let theirs = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === disc) mine += 1;
      else if (cell === opponent(disc)) theirs += 1;
    }
  }
  return mine - theirs;
}

/** 从 `disc` 的角度评估盘面：正数对它有利。 */
export function evaluate(board: Board, disc: Disc): number {
  const other = opponent(disc);
  const corners = CORNER_WEIGHT * (discsAt(board, CORNERS, disc) - discsAt(board, CORNERS, other));
  const xs = X_SQUARE_WEIGHT * (discsAt(board, X_SQUARES, disc) - discsAt(board, X_SQUARES, other));
  const mobility = MOBILITY_WEIGHT * (legalMoves(board, disc).length - legalMoves(board, other).length);
  return corners + xs + mobility + material(board, disc);
}

function minimax(
  board: Board,
  toMove: Disc,
  depth: number,
  alpha: number,
  beta: number,
  perspective: Disc,
  passed: boolean,
): number {
  const moves = legalMoves(board, toMove);
  if (depth <= 0 || moves.length === 0) {
    if (moves.length === 0 && !passed && legalMoves(board, opponent(toMove)).length > 0) {
      return minimax(board, opponent(toMove), depth, alpha, beta, perspective, true);
    }
    return evaluate(board, perspective);
  }

  const maximizing = toMove === perspective;
  let best = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const move of moves) {
    const child = applyMove(board, move, toMove);
    const value = minimax(child, opponent(toMove), depth - 1, alpha, beta, perspective, false);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export interface ScoredMove {
  move: Move;
  label: string;
  flips: number;
  /** 只有「看提示」「不留情」两档有；「伙伴自己来」没有分数。 */
  score?: number;
}

/** 算出当前可落点；档 2/3 附带参考分（都站在 `disc` 的角度，越高越好）。 */
export function scoredMoves(board: Board, disc: Disc, level: ReversiLevel): ScoredMove[] {
  return legalMoves(board, disc).map((move) => {
    const flips = flipsFor(board, move, disc).length;
    const base: ScoredMove = { move, label: toLabel(move), flips };
    if (level === 1) return base;

    const after = applyMove(board, move, disc);
    const score =
      level === 2
        ? evaluate(after, disc)
        : minimax(after, opponent(disc), 2, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, disc, false);
    return { ...base, score: Math.round(score * 10) / 10 };
  });
}

/** 事件里给模型看的一行：`c4 · 翻 3 子 · 参考 12.5`。 */
export function describeScoredMove(item: ScoredMove): string {
  if (item.score === undefined) return `${item.label} · 翻 ${item.flips} 子`;
  return `${item.label} · 翻 ${item.flips} 子 · 参考 ${item.score}`;
}

/** 棋盘复制一份（给 undo / 回放用）。 */
export function copyBoard(board: Board): Board {
  return cloneBoard(board);
}
