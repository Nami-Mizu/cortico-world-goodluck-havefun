/**
 * 推理游戏的三个标签维度：每个维度独立抽一个，组合起来交给模型出题。
 *
 * 维度本身（类型 / 基调 / 题材）是写死的；每个维度里有哪些标签可以在 WebUI 配置，
 * 这里只提供默认值。配置里清空了某个维度时回落到默认值——不能让一个空配置把游戏卡死。
 */

export type TagKey = 'type' | 'tone' | 'theme';

export interface TagDimension {
  key: TagKey;
  label: string;
  values: string[];
}

export type TagSet = Record<TagKey, string>;

/** 三个维度的显示名是固定的。 */
export const TAG_LABELS: Record<TagKey, string> = {
  type: '类型',
  tone: '基调',
  theme: '题材',
};

/** 配置留空时用的标签。 */
export const DEFAULT_TAG_VALUES: Record<TagKey, readonly string[]> = {
  type: ['本格', '叙诡', '巧合', '误解'],
  tone: ['日常', '喜剧', '温情', '离别'],
  theme: ['悬疑', '亲情', '友情', '爱情'],
};

/** `本格、叙诡，巧合` → `['本格','叙诡','巧合']`；去空、去重、保序。 */
export function parseTagList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[、,，;；\n]/u)) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export interface TagConfigSource {
  typeTags?: string;
  toneTags?: string;
  themeTags?: string;
}

/** 现读配置拼出三个维度；某个维度配置为空时用默认值。 */
export function tagDimensions(cfg: TagConfigSource): TagDimension[] {
  return [
    dimension('type', cfg.typeTags),
    dimension('tone', cfg.toneTags),
    dimension('theme', cfg.themeTags),
  ];
}

function dimension(key: TagKey, configured: string | undefined): TagDimension {
  const parsed = parseTagList(configured);
  return {
    key,
    label: TAG_LABELS[key],
    values: parsed.length ? parsed : [...DEFAULT_TAG_VALUES[key]],
  };
}

/** 每个维度独立抽一个；尽量不和上一局抽到完全相同的组合。 */
export function drawTags(
  dimensions: TagDimension[],
  previous?: TagSet,
  random: () => number = Math.random,
): TagSet {
  let drawn = drawOnce(dimensions, random);
  for (let attempt = 0; attempt < 20 && previous && sameTags(dimensions, drawn, previous); attempt += 1) {
    drawn = drawOnce(dimensions, random);
  }
  return drawn;
}

function drawOnce(dimensions: TagDimension[], random: () => number): TagSet {
  const out: Partial<TagSet> = {};
  for (const dimension of dimensions) {
    const index = Math.min(
      dimension.values.length - 1,
      Math.max(0, Math.floor(random() * dimension.values.length)),
    );
    out[dimension.key] = dimension.values[index];
  }
  return out as TagSet;
}

function sameTags(dimensions: TagDimension[], a: TagSet, b: TagSet): boolean {
  return dimensions.every((dimension) => a[dimension.key] === b[dimension.key]);
}

/** `本格 · 温情 · 亲情`，给面板和事件用。 */
export function describeTags(dimensions: TagDimension[], tags: TagSet): string {
  return dimensions.map((dimension) => tags[dimension.key]).join(' · ');
}

/** 给模型看的分维度写法：`类型：本格；基调：温情；题材：亲情`。 */
export function describeTagsForPrompt(dimensions: TagDimension[], tags: TagSet): string {
  return dimensions
    .map((dimension) => `${dimension.label}：${tags[dimension.key]}`)
    .join('；');
}
