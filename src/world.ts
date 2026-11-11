/**
 * 闲弈：在 WebUI 里和伙伴玩弱博弈的双人游戏。
 *
 * 这一版接的是「推理游戏」：World 抽三个标签，模型据此现编一道谜题，把完整真相写进文件钉死；
 * 你在面板里提问，模型用四种回答判定；面板点「查看真相」（二次确认）或模型判断
 * 「已问到关键」时收尾，收尾后展示标题、真相、问答与一段夸奖/安慰。
 *
 * 局面全部存在这个实例里，所以切到另一个页签只是不画它，回来这一局还在。
 */
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ToolDef,
  ToolOutcome,
  World,
  WorldHost,
  WorldWebUiDecl,
} from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import {
  GOODLUCKHAVEFUN_CONFIG_GROUP,
  type GoodluckhavefunConfigSection,
} from './config.ts';
import {
  describeTagsForPrompt,
  drawTags,
  parseTagList,
  tagDimensions,
  type TagDimension,
  type TagSet,
} from './tags.ts';
import { RoundStore } from './store.ts';
import { HistoryStore, type HistoryGame, type HistoryEntry, type HistoryReplay } from './history.ts';
import {
  MysteryGame,
  VERDICT_LABELS,
  type MysterySnapshot,
  type Verdict,
} from './mystery.ts';
import { TrustStore } from './trust-store.ts';
import {
  CHOICE_LABELS,
  TrustGame,
  formatProfile,
  type Choice,
  type PlayerKey,
  type TrustPanelPayload,
  type TrustResult,
  type TrustSnapshot,
} from './trust.ts';
import {
  DrawGame,
  type DrawPanelPayload,
  type DrawPanelSnapshot,
  type DrawSnapshot,
  type DrawVisionMode,
} from './drawguess.ts';
import { STROKE_SPACE, drawingInk, validateDrawing } from './strokes.ts';
import { PASS_POINTS, VisionClient, scoreReading, type VisionPing } from './vision.ts';
import {
  parseWordList,
  pickWordFrom,
  WORD_BANK,
  wordsMatch,
  type WordLists,
  type WordTier,
} from './words.ts';
import {
  ReversiGame,
  MODEL_MOVE_TIMEOUT_MS,
  type ReversiPanelSnapshot,
  type ReversiPayload,
  type ReversiReplayView,
  type ReversiSide,
  type ReversiWinner,
} from './reversi-game.ts';
import { LEVEL_DEFAULTS, LEVEL_LABELS, type ReversiLevel } from './reversi-ai.ts';
import { discCount, legalMoves, opponent, replayBoard, type Disc } from './reversi.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

/** 辅助视觉没配好时给你看的话（用户原话，别改写）。 */
const VISION_UNREADY_MESSAGE =
  '请填写辅助视觉模型地址，或关闭辅助视觉模型，交由主模型处理，关闭后可能会导致主模型偷懒。';

const DRAW_RULES =
  `画布是 ${STROKE_SPACE}×${STROKE_SPACE} 的归一化坐标，原点左上。` +
  '你交的是折线：{"strokes":[{"width":8,"points":[[x,y],[x,y],…]},…]}，最多 40 笔、每笔最多 60 个点，' +
  'width 在 1–40 之间。画面要留白，别铺满；主体占画布中间一半左右。';

const RULES_REMINDER =
  '只做逻辑推理；不写猎奇、血腥、恐怖，不描写身亡过程与伤害细节，不涉及未成年人；' +
  '不适程度的顶格是「人的离别」（可以写错过、分开、来不及的告别，不写死亡现场）。';

/** 对局历史一页放几局。 */
const HISTORY_PAGE_SIZE = 5;

export interface GoodluckhavefunWorldOptions {
  /** `worlds.goodluckhavefun` 的活引用。 */
  cfg: GoodluckhavefunConfigSection;
  timezone: string;
  /** 部署的数据目录；每一局的 JSON 落在 `<dataDir>/mystery/`。 */
  dataDir: string;
  /** 辅助视觉模型的密钥（部署 .env 里的 GOODLUCKHAVEFUN_VISION_KEY）。 */
  visionApiKey?: string;
}

interface AskResult extends MysterySnapshot {
  questionId: string;
  duplicate: boolean;
}

