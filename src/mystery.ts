import { nowIso } from 'cortico/core/util.ts';
import { describeTags, type TagDimension, type TagSet } from './tags.ts';
import type { RoundStore } from './store.ts';

/** 伙伴能给的四种回答，外加「不能回答」。 */
export type Verdict = 'yes' | 'no' | 'irrelevant' | 'asked' | 'cannot';

export const VERDICT_LABELS: Record<Verdict, string> = {
  yes: '是',
  no: '不是',
  irrelevant: '无关',
  asked: '问过了',
  cannot: '不能回答',
};

/** 一问一答里的一条。 */
export interface MysteryQuestion {
  id: string;
  text: string;
  verdict?: Verdict;
  askedAt: string;
}

/** 一局。`answer` 只在文件与模型那边；面板要等揭晓才拿得到。 */
export interface MysteryRound {
  id: string;
  tags: TagSet;
  title: string;
  surface: string;
  answer: string;
  questions: MysteryQuestion[];
  ended: boolean;
  guessed: boolean | null;
  closing: string | null;
  createdAt: string;
  endedAt: string | null;
}

export type MysteryPhase = 'drawing' | 'ready' | 'ended';

export interface MysterySnapshot {
  round: {
    id: string;
    phase: MysteryPhase;
    tags: TagSet;
    tagsLabel: string;
    title: string;
    surface: string;
    questions: Array<{ id: string; text: string; verdict?: Verdict; verdictLabel?: string }>;
    maxQuestions: number;
    guessed: boolean | null;
    closing: string | null;
    /** 这一局开局的时刻（ISO）。 */
    createdAt: string;
    /** 这一局结束的时刻（ISO）；没结束为 null。 */
    endedAt: string | null;
    /** 只有 ended 之后才有。 */
    answer: string;
  } | null;
  note: string;
}

export const MAX_QUESTION_LENGTH = 50;

const TITLE_MAX = 60;
const SURFACE_MIN = 10;
const SURFACE_MAX = 1200;
const ANSWER_MIN = 20;
const ANSWER_MAX = 4000;
const CLOSING_MAX = 800;

export interface MysteryLimits {
  maxQuestions: number;
  /** 违禁词：题目里出现任何一个就拒绝落盘。空数组表示不拦。 */
  bannedWords: string[];
}

export interface MysteryGameOptions {
  timezone: string;
  /** 现读配置，热改立即生效。 */
  limits: () => MysteryLimits;
  /** 现读维度（标签清单可配置，所以每次都要重新拼）。 */
  dimensions: () => TagDimension[];
  store: RoundStore;
}

/**
 * 一局推理游戏的规则与状态。
 *
 * 所有会改局面的方法都返回 Promise：改完立刻落盘，模型中途反悔也不会改掉已经写下的真相。
 */
export class MysteryGame {
  private readonly timezone: string;
  private readonly limits: () => MysteryLimits;
  private readonly dimensions: () => TagDimension[];
  private readonly store: RoundStore;
  private round: MysteryRound | null = null;
  private roundSeq = 0;
  private questionSeq = 0;

  constructor(options: MysteryGameOptions) {
    this.timezone = options.timezone;
    this.limits = options.limits;
    this.dimensions = options.dimensions;
    this.store = options.store;
  }

  phase(): MysteryPhase {
    if (!this.round) return 'drawing';
    if (this.round.ended) return 'ended';
    return this.round.answer ? 'ready' : 'drawing';
  }

  currentRound(): MysteryRound | null {
    return this.round;
  }

  async start(tags: TagSet): Promise<MysteryRound> {
    if (this.round && !this.round.ended) {
      throw new Error('这一局还没结束：先问完，或者点「查看真相」结束它。');
    }
    this.roundSeq += 1;
    this.questionSeq = 0;
    this.round = {
      id: `r${this.roundSeq}`,
      tags,
      title: '',
      surface: '',
      answer: '',
      questions: [],
      ended: false,
      guessed: null,
      closing: null,
      createdAt: nowIso(this.timezone),
      endedAt: null,
    };
    await this.persist();
    return this.round;
  }

