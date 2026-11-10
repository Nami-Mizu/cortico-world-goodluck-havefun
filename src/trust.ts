/**
 * 信任的进化：一局 12 回合的囚徒困境。
 *
 * 每回合先是聊天时间——双方各说一句；然后各自选「合作」或「欺骗」。
 * 都合作各 +1；一骗一合，骗的 +2、合的 +0；都骗各 -1（分数不低于 0）。
 * 先到 7 分直接胜；12 回合打完按分数判胜负。
 *
 * 画像只由这里的算法算，模型只能读、不能写。
 */
import { nowIso } from 'cortico/core/util.ts';
import { TrustStore, type TrustHistoryMatch } from './trust-store.ts';

export type Choice = 'cooperate' | 'deceive';

export const CHOICE_LABELS: Record<Choice, string> = {
  cooperate: '合作',
  deceive: '欺骗',
};

export const TARGET_SCORE = 7;
export const MAX_ROUNDS = 12;
export const MAX_SAY_LENGTH = 60;
export const MAX_CLOSING_LENGTH = 800;

export type TrustPhase = 'idle' | 'playing' | 'ended';
export type TrustWinner = 'agent' | 'human' | 'tie';
export type PlayerKey = 'agent' | 'human';

export interface TrustRoundRecord {
  index: number;
  agent: Choice;
  human: Choice;
  agentDelta: number;
  humanDelta: number;
  /** 这一回合揭晓的时刻（ISO）；面板用来显示「刚刚揭晓」。 */
  at: string;
}

export interface TrustRoundState {
  index: number;
  agentSay: string | null;
  humanSay: string | null;
  agentChoice: Choice | null;
  humanChoice: Choice | null;
}

export interface TrustSnapshot {
  phase: TrustPhase;
  matchId: number;
  round: number;
  maxRounds: number;
  targetScore: number;
  agentScore: number;
  humanScore: number;
  say: { agent: string | null; human: string | null };
  choice: { agent: Choice | null; human: Choice | null };
  rounds: TrustRoundRecord[];
  winner: TrustWinner | null;
  closing: string | null;
  /** 这一局开局的时刻（ISO）；还没开过为 null。 */
  startedAt: string | null;
  /** 这一局结束的时刻（ISO）；没结束为 null。 */
  endedAt: string | null;
}

export type ProfileKey = 'copycat' | 'stubborn' | 'veteran' | 'pink' | 'random';

export const PROFILE_LABELS: Record<ProfileKey, string> = {
  copycat: '复读机',
  stubborn: '一根筋',
  veteran: '老油条',
  pink: '小粉红',
  random: '胡乱来',
};

export interface ProfileEntry {
  key: ProfileKey;
  label: string;
  score: number;
}

export interface Profile {
  player: PlayerKey;
  samples: number;
  entries: ProfileEntry[];
}

/** 面板 `state` / `start` / `say` / `choose` 的返回：局面 + 双方画像。 */
export interface TrustPanelPayload {
  snapshot: TrustSnapshot;
  profiles: { agent: Profile; human: Profile };
}

/** 「远大于」的判定：两个概率差到这个数以上。 */
export const STRONG_GAP = 0.34;
/** 「接近」的判定：两个概率差在这个数以内。 */
export const CLOSE_GAP = 0.15;

export interface TrustResult {
  snapshot: TrustSnapshot;
  resolved: TrustRoundRecord | null;
  ended: boolean;
}

function isChoice(value: unknown): value is Choice {
  return value === 'cooperate' || value === 'deceive';
}

function sayLine(raw: string, who: PlayerKey): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`${who === 'agent' ? '你' : '你'}这句是空的，先说一句再选。`);
  if (text.length > MAX_SAY_LENGTH) {
    throw new Error(`一句话不超过 ${MAX_SAY_LENGTH} 字（现在 ${text.length} 字）。`);
  }
  return text;
}

function settle(agent: Choice, human: Choice): { agentDelta: number; humanDelta: number } {
  if (agent === 'cooperate' && human === 'cooperate') return { agentDelta: 1, humanDelta: 1 };
  if (agent === 'deceive' && human === 'cooperate') return { agentDelta: 2, humanDelta: 0 };
  if (agent === 'cooperate' && human === 'deceive') return { agentDelta: 0, humanDelta: 2 };
  return { agentDelta: -1, humanDelta: -1 };
}

export class TrustGame {
  private readonly timezone: string;
  private readonly store: TrustStore;
  private readonly history: TrustHistoryMatch[];

  private phaseValue: TrustPhase = 'idle';
  private matchId = 0;
  private round: TrustRoundState = { index: 1, agentSay: null, humanSay: null, agentChoice: null, humanChoice: null };
  private agentScore = 0;
  private humanScore = 0;
  private rounds: TrustRoundRecord[] = [];
  private winner: TrustWinner | null = null;
  private closing: string | null = null;
  private startedAt: string | null = null;
  private endedAt: string | null = null;

