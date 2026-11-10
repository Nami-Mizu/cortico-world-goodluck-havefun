import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MysteryRound } from './mystery.ts';

/**
 * 把每一局写成一个 JSON 文件：`<dataDir>/mystery/<roundId>.json`。
 *
 * 落盘的意义不是「存档」，而是把真相钉死：模型在同一局里想改口，得先改这个文件，
 * 而改写真相在规则里是明确禁止的。
 */
export class RoundStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'mystery');
  }

  directory(): string {
    return this.dir;
  }

  pathFor(roundId: string): string {
    return join(this.dir, `${roundId}.json`);
  }

  async save(round: MysteryRound): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(round.id), `${JSON.stringify(round, null, 2)}\n`, 'utf8');
  }
}
