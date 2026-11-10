/**
 * 黑白棋的一局：规则之上管先后手、轮次、自动停手、悔棋、暂停与结束。
 *
 * 这一层不碰模型、不碰面板、不碰文件；落子只认坐标，判定只认 `src/reversi.ts`。
 * 「伙伴想下哪儿」由 World 问模型，模型调工具写进来，这里只校验。
 */

import { nowIso } from 'cortico/core/util.ts';
import {
  applyMove,
  boardGrid,
  boardText,
  cellAt,
  discCount,
  flipsFor,
  fromLabel,
  initialBoard,
  legalMoves,
  opponent,
  toLabel,
  type Board,
  type Disc,
  type Move,
} from './reversi.ts';
import { LEVEL_LABELS, scoredMoves, type ReversiLevel, type ScoredMove } from './reversi-ai.ts';

export const UNDO_LIMIT = 2;
export const MODEL_MOVE_TIMEOUT_MS = 90_000;

export type ReversiPhase = 'idle' | 'playing' | 'paused' | 'ended';
export type ReversiSide = 'human' | 'model';
export type ReversiWinner = 'human' | 'model' | 'draw';

export interface ReversiMoveRecord {
  /** 手数，从 1 开始。 */
  index: number;
  side: ReversiSide;
  disc: Disc;
  label: string;
  flips: number;
  at: string;
}

export interface ReversiRoundShape {
  id: string;
  level: ReversiLevel;
  humanColor: Disc;
  phase: ReversiPhase;
  board: CellGrid;
  turn: ReversiSide;
  score: { human: number; model: number };
  moves: ReversiMoveRecord[];
  lastMove: string | null;
  undoLeft: number;
  pausedReason: string | null;
  winner: ReversiWinner | null;
  closing: string | null;
  createdAt: string;
  endedAt: string | null;
}

export type CellGrid = Array<Array<Disc | null>>;

export interface ReversiPanelSnapshot extends ReversiRoundShape {
  legal: Array<{ row: number; col: number; label: string }>;
  yourColor: Disc;
  partnerColor: Disc;
  levelLabel: string;
}

export interface ReversiModelSnapshot {
  phase: ReversiPhase;
  yourColor: Disc;
  turn: ReversiSide;
  board: string;
  score: { human: number; model: number };
  moves: number;
  legal: ScoredMove[];
  pausedReason: string | null;
  winner: ReversiWinner | null;
}

/** 复盘画面：从历史里的棋谱重摆到第 `step` 手。 */
export interface ReversiReplayView {
  entryId: string;
  level: ReversiLevel;
  levelLabel: string;
  humanColor: Disc;
  step: number;
  total: number;
  board: CellGrid;
  lastMove: string | null;
  score: { human: number; model: number };
}

/** 面板一次拿到的全部东西：当前局面（可能没有）+ 复盘画面（可能没有）。 */
export interface ReversiPayload {
  snapshot: ReversiPanelSnapshot | null;
  replay: ReversiReplayView | null;
}

/** 从某一手接着下时带进来的前缀（只用于写历史，不参与悔棋）。 */
export interface ReversiBaseMove {
  label: string;
  side: ReversiSide;
}

interface Frame {
  board: Board;
  turn: ReversiSide;
  moves: number;
  lastMove: string | null;
}

export interface PlayResult {
  ok: boolean;
  reason?: string;
  flips: number;
  ended: boolean;
  /** 这一步之后被自动跳过的一方；null 表示没有停手。 */
  passed: ReversiSide | null;
  winner: ReversiWinner | null;
}

export interface ReversiGameOptions {
  id: string;
  level: ReversiLevel;
  humanColor: Disc;
  timezone: string;
  rng?: () => number;
  /** 从复盘的第 N 手接着下：给定局面与轮次，前缀只用于写历史。 */
  start?: {
    board: CellGrid;
    turn: ReversiSide;
    baseMoves?: readonly ReversiBaseMove[];
  };
}

export class ReversiGame {
  readonly id: string;
  readonly level: ReversiLevel;
  readonly humanColor: Disc;
  readonly createdAt: string;
  /** 从复盘接着下时带进来的前缀（只写历史，不参与悔棋）。 */
  readonly baseMoves: ReadonlyArray<ReversiBaseMove>;

