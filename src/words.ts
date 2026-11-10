/**
 * 「你画我猜」的词库。
 *
 * 只收**画得出来**的具体名词：抽象词让模型画成一团线，你没法猜。
 * 分两档：easy 是三笔以内能认出来的东西，hard 需要组合几个形状。
 * 底线与推理游戏一致：不猎奇、不涉及未成年人。
 */

export type WordTier = 'easy' | 'hard';

export const WORD_BANK: Record<WordTier, readonly string[]> = {
  easy: [
    '太阳',
    '月亮',
    '雨伞',
    '房子',
    '树',
    '鱼',
    '杯子',
    '眼镜',
    '梯子',
    '时钟',
    '钥匙',
    '帽子',
    '船',
    '花',
    '苹果',
    '铅笔',
    '电视',
    '汽车',
    '桥',
    '气球',
  ],
  hard: [
    '影子',
    '迷宫',
    '秋千',
    '灯塔',
    '望远镜',
    '风筝',
    '喷泉',
    '沙漏',
    '风车',
    '城堡',
    '火车',
    '蛋糕',
    '耳机',
    '机器人',
    '火山',
    '帐篷',
    '雪人',
    '蝴蝶',
    '自行车',
    '漩涡',
  ],
};

export const WORD_TIERS: readonly WordTier[] = ['easy', 'hard'];

/** 两档词表；配置里没填的档回落默认词库。 */
export interface WordLists {
  easy: readonly string[];
  hard: readonly string[];
}

/** 词库里一共有多少词（写进面板文案与提示词，别写死）。 */
export function wordCount(lists: WordLists = WORD_BANK): number {
  return WORD_TIERS.reduce((sum, tier) => sum + lists[tier].length, 0);
}

/**
 * 从配置读一组词：按 `、`（也认逗号、分号、换行）切。
 * 空字符串、全空白、或切完一个词都没有，都回落默认。
 */
export function parseWordList(value: string | undefined, fallback: readonly string[]): readonly string[] {
  if (!value || !value.trim()) return fallback;
  const items = value
    .split(/[、,，;；\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

/** 从给定词表里抽一个词；尽量不与上一局重复（连抽 20 次就放弃）。 */
export function pickWordFrom(
  lists: WordLists,
  previous: string | undefined,
  random: () => number,
  tier: WordTier,
): { word: string; tier: WordTier } {
  const pool = lists[tier].length > 0 ? lists[tier] : WORD_BANK[tier];
  let chosen = pool[Math.floor(random() * pool.length)] ?? pool[0];
  for (let attempt = 0; attempt < 20 && chosen === previous; attempt++) {
    chosen = pool[Math.floor(random() * pool.length)] ?? pool[0];
  }
  return { word: chosen, tier };
}

/** 用内置词库抽一个词（测试与默认行为用）。 */
export function pickWord(
  previous?: string,
  random: () => number = Math.random,
  tier: WordTier = random() < 0.5 ? 'easy' : 'hard',
): { word: string; tier: WordTier } {
  return pickWordFrom(WORD_BANK, previous, random, tier);
}

/** 规范化：去空白与标点、全角转半角、小写；判对错用。 */
export function normalizeWord(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 归一化后是否命中（完全相等，或一方包含另一方且较短的一方至少两个字）。 */
export function wordsMatch(guess: string, word: string): boolean {
  const left = normalizeWord(guess);
  const right = normalizeWord(word);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.length >= 2 && longer.includes(shorter);
}
