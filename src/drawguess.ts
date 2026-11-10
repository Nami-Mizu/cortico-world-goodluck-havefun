/**
 * 「你画我猜」：伙伴画、你来猜。
 *
 * 一局的走向：World 抽词（只给模型，不给面板）→ 模型交笔画 → 面板把笔画渲染成 PNG 回传
 * → World 让辅助视觉模型盲猜打分 → 分数够就定稿，不够就带着描述让模型改 → 定稿后你猜
 * → 猜错则重置这一批的重画次数（受全局上限约束）→ 你点「查看谜底」或模型判对时结束。
 *
 * 所有判定都在 World 里：主模型只能提交笔画、说「定稿」、判你猜得对不对。
 * 分数与重画预算不归它管，这是「不会永远觉得自己对/不对」的关键。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Stroke } from './strokes.ts';
import type { VisionReading, VisionScore } from './vision.ts';
import type { WordTier } from './words.ts';

export type DrawPhase = 'idle' | 'drawing' | 'guessing' | 'ended';

export interface DrawAttempt {
  id: string;
  strokes: Stroke[];
  /** 笔画总长度，提示词里用来劝模型「画得太空」。 */
  ink: number;
  /** PNG 文件名；面板还没回传时是 null。 */
  png: string | null;
  /** 盲猜得分 0–3；关闭视觉时保持 null。 */
  points: number | null;
  matched: string | null;
  description: string | null;
  guesses: string[];
  confidence: number | null;
  createdAt: string;
}

export interface DrawGuess {
  text: string;
  correct: boolean;
  via: 'match' | 'judge';
  at: string;
}

export interface DrawRound {
  id: string;
  word: string;
  tier: WordTier;
  phase: DrawPhase;
  attempts: DrawAttempt[];
  guesses: DrawGuess[];
  /** 这一局一共用掉几次视觉检查。 */
  checksUsed: number;
  /** 当前这一批还能画几次（猜错会被重置）。 */
  batchChecks: number;
  closing: string | null;
  createdAt: string;
  endedAt: string | null;
  guessed: boolean | null;
}

/** 给模型看的状态：含答案。 */
export interface DrawSnapshot {
  phase: DrawPhase;
  round: number;
  tier: WordTier | null;
  word: string | null;
  attempts: DrawAttempt[];
  guesses: DrawGuess[];
  checksUsed: number;
  batchChecks: number;
  maxAttempts: number;
  maxChecks: number;
  /** 这一局开局的时刻（ISO）；没开局为 null。 */
  createdAt: string | null;
  /** 这一局结束的时刻（ISO）；没结束为 null。 */
  endedAt: string | null;
  closing: string | null;
  guessed: boolean | null;
}

/** 给面板看的状态：揭晓前不含答案、视觉描述与猜测。 */
export interface DrawPanelAttempt {
  id: string;
  strokes: Stroke[];
  hasPng: boolean;
  points: number | null;
}

export interface DrawPanelSnapshot {
  phase: DrawPhase;
  round: number;
  attempts: DrawPanelAttempt[];
  guesses: { text: string; correct: boolean }[];
  checksUsed: number;
  maxChecks: number;
  word: string | null;
  closing: string | null;
  guessed: boolean | null;
}

/** 辅助视觉当前的状态：可用 / 用户关掉 / 连续失败降级。 */
export type DrawVisionMode = 'on' | 'off' | 'unavailable';

/** 面板 `state` 的返回：面板快照 + 视觉状态。 */
export interface DrawPanelPayload {
  snapshot: DrawPanelSnapshot;
  vision: DrawVisionMode;
}

export interface DrawGameOptions {
  /** 部署的数据目录；一局一个目录 `<dataDir>/drawguess/<局号>/`。 */
  dataDir: string;
  limits: () => { maxAttempts: number; maxChecks: number };
  matcher: (a: string, b: string) => boolean;
}

const ROUND_ID = (index: number) => `r${index}`;

export class DrawGame {
  private readonly opts: DrawGameOptions;
  private readonly rounds: DrawRound[] = [];
  private current: DrawRound | null = null;

  constructor(options: DrawGameOptions) {
    this.opts = options;
  }

  phase(): DrawPhase {
    return this.current?.phase ?? 'idle';
  }

  active(): boolean {
    return this.phase() === 'drawing' || this.phase() === 'guessing';
  }

  /**
   * 一局的画图预算是否用完：每交一张画算一次（视觉开着时同时是一次检查）。
   * 用完就不能再画；你再猜错一次，这一局自动结束。
   */
  budgetExhausted(): boolean {
    if (!this.current) return false;
    return this.current.attempts.length >= this.opts.limits().maxChecks;
  }