  private readonly timezone: string;
  private board: Board = initialBoard();
  private turn: ReversiSide = 'human';
  private phase: ReversiPhase = 'playing';
  private moves: ReversiMoveRecord[] = [];
  private frames: Frame[] = [{ board: initialBoard(), turn: 'human', moves: 0, lastMove: null }];
  private undoUsed = 0;
  private pausedReason: string | null = null;
  private winner: ReversiWinner | null = null;
  private closing: string | null = null;
  private endedAt: string | null = null;
  private lastMove: string | null = null;

  constructor(options: ReversiGameOptions) {
    this.id = options.id;
    this.level = options.level;
    this.humanColor = options.humanColor;
    this.timezone = options.timezone;
    this.createdAt = nowIso(this.timezone);
    this.baseMoves = options.start?.baseMoves ?? [];
    if (options.start) {
      // 复盘接续：局面与轮次由调用方给定，悔棋栈从这里重新起算。
      this.board = options.start.board.map((row) => [...row]) as unknown as Board;
      this.turn = options.start.turn;
      this.frames = [{ board: this.board, turn: this.turn, moves: 0, lastMove: null }];
      return;
    }
    // 开局先手由 World 掷骰决定；随机到伙伴执黑时，第一手就归它。
    if (options.humanColor === 'W') this.turn = 'model';
  }

  get modelColor(): Disc {
    return opponent(this.humanColor);
  }

  get currentPhase(): ReversiPhase {
    return this.phase;
  }

  get currentTurn(): ReversiSide {
    return this.turn;
  }

  get undoLeft(): number {
    return Math.max(0, UNDO_LIMIT - this.undoUsed);
  }

  discOf(side: ReversiSide): Disc {
    return side === 'human' ? this.humanColor : this.modelColor;
  }

  legal(): Move[] {
    if (this.phase !== 'playing') return [];
    return legalMoves(this.board, this.discOf(this.turn));
  }

  /** 面板给玩家看的可落点（不泄漏模型档位分数）。 */
  legalLabels(): Array<{ row: number; col: number; label: string }> {
    return this.legal().map((move) => ({ ...move, label: toLabel(move) }));
  }

  /** 模型这一手可以下哪些、各自的参考分（按档位决定有没有分数）。 */
  modelOptions(): ScoredMove[] {
    if (this.phase !== 'playing' || this.turn !== 'model') return [];
    return scoredMoves(this.board, this.modelColor, this.level);
  }

  score(): { human: number; model: number } {
    const counts = discCount(this.board);
    return { human: counts[this.humanColor], model: counts[this.modelColor] };
  }

  playByHuman(label: string): PlayResult {
    return this.play('human', label);
  }

  playByModel(label: string): PlayResult {
    return this.play('model', label);
  }

  private play(side: ReversiSide, rawLabel: string): PlayResult {
    const base: PlayResult = { ok: false, flips: 0, ended: false, passed: null, winner: null };
    if (this.phase === 'paused') return { ...base, reason: '这一局正暂停着，先点「继续」。' };
    if (this.phase !== 'playing') return { ...base, reason: '这一局已经结束了。' };
    if (side !== this.turn) return { ...base, reason: '还没轮到你。' };

    const move = fromLabel(rawLabel);
    if (!move) return { ...base, reason: `坐标看不懂：「${rawLabel}」。用 c4 这种写法（a–h 列，1–8 行）。` };

    const disc = this.discOf(side);
    const flips = flipsFor(this.board, move, disc);
    if (flips.length === 0) {
      const legal = this.legal().map((item) => toLabel(item)).join('、') || '（没有可下的点）';
      return { ...base, reason: `这里不能下：${rawLabel}。当前能下：${legal}。` };
    }

    this.board = applyMove(this.board, move, disc);
    const record: ReversiMoveRecord = {
      index: this.moves.length + 1,
      side,
      disc,
      label: toLabel(move),
      flips: flips.length,
      at: nowIso(this.timezone),
    };
    this.moves = [...this.moves, record];
    this.lastMove = record.label;
    this.turn = side === 'human' ? 'model' : 'human';

    // 自动停手：下一个该下的人没地方下就跳过；两边都没地方下就终局。
    let passed: ReversiSide | null = null;
    if (legalMoves(this.board, this.discOf(this.turn)).length === 0) {
      const other = this.turn === 'human' ? 'model' : 'human';
      if (legalMoves(this.board, this.discOf(other)).length === 0) {
        this.finish();
      } else {
        passed = this.turn;
        this.turn = other;
      }
    }

    this.frames = [
      ...this.frames,
      { board: this.board, turn: this.turn, moves: this.moves.length, lastMove: this.lastMove },
    ];

    return {
      ok: true,
      flips: flips.length,
      ended: this.isEnded(),
      passed,
      winner: this.winner,
    };
  }

