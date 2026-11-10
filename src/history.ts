/**
 * 对局历史：三个游戏共用一套条目格式，按游戏分文件落盘。
 *
 * 一局一条：谁赢了、一局一行的标题、伙伴的收尾话（可能还没写）、详情行。
 * 同一个 `id` 再写一次会覆盖——收尾话往往是回合结束之后才由模型补上的。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type HistoryGame = 'mystery' | 'trust' | 'drawguess' | 'reversi';

/** 棋谱里的一手：`c4` 这样的坐标，加上是谁下的。 */
export interface HistoryReplayMove {
  label: string;
  side: 'human' | 'model';
}

/**
 * 可复盘的一局：三块字段足够从开局重摆到任意一步。
 * 只有棋盘类游戏（现在是黑白棋）会写；其它游戏没有这个字段。
 */
export interface HistoryReplay {
  level: number;
  humanColor: 'B' | 'W';
  moves: HistoryReplayMove[];
}

export interface HistoryEntry {
  /** `<game>:<局号>`；同一局重复写入会覆盖。 */
  id: string;
  game: HistoryGame;
  /** 开局时间（ISO）。 */
  at: string;
  /** 结束时间（ISO）。 */
  endedAt: string | null;
  /** 你视角的结果：true 赢、false 输、null 平局或未定。 */
  won: boolean | null;
  /** 历史列表里的一行标题。 */
  headline: string;
  /** 伙伴的收尾话；空串表示模型还没写。 */
  summary: string;
  /** 详情行。 */
  lines: string[];
  /** 可复盘棋谱；只有黑白棋会写，历史列表不直接显示落子。 */
  replay?: HistoryReplay;
}

/** 每个游戏各留最近 100 局。 */
const MAX_ENTRIES = 100;

export class HistoryStore {
  constructor(private readonly dataDir: string) {}

  private file(game: HistoryGame): string {
    return join(this.dataDir, 'history', `${game}.json`);
  }

  /** 最新的一局在最前面。 */
  async list(game: HistoryGame): Promise<HistoryEntry[]> {
    try {
      const raw = JSON.parse(await readFile(this.file(game), 'utf8')) as unknown;
      return Array.isArray(raw) ? raw.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  /** 同一局再写一次会覆盖；新的放在最前面。 */
  async save(entry: HistoryEntry): Promise<void> {
    const entries = (await this.list(entry.game)).filter((item) => item.id !== entry.id);
    entries.unshift(entry);
    await mkdir(join(this.dataDir, 'history'), { recursive: true });
    await writeFile(
      this.file(entry.game),
      `${JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2)}\n`,
      'utf8',
    );
  }
}

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    (item.game === 'mystery' ||
      item.game === 'trust' ||
      item.game === 'drawguess' ||
      item.game === 'reversi') &&
    typeof item.at === 'string' &&
    typeof item.headline === 'string' &&
    typeof item.summary === 'string' &&
    Array.isArray(item.lines) &&
    (item.replay === undefined || isReplay(item.replay))
  );
}

/** 旧记录没有棋谱；有的话至少要有可用的 moves。 */
function isReplay(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const replay = value as Record<string, unknown>;
  return (
    typeof replay.level === 'number' &&
    (replay.humanColor === 'B' || replay.humanColor === 'W') &&
    Array.isArray(replay.moves)
  );
}
