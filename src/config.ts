import type { ConfigGroup } from 'cortico/core/types.ts';
import { DEFAULT_TAG_VALUES } from './tags.ts';
import { WORD_BANK } from './words.ts';

/** `worlds.goodluckhavefun` 这一段。 */
export interface GoodluckhavefunConfigSection {
  enabled: boolean;
  /** 一局最多问多少个问题（数到上限后提问按钮停用）。 */
  maxQuestions: number;
  /** 类型维度的标签，`、` 分隔；清空则回落到内置默认值。 */
  typeTags: string;
  /** 基调维度的标签。 */
  toneTags: string;
  /** 题材维度的标签。 */
  themeTags: string;
  /** 违禁词，`、` 分隔；题目里出现任何一个就拒绝落盘，等伙伴改写。默认不拦。 */
  bannedWords: string;
  /** 「你画我猜」是否走辅助视觉模型自检；关掉就交给主模型自己判断（可能偷懒）。 */
  visionEnabled: boolean;
  /** 辅助视觉模型的 OpenAI 兼容根地址。 */
  visionBaseUrl: string;
  /** 辅助视觉模型名。 */
  visionModel: string;
  /** 「你画我猜」每一批最多画几次（你猜错会重置这一批）。 */
  maxAttempts: number;
  /** 一局最多画几张（每交一张画算一次预算；用完只能定稿，猜错自动收局）。 */
  maxChecks: number;
  /** 「你画我猜」简单档词表，`、` 分隔；清空回落内置。 */
  wordsEasy: string;
  /** 「你画我猜」偏难档词表。 */
  wordsHard: string;
  /** 辅助视觉模型的 API Key；留空则读部署 .env 的 GOODLUCKHAVEFUN_VISION_KEY。 */
  visionApiKey: string;
  /** 黑白棋默认难度：1 伙伴自己来 / 2 伙伴看提示 / 3 伙伴不留情。 */
  reversiLevel: number;
}

export const GOODLUCKHAVEFUN_DEFAULTS: GoodluckhavefunConfigSection = {
  enabled: false,
  maxQuestions: 50,
  typeTags: DEFAULT_TAG_VALUES.type.join('、'),
  toneTags: DEFAULT_TAG_VALUES.tone.join('、'),
  themeTags: DEFAULT_TAG_VALUES.theme.join('、'),
  bannedWords: '',
  visionEnabled: true,
  visionBaseUrl: 'https://openrouter.ai/api/v1',
  visionModel: 'bytedance-seed/seed-2.0-mini',
  maxAttempts: 3,
  maxChecks: 9,
  wordsEasy: WORD_BANK.easy.join('、'),
  wordsHard: WORD_BANK.hard.join('、'),
  visionApiKey: '',
  reversiLevel: 2,
};

const TAGS_DESCRIPTION = '`、` 分隔；留空就用内置默认值。改完立即生效，只影响之后抽的局。';

export const GOODLUCKHAVEFUN_CONFIG_GROUP: ConfigGroup = {
  id: 'world:goodluckhavefun',
  owner: 'world:goodluckhavefun',
  schema: {
    type: 'object',
    title: '闲弈',
    properties: {
      'worlds.goodluckhavefun.maxQuestions': {
        type: 'number',
        title: '一局最多问几个问题',
        description: '数到上限后面板上的提问框会停用；不算重复提问。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.typeTags': {
        type: 'string',
        title: '类型标签',
        description: `本格、叙诡、巧合、误解这类写法。${TAGS_DESCRIPTION}`,
        'x-hot': true,
      },
      'worlds.goodluckhavefun.toneTags': {
        type: 'string',
        title: '基调标签',
        description: `日常、喜剧、温情、离别这类写法。${TAGS_DESCRIPTION}`,
        'x-hot': true,
      },
      'worlds.goodluckhavefun.themeTags': {
        type: 'string',
        title: '题材标签',
        description: `悬疑、亲情、友情、爱情这类写法。${TAGS_DESCRIPTION}`,
        'x-hot': true,
      },
      'worlds.goodluckhavefun.bannedWords': {
        type: 'string',
        title: '违禁词',
        description: '题目里出现其中任何一个，World 就拒绝保存，让伙伴改写。`、` 分隔；留空表示不拦。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.visionEnabled': {
        type: 'boolean',
        title: '启用辅助视觉模型',
        description:
          '「你画我猜」用它看伙伴画的图，再让伙伴改；关掉就交给主模型自己判断（可能偷懒）。' +
          '密钥写在部署的 .env 里：GOODLUCKHAVEFUN_VISION_KEY。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.visionBaseUrl': {
        type: 'string',
        title: '辅助视觉模型地址',
        description: 'OpenAI 兼容的根地址，例如 https://openrouter.ai/api/v1。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.visionApiKey': {
        type: 'string',
        title: '辅助视觉模型 API Key',
        description:
          '留空则读部署 .env 里的 GOODLUCKHAVEFUN_VISION_KEY。填在这里会明文存进部署的 config.json；' +
          '这台机器多人共用的话，建议还是放 .env。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.visionModel': {
        type: 'string',
        title: '辅助视觉模型',
        description: '要能看图的模型名；留空则开不了「你画我猜」。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.maxAttempts': {
        type: 'number',
        title: '每批最多画几次',
        description: '一批之内伙伴最多画这么多次；你猜错会重置这一批。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.maxChecks': {
        type: 'number',
        title: '一局最多画几张',
        description:
          '每交一张画算一次预算（视觉开着时同时是一次检查）。用完就不能再画，只能定稿；' +
          '你再猜错一次，这一局自动收尾。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.wordsEasy': {
        type: 'string',
        title: '你画我猜·简单词表',
        description: `\`、\` 分隔；留空用内置的 ${WORD_BANK.easy.length} 个。只放画得出来的具体名词。`,
        'x-hot': true,
      },
      'worlds.goodluckhavefun.reversiLevel': {
        type: 'number',
        title: '黑白棋默认难度',
        description:
          '1 伙伴自己来（只给棋盘与可落点）/ 2 伙伴看提示（附贪心参考分）/ 3 伙伴不留情（附 3 层搜索参考分）。' +
          '面板上的滑块开局前可改，改的是这一局的档位。',
        'x-hot': true,
      },
      'worlds.goodluckhavefun.wordsHard': {
        type: 'string',
        title: '你画我猜·偏难词表',
        description: `\`、\` 分隔；留空用内置的 ${WORD_BANK.hard.length} 个。`,
        'x-hot': true,
      },
    },
  },
};
