import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import {
  GOODLUCKHAVEFUN_DEFAULTS,
  type GoodluckhavefunConfigSection,
} from './config.ts';
import { GoodluckhavefunWorld, GOODLUCKHAVEFUN_TOOL_DECLS } from './world.ts';

/** 辅助视觉模型的密钥名；写在部署的 .env 里。 */
export const VISION_KEY = 'GOODLUCKHAVEFUN_VISION_KEY';

export const GOODLUCKHAVEFUN: WorldDefinition<GoodluckhavefunConfigSection> = {
  id: 'goodluckhavefun',
  label: '闲弈',
  defaults: () => ({ ...GOODLUCKHAVEFUN_DEFAULTS }),
  create: (ctx) =>
    new GoodluckhavefunWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      dataDir: ctx.dataDir,
      visionApiKey: ctx.secret(VISION_KEY),
    }),
  describe: {
    tools: describeTools(GOODLUCKHAVEFUN_TOOL_DECLS, {
      goodluckhavefun_mystery_start: {
        zh: '开一局推理游戏，抽三个标签',
        en: 'Start a mystery round and draw three tags',
      },
      goodluckhavefun_mystery_redraw: {
        zh: '重抽标签（题目写下来之前可用）',
        en: 'Draw a new set of tags before the puzzle is written',
      },
      goodluckhavefun_mystery_write: {
        zh: '写下标题、谜面与完整真相',
        en: 'Write the title, surface and full answer',
      },
      goodluckhavefun_mystery_ask: {
        zh: '替你问一个问题',
        en: 'Ask a question on the player’s behalf',
      },
      goodluckhavefun_mystery_judge: {
        zh: '判定一个问题：是 / 不是 / 无关 / 问过了 / 不能回答',
        en: 'Judge a question: yes / no / irrelevant / asked / cannot answer',
      },
      goodluckhavefun_mystery_close: {
        zh: '收尾：夸奖或安慰',
        en: 'Close the round with praise or consolation',
      },
      goodluckhavefun_mystery_secret: {
        zh: '看当前这一局的谜面、真相与问答',
        en: 'Read the current round’s surface, answer and questions',
      },
      goodluckhavefun_trust_start: {
        zh: '开一局信任的进化（12 回合）',
        en: 'Start a Trust’s Evolution match',
      },
      goodluckhavefun_trust_say: {
        zh: '聊天时间说一句话',
        en: 'Say one line during chat time',
      },
      goodluckhavefun_trust_choose: {
        zh: '选合作或欺骗',
        en: 'Choose cooperate or deceive',
      },
      goodluckhavefun_trust_close: {
        zh: '收尾：夸奖或安慰',
        en: 'Close the match with praise or consolation',
      },
      goodluckhavefun_trust_state: {
        zh: '看比分、回合与双方画像',
        en: 'Read scores, rounds and both profiles',
      },
      goodluckhavefun_drawguess_start: {
        zh: '开一局你画我猜（伙伴画、你猜）',
        en: 'Start a Draw & Guess round',
      },
      goodluckhavefun_drawguess_draw: {
        zh: '交一张笔画（折线坐标）',
        en: 'Submit a drawing as polylines',
      },
      goodluckhavefun_drawguess_finish: {
        zh: '定稿：就这张画',
        en: 'Lock the drawing',
      },
      goodluckhavefun_drawguess_judge: {
        zh: '判你猜得对不对',
        en: 'Judge whether the guess is right',
      },
      goodluckhavefun_drawguess_close: {
        zh: '收尾：夸奖或安慰',
        en: 'Close the round with praise or consolation',
      },
      goodluckhavefun_drawguess_state: {
        zh: '看词、画与视觉检查结果',
        en: 'Read the word, drawings and vision checks',
      },
      goodluckhavefun_reversi_start: {
        zh: '开一局黑白棋（先手随机）',
        en: 'Start a Reversi game with a random first move',
      },
      goodluckhavefun_reversi_move: {
        zh: '在黑白棋里下一手',
        en: 'Play one Reversi move',
      },
      goodluckhavefun_reversi_state: {
        zh: '看黑白棋的棋盘、比分与可落点',
        en: 'Read the board, score and legal moves',
      },
      goodluckhavefun_reversi_close: {
        zh: '收尾：夸奖或安慰',
        en: 'Close the game with praise or consolation',
      },
    }),
    events: [
      {
        type: 'goodluckhavefun.started',
        description: { zh: '游戏面板挂载', en: 'The games panel is mounted' },
      },
      {
        type: 'goodluckhavefun.round_started',
        description: { zh: '抽好标签，等伙伴出题', en: 'Tags drawn; waiting for the puzzle' },
      },
      {
        type: 'goodluckhavefun.tags_redrawn',
        description: { zh: '标签重抽过，等伙伴按新标签出题', en: 'Tags redrawn; waiting for the puzzle' },
      },
      {
        type: 'goodluckhavefun.puzzle_ready',
        description: { zh: '题目写好了，等你提问', en: 'The puzzle is written' },
      },
      {
        type: 'goodluckhavefun.question_asked',
        description: { zh: '你问了一个问题，等伙伴判定', en: 'A question awaits judging' },
      },
      {
        type: 'goodluckhavefun.round_revealed',
        description: { zh: '这一局结束，真相可以看了', en: 'The round is over; the answer is visible' },
      },
      {
        type: 'goodluckhavefun.trust_started',
        description: { zh: '信任的进化开局，等第一回合的聊天', en: 'A Trust’s Evolution match started' },
      },
      {
        type: 'goodluckhavefun.trust_round',
        description: { zh: '轮到伙伴说话或选择', en: 'Your partner’s turn to talk or choose' },
      },
      {
        type: 'goodluckhavefun.trust_prompt',
        description: {
          zh: '你说完话，伙伴这一回合还没结算，可以改选',
          en: 'The player just spoke; the host may still change its pick',
        },
      },
      {
        type: 'goodluckhavefun.trust_round_done',
        description: { zh: '一回合结算完，等下一回合', en: 'A round resolved; next round begins' },
      },
      {
        type: 'goodluckhavefun.trust_ended',
        description: { zh: '这一局打完，等收尾话', en: 'The match is over; waiting for the closing words' },
      },
      {
        type: 'goodluckhavefun.drawguess_started',
        description: { zh: '抽到词了，等伙伴交笔画', en: 'A word is drawn; waiting for the drawing' },
      },
      {
        type: 'goodluckhavefun.drawguess_checked',
        description: { zh: '视觉模型看完图了，带描述与分数', en: 'The vision check finished with notes and a score' },
      },
      {
        type: 'goodluckhavefun.drawguess_ready',
        description: { zh: '图已定稿，等你猜', en: 'The drawing is locked; the player guesses' },
      },
      {
        type: 'goodluckhavefun.drawguess_guess',
        description: { zh: '你猜了一个词', en: 'The player made a guess' },
      },
      {
        type: 'goodluckhavefun.drawguess_ended',
        description: { zh: '这一局结束，答案可以看了', en: 'The round is over; the answer is visible' },
      },
      {
        type: 'goodluckhavefun.reversi_started',
        description: { zh: '黑白棋开局，先手随机', en: 'A Reversi game started; the first move was random' },
      },
      {
        type: 'goodluckhavefun.reversi_turn',
        description: { zh: '轮到伙伴下棋，棋盘与可落点已发过去', en: 'It is the partner’s turn; board and legal moves were sent' },
      },
      {
        type: 'goodluckhavefun.reversi_paused',
        description: { zh: '伙伴超时或连着下错，这一局暂停了', en: 'The game paused after a timeout or two illegal tries' },
      },
      {
        type: 'goodluckhavefun.reversi_ended',
        description: { zh: '黑白棋终局，等收尾话', en: 'The Reversi game is over; waiting for the closing words' },
      },
    ],
  },
};
