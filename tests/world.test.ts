import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, World } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { GOODLUCKHAVEFUN } from '../src/definition.ts';
import type { GoodluckhavefunConfigSection } from '../src/config.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { drawTags, tagDimensions, DEFAULT_TAG_VALUES } from '../src/tags.ts';
import type { MysterySnapshot } from '../src/mystery.ts';
import { ReversiGame } from '../src/reversi-game.ts';
import type { ReversiPanelSnapshot, ReversiPayload } from '../src/reversi-game.ts';
import { buildProfile } from '../src/trust.ts';

const call = {} as ToolCallContext;

let scratchDir: string;
beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'goodluckhavefun-'));
});
afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

const PUZZLE = {
  title: '半根火柴',
  surface: '沙漠里躺着一个人，旁边是半根火柴。',
  answer: '他和同伴乘热气球穿越沙漠，超重时抽签，输的人跳了下去。',
};

function tool(world: World, name: string) {
  const found = world.tools().find((it) => it.name === name);
  if (!found) throw new Error(`没有工具 ${name}`);
  return found;
}

async function callTool(world: World, name: string, args: Record<string, unknown> = {}) {
  const outcome = await tool(world, name).handler(args, call);
  return typeof outcome === 'string'
    ? { text: outcome, failed: false }
    : { text: outcome.text, failed: outcome.failed === true };
}


/** 面板拆成三个之后，信任页的方法名去掉了 trust 前缀。 */
function trustMethod(method: string): string {
  if (method === 'trustState') return 'state';
  if (method === 'trustStart') return 'start';
  if (method === 'trustSay') return 'say';
  if (method === 'trustChoose') return 'choose';
  throw new Error(`未知的信任方法：${method}`);
}

/** 你画我猜同理，去掉了 draw 前缀。 */
function drawMethod(method: string): string {
  if (method === 'drawState') return 'state';
  if (method === 'drawStart') return 'start';
  if (method === 'drawGuess') return 'guess';
  if (method === 'drawReveal') return 'reveal';
  if (method === 'drawArt') return 'art';
  throw new Error(`未知的画图方法：${method}`);
}

async function invoke(world: World, method: string, args: unknown[] = []): Promise<MysterySnapshot> {
  const decl = world.webUi?.();
  if (!decl?.invoke) throw new Error('World 没有声明面板 invoke');
  return (await decl.invoke('mystery', method, args)) as MysterySnapshot;
}

function roundOf(snapshot: MysterySnapshot) {
  if (!snapshot.round) throw new Error('还没有一局');
  return snapshot.round;
}

function makeWorld() {
  const ctx = fakeWorldContext(GOODLUCKHAVEFUN, { scratchDir });
  return { ctx, world: GOODLUCKHAVEFUN.create(ctx) };
}