  /**
   * 重抽标签：只允许在题写出来之前。
   *
   * 用途是「标签互相打架」——比如「温情」配「误解」还能写，「离别」配「巧合」就很容易写成车祸。
   */
  async retag(tags: TagSet): Promise<MysteryRound> {
    const round = this.requireRound();
    if (round.answer) throw new Error('题已经写下了，标签不能再改；要换标签请先结束这一局。');
    round.tags = tags;
    await this.persist();
    return round;
  }

  async writePuzzle(input: { title: string; surface: string; answer: string }): Promise<void> {
    const round = this.requireRound();
    if (round.answer) throw new Error('这一局的真相已经写下了，不能改。要换题请先结束这一局。');
    const title = input.title.trim();
    const surface = input.surface.trim();
    const answer = input.answer.trim();
    if (!title) throw new Error('标题不能为空。');
    if ([...title].length > TITLE_MAX) throw new Error(`标题最多 ${TITLE_MAX} 个字。`);
    if ([...surface].length < SURFACE_MIN) throw new Error(`谜面太短了，至少 ${SURFACE_MIN} 个字。`);
    if ([...surface].length > SURFACE_MAX) throw new Error(`谜面最多 ${SURFACE_MAX} 个字。`);
    if ([...answer].length < ANSWER_MIN) throw new Error(`真相太短了，至少 ${ANSWER_MIN} 个字。`);
    if ([...answer].length > ANSWER_MAX) throw new Error(`真相最多 ${ANSWER_MAX} 个字。`);
    const banned = findBannedWords(`${title}\n${surface}\n${answer}`, this.limits().bannedWords);
    if (banned.length) {
      throw new Error(
        `题目里有违禁词：${banned.map((word) => `「${word}」`).join('、')}。` +
          '换一个说法或者改情节，再调一次 write（这一局还没消耗掉，可以重写）。',
      );
    }
    round.title = title;
    round.surface = surface;
    round.answer = answer;
    await this.persist();
  }

  /** 提问。重复的问题直接判「问过了」，不占伙伴的判定。 */
  async ask(text: string): Promise<{ question: MysteryQuestion; duplicate: boolean }> {
    const round = this.requirePlayable();
    const cleaned = text.trim();
    const length = [...cleaned].length;
    if (!length) throw new Error('问题不能为空。');
    if (length > MAX_QUESTION_LENGTH) {
      throw new Error(`问题最多 ${MAX_QUESTION_LENGTH} 个字，现在有 ${length} 个。`);
    }
    const maxQuestions = this.maxQuestions();
    if (this.countQuestions(round) >= maxQuestions) {
      throw new Error(`这一局已经问到上限（${maxQuestions} 个问题），点「查看真相」收尾吧。`);
    }
    this.questionSeq += 1;
    const question: MysteryQuestion = {
      id: `q${this.questionSeq}`,
      text: cleaned,
      askedAt: nowIso(this.timezone),
    };
    const duplicate = round.questions.find(
      (earlier) => normalizeQuestion(earlier.text) === normalizeQuestion(cleaned),
    );
    if (duplicate) {
      question.verdict = 'asked';
      round.questions.push(question);
      await this.persist();
      return { question, duplicate: true };
    }
    round.questions.push(question);
    await this.persist();
    return { question, duplicate: false };
  }

  async judge(questionId: string, verdict: Verdict): Promise<MysteryQuestion> {
    const round = this.requireRound();
    const question = round.questions.find((item) => item.id === questionId);
    if (!question) throw new Error(`没有 ${questionId} 这个问题。`);
    if (question.verdict) throw new Error(`${questionId} 已经判过了：${VERDICT_LABELS[question.verdict]}。`);
    question.verdict = verdict;
    await this.persist();
    return question;
  }