  currentRound(): DrawRound | null {
    return this.current;
  }

  /** 开一局。同一个词不连出两局。 */
  async start(word: string, tier: WordTier): Promise<DrawRound> {
    if (this.active()) throw new Error('上一局还没结束，先把它收掉再开新的。');
    const index = this.rounds.length + 1;
    const round: DrawRound = {
      id: ROUND_ID(index),
      word,
      tier,
      phase: 'drawing',
      attempts: [],
      guesses: [],
      checksUsed: 0,
      batchChecks: 0,
      closing: null,
      createdAt: new Date().toISOString(),
      endedAt: null,
      guessed: null,
    };
    this.rounds.push(round);
    this.current = round;
    await this.persist();
    return round;
  }

  /** 收一笔画。属于「这一批」的预算，猜错会重置。 */
  async addAttempt(drawing: { strokes: Stroke[] }, ink: number): Promise<DrawAttempt> {
    const round = this.requireRound();
    if (round.phase !== 'drawing') throw new Error('现在不是在画图阶段。');
    const { maxAttempts } = this.opts.limits();
    if (round.batchChecks >= maxAttempts) {
      throw new Error(`这一批已经画了 ${maxAttempts} 次，不能再画；调 finish 定稿，或等你猜错后重画。`);
    }
    round.batchChecks += 1;
    const attempt: DrawAttempt = {
      id: `a${round.attempts.length + 1}`,
      strokes: drawing.strokes,
      ink,
      png: null,
      points: null,
      matched: null,
      description: null,
      guesses: [],
      confidence: null,
      createdAt: new Date().toISOString(),
    };
    round.attempts.push(attempt);
    await this.persist();
    return attempt;
  }

  /** 面板把 PNG 回传上来；同一张图重复回传只覆盖。 */
  async setArt(attemptId: string, png: string): Promise<DrawAttempt> {
    const attempt = this.requireAttempt(attemptId);
    attempt.png = png;
    await this.persist();
    return attempt;
  }

  /** 记下盲猜结果。 */
  async setCheck(attemptId: string, reading: VisionReading, score: VisionScore): Promise<DrawAttempt> {
    const round = this.requireRound();
    const attempt = this.requireAttempt(attemptId);
    attempt.points = score.points;
    attempt.matched = score.matched;
    attempt.description = reading.description;
    attempt.guesses = reading.guesses;
    attempt.confidence = reading.confidence;
    round.checksUsed += 1;
    await this.persist();
    return attempt;
  }

  /** 得分最高的那一张；同分取更晚的一张。 */
  bestAttempt(): DrawAttempt | null {
    const attempts = this.current?.attempts.filter((item) => item.png !== null) ?? [];
    if (attempts.length === 0) return null;
    return attempts.reduce((best, item) => ((item.points ?? -1) >= (best.points ?? -1) ? item : best));
  }

  lastAttempt(): DrawAttempt | null {
    const attempts = this.current?.attempts ?? [];
    return attempts[attempts.length - 1] ?? null;
  }

  /** 定稿：模型说「就这张」。要求至少有一张回传过 PNG。 */
  async finish(): Promise<DrawRound> {
    const round = this.requireRound();
    if (round.phase !== 'drawing') throw new Error('现在不是在画图阶段。');
    const best = this.bestAttempt();
    if (!best) throw new Error('还没有成图（面板还没把 PNG 回传上来），等一下再 finish。');
    round.phase = 'guessing';
    await this.persist();
    return round;
  }

  /** 你猜一个词。命中就走 World 的规范化比较，不必再让模型判。 */
  async guess(text: string): Promise<{ round: DrawRound; guess: DrawGuess; matched: boolean }> {
    const round = this.requireRound();
    if (round.phase !== 'guessing') throw new Error('现在不在猜词阶段。');
    const value = text.trim();
    if (!value) throw new Error('猜的词不能是空的。');
    if (value.length > 30) throw new Error('一次猜一个词就够了，最多 30 字。');
    const matched = this.opts.matcher(value, round.word);
    const guess: DrawGuess = {
      text: value,
      correct: matched,
      via: 'match',
      at: new Date().toISOString(),
    };
    round.guesses.push(guess);
    if (matched) await this.end(true);
    else await this.persist();
    return { round, guess, matched };
  }