describe('闲弈', () => {
  it('干装载不报失败：装载器会接受它', async () => {
    const report = await dryMountWorld(GOODLUCKHAVEFUN, { scratchDir });
    expect(report.failures).toEqual([]);
  });

  it('id 全小写、工具都带前缀、面板只有一个', () => {
    expect(GOODLUCKHAVEFUN.id).toBe('goodluckhavefun');
    expect(GOODLUCKHAVEFUN.id).toMatch(/^[a-z0-9]+$/);
    const { world } = makeWorld();
    for (const decl of world.tools()) {
      expect(decl.name.startsWith('goodluckhavefun_')).toBe(true);
    }
    expect(world.webUi?.().panels?.map((it) => it.id)).toEqual(['mystery', 'trust', 'drawguess']);
  });

  it('挂载时推 started 事件', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.started');
  });

  it('面板开局：抽三个标签、推 round_started、真相还没写', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);

    const round = roundOf(await invoke(world, 'start'));
    expect(round.phase).toBe('drawing');
    expect(round.tagsLabel.split(' · ')).toHaveLength(3);
    expect(round.answer).toBe('');

    const event = host.events.find((it) => it.type === 'goodluckhavefun.round_started');
    expect(event?.text).toContain('标签');
    expect(event?.text).toContain('未成年人');
  });

  it('写下真相会落盘到 mystery 目录，面板在结束前拿不到真相', async () => {
    const { ctx, world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await invoke(world, 'start');

    const result = await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    expect(result.failed).toBe(false);

    const file = join(ctx.dataDir, 'mystery', 'r1.json');
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { answer: string; title: string };
    expect(saved.answer).toContain('热气球');
    expect(saved.title).toBe('半根火柴');

    const round = roundOf(await invoke(world, 'state'));
    expect(round.phase).toBe('ready');
    expect(round.surface).toContain('沙漠');
    expect(round.answer).toBe('');
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.puzzle_ready');
  });

  it('真相写下后不能改', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    const second = await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    expect(second.failed).toBe(true);
    expect(second.text).toContain('不能改');
  });

  it('违禁词由配置决定：命中就拒收，改完能重写', async () => {
    const { ctx, world } = makeWorld();
    ctx.cfg.bannedWords = '热气球、沙漠';
    await world.start(new FakeHost());
    await invoke(world, 'start');

    const blocked = await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    expect(blocked.failed).toBe(true);
    expect(blocked.text).toContain('违禁词');
    expect(blocked.text).toContain('热气球');
    expect(roundOf(await invoke(world, 'state')).phase).toBe('drawing');

    ctx.cfg.bannedWords = '';
    const ok = await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    expect(ok.failed).toBe(false);
    expect(roundOf(await invoke(world, 'state')).phase).toBe('ready');
  });

  it('重抽只在出题前可用，且会推 tags_redrawn', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await invoke(world, 'start');

    const first = roundOf(await invoke(world, 'state')).tags;
    const redrawn = await callTool(world, 'goodluckhavefun_mystery_redraw');
    expect(redrawn.failed).toBe(false);
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.tags_redrawn');

    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    const late = await callTool(world, 'goodluckhavefun_mystery_redraw');
    expect(late.failed).toBe(true);
    expect(roundOf(await invoke(world, 'state')).tags).toEqual(first);
  });

  it('提问：超过 50 字拒绝，重复提问自动判「问过了」', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);

    const long = await callTool(world, 'goodluckhavefun_mystery_ask', { text: '很'.repeat(51) });
    expect(long.failed).toBe(true);
    expect(long.text).toContain('50');

    const first = await callTool(world, 'goodluckhavefun_mystery_ask', { text: '他是热气球上的人吗？' });
    expect(first.failed).toBe(false);
    const second = await callTool(world, 'goodluckhavefun_mystery_ask', { text: '他是热气球上的人吗' });
    expect(second.failed).toBe(false);
    expect(second.text).toContain('问过了');

    const round = roundOf(await invoke(world, 'state'));
    expect(round.questions).toHaveLength(2);
    expect(round.questions[1]?.verdictLabel).toBe('问过了');

    const asked = host.events.filter((it) => it.type === 'goodluckhavefun.question_asked');
    expect(asked).toHaveLength(1);
  });

  it('判定会写回；重复判与未知编号都被拒', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    await callTool(world, 'goodluckhavefun_mystery_ask', { text: '他在沙漠里吗？' });

    const judged = await callTool(world, 'goodluckhavefun_mystery_judge', {
      questionId: 'q1',
      verdict: 'yes',
    });
    expect(judged.failed).toBe(false);
    const again = await callTool(world, 'goodluckhavefun_mystery_judge', {
      questionId: 'q1',
      verdict: 'no',
    });
    expect(again.failed).toBe(true);
    const unknown = await callTool(world, 'goodluckhavefun_mystery_judge', {
      questionId: 'q9',
      verdict: 'yes',
    });
    expect(unknown.failed).toBe(true);

    expect(roundOf(await invoke(world, 'state')).questions[0]?.verdictLabel).toBe('是');
  });

  it('判不了的问题可以判「不能回答」', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    await callTool(world, 'goodluckhavefun_mystery_ask', { text: '他为什么要抽签？' });

    const judged = await callTool(world, 'goodluckhavefun_mystery_judge', {
      questionId: 'q1',
      verdict: 'cannot',
    });
    expect(judged.failed).toBe(false);
    expect(roundOf(await invoke(world, 'state')).questions[0]?.verdictLabel).toBe('不能回答');
  });

  it('问题上限热改立即生效', async () => {
    const { ctx, world } = makeWorld();
    ctx.cfg.maxQuestions = 2;
    await world.start(new FakeHost());
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    expect((await callTool(world, 'goodluckhavefun_mystery_ask', { text: '一？' })).failed).toBe(false);
    expect((await callTool(world, 'goodluckhavefun_mystery_ask', { text: '二？' })).failed).toBe(false);
    const third = await callTool(world, 'goodluckhavefun_mystery_ask', { text: '三？' });
    expect(third.failed).toBe(true);
    expect(third.text).toContain('上限');
  });

  it('面板点「查看真相」立即结束，之后才看得到真相', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);

    const ended = roundOf(await invoke(world, 'reveal'));
    expect(ended.phase).toBe('ended');
    expect(ended.answer).toContain('热气球');
    expect(ended.guessed).toBe(false);
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.round_revealed');

    const after = roundOf(await invoke(world, 'state'));
    expect(after.phase).toBe('ended');
    expect(after.answer).toContain('热气球');
  });

  it('收尾：猜中就写夸奖，没猜中就写安慰', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    await callTool(world, 'goodluckhavefun_mystery_ask', { text: '热气球超重了吗？' });
    await callTool(world, 'goodluckhavefun_mystery_judge', { questionId: 'q1', verdict: 'yes' });

    const closed = await callTool(world, 'goodluckhavefun_mystery_close', {
      guessed: true,
      closing: '你从「半根火柴」推到「超重抽签」，这一步很漂亮。',
    });
    expect(closed.failed).toBe(false);

    const round = roundOf(await invoke(world, 'state'));
    expect(round.phase).toBe('ended');
    expect(round.guessed).toBe(true);
    expect(round.closing).toContain('漂亮');
  });

  it('面板的未知方法直接报错', async () => {
    const { world } = makeWorld();
    const decl = world.webUi?.();
    if (!decl?.invoke) throw new Error('World 没有声明面板 invoke');
    await expect(decl.invoke('games', 'wat', [])).rejects.toThrow(/没有方法/);
    await expect(decl.invoke('nope', 'state', [])).rejects.toThrow(/没有方法/);
  });

  it('切页签不重置局面：再读 state 还是同一局、同一批问题', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invoke(world, 'start');
    await callTool(world, 'goodluckhavefun_mystery_write', PUZZLE);
    await callTool(world, 'goodluckhavefun_mystery_ask', { text: '一？' });

    const before = roundOf(await invoke(world, 'state'));
    const again = roundOf(await invoke(world, 'state'));
    expect(again.id).toBe(before.id);
    expect(again.questions).toHaveLength(1);
  });

  it('标签：每个维度独立抽，默认值就是约定的那几组', () => {
    const dimensions = tagDimensions({});
    expect(dimensions.map((it) => it.key)).toEqual(['type', 'tone', 'theme']);
    expect(dimensions.map((it) => it.values)).toEqual([
      [...DEFAULT_TAG_VALUES.type],
      [...DEFAULT_TAG_VALUES.tone],
      [...DEFAULT_TAG_VALUES.theme],
    ]);
    expect(DEFAULT_TAG_VALUES.type).toContain('巧合');
    expect(DEFAULT_TAG_VALUES.type).toContain('误解');

    const first = drawTags(dimensions, undefined, () => 0);
    expect(first).toEqual({ type: '本格', tone: '日常', theme: '悬疑' });

    let tick = 0;
    const random = () => {
      tick += 1;
      return ((tick * 7) % 10) / 10;
    };
    for (let i = 0; i < 20; i += 1) {
      const next = drawTags(dimensions, first, random);
      for (const dimension of dimensions) {
        expect(dimension.values).toContain(next[dimension.key]);
      }
      expect(next).not.toEqual(first);
    }
  });

  it('标签可以在配置里换掉，清空则回落默认', () => {
    expect(tagDimensions({ typeTags: '甲、乙' })[0]?.values).toEqual(['甲', '乙']);
    expect(tagDimensions({ typeTags: '' })[0]?.values).toEqual([...DEFAULT_TAG_VALUES.type]);
  });

  it('环境提示词变量随局面变化', async () => {
    const { world } = makeWorld();
    const before = await world.envPromptVars();
    expect(before?.['goodluckhavefun.mystery']).toContain('还没开局');
    await world.start(new FakeHost());
    await invoke(world, 'start');
    const after = await world.envPromptVars();
    expect(after?.['goodluckhavefun.mystery']).toContain('进行中');
  });

  it('面板声明了 games 面板与一份提示词', () => {
    const { world } = makeWorld();
    const decl = world.webUi?.();
    expect(decl?.panels?.map((it) => it.id)).toEqual(['mystery', 'trust', 'drawguess']);
    expect(decl?.promptDocs?.[0]?.role).toBe('envPrompt');
    expect(decl?.promptDocs?.[0]?.vars?.map((it) => it.name)).toEqual([
      'goodluckhavefun.mystery',
      'goodluckhavefun.trust',
    ]);
  });
});