  private constructor(timezone: string, store: TrustStore, history: TrustHistoryMatch[]) {
    this.timezone = timezone;
    this.store = store;
    this.history = history;
    this.matchId = history.reduce((max, item) => Math.max(max, item.id), 0);
  }

  static async open(timezone: string, store: TrustStore): Promise<TrustGame> {
    const history = await store.load();
    return new TrustGame(timezone, store, history);
  }

  phase(): TrustPhase {
    return this.phaseValue;
  }

  active(): boolean {
    return this.phaseValue === 'playing';
  }

  snapshot(): TrustSnapshot {
    return {
      phase: this.phaseValue,
      matchId: this.matchId,
      round: this.round.index,
      maxRounds: MAX_ROUNDS,
      targetScore: TARGET_SCORE,
      agentScore: this.agentScore,
      humanScore: this.humanScore,
      say: { agent: this.round.agentSay, human: this.round.humanSay },
      choice: { agent: this.round.agentChoice, human: this.round.humanChoice },
      rounds: this.rounds.map((item) => ({ ...item })),
      winner: this.winner,
      closing: this.closing,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  async start(): Promise<TrustSnapshot> {
    if (this.phaseValue === 'playing') {
      throw new Error('这一局还没结束；打完或者等它结束再开新的一局。');
    }
    this.matchId += 1;
    this.phaseValue = 'playing';
    this.round = { index: 1, agentSay: null, humanSay: null, agentChoice: null, humanChoice: null };
    this.agentScore = 0;
    this.humanScore = 0;
    this.rounds = [];
    this.winner = null;
    this.closing = null;
    this.startedAt = nowIso(this.timezone);
    this.endedAt = null;
    return this.snapshot();
  }

  async say(who: PlayerKey, raw: string): Promise<TrustSnapshot> {
    this.requirePlaying();
    const text = sayLine(raw, who);
    if (who === 'agent') this.round.agentSay = text;
    else this.round.humanSay = text;
    return this.snapshot();
  }

  async choose(who: PlayerKey, value: Choice): Promise<TrustResult> {
    this.requirePlaying();
    if (!isChoice(value)) throw new Error(`不认识的选项：${String(value)}`);
    if (who === 'agent') {
      // 你还没选之前，模型可以改主意；一旦双方都选了就立刻结算，下一回合会换成新的 round。
      this.round.agentChoice = value;
    } else {
      if (this.round.humanChoice) throw new Error('这一回合你已经选过了。');
      this.round.humanChoice = value;
    }
    const agent = this.round.agentChoice;
    const human = this.round.humanChoice;
    if (!agent || !human) {
      return { snapshot: this.snapshot(), resolved: null, ended: false };
    }
    const { agentDelta, humanDelta } = settle(agent, human);
    this.agentScore = Math.max(0, this.agentScore + agentDelta);
    this.humanScore = Math.max(0, this.humanScore + humanDelta);
    const record: TrustRoundRecord = {
      index: this.round.index,
      agent,
      human,
      agentDelta,
      humanDelta,
      at: nowIso(this.timezone),
    };
    this.rounds.push(record);
    const finished = this.agentScore >= TARGET_SCORE || this.humanScore >= TARGET_SCORE || this.round.index >= MAX_ROUNDS;
    if (finished) {
      this.phaseValue = 'ended';
      this.endedAt = nowIso(this.timezone);
      this.winner =
        this.agentScore === this.humanScore
          ? 'tie'
          : this.agentScore > this.humanScore
            ? 'agent'
            : 'human';
      this.history.push({
        id: this.matchId,
        startedAt: this.startedAt ?? nowIso(this.timezone),
        endedAt: nowIso(this.timezone),
        rounds: this.rounds.map((item) => ({ agent: item.agent, human: item.human })),
      });
      await this.store.save(this.history);
      return { snapshot: this.snapshot(), resolved: record, ended: true };
    }
    this.round = {
      index: this.round.index + 1,
      agentSay: null,
      humanSay: null,
      agentChoice: null,
      humanChoice: null,
    };
    return { snapshot: this.snapshot(), resolved: record, ended: false };
  }

  async close(closing: string): Promise<TrustSnapshot> {
    if (this.phaseValue !== 'ended') throw new Error('这一局还没打完，先打完再收尾。');
    if (this.closing) throw new Error('收尾话已经交过了。');
    const text = closing.trim();
    if (!text) throw new Error('收尾话是空的。');
    if (text.length > MAX_CLOSING_LENGTH) throw new Error(`收尾话最多 ${MAX_CLOSING_LENGTH} 字。`);
    this.closing = text;
    this.history[this.history.length - 1] = {
      ...this.history[this.history.length - 1]!,
      closing: text,
    };
    await this.store.save(this.history);
    return this.snapshot();
  }

  profiles(): { agent: Profile; human: Profile } {
    const agent: Choice[][] = [];
    const human: Choice[][] = [];
    for (const match of this.history) {
      agent.push(match.rounds.map((item) => item.agent));
      human.push(match.rounds.map((item) => item.human));
    }
    return {
      agent: buildProfile('agent', agent, human),
      human: buildProfile('human', human, agent),
    };
  }

  private requirePlaying(): void {
    if (this.phaseValue !== 'playing') {
      throw new Error(this.phaseValue === 'idle' ? '还没开局，先 start。' : '这一局已经结束了。');
    }
  }
}

/**
 * 画像算法。
 *
 * - 复读机：连续重复对方上一回合的操作——每命中一回合 +1。
 * - 一根筋：连续重复自己上一回合的操作——每命中一回合 +1。
 * - 老油条：存在连续两轮（第 N、N+1 回合）「欺骗概率都远大于合作」——每对 +1。
 * - 小粉红：存在连续两轮「合作概率都远大于欺骗」——每对 +1。
 * - 胡乱来：存在连续两轮「两种概率都接近」——每对 +1。
 *
 * 概率按回合序号统计（第 1 回合、第 2 回合……），跨局累计。
 *
 * 复读机与一根筋几乎每回合都会命中，如果和另外三种一样每个 +1，它们会稳定压住前两名；
 * 所以这两种「行为惯性」的分乘 `PATTERN_WEIGHT`（0.6），另外三种仍按每对 +1。
 */
export const PATTERN_WEIGHT = 0.6;

function weighted(count: number): number {
  return Math.round(count * PATTERN_WEIGHT * 10) / 10;
}

export function buildProfile(
  player: PlayerKey,
  mineByMatch: Choice[][],
  theirByMatch: Choice[][],
): Profile {
  const samples = mineByMatch.reduce((sum, match) => sum + match.length, 0);
  let copycat = 0;
  let stubborn = 0;
  for (let m = 0; m < mineByMatch.length; m += 1) {
    const mine = mineByMatch[m] ?? [];
    const theirs = theirByMatch[m] ?? [];
    for (let i = 1; i < mine.length; i += 1) {
      if (mine[i] === theirs[i - 1]) copycat += 1;
      if (mine[i] === mine[i - 1]) stubborn += 1;
    }
  }

  const cooperationRate: number[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    let cooperate = 0;
    let total = 0;
    for (const mine of mineByMatch) {
      const choice = mine[round - 1];
      if (!choice) continue;
      total += 1;
      if (choice === 'cooperate') cooperate += 1;
    }
    cooperationRate[round] = total === 0 ? Number.NaN : cooperate / total;
  }

  let veteran = 0;
  let pink = 0;
  let random = 0;
  for (let round = 1; round < MAX_ROUNDS; round += 1) {
    const near = cooperationRate[round];
    const next = cooperationRate[round + 1];
    if (near === undefined || next === undefined) continue;
    if (Number.isNaN(near) || Number.isNaN(next)) continue;
    const deceiveGap = (1 - near) - near;
    const nextDeceiveGap = (1 - next) - next;
    if (deceiveGap >= STRONG_GAP && nextDeceiveGap >= STRONG_GAP) veteran += 1;
    if (-deceiveGap >= STRONG_GAP && -nextDeceiveGap >= STRONG_GAP) pink += 1;
    if (Math.abs(deceiveGap) <= CLOSE_GAP && Math.abs(nextDeceiveGap) <= CLOSE_GAP) random += 1;
  }

  const entries: ProfileEntry[] = (
    [
      { key: 'copycat', label: PROFILE_LABELS.copycat, score: weighted(copycat) },
      { key: 'stubborn', label: PROFILE_LABELS.stubborn, score: weighted(stubborn) },
      { key: 'veteran', label: PROFILE_LABELS.veteran, score: veteran },
      { key: 'pink', label: PROFILE_LABELS.pink, score: pink },
      { key: 'random', label: PROFILE_LABELS.random, score: random },
    ] satisfies ProfileEntry[]
  ).sort((a, b) => b.score - a.score);

  return { player, samples, entries };
}

export function formatProfile(profile: Profile, name: string): string {
  const head = `${name}（${profile.samples} 回合样本）`;
  if (profile.samples === 0) return `${head}：还没有样本。`;
  const body = profile.entries
    .filter((entry) => entry.score > 0)
    .map((entry) => `${entry.label} ${entry.score}`)
    .join(' / ');
  return body ? `${head}：${body}` : `${head}：还没有明显的倾向。`;
}