  /** 模型判定你猜对了（World 没命中、但模型认为算对时用）。 */
  async judgeCorrect(text: string): Promise<DrawRound> {
    const round = this.requireRound();
    if (round.phase !== 'guessing') throw new Error('现在不在猜词阶段。');
    round.guesses.push({
      text: text.trim() || round.word,
      correct: true,
      via: 'judge',
      at: new Date().toISOString(),
    });
    await this.end(true);
    return round;
  }

  /** 猜错了：重置这一批的重画次数（受全局上限约束），回到画图阶段。 */
  async rejectGuess(): Promise<{ round: DrawRound; canRedraw: boolean }> {
    const round = this.requireRound();
    if (round.phase !== 'guessing') throw new Error('现在不在猜词阶段。');
    const canRedraw = !this.budgetExhausted();
    if (canRedraw) {
      round.phase = 'drawing';
      round.batchChecks = 0;
    }
    await this.persist();
    return { round, canRedraw };
  }

  /** 你点「查看谜底」：直接结束，算没猜中。 */
  async reveal(): Promise<DrawRound> {
    const round = this.requireRound();
    if (round.phase === 'ended') throw new Error('这一局已经结束了。');
    await this.end(false);
    return round;
  }

  async end(guessed: boolean): Promise<DrawRound> {
    const round = this.requireRound();
    round.phase = 'ended';
    round.guessed = guessed;
    round.endedAt = new Date().toISOString();
    await this.persist();
    return round;
  }

  async close(closing: string): Promise<DrawRound> {
    const round = this.requireRound();
    if (round.phase !== 'ended') throw new Error('还没结束，等你点「查看谜底」或判对之后再写收尾。');
    const value = closing.trim();
    if (!value) throw new Error('收尾话不能是空的。');
    if (value.length > 800) throw new Error('收尾话最多 800 字。');
    if (round.closing) throw new Error('收尾话已经写过了。');
    round.closing = value;
    await this.persist();
    return round;
  }

  /** 模型看的状态：含答案与视觉描述。 */
  snapshot(): DrawSnapshot {
    const round = this.current;
    const limits = this.opts.limits();
    if (!round) {
      return {
        phase: 'idle',
        round: 0,
        tier: null,
        word: null,
        attempts: [],
        guesses: [],
        checksUsed: 0,
        batchChecks: 0,
        maxAttempts: limits.maxAttempts,
        maxChecks: limits.maxChecks,
        createdAt: null,
        endedAt: null,
        closing: null,
        guessed: null,
      };
    }
    return {
      phase: round.phase,
      round: this.rounds.length,
      tier: round.tier,
      word: round.word,
      attempts: round.attempts,
      guesses: round.guesses,
      checksUsed: round.checksUsed,
      batchChecks: round.batchChecks,
      maxAttempts: limits.maxAttempts,
      maxChecks: limits.maxChecks,
      createdAt: round.createdAt,
      endedAt: round.endedAt,
      closing: round.closing,
      guessed: round.guessed,
    };
  }

  /** 面板看的状态：揭晓前不含词、视觉描述与猜测。 */
  panelSnapshot(): DrawPanelSnapshot {
    const round = this.current;
    if (!round) {
      return {
        phase: 'idle',
        round: 0,
        attempts: [],
        guesses: [],
        checksUsed: 0,
        maxChecks: this.opts.limits().maxChecks,
        word: null,
        closing: null,
        guessed: null,
      };
    }
    const revealed = round.phase === 'ended';
    return {
      phase: round.phase,
      round: this.rounds.length,
      attempts: round.attempts.map((item) => ({
        id: item.id,
        strokes: item.strokes,
        hasPng: item.png !== null,
        points: item.points,
      })),
      guesses: round.guesses.map((item) => ({ text: item.text, correct: item.correct })),
      checksUsed: round.checksUsed,
      maxChecks: this.opts.limits().maxChecks,
      word: revealed ? round.word : null,
      closing: round.closing,
      guessed: round.guessed,
    };
  }

  /** 落盘：一局一个 JSON（PNG 走单独的 png 名字段，由 World 存）。 */
  private async persist(): Promise<void> {
    const round = this.current;
    if (!round) return;
    const dir = join(this.dataDir(), round.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'round.json'), `${JSON.stringify(round, null, 2)}\n`, 'utf8');
  }

  private dataDir(): string {
    return join(this.opts.dataDir, 'drawguess');
  }

  private requireRound(): DrawRound {
    if (!this.current) throw new Error('还没开局。');
    return this.current;
  }

  private requireAttempt(attemptId: string): DrawAttempt {
    const round = this.requireRound();
    const attempt = round.attempts.find((item) => item.id === attemptId);
    if (!attempt) throw new Error(`找不到这一笔：${attemptId}`);
    return attempt;
  }
}