interface TrustPayloadShape {
  snapshot: {
    phase: 'idle' | 'playing' | 'ended';
    matchId: number;
    round: number;
    agentScore: number;
    humanScore: number;
    say: { agent: string | null; human: string | null };
    choice: { agent: string | null; human: string | null };
    rounds: Array<{ index: number; agent: string; human: string }>;
    winner: string | null;
    closing: string | null;
  };
  profiles: {
    agent: { samples: number; entries: Array<{ label: string; score: number }> };
    human: { samples: number; entries: Array<{ label: string; score: number }> };
  };
}

async function invokeTrust(
  world: World,
  method: string,
  args: unknown[] = [],
): Promise<TrustPayloadShape> {
  const decl = world.webUi?.();
  if (!decl?.invoke) throw new Error('World 没有声明面板 invoke');
  return (await decl.invoke('trust', trustMethod(method), args)) as TrustPayloadShape;
}

describe('信任的进化', () => {
  it('开局：第 1 回合、0:0、推 trust_started，面板拿不到伙伴的选择', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);

    const payload = await invokeTrust(world, 'trustStart');
    expect(payload.snapshot.phase).toBe('playing');
    expect(payload.snapshot.round).toBe(1);
    expect(payload.snapshot.agentScore).toBe(0);
    expect(payload.snapshot.humanScore).toBe(0);
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.trust_started');

    await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
    const after = await invokeTrust(world, 'trustState');
    expect(after.snapshot.choice.agent).toBeNull();
    expect(after.snapshot.choice.human).toBeNull();

    // 给模型看的比分按变量名走：我是「你」、人类是「对方」。
    const stateText = await callTool(world, 'goodluckhavefun_trust_state');
    expect(stateText.text).toMatch(/你 0 : 0 对方/);
  });

  it('都合作：各 +1；面板下一回合从 0 开始数', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');
    await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'cooperate' });
    const payload = await invokeTrust(world, 'trustChoose', ['cooperate']);

    expect(payload.snapshot.agentScore).toBe(1);
    expect(payload.snapshot.humanScore).toBe(1);
    expect(payload.snapshot.round).toBe(2);
    expect(payload.snapshot.rounds).toHaveLength(1);
    expect(payload.snapshot.rounds[0]).toMatchObject({ agent: 'cooperate', human: 'cooperate' });
  });

  it('一骗一合：骗的 +2，合的 +0', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');
    await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
    const payload = await invokeTrust(world, 'trustChoose', ['cooperate']);
    expect(payload.snapshot.agentScore).toBe(2);
    expect(payload.snapshot.humanScore).toBe(0);
  });

  it('都欺骗各 -1，但分数不会低于 0', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');
    await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
    const payload = await invokeTrust(world, 'trustChoose', ['deceive']);
    expect(payload.snapshot.agentScore).toBe(0);
    expect(payload.snapshot.humanScore).toBe(0);
    expect(payload.snapshot.round).toBe(2);
  });

  it('没开局时选择会被拒；你选之前，伙伴可以改主意', async () => {
    const { world } = makeWorld();
    await invokeTrust(world, 'trustStart');
    const first = await invokeTrust(world, 'trustChoose', ['cooperate']);
    expect(first.snapshot.choice.agent).toBe('cooperate');

    const revised = await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
    expect(revised.failed).toBe(false);
    const after = await invokeTrust(world, 'trustState');
    expect(after.snapshot.choice.agent).toBe('deceive');

    // 你一选，这一回合立刻结算：骗 +2、合 +0。
    const settled = await invokeTrust(world, 'trustChoose', ['cooperate']);
    expect(settled.snapshot.agentScore).toBe(2);
    expect(settled.snapshot.humanScore).toBe(0);

    const { world: fresh } = makeWorld();
    const idle = await callTool(fresh, 'goodluckhavefun_trust_choose', { choice: 'cooperate' });
    expect(idle.failed).toBe(true);
  });

  it('你说话后推 trust_prompt：伙伴已经选过、还没结算时可以改选', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await invokeTrust(world, 'trustStart');

    await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'cooperate' });
    host.events.length = 0;
    await invokeTrust(world, 'trustSay', ['这次你先来？']);

    const prompt = host.events.find((it) => it.type === 'goodluckhavefun.trust_prompt');
    expect(prompt?.text).toContain('可以改主意');
    expect(prompt?.text).toContain('这次你先来？');
  });

  it('聊天：每回合一句，超过 60 字被拒；你说的一句会进面板', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');

    const long = await callTool(world, 'goodluckhavefun_trust_say', { text: '话'.repeat(61) });
    expect(long.failed).toBe(true);

    const ok = await callTool(world, 'goodluckhavefun_trust_say', { text: '这回我信你。' });
    expect(ok.failed).toBe(false);

    const payload = await invokeTrust(world, 'trustSay', ['那就一起赚。']);
    expect(payload.snapshot.say.agent).toBe('这回我信你。');
    expect(payload.snapshot.say.human).toBe('那就一起赚。');
  });

  it('聊天与选择互不影响：说过还能改口，选完也还能说话', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');

    await invokeTrust(world, 'trustSay', ['第一句。']);
    const replaced = await invokeTrust(world, 'trustSay', ['改口，第二句。']);
    expect(replaced.snapshot.say.human).toBe('改口，第二句。');

    await invokeTrust(world, 'trustChoose', ['cooperate']);
    const afterChoice = await invokeTrust(world, 'trustSay', ['选完还能补一句。']);
    expect(afterChoice.snapshot.say.human).toBe('选完还能补一句。');
    expect(afterChoice.snapshot.choice.human).toBe('cooperate');
  });

  it('先到 7 分结束：连骗四回合，伙伴 8:0 收工并等收尾话', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await invokeTrust(world, 'trustStart');

    let payload: TrustPayloadShape | null = null;
    for (let i = 0; i < 4; i += 1) {
      await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
      payload = await invokeTrust(world, 'trustChoose', ['cooperate']);
    }
    expect(payload?.snapshot.phase).toBe('ended');
    expect(payload?.snapshot.winner).toBe('agent');
    expect(payload?.snapshot.agentScore).toBe(8);
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.trust_ended');

    const closed = await callTool(world, 'goodluckhavefun_trust_close', {
      closing: '你这几回合太信人了，下次记得留一手。',
    });
    expect(closed.failed).toBe(false);
    const after = await invokeTrust(world, 'trustState');
    expect(after.snapshot.closing).toContain('留一手');
  });

  it('12 回合打完按分数判：都欺骗则平局', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');

    let payload: TrustPayloadShape | null = null;
    for (let i = 0; i < 12; i += 1) {
      await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
      payload = await invokeTrust(world, 'trustChoose', ['deceive']);
    }
    expect(payload?.snapshot.phase).toBe('ended');
    expect(payload?.snapshot.winner).toBe('tie');
    expect(payload?.snapshot.rounds).toHaveLength(12);
  });

  it('打完之后不能再选；未结束不能写收尾话', async () => {
    const { world } = makeWorld();
    await invokeTrust(world, 'trustStart');
    const early = await callTool(world, 'goodluckhavefun_trust_close', { closing: '早了' });
    expect(early.failed).toBe(true);

    for (let i = 0; i < 12; i += 1) {
      await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'deceive' });
      await invokeTrust(world, 'trustChoose', ['deceive']);
    }
    const late = await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'cooperate' });
    expect(late.failed).toBe(true);
  });

  it('画像：复读机 / 一根筋 按连续操作记分（倍率 0.6）', () => {
    const mine = ['cooperate', 'cooperate', 'deceive', 'deceive'] as const;
    const theirs = ['cooperate', 'cooperate', 'cooperate', 'cooperate'] as const;
    const profile = buildProfile('agent', [[...mine]], [[...theirs]]);
    const byLabel = Object.fromEntries(profile.entries.map((it) => [it.label, it.score]));
    // i=1: C==C（复读机），C==C（一根筋）；i=2: D!=C，D!=C；i=3: D==C? 否，D==D（一根筋）
    expect(byLabel['复读机']).toBe(0.6);
    expect(byLabel['一根筋']).toBe(1.2);
    expect(profile.samples).toBe(4);
  });

  it('画像：老油条 / 小粉红 / 胡乱来 按连续两轮的概率分布记分', () => {
    const choices: Array<'cooperate' | 'deceive'> = [];
    for (let i = 0; i < 12; i += 1) choices.push(i < 4 ? 'deceive' : 'cooperate');
    const profile = buildProfile('agent', [choices], [choices]);
    const byLabel = Object.fromEntries(profile.entries.map((it) => [it.label, it.score]));
    expect(byLabel['老油条']).toBe(3);
    expect(byLabel['小粉红']).toBe(7);
    expect(byLabel['胡乱来']).toBe(0);
  });

  it('画像工具只读：trust_state 能读回画像，没有写画像的工具', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');
    const text = await callTool(world, 'goodluckhavefun_trust_state');
    expect(text.failed).toBe(false);
    expect(text.text).toContain('画像');
    expect(world.tools().some((it) => /profile|画像/.test(it.name))).toBe(false);
  });

  it('切页签不丢信任的进化这一局', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());
    await invokeTrust(world, 'trustStart');
    await callTool(world, 'goodluckhavefun_trust_choose', { choice: 'cooperate' });
    await invokeTrust(world, 'trustChoose', ['deceive']);

    const again = await invokeTrust(world, 'trustState');
    expect(again.snapshot.matchId).toBe(1);
    expect(again.snapshot.round).toBe(2);
    expect(again.snapshot.agentScore).toBe(0);
    expect(again.snapshot.humanScore).toBe(2);
  });
});

