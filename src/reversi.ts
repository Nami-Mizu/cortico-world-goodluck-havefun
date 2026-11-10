/**
 * 黑白棋（Reversi）的纯规则层：不碰 DOM、不碰文件、不碰模型。
 *
 * 坐标：row 0 是第 1 行（棋盘最上面一行），col 0 是 a 列；落子记作 `c4` 这种形式。
 * 颜色：`B` 黑先，`W` 白后。
 */

export type Disc = 'B' | 'W';
export type Cell = Disc | null;

/** `[row][col]`，row 0 = 第 1 行，col 0 = a 列。 */
export type Board = readonly (readonly Cell[])[];

export interface Move {
  readonly row: number;
  readonly col: number;
}

export const SIZE = 8;
export const FILES = 'abcdefgh';

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function opponent(disc: Disc): Disc {
  return disc === 'B' ? 'W' : 'B';
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

export function emptyCell(): Board {
  return Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
}

/** 标准开局：d4、e5 白，d5、e4 黑。 */
export function initialBoard(): Board {
  const board = emptyCell().map((row) => [...row]);
  board[3]![3] = 'W'; // d4
  board[4]![4] = 'W'; // e5
  board[4]![3] = 'B'; // d5
  board[3]![4] = 'B'; // e4
  return board;
}

export function cloneBoard(board: Board): Cell[][] {
  return board.map((row) => [...row]);
}

export function cellAt(board: Board, row: number, col: number): Cell {
  return inBounds(row, col) ? (board[row]![col] ?? null) : null;
}

/**
 * 把 `disc` 下在 `move` 上能翻掉哪些子；空数组表示这不是合法手。
 * 八个方向各走一遍，碰到自己的子才算夹住，撞到空位或出界就作废。
 */
export function flipsFor(board: Board, move: Move, disc: Disc): Move[] {
  if (!inBounds(move.row, move.col)) return [];
  if (cellAt(board, move.row, move.col) !== null) return [];

  const flips: Move[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    const line: Move[] = [];
    let row = move.row + dRow;
    let col = move.col + dCol;
    while (inBounds(row, col) && cellAt(board, row, col) === opponent(disc)) {
      line.push({ row, col });
      row += dRow;
      col += dCol;
    }
    if (line.length > 0 && cellAt(board, row, col) === disc) flips.push(...line);
  }
  return flips;
}

export function legalMoves(board: Board, disc: Disc): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (board[row]![col] !== null) continue;
      if (flipsFor(board, { row, col }, disc).length > 0) moves.push({ row, col });
    }
  }
  return moves;
}

/** 落子并翻转。调用前应先确认合法（`flipsFor` 非空）。 */
export function applyMove(board: Board, move: Move, disc: Disc): Cell[][] {
  const next = cloneBoard(board);
  next[move.row]![move.col] = disc;
  for (const flip of flipsFor(board, move, disc)) next[flip.row]![flip.col] = disc;
  return next;
}

export function discCount(board: Board): { B: number; W: number } {
  let B = 0;
  let W = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === 'B') B += 1;
      else if (cell === 'W') W += 1;
    }
  }
  return { B, W };
}

export function emptyCount(board: Board): number {
  const { B, W } = discCount(board);
  return SIZE * SIZE - B - W;
}

export function toLabel(move: Move): string {
  return `${FILES[move.col] ?? '?'}${move.row + 1}`;
}

export function fromLabel(label: string): Move | null {
  const text = label.trim().toLowerCase();
  if (!/^[a-h][1-8]$/.test(text)) return null;
  return { row: Number(text[1]) - 1, col: FILES.indexOf(text[0]!) };
}

/** 盘面转成 8 行文本，`.` 是空位。给模型看的紧凑表示。 */
export function boardText(board: Board): string {
  const lines = board.map((row) => row.map((cell) => cell ?? '.').join(''));
  const header = `  ${FILES.split('').join(' ')}`;
  return [header, ...lines.map((line, index) => `${index + 1} ${line.split('').join(' ')}`)].join('\n');
}

/** 盘面给面板用的二维数组（`B` / `W` / `null`）。 */
export function boardGrid(board: Board): Cell[][] {
  return board.map((row) => [...row]);
}

/** 复盘用的一手：坐标 + 这一手是谁的颜色。 */
export interface ReplayStep {
  readonly label: string;
  readonly disc: Disc;
}

/**
 * 从开局摆到第 N 手之后（复盘用）。
 * 坐标不认识或这一手本身不合法就跳过，不让一条坏记录毁掉整段回放。
 */
export function replayBoard(steps: readonly ReplayStep[]): Board {
  let board: Board = initialBoard();
  for (const step of steps) {
    const cell = fromLabel(step.label);
    if (!cell) continue;
    if (flipsFor(board, cell, step.disc).length === 0) continue;
    board = applyMove(board, cell, step.disc);
  }
  return board;
}