  /** 面板点了「查看真相」：这一局立刻结束（按没猜中算），收尾词等伙伴生成。 */
  async endByPanel(): Promise<MysteryRound> {
    const round = this.requirePlayable();
    round.ended = true;
    round.guessed = round.guessed ?? false;
    round.endedAt = nowIso(this.timezone);
    await this.persist();
    return round;
  }

  /**
   * 伙伴收尾：写一段夸奖（猜中）或安慰（没猜中）。
   *
   * 如果这一局还没结束（伙伴判断「已问到关键」），这一步顺手把它结束。
   */
  async close(input: { guessed: boolean; closing: string }): Promise<MysteryRound> {
    const round = this.requireRound();
    if (!round.answer) throw new Error('真相还没写，不能收尾。');
    if (round.closing) throw new Error('这一局已经写过收尾词了。');
    const text = input.closing.trim();
    if (!text) throw new Error('收尾词不能为空：猜中要夸，没猜中要安慰。');
    if ([...text].length > CLOSING_MAX) throw new Error(`收尾词最多 ${CLOSING_MAX} 个字。`);
    if (!round.ended) {
      const pending = round.questions.find((item) => !item.verdict);
      if (pending) throw new Error(`${pending.id} 还没判，先判完再收尾。`);
      round.ended = true;
      round.endedAt = nowIso(this.timezone);
    }
    round.guessed = input.guessed;
    round.closing = text;
    await this.persist();
    return round;
  }

  snapshot(): MysterySnapshot {
    const round = this.round;
    if (!round) {
      return { round: null, note: '还没有开局。点「开始一局」抽三个标签，让伙伴出题。' };
    }
    const phase = this.phase();
    return {
      round: {
        id: round.id,
        phase,
        tags: round.tags,
        tagsLabel: describeTags(this.dimensions(), round.tags),
        title: round.title,
        surface: round.surface,
        questions: round.questions.map((item) => ({
          id: item.id,
          text: item.text,
          verdict: item.verdict,
          verdictLabel: item.verdict ? VERDICT_LABELS[item.verdict] : undefined,
        })),
        maxQuestions: this.maxQuestions(),
        guessed: round.guessed,
        closing: round.closing,
        createdAt: round.createdAt,
        endedAt: round.endedAt,
        answer: round.ended ? round.answer : '',
      },
      note: noteFor(phase),
    };
  }

  maxQuestions(): number {
    const value = this.limits().maxQuestions;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 50;
  }

  /** 已经占掉判定次数的问题数（重复提问不计）。 */
  countQuestions(round: MysteryRound): number {
    return round.questions.filter((item) => item.verdict !== 'asked').length;
  }

  private requireRound(): MysteryRound {
    if (!this.round) throw new Error('还没有开局：先调 goodluckhavefun_mystery_start。');
    return this.round;
  }

  private requirePlayable(): MysteryRound {
    const round = this.requireRound();
    if (round.ended) throw new Error('这一局已经结束了，先开新的一局。');
    if (!round.answer) throw new Error('真相还没写好，等伙伴写完再提问。');
    return round;
  }

  private async persist(): Promise<void> {
    if (!this.round) return;
    await this.store.save(this.round);
  }
}

/** 命中违禁词（英文不分大小写，中文按原样包含）。 */
export function findBannedWords(text: string, words: string[]): string[] {
  if (!words.length) return [];
  const haystack = text.toLowerCase();
  return words.filter((word) => word && haystack.includes(word.toLowerCase()));
}

function noteFor(phase: MysteryPhase): string {
  if (phase === 'drawing') return '标签已抽，等伙伴把真相写进文件、再发来标题和谜面。';
  if (phase === 'ended') return '这一局结束了：下面是标题、真相与问答。';
  return '可以提问了：一次一个问题，不超过 50 字。';
}

/** 去掉空白与标点后再比，避免「他死了吗？」和「他死了吗」被算成两个问题。 */
export function normalizeQuestion(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]/gu, '')
    .replace(/[。．.，,！!？?、；;：:…~～「」『』"'（）()《》]/gu, '');
}