interface DrawPayloadShape {
  snapshot: {
    phase: string;
    round: number;
    attempts: Array<{ id: string; points: number | null; hasPng: boolean }>;
    guesses: Array<{ text: string; correct: boolean }>;
    checksUsed: number;
    maxChecks: number;
    word: string | null;
    closing: string | null;
    guessed: boolean | null;
  };
  vision: string;
}

async function invokeDraw(
  world: World,
  method: string,
  args: unknown[] = [],
): Promise<DrawPayloadShape> {
  const decl = world.webUi?.();
  if (!decl?.invoke) throw new Error('World 没有声明面板 invoke');
  return (await decl.invoke('drawguess', drawMethod(method), args)) as DrawPayloadShape;
}

/** 关掉辅助视觉：这些用例不联网，走「主模型自己判断」那条降级路。 */
function makeOfflineWorld(overrides: Partial<GoodluckhavefunConfigSection> = {}) {
  const made = makeWorld();
  Object.assign(made.ctx.cfg, { visionEnabled: false }, overrides);
  return made;
}

const PNG = `data:image/png;base64,${Buffer.alloc(2048, 3).toString('base64')}`;
const CIRCLE = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  return [500 + 150 * Math.cos(angle), 500 + 150 * Math.sin(angle)] as [number, number];
});

