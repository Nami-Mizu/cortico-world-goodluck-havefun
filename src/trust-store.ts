import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Choice } from './trust.ts';

export interface TrustHistoryMatch {
  id: number;
  startedAt: string;
  endedAt: string;
  rounds: Array<{ agent: Choice; human: Choice }>;
  closing?: string;
}

const MAX_MATCHES = 100;

function isChoice(value: unknown): value is Choice {
  return value === 'cooperate' || value === 'deceive';
}

function validMatch(value: unknown): value is TrustHistoryMatch {
  if (!value || typeof value !== 'object') return false;
  const match = value as TrustHistoryMatch;
  if (typeof match.id !== 'number') return false;
  if (!Array.isArray(match.rounds)) return false;
  return match.rounds.every((round) => isChoice(round?.agent) && isChoice(round?.human));
}

/**
 * 全部打完的局，落在 `<dataDir>/trust/history.json`。
 *
 * 画像只从这份历史里算——模型读得到画像，但没有任何工具能改它。
 */
export class TrustStore {
  private readonly dir: string;
  private readonly file: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'trust');
    this.file = join(this.dir, 'history.json');
  }

  directory(): string {
    return this.dir;
  }

  path(): string {
    return this.file;
  }

  async load(): Promise<TrustHistoryMatch[]> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { matches?: unknown };
      const matches = Array.isArray(parsed.matches) ? parsed.matches.filter(validMatch) : [];
      return matches.slice(-MAX_MATCHES);
    } catch {
      return [];
    }
  }

  async save(matches: TrustHistoryMatch[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const trimmed = matches.slice(-MAX_MATCHES);
    await writeFile(this.file, `${JSON.stringify({ matches: trimmed }, null, 2)}\n`, 'utf8');
  }
}