export const GOODLUCKHAVEFUN_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'goodluckhavefun_mystery_start',
    description:
      '开一局推理游戏。World 会抽三个标签（类型 / 基调 / 题材）发给你；你要据此现编一道谜题，' +
      '再用 goodluckhavefun_mystery_write 把标题、谜面、完整真相写下来。同一时间只能有一局。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_mystery_redraw',
    description:
      '重抽这一局的标签：只在题目写下来之前可用。三个标签互相打架、编不出合规的题时调它，' +
      '拿到一组新标签后重新出题。已经写下真相就不能再重抽。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_mystery_write',
    description:
      '把这一局的题写死：标题、谜面（给你看的谜面）、完整真相（真相）。' +
      '写完真相就不能改；真相只留给你和文件，不要念给你听。有违禁词会被拒绝，改写后再试。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'surface', 'answer'],
      properties: {
        title: {
          type: 'string',
          description: '标题，最多 60 字。',
        },
        surface: {
          type: 'string',
          description: '谜面：只写你看到的现象与谜面，不写真相，10–1200 字。',
        },
        answer: {
          type: 'string',
          description: '完整真相：真相、动机与关键细节，20–4000 字。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_mystery_ask',
    description:
      '替你问一个问题（不超过 50 字），返回问题编号。重复的问题会直接标成「问过了」，' +
      '不占判定次数。之后用 goodluckhavefun_mystery_judge 给这个问题一个回答。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: '问题原文，最多 50 字。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_mystery_judge',
    description:
      '判定一个问题：是 / 不是 / 无关 / 问过了 / 不能回答。只能判真相能确定的事；拿不准就判「无关」。' +
      '如果这个问题没法用是 / 不是回答（问原因、问过程、问主观感受、一次问好几件事），判「不能回答」。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['questionId', 'verdict'],
      properties: {
        questionId: {
          type: 'string',
          description: 'goodluckhavefun_mystery_ask 返回的编号，如 q3。',
        },
        verdict: {
          type: 'string',
          enum: ['yes', 'no', 'irrelevant', 'asked', 'cannot'],
          description:
            'yes=是，no=不是，irrelevant=无关，asked=问过了，cannot=不能回答（问题本身没法用是/不是/无关来判）。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_mystery_close',
    description:
      '收尾：你猜中了就给一段夸奖（guessed=true），没猜中就安慰（guessed=false）。' +
      '如果你点了「查看真相」，这一局已经结束，你只需补上收尾词。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['guessed', 'closing'],
      properties: {
        guessed: {
          type: 'boolean',
          description: '你是否已经猜中真相。',
        },
        closing: {
          type: 'string',
          description: '给你的收尾话：猜中就具体夸，没猜中就安慰并点一句关键线索，最多 800 字。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_mystery_secret',
    description:
      '只读：看这一局的完整真相、谜面与已经问过的问题。判定或收尾前拿不准时先调这个，别凭记忆答。' +
      '上下文被压缩过、忘了细节时也先调这个。内容只给你自己看，不要念给对方。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_trust_start',
    description:
      '开一局「信任的进化」：12 回合的囚徒困境。每回合先是聊天时间（双方各说一句），' +
      '再各自选合作或欺骗；先到 7 分直接胜，12 回合打完按分数判输赢。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_trust_say',
    description:
      '聊天时间说一句话（最多 60 字，只有一句）。每回合双方各说一句，先聊，再选合作还是欺骗。' +
      '你可以说狠话、套近乎、试探，但别把要选的答案直接说出来。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: '你这一回合要说的话，一句，最多 60 字。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_trust_choose',
    description:
      '这一回合你的选择：合作或欺骗。你也选过之后才结算——都合作各 +1；一骗一合，骗的 +2；' +
      '都骗各 -1（分数不低于 0）。你还没选之前可以再调一次改主意。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['choice'],
      properties: {
        choice: {
          type: 'string',
          enum: ['cooperate', 'deceive'],
          description: 'cooperate=合作，deceive=欺骗。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_trust_close',
    description:
      '这一局打完后给你一段收尾话：赢了也夸两句，输了就安慰，最多 800 字。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['closing'],
      properties: {
        closing: {
          type: 'string',
          description: '给你的收尾话，最多 800 字。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_trust_state',
    description:
      '看「信任的进化」的当前状态：比分、第几回合、上一回合双方选了什么，' +
      '以及你和你的画像（画像由算法算，你只能读）。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_reversi_start',
    description:
      '开一局黑白棋（Reversi，8×8 标准盘）。先后手随机；World 会把棋盘与可落点发给你，' +
      '你每次用 goodluckhavefun_reversi_move 下一手。同一时间只能有一局。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        level: {
          type: 'number',
          enum: [1, 2, 3],
          description:
            '这一局的难度：1 自己算（只给可落点）、2 看贪心参考分、3 看搜索参考分；不给就用配置里的默认档。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_reversi_move',
    description:
      '在黑白棋里下一手。label 用 c4 这种写法（a–h 列，1–8 行），必须是当前可落点之一；' +
      '下不了会告诉你为什么，并把当前可落点再列一遍。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', description: '落点，例如 c4。' },
      },
      required: ['label'],
    },
  },
  {
    name: 'goodluckhavefun_reversi_state',
    description:
      '只读：看黑白棋这一局的棋盘、比分、轮到谁、可落点。拿不准局面时先调它，别凭记忆下。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_reversi_close',
    description:
      '黑白棋终局后写一句收尾：赢了就夸对方一句，输了或平局就安慰一句。只写这一句，别复述棋谱。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        closing: { type: 'string', description: '收尾话，一到两句。' },
      },
      required: ['closing'],
    },
  },
  {
    name: 'goodluckhavefun_drawguess_start',
    description:
      '开一局「你画我猜」：你画，你猜。World 会把一个词只发给你（面板看不到），' +
      '你按词交笔画，面板渲染成图，辅助视觉模型盲猜打分；分数够 2 才允许定稿。同一时间只能有一局。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tier: {
          type: 'string',
          enum: ['easy', 'hard'],
          description: '词库难度：easy 用简单词表、hard 用偏难词表；不给就随机。面板上由对方选。',
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_drawguess_draw',
    description:
      '交一张画。strokes 是折线数组，每条折线给 width 与 points（[x,y] 坐标，0–1000，原点左上）。' +
      `最多 40 笔、每笔 60 点，${STROKE_SPACE} 空间。交完等 World 把视觉检查结果发给你，别连着交。`,
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['strokes'],
      properties: {
        strokes: {
          type: 'array',
          description: '折线数组：每项 {width, points}。',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['width', 'points'],
            properties: {
              width: { type: 'number', description: '笔宽，1–40。' },
              points: {
                type: 'array',
                description: '折线点，[x, y]，0–1000，原点左上。',
                items: {
                  type: 'array',
                  items: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'goodluckhavefun_drawguess_finish',
    description: '定稿：就这张画。定稿后你开始猜，你不能再改。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'goodluckhavefun_drawguess_judge',
    description:
      '判你刚才那个猜测算不算对。correct=true 就结束这一局；correct=false 会让你继续猜、' +
      '并给你一次重画机会（受总预算限制）。拿不准就别判对。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['correct'],
      properties: {
        correct: { type: 'boolean', description: '这个猜测算不算答对。' },
        hint: { type: 'string', description: '算错时给你的一句提示，最多 40 字。' },
      },
    },
  },
  {
    name: 'goodluckhavefun_drawguess_close',
    description: '给「你画我猜」写收尾：猜中就具体夸，没猜中就安慰，并说一句这张画好在哪。最多 800 字。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['closing'],
      properties: {
        closing: { type: 'string', description: '收尾话，最多 800 字。' },
      },
    },
  },
  {
    name: 'goodluckhavefun_drawguess_state',
    description: '看「你画我猜」的当前状态：抽到的词、画了几张、视觉模型的描述与打分、你猜过什么。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
];

export class GoodluckhavefunWorld implements World {
  readonly id = 'goodluckhavefun';

  private readonly cfg: GoodluckhavefunConfigSection;
  private readonly timezone: string;
  private readonly dataDir: string;
  private readonly envVisionKey: string;
  private readonly game: MysteryGame;
  private readonly draw: DrawGame;
  private readonly history: HistoryStore;
  private host: WorldHost | null = null;
  private lastTags: TagSet | undefined;
  private lastWord: string | undefined;
  private visionFailures = 0;
  private trustGame: TrustGame | null = null;
  private trustOpening: Promise<TrustGame> | null = null;
  private reversi: ReversiGame | null = null;
  private reversiTimer: ReturnType<typeof setTimeout> | null = null;
  private reversiMisses = 0;
  private reversiRound = 0;
  /** 正在看的复盘：棋谱 + 停在第几手。 */
  private reversiReplayState: (HistoryReplay & { entryId: string; step: number }) | null = null;

  constructor(options: GoodluckhavefunWorldOptions) {
    this.cfg = options.cfg;
    this.timezone = options.timezone;
    this.dataDir = options.dataDir;
    this.envVisionKey = options.visionApiKey ?? '';
    this.history = new HistoryStore(options.dataDir);
    this.game = new MysteryGame({
      timezone: options.timezone,
      limits: () => ({
        maxQuestions: this.cfg.maxQuestions,
        bannedWords: parseTagList(this.cfg.bannedWords),
      }),
      dimensions: () => this.dimensions(),
      store: new RoundStore(options.dataDir),
    });
    this.draw = new DrawGame({
      dataDir: options.dataDir,
      limits: () => ({
        maxAttempts: Math.max(1, Math.round(this.cfg.maxAttempts)),
        maxChecks: Math.max(1, Math.round(this.cfg.maxChecks)),
      }),
      matcher: wordsMatch,
    });
  }

  envPromptVars(): Record<string, string> {
    const snapshot = this.game.snapshot();
    if (!snapshot.round) {
      return {
        'goodluckhavefun.mystery': '还没开局。',
        'goodluckhavefun.trust': this.trustText(),
        'goodluckhavefun.drawguess': this.drawText(),
        'goodluckhavefun.reversi': this.reversiText(),
      };
    }
    const round = snapshot.round;
    const parts = [`第 ${round.id} 局（${round.tagsLabel}）`];
    parts.push(
      round.phase === 'ended'
        ? `已结束，${round.guessed ? '你猜中了' : '你没猜出来'}`
        : `进行中，已问 ${round.questions.length} 个问题`,
    );
    return {
      'goodluckhavefun.mystery': `${parts.join('，')}。`,
      'goodluckhavefun.trust': this.trustText(),
      'goodluckhavefun.drawguess': this.drawText(),
    };
  }

  tools(): ToolDef[] {
    return GOODLUCKHAVEFUN_TOOL_DECLS.map((decl) => {
      switch (decl.name) {
        case 'goodluckhavefun_mystery_start':
          return { ...decl, handler: async () => this.startTool() };
        case 'goodluckhavefun_mystery_redraw':
          return { ...decl, handler: async () => this.redrawTool() };
        case 'goodluckhavefun_mystery_write':
          return { ...decl, handler: async (args) => this.writeTool(args) };
        case 'goodluckhavefun_mystery_ask':
          return { ...decl, handler: async (args) => this.askTool(args) };
        case 'goodluckhavefun_mystery_judge':
          return { ...decl, handler: async (args) => this.judgeTool(args) };
        case 'goodluckhavefun_mystery_close':
          return { ...decl, handler: async (args) => this.closeTool(args) };
        case 'goodluckhavefun_mystery_secret':
          return { ...decl, handler: async () => this.secretTool() };
        case 'goodluckhavefun_trust_start':
          return { ...decl, handler: async () => this.trustStartTool() };
        case 'goodluckhavefun_trust_say':
          return { ...decl, handler: async (args) => this.trustSayTool(args) };
        case 'goodluckhavefun_trust_choose':
          return { ...decl, handler: async (args) => this.trustChooseTool(args) };
        case 'goodluckhavefun_trust_close':
          return { ...decl, handler: async (args) => this.trustCloseTool(args) };
        case 'goodluckhavefun_trust_state':
          return { ...decl, handler: async () => this.trustStateTool() };
        case 'goodluckhavefun_drawguess_start':
          return { ...decl, handler: async (args) => this.drawStartTool(args) };
        case 'goodluckhavefun_drawguess_draw':
          return { ...decl, handler: async (args) => this.drawTool(args) };
        case 'goodluckhavefun_drawguess_finish':
          return { ...decl, handler: async () => this.drawFinishTool() };
        case 'goodluckhavefun_drawguess_judge':
          return { ...decl, handler: async (args) => this.drawJudgeTool(args) };
        case 'goodluckhavefun_drawguess_close':
          return { ...decl, handler: async (args) => this.drawCloseTool(args) };
        case 'goodluckhavefun_drawguess_state':
          return { ...decl, handler: async () => this.drawStateTool() };
        case 'goodluckhavefun_reversi_start':
          return { ...decl, handler: async (args) => this.reversiStartTool(args) };
        case 'goodluckhavefun_reversi_move':
          return { ...decl, handler: async (args) => this.reversiMoveTool(args) };
        case 'goodluckhavefun_reversi_state':
          return { ...decl, handler: async () => this.reversiStateTool() };
        case 'goodluckhavefun_reversi_close':
          return { ...decl, handler: async (args) => this.reversiCloseTool(args) };
        default:
          throw new Error(`未实现的工具：${decl.name}`);
      }
    });
  }

  webUi(): WorldWebUiDecl {
    return {
      label: '闲弈',
      badges: [
        {
          label: '推理游戏',
          value: this.badge(),
          tone: this.game.currentRound() ? 'on' : 'plain',
        },
        {
          label: '信任的进化',
          value: this.trustBadge(),
          tone: this.trustGame?.active() ? 'on' : 'plain',
        },
        {
          label: '你画我猜',
          value: this.drawBadge(),
          tone: this.draw.active() ? 'on' : 'plain',
        },
        {
          label: '黑白棋',
          value: this.reversiBadge(),
          tone: this.reversi?.currentPhase === 'playing' ? 'on' : 'plain',
        },
      ],
      config: [GOODLUCKHAVEFUN_CONFIG_GROUP],
      panels: [
        {
          id: 'mystery',
          title: '推理游戏',
          description: '伙伴现编一道推理题，你一问他一答；猜中或点「查看真相」结束。',
          getMethods: ['home', 'history', 'state', 'start', 'ask', 'reveal'],
        },
        {
          id: 'trust',
          title: '信任的进化',
          description: '十二回合的合作与欺骗，先到 7 分胜；聊天和选择各自独立。',
          getMethods: ['home', 'history', 'state', 'start', 'say', 'choose'],
        },
        {
          id: 'drawguess',
          title: '你画我猜',
          description: '伙伴用折线画一个词，你来猜；每张画都会先让视觉模型盲评一次。',
          getMethods: ['home', 'history', 'state', 'start', 'guess', 'reveal', 'art'],
        },
        {
          id: 'reversi',
          title: '黑白棋',
          description: '8×8 标准盘，先手随机；伙伴出招、World 校验，你随时可以悔棋两次或认输。',
          getMethods: ['home', 'history', 'state', 'start', 'move', 'undo', 'resign', 'resume', 'replay', 'replayStep', 'replayResume', 'replayExit'],
        },
      ],
      promptDocs: [
        {
          key: 'worlds.goodluckhavefun.envPrompt',
          title: '闲弈',
          description:
            '四个游戏的玩法：推理游戏怎么出题判定，信任的进化怎么聊、怎么选、怎么收尾，' +
            '你画我猜怎么交笔画、怎么看视觉检查、怎么判你的猜测，黑白棋怎么下、怎么收尾。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'goodluckhavefun.mystery', description: '推理游戏当前这一局的进度。' },
            { name: 'goodluckhavefun.trust', description: '「信任的进化」当前的比分与回合。' },
            { name: 'goodluckhavefun.drawguess', description: '「你画我猜」当前的词与画图进度。' },
            { name: 'goodluckhavefun.reversi', description: '黑白棋当前的比分、轮到谁与难度档。' },
          ],
        },
      ],
      invoke: async (panel, method, args) => {
        return this.invoke(panel, method, args);
      },
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await this.push({
      type: 'goodluckhavefun.started',
      text: '游戏面板已就绪：推理游戏、信任的进化、你画我猜、黑白棋都能开局。',
    });
  }

  async stop(): Promise<void> {
    this.clearReversiTimer();
    this.host = null;
  }

  private dimensions(): TagDimension[] {
    return tagDimensions(this.cfg);
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (method === 'home') return this.homePayload(panel);
    if (method === 'history') return this.historyPage(panel, Number(args[0] ?? 0));
    switch (panel) {
      case 'mystery':
        switch (method) {
          case 'state':
            return this.game.snapshot();
          case 'start':
            return this.startRound();
          case 'ask':
            return this.askFromPanel(String(args[0] ?? ''));
          case 'reveal':
            return this.revealFromPanel();
        }
        break;
      case 'trust':
        switch (method) {
          case 'state':
            return this.trustPayload();
          case 'start':
            return this.trustStart();
          case 'say':
            return this.trustSayFromPanel(String(args[0] ?? ''));
          case 'choose':
            return this.trustChooseFromPanel(String(args[0] ?? ''));
        }
        break;
      case 'drawguess':
        switch (method) {
          case 'state':
            return this.drawPayload();
          case 'start':
            return this.drawStartFromPanel(args[0]);
          case 'guess':
            return this.drawGuessFromPanel(String(args[0] ?? ''));
          case 'reveal':
            return this.drawRevealFromPanel();
          case 'art':
            return this.submitArt(String(args[0] ?? ''), String(args[1] ?? ''));
        }
        break;
    }
    if (panel === 'reversi') {
      switch (method) {
        case 'state':
          return this.reversiPayload();
        case 'start':
          return this.reversiStart(args[0]);
        case 'move':
          return this.reversiMoveFromPanel(String(args[0] ?? ''));
        case 'undo':
          return this.reversiUndo();
        case 'resign':
          return this.reversiResign();
        case 'resume':
          return this.reversiResume();
        case 'replay':
          return this.reversiReplayStart(String(args[0] ?? ''));
        case 'replayStep':
          return this.reversiReplayStep(args[0]);
        case 'replayResume':
          return this.reversiReplayResume();
        case 'replayExit':
          return this.reversiReplayExit();
      }
    }
    throw new Error(`「${panel}」面板没有方法：${method}`);
  }

  private async homePayload(panel: string): Promise<{ game: string; phase: string; total: number }> {
    await this.ensureRecorded(panel as HistoryGame);
    const total = (await this.history.list(panel as HistoryGame)).length;
    if (panel === 'mystery') {
      const round = this.game.currentRound();
      const phase = !round
        ? 'idle'
        : round.endedAt
          ? 'ended'
          : round.title
            ? 'playing'
            : 'drawing';
      return { game: panel, phase, total };
    }
    if (panel === 'trust') {
      const snapshot = this.trustGame?.snapshot();
      return { game: panel, phase: snapshot?.phase ?? 'idle', total };
    }
    if (panel === 'reversi') {
      return { game: panel, phase: this.reversi?.currentPhase ?? 'idle', total };
    }
    return { game: panel, phase: this.draw.phase(), total };
  }

  private async historyPage(
    panel: string,
    page: number,
  ): Promise<{
    game: string;
    page: number;
    pages: number;
    total: number;
    size: number;
    entries: HistoryEntry[];
  }> {
    await this.ensureRecorded(panel as HistoryGame);
    const entries = await this.history.list(panel as HistoryGame);
    const pages = Math.max(1, Math.ceil(entries.length / HISTORY_PAGE_SIZE));
    const index = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1);
    const start = index * HISTORY_PAGE_SIZE;
    return {
      game: panel,
      page: index,
      pages,
      total: entries.length,
      size: HISTORY_PAGE_SIZE,
      entries: entries.slice(start, start + HISTORY_PAGE_SIZE),
    };
  }

  /** 局面已结束就把这一局记进对局历史；同一局重复记会覆盖（收尾话后到也能更新）。 */
  private async ensureRecorded(panel: HistoryGame): Promise<void> {
    const entry = this.buildHistoryEntry(panel);
    if (!entry) return;
    const existing = (await this.history.list(panel)).find((item) => item.id === entry.id);
    if (existing && existing.summary === entry.summary && existing.endedAt === entry.endedAt) return;
    await this.history.save(entry);
  }

  private buildHistoryEntry(panel: HistoryGame): HistoryEntry | null {
    const stamp = nowIso(this.timezone);
    if (panel === 'mystery') {
      const round = this.game.snapshot().round;
      if (!round || !round.endedAt) return null;
      return {
        // 用开局时间当 id：`r1` / 局号在重启后会从 1 重数，会和盘上的旧记录撞 id 而被覆盖。
        id: `mystery:${round.createdAt || round.id}`,
        game: 'mystery',
        at: round.createdAt,
        endedAt: round.endedAt,
        won: round.guessed ?? null,
        headline: round.title || `第 ${round.id} 局`,
        summary: round.closing ?? '',
        lines: [
          `标签：${round.tagsLabel}`,
          `谜面：${round.surface}`,
          `真相：${round.answer}`,
          `提问 ${round.questions.length} 个（上限 ${round.maxQuestions}）`,
          round.guessed ? '结果：猜中' : '结果：没猜中，答案已揭晓',
        ],
      };
    }
    if (panel === 'trust') {
      const snapshot = this.trustGame?.snapshot();
      if (!snapshot || snapshot.phase !== 'ended') return null;
      const cooperative = snapshot.rounds.filter((item) => item.human === 'cooperate').length;
      return {
        id: `trust:${snapshot.matchId}`,
        game: 'trust',
        at: snapshot.startedAt ?? stamp,
        endedAt: snapshot.endedAt,
        won: snapshot.winner === 'human' ? true : snapshot.winner === 'agent' ? false : null,
        headline: `你 ${snapshot.humanScore} : ${snapshot.agentScore} 伙伴`,
        summary: snapshot.closing ?? '',
        lines: [
          `结果：${snapshot.winner === 'human' ? '你赢了' : snapshot.winner === 'agent' ? '伙伴赢了' : '平局'}`,
          `共 ${snapshot.rounds.length} 回合（先到 ${snapshot.targetScore} 分，上限 ${snapshot.maxRounds} 回合）`,
          `你选了 ${cooperative} 次合作、${snapshot.rounds.length - cooperative} 次欺骗`,
        ],
      };
    }
    if (panel === 'reversi') {
      const game = this.reversi;
      if (!game || game.currentPhase !== 'ended') return null;
      const view = game.snapshot();
      const result =
        view.winner === 'human' ? '你赢了' : view.winner === 'model' ? '伙伴赢了' : '平局';
      // 棋谱照存：历史卡片不显示落子，留给复盘用。
      const replay = {
        level: view.level,
        humanColor: view.humanColor,
        moves: [
          ...game.baseMoves.map((move) => ({ label: move.label, side: move.side })),
          ...view.moves.map((move) => ({ label: move.label, side: move.side })),
        ],
      };
      return {
        // 用开局时间当 id：局号在重启后会重数，撞 id 会覆盖盘上的旧记录。
        id: `reversi:${view.createdAt}`,
        game: 'reversi',
        at: view.createdAt,
        endedAt: view.endedAt,
        won: view.winner === 'human' ? true : view.winner === 'model' ? false : null,
        headline: `你 ${view.score.human} : ${view.score.model} 伙伴 · ${result}`,
        summary: view.closing ?? '',
        lines: [
          `结果：${result}`,
          `难度：${view.levelLabel}`,
          `共 ${view.moves.length + game.baseMoves.length} 手`,
          `你 ${view.score.human} 子，伙伴 ${view.score.model} 子`,
        ],
        replay,
      };
    }
    const snapshot = this.draw.snapshot();
    if (snapshot.phase !== 'ended') return null;
    return {
      // 同样用开局时间：`round` 是进程内的局数，重启后会从 1 重数，撞 id 会覆盖旧记录。
      id: `drawguess:${snapshot.createdAt ?? stamp}`,
      game: 'drawguess',
      at: snapshot.createdAt ?? stamp,
      endedAt: snapshot.endedAt,
      won: snapshot.guessed ?? null,
      headline: `词：${snapshot.word ?? '（未知）'}`,
      summary: snapshot.closing ?? '',
      lines: [
        snapshot.guessed ? '结果：猜中' : '结果：没猜中，答案已揭晓',
        `画了 ${snapshot.attempts.length} 张（上限 ${snapshot.maxChecks}）`,
        `猜了 ${snapshot.guesses.length} 次`,
      ],
    };
  }

  // ── 黑白棋 ────────────────────────────────────────────────

  private parseReversiLevel(value: unknown): ReversiLevel {
    const raw = Math.round(Number(value));
    if (raw === 1 || raw === 2 || raw === 3) return raw as ReversiLevel;
    const configured = Math.round(Number(this.cfg.reversiLevel));
    if (configured === 1 || configured === 3) return configured as ReversiLevel;
    return LEVEL_DEFAULTS;
  }

  private reversiPayload(): ReversiPayload {
    return { snapshot: this.reversi?.snapshot() ?? null, replay: this.reversiReplayView() };
  }

  /** 复盘的当前画面：从开局按 `step` 重摆。 */
  private reversiReplayView(): ReversiReplayView | null {
    const state = this.reversiReplayState;
    if (!state) return null;
    const level = this.reversiReplayLevel(state.level);
    const steps = state.moves.slice(0, state.step).map((move) => ({
      label: move.label,
      disc: move.side === 'human' ? state.humanColor : opponent(state.humanColor),
    }));
    const board = replayBoard(steps);
    const counts = discCount(board);
    return {
      entryId: state.entryId,
      level,
      levelLabel: LEVEL_LABELS[level],
      humanColor: state.humanColor,
      step: state.step,
      total: state.moves.length,
      board: board.map((row) => [...row]),
      lastMove: state.step > 0 ? (state.moves[state.step - 1]?.label ?? null) : null,
      score: {
        human: counts[state.humanColor],
        model: counts[opponent(state.humanColor)],
      },
    };
  }

  private reversiReplayLevel(value: unknown): ReversiLevel {
    const raw = Math.round(Number(value));
    return raw === 1 || raw === 3 ? (raw as ReversiLevel) : LEVEL_DEFAULTS;
  }

  private async reversiReplayStart(entryId: string): Promise<ReversiPayload> {
    const entries = await this.history.list('reversi');
    const entry = entries.find((item) => item.id === entryId);
    if (!entry?.replay) throw new Error('这一局没有可复盘的棋谱。');
    this.reversiReplayState = {
      entryId: entry.id,
      level: entry.replay.level,
      humanColor: entry.replay.humanColor,
      moves: entry.replay.moves.map((move) => ({ ...move })),
      step: 0,
    };
    this.clearReversiTimer();
    return this.reversiPayload();
  }

  private reversiReplayStep(delta: unknown): ReversiPayload {
    const state = this.reversiReplayState;
    if (!state) throw new Error('还没进复盘。');
    const amount = Math.round(Number(delta)) || 0;
    state.step = Math.min(state.moves.length, Math.max(0, state.step + amount));
    return this.reversiPayload();
  }

  private async reversiReplayResume(): Promise<ReversiPayload> {
    const state = this.reversiReplayState;
    if (!state) throw new Error('还没进复盘。');
    // 已经在最后一手：这一局已经下完了，不能再从「结束」接着下。
    if (state.step >= state.moves.length) throw new Error('已经在最后一手了，这一局下完了，不能从此刻开始。');
    const steps = state.moves.slice(0, state.step).map((move) => ({
      label: move.label,
      disc: move.side === 'human' ? state.humanColor : opponent(state.humanColor),
    }));
    const board = replayBoard(steps);
    const nextSide: ReversiSide =
      state.step < state.moves.length
        ? state.moves[state.step]!.side
        : state.moves.length === 0
          ? state.humanColor === 'B'
            ? 'human'
            : 'model'
          : state.moves[state.moves.length - 1]!.side === 'human'
            ? 'model'
            : 'human';
    const disc = nextSide === 'human' ? state.humanColor : opponent(state.humanColor);
    if (legalMoves(board, disc).length === 0) throw new Error('这个局面已经下不下去了。');
    const level = this.reversiReplayLevel(state.level);
    const prefix = state.moves.slice(0, state.step).map((move) => ({ label: move.label, side: move.side }));
    this.reversiRound += 1;
    this.reversiMisses = 0;
    const game = new ReversiGame({
      id: `reversi-${this.reversiRound}`,
      level,
      humanColor: state.humanColor,
      timezone: this.timezone,
      start: { board: board.map((row) => [...row]), turn: nextSide, baseMoves: prefix },
    });
    this.reversi = game;
    this.reversiReplayState = null;
    await this.push({
      type: 'goodluckhavefun.reversi_started',
      text:
        `从复盘的第 ${state.step} 手接着下（${LEVEL_LABELS[level]}）：` +
        `你执${game.modelColor === 'B' ? '黑' : '白'}，对方执${game.humanColor === 'B' ? '黑' : '白'}。` +
        (game.currentTurn === 'model' ? '你先下。' : '对方先下。'),
    });
    await this.reversiAdvance();
    return this.reversiPayload();
  }

  private reversiReplayExit(): ReversiPayload {
    this.reversiReplayState = null;
    return this.reversiPayload();
  }

  private reversiBadge(): string {
    const game = this.reversi;
    if (!game) return '未开局';
    const score = game.score();
    if (game.currentPhase === 'ended') {
      return `${score.human} : ${score.model}`;
    }
    if (game.currentPhase === 'paused') return '已暂停';
    return `${score.human} : ${score.model}`;
  }

  private reversiText(): string {
    const game = this.reversi;
    if (!game) return '还没开局。';
    const score = game.score();
    const label = LEVEL_LABELS[game.level];
    if (game.currentPhase === 'ended') {
      const result =
        game.snapshot().winner === 'human'
          ? '对方赢了'
          : game.snapshot().winner === 'model'
            ? '你赢了'
            : '平局';
      const tail = game.snapshot().closing ? '，收尾话已交。' : '，还没写收尾话。';
      return `黑白棋这一局已结束（${result}；你 ${score.model} : ${score.human} 对方，${label}）${tail}`;
    }
    if (game.currentPhase === 'paused') {
      return `黑白棋这一局暂停着（${game.snapshot().pausedReason ?? ''}；你 ${score.model} : ${score.human} 对方）。`;
    }
    const side = game.currentTurn === 'human' ? '轮到你' : '轮到你';
    return `黑白棋第 ${this.reversiRound} 局（${label}），${side}，你 ${score.model} : ${score.human} 对方`;
  }

  private async reversiStart(levelArg?: unknown): Promise<ReversiPayload> {
    const level = this.parseReversiLevel(levelArg);
    // 先后手随机：黑先，谁执黑谁先下。
    const humanColor: Disc = Math.random() < 0.5 ? 'B' : 'W';
    this.reversiRound += 1;
    this.reversiMisses = 0;
    this.reversiReplayState = null;
    const game = new ReversiGame({
      id: `reversi-${this.reversiRound}`,
      level,
      humanColor,
      timezone: this.timezone,
    });
    this.reversi = game;
    await this.push({
      type: 'goodluckhavefun.reversi_started',
      text:
        `黑白棋开局（${LEVEL_LABELS[level]}）：你执${game.modelColor === 'B' ? '黑' : '白'}，` +
        `对方执${humanColor === 'B' ? '黑' : '白'}。` +
        (game.currentTurn === 'model' ? '你先下。' : '对方先下。'),
    });
    await this.reversiAdvance();
    return this.reversiPayload();
  }

  private async reversiMoveFromPanel(label: string): Promise<ReversiPayload> {
    const game = this.reversi;
    if (!game) throw new Error('还没开局。');
    const result = game.playByHuman(label);
    if (!result.ok) throw new Error(result.reason ?? '这一手不能下。');
    await this.reversiAdvance();
    return this.reversiPayload();
  }

  private async reversiUndo(): Promise<ReversiPayload> {
    const game = this.reversi;
    if (!game) throw new Error('还没开局。');
    const result = game.undo();
    if (!result.ok) throw new Error(result.reason ?? '现在不能悔棋。');
    await this.reversiAdvance();
    return this.reversiPayload();
  }

  private async reversiResign(): Promise<ReversiPayload> {
    const game = this.reversi;
    if (!game) throw new Error('还没开局。');
    game.resign();
    await this.reversiAdvance();
    return this.reversiPayload();
  }

  private async reversiResume(): Promise<ReversiPayload> {
    const game = this.reversi;
    if (!game) throw new Error('还没开局。');
    const result = game.resume();
    if (!result.ok) throw new Error(result.reason ?? '这一局没在暂停。');
    this.reversiMisses = 0;
    await this.reversiAdvance();
    return this.reversiPayload();
  }

  /** 一手之后：该谁下、要不要叫模型、要不要收局。 */
  private async reversiAdvance(): Promise<void> {
    const game = this.reversi;
    if (!game) return;
    this.clearReversiTimer();
    if (game.currentPhase === 'ended') {
      await this.push({
        type: 'goodluckhavefun.reversi_ended',
        text: `${game.turnLine()}。请用 goodluckhavefun_reversi_close 写一句收尾。`,
      });
      return;
    }
    if (game.currentPhase !== 'playing') return;
    if (game.currentTurn !== 'model') return;
    await this.push({
      type: 'goodluckhavefun.reversi_turn',
      text: this.reversiTurnText(game),
    });
    this.armReversiTimer();
  }

  private reversiTurnText(game: ReversiGame): string {
    const snapshot = game.modelSnapshot();
    const options = snapshot.legal
      .map((item) =>
        item.score === undefined
          ? `${item.label} · 翻 ${item.flips} 子`
          : `${item.label} · 翻 ${item.flips} 子 · 参考 ${item.score}`,
      )
      .join('；');
    return [
      `轮到你下（你执${snapshot.yourColor === 'B' ? '黑' : '白'}，你 ${snapshot.score.model} : ${snapshot.score.human} 对方）。`,
      '棋盘（B 黑，W 白，. 空；row 1 在最上面）：',
      snapshot.board,
      `可落点：${options || '（没有可落点，World 会自动停手）'}`,
      '用 goodluckhavefun_reversi_move 下其中一手，label 例如 c4。',
      snapshot.legal.some((item) => item.score !== undefined)
        ? '参考分只是参考，不是命令；你有更好的想法就按自己的想法下。'
        : '这一档不给参考分，靠你自己算。',
    ].join('\n');
  }

  private armReversiTimer(): void {
    this.clearReversiTimer();
    this.reversiTimer = setTimeout(() => {
      const game = this.reversi;
      if (!game || game.currentPhase !== 'playing' || game.currentTurn !== 'model') return;
      if (!game.pause('超过 90 秒没有落子')) return;
      void this.push({
        type: 'goodluckhavefun.reversi_paused',
        text: `这一手想了太久（${Math.round(MODEL_MOVE_TIMEOUT_MS / 1000)} 秒），这一局先暂停了。点「继续」再想一次。`,
      });
    }, MODEL_MOVE_TIMEOUT_MS);
    const timer = this.reversiTimer as { unref?: () => void };
    timer.unref?.();
  }

  private clearReversiTimer(): void {
    if (!this.reversiTimer) return;
    clearTimeout(this.reversiTimer);
    this.reversiTimer = null;
  }

  private async reversiStartTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      if (this.reversi && this.reversi.currentPhase !== 'ended') {
        return '上一局黑白棋还没结束，先下完它。';
      }
      const payload = await this.reversiStart(args.level);
      const view = payload.snapshot;
      if (!view) return '开局没有成功。';
      const who = view.partnerColor === 'B' ? '黑' : '白';
      return `黑白棋开局：你执${who}，对方执${view.yourColor === 'B' ? '黑' : '白'}，难度「${view.levelLabel}」。` +
        (view.turn === 'model' ? '你先下，等 World 把棋盘发给你。' : '对方先下。');
    } catch (error) {
      return this.fail(error);
    }
  }

  private async reversiMoveTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const game = this.reversi;
    if (!game) return this.fail(new Error('还没开局。'));
    const result = game.playByModel(String(args.label ?? ''));
    if (!result.ok) {
      this.reversiMisses += 1;
      if (this.reversiMisses >= 2 && game.pause('连着两手没下成')) {
        await this.push({
          type: 'goodluckhavefun.reversi_paused',
          text: '你连着两手没下成，这一局先暂停了。点「继续」再试一次。',
        });
      }
      return { text: result.reason ?? '这一手不能下。', failed: true };
    }
    this.reversiMisses = 0;
    await this.reversiAdvance();
    const view = game.snapshot();
    const tail =
      view.phase === 'ended'
        ? `终局：你 ${view.score.model} : ${view.score.human} 对方。请用 goodluckhavefun_reversi_close 写一句收尾。`
        : '这一手已经落在盘上，现在轮到你。';
    return `下在 ${String(args.label ?? '')}，翻 ${result.flips} 子。${tail}`;
  }

  private async reversiStateTool(): Promise<string | ToolOutcome> {
    const game = this.reversi;
    if (!game) return '黑白棋还没开局。';
    const view = game.modelSnapshot();
    const options = view.legal
      .map((item) =>
        item.score === undefined
          ? `${item.label} · 翻 ${item.flips} 子`
          : `${item.label} · 翻 ${item.flips} 子 · 参考 ${item.score}`,
      )
      .join('；');
    return [
      `第 ${this.reversiRound} 局，${view.phase === 'ended' ? '已结束' : view.phase === 'paused' ? '暂停中' : view.turn === 'model' ? '轮到你' : '轮到你'}，` +
        `难度「${LEVEL_LABELS[game.level]}」，你 ${view.score.model} : ${view.score.human} 对方，已下 ${view.moves} 手。`,
      '棋盘：',
      view.board,
      options ? `可落点：${options}` : '现在没有可落点。',
      view.pausedReason ? `暂停原因：${view.pausedReason}` : '',
      view.winner
        ? `结果：${view.winner === 'model' ? '你赢了' : view.winner === 'human' ? '对方赢了' : '平局'}`
        : '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private async reversiCloseTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const game = this.reversi;
    if (!game) return this.fail(new Error('还没开局。'));
    if (game.currentPhase !== 'ended') return '这一局还没结束，等终局再写收尾。';
    const closing = String(args.closing ?? '').trim();
    if (!closing) return this.fail(new Error('收尾话是空的。'));
    if (closing.length > 800) return this.fail(new Error('收尾话太长了（上限 800 字）。'));
    game.close(closing);
    return '收尾话已记下，面板会显示在结束页。';
  }

  private async trust(): Promise<TrustGame> {
    if (this.trustGame) return this.trustGame;
    this.trustOpening ??= TrustGame.open(this.timezone, new TrustStore(this.dataDir));
    this.trustGame = await this.trustOpening;
    return this.trustGame;
  }

  private trustText(): string {
    const snapshot = this.trustGame?.snapshot();
    if (!snapshot || snapshot.phase === 'idle') return '还没开局。';
    const score = `你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方`;
    if (snapshot.phase === 'ended') {
      const result =
        snapshot.winner === 'agent' ? '你赢了' : snapshot.winner === 'human' ? '对方赢了' : '平局';
      const tail = snapshot.closing ? '，收尾话已交。' : '，还没写收尾话。';
      return `第 ${snapshot.matchId} 局已结束（${result}，${score}）${tail}`;
    }
    return `第 ${snapshot.matchId} 局，第 ${snapshot.round} 回合（${score}）`;
  }

  private trustBadge(): string {
    if (!this.trustGame) return '未读取';
    const snapshot = this.trustGame.snapshot();
    if (snapshot.phase === 'idle') return '未开局';
    if (snapshot.phase === 'ended') {
      return snapshot.winner === 'agent' ? '你胜' : snapshot.winner === 'human' ? '对方胜' : '平局';
    }
    return `第 ${snapshot.round} 回合`;
  }

  private async trustPayload(): Promise<TrustPanelPayload> {
    const game = await this.trust();
    return { snapshot: this.panelTrust(game.snapshot()), profiles: game.profiles() };
  }

  /** 浏览器不该在你选之前看到伙伴的选择；历史回合仍然可见。 */
  private panelTrust(snapshot: TrustSnapshot): TrustSnapshot {
    return { ...snapshot, choice: { agent: null, human: snapshot.choice.human } };
  }

  private async trustStart(): Promise<TrustPanelPayload> {
    const game = await this.trust();
    const snapshot = await game.start();
    await this.push({ type: 'goodluckhavefun.trust_started', text: this.trustRoundPrompt(snapshot) });
    return { snapshot: this.panelTrust(snapshot), profiles: game.profiles() };
  }

  private async trustSayFromPanel(text: string): Promise<TrustPanelPayload> {
    const game = await this.trust();
    const snapshot = await game.say('human', text);
    if (snapshot.choice.agent && !snapshot.choice.human) {
      // 你刚开口，而模型已经选过了、这一回合还没结算：给它一次改主意的机会。
      await this.push({
        type: 'goodluckhavefun.trust_prompt',
        text:
          `你说：「${snapshot.say.human}」。\n` +
          '你这一回合已经选过了，但你还没选，可以改主意：想改就再调一次 goodluckhavefun_trust_choose 覆盖，不想改就别动。',
      });
    } else {
      await this.push({
        type: 'goodluckhavefun.trust_round',
        text:
          `你说：「${snapshot.say.human}」。\n` +
          '轮到你了：回一句（goodluckhavefun_trust_say），再选合作还是欺骗（goodluckhavefun_trust_choose）。',
      });
    }
    return { snapshot: this.panelTrust(snapshot), profiles: game.profiles() };
  }

  private async trustChooseFromPanel(value: string): Promise<TrustPanelPayload> {
    const game = await this.trust();
    const result = await game.choose('human', value as Choice);
    await this.afterTrustRound(result, 'human');
    return { snapshot: this.panelTrust(result.snapshot), profiles: game.profiles() };
  }

  private async afterTrustRound(result: TrustResult, by: PlayerKey): Promise<void> {
    const snapshot = result.snapshot;
    if (result.ended) {
      await this.push({ type: 'goodluckhavefun.trust_ended', text: this.trustEndText(snapshot) });
      return;
    }
    if (result.resolved) {
      const record = result.resolved;
      await this.push({
        type: 'goodluckhavefun.trust_round_done',
        text:
          `第 ${record.index} 回合：你 ${CHOICE_LABELS[record.agent]}，你 ${CHOICE_LABELS[record.human]} → ` +
          `你 ${signed(record.agentDelta)}，你 ${signed(record.humanDelta)}。` +
          `当前 你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方。\n` +
          `第 ${snapshot.round} 回合：聊天时间——说一句话（goodluckhavefun_trust_say），再选（goodluckhavefun_trust_choose）。`,
      });
      return;
    }
    if (by === 'human') {
      await this.push({
        type: 'goodluckhavefun.trust_round',
        text: '你已经选好了（你看不到他选了什么）。轮到你：合作还是欺骗？用 goodluckhavefun_trust_choose 交。',
      });
    }
  }

  private trustRoundPrompt(snapshot: TrustSnapshot): string {
    return (
      `第 ${snapshot.matchId} 局「信任的进化」开始。第 1 回合：聊天时间——` +
      '先对你说一句话（goodluckhavefun_trust_say，最多 60 字），再选合作或欺骗（goodluckhavefun_trust_choose）。'
    );
  }

  private trustEndText(snapshot: TrustSnapshot): string {
    const result =
      snapshot.winner === 'agent' ? '你赢了' : snapshot.winner === 'human' ? '对方赢了' : '平局';
    const rounds = snapshot.rounds
      .map(
        (record) =>
          `第 ${record.index} 回合：你 ${CHOICE_LABELS[record.agent]}，你 ${CHOICE_LABELS[record.human]}（${signed(record.agentDelta)} / ${signed(record.humanDelta)}）`,
      )
      .join('\n');
    return (
      `这一局结束：${result}（你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方）。\n${rounds}\n` +
      '写一段收尾：赢了就具体夸你两句，输了就安慰并说一句这一局有意思的地方，' +
      '然后用 goodluckhavefun_trust_close 交上来。'
    );
  }

  private describeTrustResult(result: TrustResult): string {
    const snapshot = result.snapshot;
    if (!result.resolved) return `已选，等你这一回合的选择。当前 你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方。`;
    const record = result.resolved;
    const head =
      `第 ${record.index} 回合：你 ${CHOICE_LABELS[record.agent]}，你 ${CHOICE_LABELS[record.human]} → ` +
      `你 ${signed(record.agentDelta)}，你 ${signed(record.humanDelta)}。` +
      `当前 你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方。`;
    if (result.ended) {
      const resultText =
        snapshot.winner === 'agent' ? '你赢了' : snapshot.winner === 'human' ? '对方赢了' : '平局';
      return `${head}\n这一局结束（${resultText}）。用 goodluckhavefun_trust_close 写收尾。`;
    }
    return `${head}\n第 ${snapshot.round} 回合：先说一句（trust_say），再选（trust_choose）。`;
  }

  private async startRound(): Promise<MysterySnapshot> {
    const tags = drawTags(this.dimensions(), this.lastTags);
    this.lastTags = tags;
    const round = await this.game.start(tags);
    await this.push({
      type: 'goodluckhavefun.round_started',
      text:
        `新的一局（${round.id}），标签：${describeTagsForPrompt(this.dimensions(), tags)}。\n` +
        `${RULES_REMINDER}\n` +
        '把标题、谜面、完整真相用 goodluckhavefun_mystery_write 写下来——真相一旦写下就不能改。' +
        '标签互相打架、编不出合规的题时，可以调 goodluckhavefun_mystery_redraw 重抽一次。',
    });
    return this.game.snapshot();
  }

  private async askFromPanel(text: string): Promise<AskResult> {
    const { question, duplicate } = await this.game.ask(text);
    if (!duplicate) {
      await this.push({
        type: 'goodluckhavefun.question_asked',
        text:
          `你问了 ${question.id}：${question.text}\n` +
          `请用 goodluckhavefun_mystery_judge 判一下（是 / 不是 / 无关）。`,
      });
    }
    return { ...this.game.snapshot(), questionId: question.id, duplicate };
  }

  private async revealFromPanel(): Promise<MysterySnapshot> {
    const round = await this.game.endByPanel();
    await this.push({
      type: 'goodluckhavefun.round_revealed',
      text:
        `你点了「查看真相」，这一局（${round.id}）结束。真相：${round.answer}\n` +
        '请写一段收尾：没猜中就安慰，猜中了就夸，然后用 goodluckhavefun_mystery_close 交上来。',
    });
    return this.game.snapshot();
  }

  private async startTool(): Promise<string | ToolOutcome> {
    try {
      const tags = drawTags(this.dimensions(), this.lastTags);
      const round = await this.game.start(tags);
      const message =
        `第 ${round.id} 局，标签：${describeTagsForPrompt(this.dimensions(), tags)}。\n` +
        `${RULES_REMINDER}\n` +
        '想好之后调用 goodluckhavefun_mystery_write，把标题、谜面、完整真相一起写下来；' +
        '标签冲突可以调 goodluckhavefun_mystery_redraw 重抽。';
      await this.push({ type: 'goodluckhavefun.round_started', text: message });
      return message;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async redrawTool(): Promise<string | ToolOutcome> {
    try {
      if (this.game.phase() !== 'drawing') {
        throw new Error('题已经写下了，标签不能再改；要换标签请先结束这一局。');
      }
      const tags = drawTags(this.dimensions(), this.lastTags);
      this.lastTags = tags;
      const round = await this.game.retag(tags);
      const message =
        `重抽好了：${describeTagsForPrompt(this.dimensions(), tags)}（第 ${round.id} 局）。\n` +
        `${RULES_REMINDER}\n` +
        '据此出题，然后调用 goodluckhavefun_mystery_write。';
      await this.push({ type: 'goodluckhavefun.tags_redrawn', text: message });
      return message;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async writeTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      await this.game.writePuzzle({
        title: String(args.title ?? ''),
        surface: String(args.surface ?? ''),
        answer: String(args.answer ?? ''),
      });
      const round = this.game.currentRound();
      const text =
        `题目写好了：《${round?.title ?? ''}》。谜面已经显示在面板上，等你提问。` +
        '真相已钉住，后面不要改口；你问什么，用 judge 判。';
      await this.push({ type: 'goodluckhavefun.puzzle_ready', text });
      return text;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async askTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const { question, duplicate } = await this.game.ask(String(args.text ?? ''));
      if (duplicate) {
        return `这个问题之前问过了（${question.id}），直接按「问过了」处理，不用再判。`;
      }
      await this.push({
        type: 'goodluckhavefun.question_asked',
        text: `问题 ${question.id}：${question.text}\n请用 judge 判一下。`,
      });
      return `已记下 ${question.id}：${question.text}。请判一下（是 / 不是 / 无关）。`;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async judgeTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const verdict = String(args.verdict ?? '') as Verdict;
      if (!(verdict in VERDICT_LABELS)) throw new Error(`不认识的判定：${verdict}`);
      const question = await this.game.judge(String(args.questionId ?? ''), verdict);
      return `${question.id}「${question.text}」→ ${VERDICT_LABELS[verdict]}。`;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async closeTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const round = await this.game.close({
        guessed: Boolean(args.guessed),
        closing: String(args.closing ?? ''),
      });
      await this.push({
        type: 'goodluckhavefun.round_revealed',
        text:
          `这一局收尾了（${round.id}，${round.guessed ? '猜中' : '没猜中'}）。` +
          `真相：《${round.title}》——${round.answer}`,
      });
      return '收尾词已交给面板。';
    } catch (error) {
      return this.fail(error);
    }
  }

  private async secretTool(): Promise<string | ToolOutcome> {
    const round = this.game.currentRound();
    if (!round) return '还没开局。';
    const questions = round.questions
      .map((item) => `- ${item.id} ${item.text} → ${item.verdict ? VERDICT_LABELS[item.verdict] : '待判'}`)
      .join('\n');
    return [
      `第 ${round.id} 局，标签：${describeTagsForPrompt(this.dimensions(), round.tags)}`,
      `标题：${round.title || '（还没写）'}`,
      `谜面：${round.surface || '（还没写）'}`,
      `真相：${round.answer || '（还没写）'}`,
      `问题：\n${questions || '（还没问）'}`,
      round.ended ? `已结束（${round.guessed ? '猜中' : '没猜中'}）。收尾词：${round.closing ?? '（还没写）'}` : '进行中。',
    ].join('\n');
  }

  private async trustStartTool(): Promise<string | ToolOutcome> {
    try {
      const game = await this.trust();
      const snapshot = await game.start();
      const text = this.trustRoundPrompt(snapshot);
      await this.push({ type: 'goodluckhavefun.trust_started', text });
      return text;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async trustSayTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const game = await this.trust();
      const snapshot = await game.say('agent', String(args.text ?? ''));
      return `说了：「${snapshot.say.agent}」。现在选：合作还是欺骗？`;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async trustChooseTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const game = await this.trust();
      const result = await game.choose('agent', String(args.choice ?? '') as Choice);
      await this.afterTrustRound(result, 'agent');
      return this.describeTrustResult(result);
    } catch (error) {
      return this.fail(error);
    }
  }

  private async trustCloseTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const game = await this.trust();
      const snapshot = await game.close(String(args.closing ?? ''));
      return `收尾话已交给面板（你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方）。`;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async trustStateTool(): Promise<string | ToolOutcome> {
    try {
      const game = await this.trust();
      const snapshot = game.snapshot();
      const profiles = game.profiles();
      const header =
        snapshot.phase === 'idle'
          ? '「信任的进化」还没开局。'
          : snapshot.phase === 'ended'
            ? `第 ${snapshot.matchId} 局已结束：你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方。`
            : `第 ${snapshot.matchId} 局，第 ${snapshot.round}/${snapshot.maxRounds} 回合，你 ${snapshot.agentScore} : ${snapshot.humanScore} 对方（先到 ${snapshot.targetScore} 分胜）。`;
      const rounds = snapshot.rounds
        .map(
          (record) =>
            `- 第 ${record.index} 回合：你 ${CHOICE_LABELS[record.agent]}，你 ${CHOICE_LABELS[record.human]}`,
        )
        .join('\n');
      const current =
        snapshot.phase === 'playing'
          ? [
              `本回合你说：${snapshot.say.agent ?? '（还没说）'}`,
              `本回合你说：${snapshot.say.human ?? '（还没说）'}`,
              `你已选：${snapshot.choice.agent ? CHOICE_LABELS[snapshot.choice.agent] : '（还没选）'}；` +
                `你已选：${snapshot.choice.human ? '（已选）' : '（还没选）'}`,
            ].join('\n')
          : '';
      return [
        header,
        current,
        rounds ? `回合记录：\n${rounds}` : '',
        `画像：\n- ${formatProfile(profiles.agent, '你')}\n- ${formatProfile(profiles.human, '你')}`,
      ]
        .filter((line) => line !== '')
        .join('\n');
    } catch (error) {
      return this.fail(error);
    }
  }

  // ---- 你画我猜 ----

  private vision(): VisionClient {
    return new VisionClient({
      baseUrl: this.cfg.visionBaseUrl,
      model: this.cfg.visionModel,
      apiKey: this.visionKey(),
    });
  }

  /** 配置里填的 Key 优先；没填就读部署 .env 里那个。 */
  private visionKey(): string {
    return this.cfg.visionApiKey.trim() || this.envVisionKey;
  }

  /** 面板配置里的词表；留空的档回落内置。 */
  private wordLists(): WordLists {
    return {
      easy: parseWordList(this.cfg.wordsEasy, WORD_BANK.easy),
      hard: parseWordList(this.cfg.wordsHard, WORD_BANK.hard),
    };
  }

  private visionMode(): DrawVisionMode {
    if (!this.cfg.visionEnabled) return 'off';
    if (this.visionFailures >= 2) return 'unavailable';
    return 'on';
  }

  /** 开局前先确认辅助视觉能用；不能用就把用户写的那句话原样抛出去。 */
  private async ensureVisionReady(): Promise<void> {
    if (!this.cfg.visionEnabled) return;
    if (this.visionMode() === 'unavailable') return;
    const ping = await this.vision().ping();
    if (!ping.ok) throw new Error(`${VISION_UNREADY_MESSAGE}\n（${ping.reason}）`);
  }

  private async drawPayload(): Promise<DrawPanelPayload> {
    return { snapshot: this.draw.panelSnapshot(), vision: this.visionMode() };
  }

  private drawText(): string {
    const snapshot = this.draw.snapshot();
    if (snapshot.phase === 'idle') return '还没开局。';
    if (snapshot.phase === 'ended') {
      const budget = !snapshot.guessed && snapshot.checksUsed >= snapshot.maxChecks ? '，检查预算用完自动收局' : '';
      return `第 ${snapshot.round} 局已结束（${snapshot.guessed ? '你猜中' : '你没猜中'}${budget}），答案是「${snapshot.word}」。`;
    }
    const checks = `视觉检查 ${snapshot.checksUsed}/${snapshot.maxChecks}`;
    return snapshot.phase === 'drawing'
      ? `第 ${snapshot.round} 局，你画的是「${snapshot.word}」，已交 ${snapshot.attempts.length} 张（${checks}）。`
      : `第 ${snapshot.round} 局已定稿，等你猜（${checks}）。`;
  }

  private drawBadge(): string {
    const snapshot = this.draw.snapshot();
    if (snapshot.phase === 'idle') return '未开局';
    if (snapshot.phase === 'ended') return snapshot.guessed ? '猜中了' : '已揭晓';
    if (snapshot.phase === 'guessing') return '等你猜';
    return `画图中 · ${snapshot.attempts.length} 张`;
  }

  private drawOpening(roundId: string, word: string, tier: WordTier): string {
    const level = tier === 'easy' ? '简单' : '偏难';
    return (
      `第 ${roundId} 局「你画我猜」开始。你要画的是：${word}（${level}）。\n` +
      `${DRAW_RULES}\n` +
      `画好调 goodluckhavefun_drawguess_draw 交笔画。面板会把笔画渲染成图，交给辅助视觉模型**盲猜**` +
      `（它不知道答案）：猜得出（${PASS_POINTS} 分以上）你就可以 finish 定稿；猜不出会把它的描述发给你，让你改。`
    );
  }

  private async drawStartFromPanel(tier?: unknown): Promise<{
    snapshot: DrawPanelSnapshot;
    vision: 'on' | 'off' | 'unavailable';
  }> {
    await this.ensureVisionReady();
    const level: WordTier = tier === 'easy' || tier === 'hard' ? tier : Math.random() < 0.5 ? 'easy' : 'hard';
    const { word, tier: picked } = pickWordFrom(this.wordLists(), this.lastWord, Math.random, level);
    this.lastWord = word;
    const round = await this.draw.start(word, picked);
    await this.push({ type: 'goodluckhavefun.drawguess_started', text: this.drawOpening(round.id, word, picked) });
    return this.drawPayload();
  }

  private async drawStartTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const payload = await this.drawStartFromPanel(args.tier);
      const snapshot = this.draw.snapshot();
      return (
        `第 ${snapshot.round} 局开始，你画的是「${snapshot.word}」（${snapshot.tier === 'easy' ? '简单' : '偏难'}）。\n` +
        `${DRAW_RULES}\n` +
        '交一张笔画（goodluckhavefun_drawguess_draw），等 World 把盲猜结果发给你。'
      );
    } catch (error) {
      return this.fail(error);
    }
  }

  private async drawTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const checked = validateDrawing({ strokes: args.strokes });
      if (!checked.ok) return this.fail(new Error(checked.reason));
      if (this.draw.budgetExhausted()) {
        return this.fail(
          new Error(
            '视觉检查的预算用完了，这一局不能再画；调 goodluckhavefun_drawguess_finish 让你猜最后一次（猜错这一局就结束）。',
          ),
        );
      }
      const ink = drawingInk(checked.drawing);
      const attempt = await this.draw.addAttempt(checked.drawing, ink);
      const head = `已收到 ${attempt.id}（${checked.drawing.strokes.length} 笔，墨量 ${ink}）。`;
      if (this.visionMode() !== 'on') {
        return `${head}视觉检查已关闭：你看一眼自己的笔画，觉得像就调 goodluckhavefun_drawguess_finish 定稿。`;
      }
      return `${head}面板正在出图，等 World 把辅助视觉的盲猜结果发给你再决定改不改，别连着交。`;
    } catch (error) {
      return this.fail(error);
    }
  }

  /** 面板把渲染好的 PNG 传上来；紧接着做一次盲猜。 */
  private async submitArt(
    attemptId: string,
    dataUrl: string,
  ): Promise<{ snapshot: DrawPanelSnapshot; vision: 'on' | 'off' | 'unavailable' }> {
    const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('图要是 PNG 的 data URL。');
    const bytes = Buffer.from(match[1]!, 'base64');
    if (bytes.byteLength < 1000) throw new Error('图太小了，重新渲染一次。');
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('图太大了（上限 4MB）。');
    const attempt = await this.draw.setArt(attemptId, `${attemptId}.png`);
    const round = this.draw.currentRound();
    if (!round) throw new Error('还没开局。');
    const dir = join(this.dataDir, 'drawguess', round.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${attemptId}.png`), bytes);

    if (this.visionMode() !== 'on') return this.drawPayload();
    if (this.draw.budgetExhausted()) {
      await this.push({
        type: 'goodluckhavefun.drawguess_checked',
        text:
          '这一局的画图预算已经用完了，这张不再检查（也画不了新图）。' +
          '只能调 goodluckhavefun_drawguess_finish 让你猜最后一次；猜错这一局就结束。',
      });
      return this.drawPayload();
    }
    try {
      const reading = await this.vision().check(bytes);
      const score = scoreReading(reading, round.word, wordsMatch);
      await this.draw.setCheck(attemptId, reading, score);
      this.visionFailures = 0;
      const snapshot = this.draw.snapshot();
      const left = Math.max(0, snapshot.maxAttempts - snapshot.batchChecks);
      const guesses = reading.guesses.length ? reading.guesses.map((item) => `「${item}」`).join('、') : '（没给猜测）';
      const head = `视觉模型看到：${reading.description}\n它猜：${guesses}（把握 ${reading.confidence}%），得分 ${score.points}/3。`;
      const outOfBudget = this.draw.budgetExhausted();
      const advice =
        score.points >= PASS_POINTS
          ? '够清楚了，调 goodluckhavefun_drawguess_finish 定稿。'
          : outOfBudget
            ? '还不够清楚，但视觉检查的预算已经用完：只能 finish 让你猜最后一次；猜错这一局就结束。'
            : left > 0
              ? `还不够清楚。按描述改一改，还能再画 ${left} 次；实在改不动就 finish，让你猜。`
              : '这一批画完了，只能 finish；等你猜错后 World 会再给你机会。';
      await this.push({ type: 'goodluckhavefun.drawguess_checked', text: `${head}\n${advice}` });
      return this.drawPayload();
    } catch (error) {
      this.visionFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      await this.push({
        type: 'goodluckhavefun.drawguess_checked',
        text:
          `这次视觉检查失败了：${message}\n` +
          (this.visionFailures >= 2
            ? '连续失败两次，这一局不再自动检查；你自己判断能不能 finish。'
            : '可以再交一张试试，或者直接 finish。'),
      });
      return this.drawPayload();
    }
  }

  private async drawFinishTool(): Promise<string | ToolOutcome> {
    try {
      const round = await this.draw.finish();
      const best = this.draw.bestAttempt();
      await this.push({
        type: 'goodluckhavefun.drawguess_ready',
        text:
          `图定稿了（${best?.id ?? '?'}，得分 ${best?.points ?? '未检查'}）。` +
          '你开始猜；猜错的话 World 会给你重画的机会。等你猜的时候别自己揭晓答案。',
      });
      return `定稿了（${round.id}）。等你猜。`;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async drawGuessFromPanel(text: string): Promise<{
    snapshot: DrawPanelSnapshot;
    vision: 'on' | 'off' | 'unavailable';
  }> {
    const { matched, guess } = await this.draw.guess(text);
    if (matched) {
      await this.push({
        type: 'goodluckhavefun.drawguess_ended',
        text:
          `你猜「${guess.text}」——猜中了（答案是「${this.draw.snapshot().word}」）。` +
          '请用 goodluckhavefun_drawguess_close 写一段收尾，具体夸他两句。',
      });
      return this.drawPayload();
    }
    await this.push({
      type: 'goodluckhavefun.drawguess_guess',
      text:
        `你猜「${guess.text}」，这不是答案。请用 goodluckhavefun_drawguess_judge 判一下：` +
        '如果它其实算对（同义、口语说法）就 correct=true；否则 correct=false，World 会让他继续猜，并让你重画。',
    });
    return this.drawPayload();
  }

  private async drawJudgeTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const snapshot = this.draw.snapshot();
      const lastGuess = snapshot.guesses[snapshot.guesses.length - 1]?.text ?? '';
      if (args.correct === true) {
        await this.draw.judgeCorrect(lastGuess);
        await this.push({
          type: 'goodluckhavefun.drawguess_ended',
          text:
            `你判你猜对了（「${lastGuess}」，答案是「${this.draw.snapshot().word}」）。` +
            '请用 goodluckhavefun_drawguess_close 写一段收尾。',
        });
        return '已判对，这一局结束。写收尾（goodluckhavefun_drawguess_close）。';
      }
      const hint = String(args.hint ?? '').trim().slice(0, 40);
      const { canRedraw } = await this.draw.rejectGuess();
      if (!canRedraw) {
        await this.draw.end(false);
        const word = this.draw.snapshot().word ?? '';
        await this.push({
          type: 'goodluckhavefun.drawguess_ended',
          text:
            (hint ? `你给了句提示：「${hint}」。\n` : '') +
            `你猜「${lastGuess}」还是不对，画图与检查的预算也用完了（${snapshot.attempts.length}/${snapshot.maxChecks}），` +
            `这一局到此为止。答案是「${word}」。` +
            '请用 goodluckhavefun_drawguess_close 写一段收尾：没猜中也别泄气，点一条他没注意到的线索。',
        });
        return '已判错；检查预算用完，这一局自动结束。写收尾（goodluckhavefun_drawguess_close）。';
      }
      await this.push({
        type: 'goodluckhavefun.drawguess_guess',
        text:
          (hint ? `你给了句提示：「${hint}」。\n` : '') +
          '你可以继续猜；你也有重画机会——换一种画法（再调 goodluckhavefun_drawguess_draw），画好再 finish。',
      });
      return '已判错。可以换一种画法重画。';
    } catch (error) {
      return this.fail(error);
    }
  }

  private async drawRevealFromPanel(): Promise<{
    snapshot: DrawPanelSnapshot;
    vision: 'on' | 'off' | 'unavailable';
  }> {
    const round = await this.draw.reveal();
    await this.push({
      type: 'goodluckhavefun.drawguess_ended',
      text:
        `你点了「查看谜底」，这一局（${round.id}）结束。答案是「${round.word}」，他没猜中。` +
        '请用 goodluckhavefun_drawguess_close 写一段收尾：安慰两句，说一句这张画好在哪。',
    });
    return this.drawPayload();
  }

  private async drawCloseTool(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    try {
      const round = await this.draw.close(String(args.closing ?? ''));
      return `收尾话已交给面板（答案「${round.word}」）。`;
    } catch (error) {
      return this.fail(error);
    }
  }

  private async drawStateTool(): Promise<string | ToolOutcome> {
    const snapshot = this.draw.snapshot();
    if (snapshot.phase === 'idle') return '「你画我猜」还没开局。';
    const attempts = snapshot.attempts
      .map(
        (item) =>
          `- ${item.id}：${item.strokes.length} 笔，墨量 ${item.ink}，` +
          `得分 ${item.points ?? '未检查'}${item.description ? `，视觉模型看到：${item.description}` : ''}` +
          `${item.guesses.length ? `，它猜：${item.guesses.join('、')}` : ''}`,
      )
      .join('\n');
    const guesses = snapshot.guesses
      .map((item) => `- 「${item.text}」${item.correct ? '（对）' : '（不对）'}`)
      .join('\n');
    return [
      `第 ${snapshot.round} 局，${snapshot.phase === 'drawing' ? '画图中' : snapshot.phase === 'guessing' ? '等你猜' : '已结束'}。`,
      `答案：${snapshot.word}（${snapshot.tier === 'easy' ? '简单' : '偏难'}）。`,
      `检查：${snapshot.checksUsed}/${snapshot.maxChecks}，这一批已画 ${snapshot.batchChecks}/${snapshot.maxAttempts}。`,
      attempts ? `画：\n${attempts}` : '',
      guesses ? `你的猜测：\n${guesses}` : '',
      snapshot.closing ? `收尾词：${snapshot.closing}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private badge(): string {
    const round = this.game.currentRound();
    if (!round) return '未开局';
    if (round.ended) return round.guessed ? '猜中了' : '已揭晓';
    return round.answer ? `进行中 · ${round.questions.length} 问` : '出题中';
  }

  private fail(error: unknown): ToolOutcome {
    const message = error instanceof Error ? error.message : String(error);
    return { text: message, failed: true };
  }

  private async push(event: { type: string; text: string }): Promise<void> {
    const host = this.host;
    if (!host) return;
    try {
      await host.pushEvent({
        type: event.type,
        ts: nowIso(this.timezone),
        source: this.id,
        origin: 'internal',
        senderKey: this.id,
        text: event.text,
      });
    } catch {
      // 事件推不出去不该影响一局本身；面板会下一次轮询时看到状态。
    }
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}