describe('你画我猜', () => {
  it('开局：面板看不到词，视觉关闭时直接可玩', async () => {
    const { world } = makeOfflineWorld();
    const host = new FakeHost();
    await world.start(host);

    const payload = await invokeDraw(world, 'drawStart');
    expect(payload.snapshot.phase).toBe('drawing');
    expect(payload.snapshot.word).toBeNull();
    expect(payload.vision).toBe('off');
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.drawguess_started');

    const hostText = await callTool(world, 'goodluckhavefun_drawguess_state');
    expect(hostText.text).toMatch(/答案：.+（/);
  });

  it('可以指定难度：简单与困难各抽各自的词表', async () => {
    const { world, ctx } = makeOfflineWorld({ wordsEasy: '苹果', wordsHard: '灯塔' });
    await world.start(new FakeHost());

    const easy = await invokeDraw(world, 'drawStart', ['easy']);
    expect(easy.snapshot.phase).toBe('drawing');
    const easyHost = await callTool(world, 'goodluckhavefun_drawguess_state');
    expect(easyHost.text).toContain('答案：苹果');

    await invokeDraw(world, 'drawReveal');
    const hard = await invokeDraw(world, 'drawStart', ['hard']);
    expect(hard.snapshot.phase).toBe('drawing');
    const hardHost = await callTool(world, 'goodluckhavefun_drawguess_state');
    expect(hardHost.text).toContain('答案：灯塔');
  });

  it('笔画校验：空、单点、越界、超宽都拒；合法笔画落成一笔', async () => {
    const { world } = makeOfflineWorld();
    await world.start(new FakeHost());
    await invokeDraw(world, 'drawStart');

    for (const strokes of [
      [],
      [{ width: 3, points: [[0, 0]] }],
      [{ width: 3, points: [[-5, 0], [10, 10]] }],
      [{ width: 99, points: [[10, 10], [20, 20]] }],
    ]) {
      const rejected = await callTool(world, 'goodluckhavefun_drawguess_draw', { strokes });
      expect(rejected.failed).toBe(true);
    }

    const drawn = await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 6, points: CIRCLE }],
    });
    expect(drawn.failed).toBe(false);
    const payload = await invokeDraw(world, 'drawState');
    expect(payload.snapshot.attempts).toHaveLength(1);
    expect(payload.snapshot.attempts[0]?.hasPng).toBe(false);
  });

  it('finish 要等 PNG 回传；定稿后仍不把词发给面板', async () => {
    const { world } = makeOfflineWorld();
    await world.start(new FakeHost());
    await invokeDraw(world, 'drawStart');
    await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 6, points: CIRCLE }],
    });

    const tooEarly = await callTool(world, 'goodluckhavefun_drawguess_finish');
    expect(tooEarly.failed).toBe(true);

    const uploaded = await invokeDraw(world, 'drawArt', ['a1', PNG]);
    expect(uploaded.snapshot.attempts[0]?.hasPng).toBe(true);

    const locked = await callTool(world, 'goodluckhavefun_drawguess_finish');
    expect(locked.failed).toBe(false);
    const payload = await invokeDraw(world, 'drawState');
    expect(payload.snapshot.phase).toBe('guessing');
    expect(payload.snapshot.word).toBeNull();
  });

  it('猜错回到画图阶段并保住视觉预算；猜对则结束并揭晓', async () => {
    const { world } = makeOfflineWorld();
    await world.start(new FakeHost());
    await invokeDraw(world, 'drawStart');
    const hostText = await callTool(world, 'goodluckhavefun_drawguess_state');
    const word = /答案：(.+?)（/.exec(hostText.text)?.[1];
    expect(word).toBeTruthy();

    await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 6, points: CIRCLE }],
    });
    await invokeDraw(world, 'drawArt', ['a1', PNG]);
    await callTool(world, 'goodluckhavefun_drawguess_finish');

    const wrong = await invokeDraw(world, 'drawGuess', ['完全不对的东西']);
    expect(wrong.snapshot.phase).toBe('guessing');
    expect(wrong.snapshot.guesses).toHaveLength(1);

    await callTool(world, 'goodluckhavefun_drawguess_judge', { correct: false });
    const back = await invokeDraw(world, 'drawState');
    expect(back.snapshot.phase).toBe('drawing');
    expect(back.snapshot.checksUsed).toBe(0);

    await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 5, points: CIRCLE }],
    });
    await invokeDraw(world, 'drawArt', ['a2', PNG]);
    await callTool(world, 'goodluckhavefun_drawguess_finish');

    const right = await invokeDraw(world, 'drawGuess', [word!]);
    expect(right.snapshot.phase).toBe('ended');
    expect(right.snapshot.guessed).toBe(true);
    expect(right.snapshot.word).toBe(word);
  });

  it('查看谜底直接结束并可写收尾；切页签不丢这一局', async () => {
    const { world } = makeOfflineWorld();
    await world.start(new FakeHost());
    await invokeDraw(world, 'drawStart');
    await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 6, points: CIRCLE }],
    });
    await invokeDraw(world, 'drawArt', ['a1', PNG]);
    await callTool(world, 'goodluckhavefun_drawguess_finish');

    const revealed = await invokeDraw(world, 'drawReveal');
    expect(revealed.snapshot.phase).toBe('ended');
    expect(revealed.snapshot.guessed).toBe(false);
    expect(revealed.snapshot.word).toBeTruthy();

    const closed = await callTool(world, 'goodluckhavefun_drawguess_close', {
      closing: '这张画其实挺像的。',
    });
    expect(closed.failed).toBe(false);

    const again = await invokeDraw(world, 'drawState');
    expect(again.snapshot.round).toBe(1);
    expect(again.snapshot.closing).toContain('挺像');
  });

  it('画图预算用完就不能再画；你再猜错，这一局自动收局', async () => {
    const { world, ctx } = makeOfflineWorld();
    ctx.cfg.maxChecks = 1;
    const host = new FakeHost();
    await world.start(host);
    await invokeDraw(world, 'drawStart');

    await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 6, points: CIRCLE }],
    });
    await invokeDraw(world, 'drawArt', ['a1', PNG]);
    await callTool(world, 'goodluckhavefun_drawguess_finish');

    const blocked = await callTool(world, 'goodluckhavefun_drawguess_judge', { correct: false });
    expect(blocked.failed).toBe(false);
    const afterMiss = await invokeDraw(world, 'drawState');
    // 只有一张画、又猜错了：预算用完，World 直接收局，不再回到画图阶段。
    expect(afterMiss.snapshot.phase).toBe('ended');
    expect(afterMiss.snapshot.guessed).toBe(false);
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.drawguess_ended');

    const noMoreDraw = await callTool(world, 'goodluckhavefun_drawguess_draw', {
      strokes: [{ width: 6, points: CIRCLE }],
    });
    expect(noMoreDraw.failed).toBe(true);

    const closed = await callTool(world, 'goodluckhavefun_drawguess_close', { closing: '下次换一种画法。' });
    expect(closed.failed).toBe(false);
  });

  it('词库可以在配置里换：两档都填同一个词，抽出来就一定是它', async () => {
    const { world, ctx } = makeOfflineWorld();
    ctx.cfg.wordsEasy = '苹果、香蕉';
    ctx.cfg.wordsHard = '苹果';
    await world.start(new FakeHost());
    await invokeDraw(world, 'drawStart');

    const hostText = await callTool(world, 'goodluckhavefun_drawguess_state');
    expect(hostText.text).toContain('答案：苹果');
  });

  it('视觉 Key 可以填在配置里：不填报没有 Key，填了就去连地址', async () => {
    const { world, ctx } = makeWorld();
    await world.start(new FakeHost());
    ctx.cfg.visionEnabled = true;
    ctx.cfg.visionModel = 'test-vision';
    ctx.cfg.visionBaseUrl = 'http://127.0.0.1:9'; // 本地必然连不上的端口
    ctx.cfg.visionApiKey = '';

    await expect(invokeDraw(world, 'drawStart')).rejects.toThrow(/密钥/);

    ctx.cfg.visionApiKey = 'sk-test';
    await expect(invokeDraw(world, 'drawStart')).rejects.toThrow(/连不上/);
  });
});