  private finish(): void {
    const score = this.score();
    this.phase = 'ended';
    this.endedAt = nowIso(this.timezone);
    this.winner = score.human === score.model ? 'draw' : score.human > score.model ? 'human' : 'model';
  }

  private isEnded(): boolean {
    return this.phase === 'ended';
  }

  /** 悔棋：退回「玩家上一次落子之前」，也就是把伙伴随后那一手也一起撤掉。 */
  undo(): { ok: boolean; reason?: string } {
    if (this.phase !== 'playing') return { ok: false, reason: '这一局现在不能悔棋。' };
    if (this.undoLeft <= 0) return { ok: false, reason: '这一局的悔棋次数用完了。' };
    const target = [...this.moves].reverse().find((item) => item.side === 'human');
    if (!target) return { ok: false, reason: '你还没落子，没什么可悔的。' };

    const frame = this.frames[target.index - 1];
    if (!frame) return { ok: false, reason: '悔棋需要的局面丢了，只能继续。' };

    this.board = frame.board;
    this.turn = frame.turn;
    this.moves = this.moves.slice(0, frame.moves);
    this.lastMove = frame.lastMove;
    this.frames = this.frames.slice(0, target.index);
    this.undoUsed += 1;
    return { ok: true };
  }

  resign(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.endedAt = nowIso(this.timezone);
    this.winner = 'model';
  }

  pause(reason: string): boolean {
    if (this.phase !== 'playing') return false;
    this.phase = 'paused';
    this.pausedReason = reason;
    return true;
  }

  resume(): { ok: boolean; reason?: string } {
    if (this.phase !== 'paused') return { ok: false, reason: '这一局没在暂停。' };
    this.phase = 'playing';
    this.pausedReason = null;
    return { ok: true };
  }

  close(closing: string): void {
    this.closing = closing;
  }

  snapshot(): ReversiPanelSnapshot {
    const score = this.score();
    return {
      id: this.id,
      level: this.level,
      humanColor: this.humanColor,
      phase: this.phase,
      board: boardGrid(this.board) as CellGrid,
      turn: this.turn,
      score,
      moves: this.moves,
      lastMove: this.lastMove,
      undoLeft: this.undoLeft,
      pausedReason: this.pausedReason,
      winner: this.winner,
      closing: this.closing,
      createdAt: this.createdAt,
      endedAt: this.endedAt,
      legal: this.legalLabels(),
      yourColor: this.humanColor,
      partnerColor: this.modelColor,
      levelLabel: LEVEL_LABELS[this.level],
    };
  }

  modelSnapshot(): ReversiModelSnapshot {
    return {
      phase: this.phase,
      yourColor: this.modelColor,
      turn: this.turn,
      board: boardText(this.board),
      score: this.score(),
      moves: this.moves.length,
      legal: this.modelOptions(),
      pausedReason: this.pausedReason,
      winner: this.winner,
    };
  }

  /** 给事件用：轮到谁、比分、可落点。 */
  turnLine(): string {
    const score = this.score();
    if (this.phase === 'ended') {
      return `终局：你 ${score.model} : ${score.human} 对方`;
    }
    const side = this.turn === 'human' ? '对方' : '你';
    return `轮到${side}（你 ${score.model} : ${score.human} 对方）`;
  }

  boardLine(row: number, col: number): string {
    return cellAt(this.board, row, col) ?? '.';
  }
}