async function invokeReversi(
  world: World,
  method: string,
  args: unknown[] = [],
): Promise<ReversiPanelSnapshot> {
  const decl = world.webUi?.();
  if (!decl?.invoke) throw new Error('World 没有声明面板 invoke');
  return (await decl.invoke('reversi', method, args)) as ReversiPanelSnapshot;
}

/** 轮到伙伴就替它走一手（走它的第一个可落点，足够把回合推回来）。 */
async function passModelTurn(world: World): Promise<ReversiPanelSnapshot> {
  const state = await invokeReversi(world, 'state');
  if (state.turn !== 'model') return state;
  const move = state.legal[0];
  if (!move) throw new Error('伙伴回合却没有可落点');
  const result = await callTool(world, 'goodluckhavefun_reversi_move', { label: move.label });
  if (result.failed) throw new Error(result.text);
  return invokeReversi(world, 'state');
}

describe('黑白棋', () => {
  it('开局：8×8 盘、有可落点、先手随机但双方都能下', async () => {
    const { world } = makeWorld();
    const host = new FakeHost();
    await world.start(host);

    const state = await invokeReversi(world, 'start', [1]);
    expect(state.phase).toBe('playing');
    expect(state.board).toHaveLength(8);
    expect(state.board[0]).toHaveLength(8);
    expect(state.legal.length).toBeGreaterThan(0);
    expect(state.levelLabel).toBe('伙伴自己来');
    expect(host.events.map((it) => it.type)).toContain('goodluckhavefun.reversi_started');
  });

  it('伙伴出招后轮到你，你落子会翻子', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());

    let state = await invokeReversi(world, 'start', [2]);
    state = await passModelTurn(world);
    expect(state.turn).toBe('human');

    const before = state.board.flat().filter(Boolean).length;
    const target = state.legal[0];
    if (!target) throw new Error('没有可落点');
    state = await invokeReversi(world, 'move', [target.label]);
    expect(state.board.flat().filter(Boolean).length).toBeGreaterThan(before);
    expect(state.moves.length).toBeGreaterThan(0);
  });

  it('连着两次下在不能下的地方：自动暂停，可以继续', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());

    let state = await invokeReversi(world, 'start', [1]);
    state = await passModelTurn(world);

    const first = await callTool(world, 'goodluckhavefun_reversi_move', { label: 'a1' });
    expect(first.failed).toBe(true);
    const second = await callTool(world, 'goodluckhavefun_reversi_move', { label: 'a1' });
    expect(second.failed).toBe(true);

    state = await invokeReversi(world, 'state');
    expect(state.phase).toBe('paused');

    state = await invokeReversi(world, 'resume');
    expect(state.phase).toBe('playing');
  });

  it('悔棋撤掉你那一手和伙伴的应手，次数只有两次', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());

    let state = await invokeReversi(world, 'start', [1]);
    state = await passModelTurn(world);
    const first = state.legal[0];
    if (!first) throw new Error('没有可落点');
    await invokeReversi(world, 'move', [first.label]);
    state = await passModelTurn(world);

    const movesBefore = state.moves.length;
    state = await invokeReversi(world, 'undo');
    expect(state.moves.length).toBe(movesBefore - 2);
    expect(state.undoLeft).toBe(1);

    await invokeReversi(world, 'undo');
    await expect(invokeReversi(world, 'undo')).rejects.toThrow(/悔棋|没有/);
  });

  it('认输结束这一局，收尾话进快照与历史', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());

    await invokeReversi(world, 'start', [3]);
    let state = await invokeReversi(world, 'resign');
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('model');

    const closed = await callTool(world, 'goodluckhavefun_reversi_close', {
      closing: '这局你下得挺稳，下次我认真点。',
    });
    expect(closed.failed).toBeFalsy();

    state = await invokeReversi(world, 'state');
    expect(state.closing).toBe('这局你下得挺稳，下次我认真点。');

    const page = (await invokeReversi(world, 'history', [0])) as unknown as {
      total: number;
      entries: Array<{ id: string; headline: string; lines: string[] }>;
    };
    expect(page.total).toBe(1);
    expect(page.entries[0]?.id.startsWith('reversi:')).toBe(true);
    expect(page.entries[0]?.lines.some((line) => line.includes('难度'))).toBe(true);
  });

  it('历史里存着棋谱，可以逐步回放', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());

    let state = await invokeReversi(world, 'start', [1]);
    state = await passModelTurn(world);
    const move = state.legal[0];
    if (!move) throw new Error('没有可落点');
    state = await invokeReversi(world, 'move', [move.label]);
    state = await passModelTurn(world);
    await invokeReversi(world, 'resign');

    const page = (await invokeReversi(world, 'history', [0])) as unknown as {
      entries: Array<{ id: string; replay?: { moves: unknown[] } }>;
    };
    const entry = page.entries[0];
    if (!entry?.replay) throw new Error('历史里没有棋谱');
    expect(entry.replay.moves.length).toBeGreaterThan(0);

    const payload = (await invokeReversi(world, 'replay', [entry.id])) as unknown as ReversiPayload;
    expect(payload.replay?.step).toBe(0);
    expect(payload.replay?.total).toBe(entry.replay.moves.length);

    const stepped = (await invokeReversi(world, 'replayStep', [1])) as unknown as ReversiPayload;
    expect(stepped.replay?.step).toBe(1);
    expect(stepped.replay?.lastMove).toBeTruthy();

    const back = (await invokeReversi(world, 'replayStep', [-5])) as unknown as ReversiPayload;
    expect(back.replay?.step).toBe(0);
  });

  it('从复盘第 1 手接着下：开一局新棋，局面就在那一手之后', async () => {
    const { world } = makeWorld();
    await world.start(new FakeHost());

    let state = await invokeReversi(world, 'start', [1]);
    state = await passModelTurn(world);
    const move = state.legal[0];
    if (!move) throw new Error('没有可落点');
    const humanColor = state.humanColor;
    state = await invokeReversi(world, 'move', [move.label]);
    await passModelTurn(world);
    await invokeReversi(world, 'resign');

    const page = (await invokeReversi(world, 'history', [0])) as unknown as {
      entries: Array<{ id: string; replay?: { moves: Array<{ label: string }> } }>;
    };
    const entry = page.entries[0];
    if (!entry?.replay) throw new Error('历史里没有棋谱');
    await invokeReversi(world, 'replay', [entry.id]);
    await invokeReversi(world, 'replayStep', [1]);

    const resumed = (await invokeReversi(world, 'replayResume')) as unknown as ReversiPayload;
    expect(resumed.replay).toBeNull();
    expect(resumed.snapshot?.moves).toHaveLength(0);
    expect(resumed.snapshot?.humanColor).toBe(humanColor);
    expect(resumed.snapshot?.phase).toBe('playing');
  });
});

describe('黑白棋的终局判定', () => {
  it('下满全盘同色时立刻按 64:0 结算', () => {
    const board = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'B' as const));
    const game = new ReversiGame({
      id: 'reversi-full',
      level: 2,
      humanColor: 'W',
      timezone: 'Asia/Shanghai',
      start: { board, turn: 'human' },
    });
    expect(game.currentPhase).toBe('ended');
    expect(game.score()).toEqual({ human: 0, model: 64 });
    expect(game.snapshot().winner).toBe('model');
  });

  it('某一方被清空（盘面还没下满）也立刻结算，并按 64:0 记分', () => {
    const board = Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => (row === 0 && col === 0 ? null : ('B' as const))),
    );
    const game = new ReversiGame({
      id: 'reversi-wipe',
      level: 2,
      humanColor: 'W',
      timezone: 'Asia/Shanghai',
      start: { board, turn: 'human' },
    });
    expect(game.currentPhase).toBe('ended');
    expect(game.score()).toEqual({ human: 0, model: 64 });
    expect(game.snapshot().winner).toBe('model');
  });
});
