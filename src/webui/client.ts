/**
 * 闲弈 的面板。
 *
 * 三个游戏各自是一个 World 面板 —— 在 WebUI 里就是三个与「配置」同级的页签。
 * 每个面板自己管理四块画面：主界面（标题 / 简介 / 开始 / 对局历史）、游戏页、
 * 结束页（复盘收尾）、对局历史列表。切页签只卸载面板，局面留在 World 里。
 */
import type {
  WebUi,
  WebUiClientBundle,
  WebUiPanelContext,
} from 'cortico/web/shared/client-panel.ts';
import type { DrawPanelPayload, DrawPanelSnapshot, DrawVisionMode } from '../drawguess.ts';
import type { HistoryEntry } from '../history.ts';
import type { MysterySnapshot } from '../mystery.ts';
import type { ReversiPanelSnapshot, ReversiPayload, ReversiReplayView } from '../reversi-game.ts';
import type { Profile, TrustPanelPayload, TrustSnapshot } from '../trust.ts';

type Text = (zh: string, en: string) => string;

interface Disposable {
  dispose(): void;
}

interface Home {
  game: string;
  phase: string;
  total: number;
}

interface HistoryPage {
  game: string;
  page: number;
  pages: number;
  total: number;
  size: number;
  entries: HistoryEntry[];
}

const FADE_IN = [
  { opacity: 0, transform: 'translateY(10px)' },
  { opacity: 1, transform: 'translateY(0)' },
];

function fadeIn(el: HTMLElement): void {
  try {
    el.animate(FADE_IN, { duration: 280, easing: 'ease-out' });
  } catch {
    // 老浏览器没有 Web Animations API，直接出现就好。
  }
}

function clock(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { hour12: false });
}

// 按钮音效：浏览器不需要任何音频文件，点一下合成一个很短的「嘟」。
// AudioContext 必须在用户手势里创建/恢复，所以懒初始化；浏览器不给就静音。
let audio: AudioContext | null = null;

function playClick(): void {
  try {
    const ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctor) return;
    audio ??= new ctor();
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {
    // 没有音频设备、被自动播放策略拦住，都只是没声音，按钮照常工作。
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickText(ctx: WebUiPanelContext): Text {
  const zh = ctx.language.startsWith('zh');
  return (a, b) => (zh ? a : b);
}

function bigButton(ui: WebUi, label: string, variant: 'plain' | 'primary', onClick: () => void): HTMLButtonElement {
  const button = ui.button(label, { variant, size: 'md', onClick });
  button.style.minHeight = '44px';
  button.style.padding = '0 22px';
  button.style.fontSize = '15px';
  button.style.fontWeight = '600';
  return button;
}

function spacer(px: number): HTMLDivElement {
  const el = document.createElement('div');
  el.style.height = `${px}px`;
  return el;
}

type View = 'main' | 'play' | 'end';

interface Scaffold {
  root: HTMLDivElement;
  main: HTMLElement;
  play: HTMLElement;
  end: HTMLElement;
  primary: HTMLButtonElement;
  /** 主界面那排按钮（主按钮 + 额外按钮 + 对局历史），额外的开始按钮插在历史按钮前面。 */
  actions: HTMLElement;
  historyToggle: HTMLButtonElement;
  historyBox: HTMLElement;
  historyBody: HTMLElement;
  historyNote: HTMLElement;
  endTitle: HTMLElement;
  endDetail: HTMLElement;
  endClosing: HTMLElement;
  show(view: View): void;
  setPrimary(label: string): void;
  setProgress(line: string): void;
  setEnd(title: string, closing: string | null, text: Text, detail?: string | null): void;
  setEndAnswer(line: string | null): void;
}

function buildScaffold(
  ctx: WebUiPanelContext,
  opts: {
    title: string;
    intro: readonly string[];
    primaryLabel: string;
    onPrimary(): void;
    onHistory(): void;
    onBack(): void;
    /** 有棋谱的条目会多一个「复盘」按钮；不传就不显示。 */
    onReplay?(entry: HistoryEntry): void;
    text: Text;
  },
): Scaffold {
  const ui = ctx.ui;
  // null 表示「还没有画过任何一块」：挂载后第一次 show() 一定算「切换」，
  // 于是切页签（Cortico 会卸载再挂载面板）时能正好播一次渐入。
  let view: View | null = null;

  const root = ui.h('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.padding = '6px 2px 2px';
  root.style.maxWidth = '640px';

  const main = ui.h('section');
  main.setAttribute('data-view', 'main');
  main.style.display = 'flex';
  main.style.flexDirection = 'column';
  main.style.gap = '12px';

  const title = ui.h('h1', null, opts.title);
  title.style.margin = '0';
  title.style.fontSize = '22px';
  title.style.fontWeight = '800';
  title.style.letterSpacing = '0.01em';

  const intro = ui.h('div');
  intro.style.display = 'flex';
  intro.style.flexDirection = 'column';
  intro.style.gap = '6px';
  for (const line of opts.intro) {
    const p = ui.h('p', 'muted', line);
    p.style.margin = '0';
    p.style.lineHeight = '1.6';
    intro.append(p);
  }

  const primary = bigButton(ui, opts.primaryLabel, 'primary', opts.onPrimary);
  const historyToggle = bigButton(ui, opts.text('对局历史', 'History'), 'plain', opts.onHistory);
  const buttons = ui.h('div');
  buttons.style.display = 'flex';
  buttons.style.gap = '10px';
  buttons.style.flexWrap = 'wrap';
  buttons.style.marginTop = '4px';
  buttons.append(primary, historyToggle);

  const historyBox = ui.h('div');
  historyBox.hidden = true;
  historyBox.style.borderTop = '1px solid rgba(127,127,127,0.25)';
  historyBox.style.paddingTop = '10px';
  historyBox.style.display = 'flex';
  historyBox.style.flexDirection = 'column';
  historyBox.style.gap = '8px';

  const historyBar = ui.rowbar();
  historyBar.style.display = 'flex';
  historyBar.style.alignItems = 'center';
  historyBar.style.gap = '8px';
  const historyNote = ui.msgline('');
  historyBar.append(historyNote);

  const historyBody = ui.h('div');
  historyBody.style.display = 'flex';
  historyBody.style.flexDirection = 'column';
  historyBody.style.gap = '6px';
  historyBox.append(historyBar, historyBody);

  const progressLine = ui.h('p', 'muted');
  progressLine.style.margin = '0';
  progressLine.style.lineHeight = '1.6';

  main.append(title, intro, progressLine, spacer(24), buttons, historyBox);

  const play = ui.h('section');
  play.setAttribute('data-view', 'play');
  play.hidden = true;

  const endView = ui.h('section');
  endView.setAttribute('data-view', 'end');
  endView.hidden = true;
  endView.style.display = 'flex';
  endView.style.flexDirection = 'column';
  endView.style.gap = '10px';

  const endTitle = ui.h('h1');
  endTitle.style.margin = '4px 0 0';
  endTitle.style.fontSize = '26px';
  endTitle.style.fontWeight = '800';

  const endDetail = ui.h('p', 'muted');
  endDetail.style.margin = '0';
  endDetail.style.fontSize = '14px';
  endDetail.style.fontWeight = '600';

  // 谜底（推理游戏的真相）：在「复盘收尾」上面单独一行。
  const endAnswer = ui.h('p');
  endAnswer.style.margin = '0';
  endAnswer.style.lineHeight = '1.7';
  endAnswer.style.whiteSpace = 'pre-wrap';
  endAnswer.hidden = true;

  const endHeading = ui.h('h2', null, opts.text('复盘收尾', 'Wrap-up'));
  endHeading.style.margin = '0';
  endHeading.style.fontSize = '16px';
  endHeading.style.fontWeight = '700';

  const endClosing = ui.h('p');
  endClosing.style.margin = '0';
  endClosing.style.lineHeight = '1.75';
  endClosing.style.whiteSpace = 'pre-wrap';

  const endHint = ui.h('p', 'muted', opts.text('对局详情已记录，可在【对局历史】中查看。', 'The game is saved — see it under “History”.'));
  endHint.style.margin = '0';

  const back = bigButton(ui, opts.text('返回主界面', 'Back'), 'primary', () => {
    opts.onBack();
    show('main');
  });
  back.style.alignSelf = 'flex-start';
  endView.append(endTitle, endDetail, endAnswer, spacer(8), endHeading, spacer(10), endClosing, spacer(12), endHint, spacer(6), back);

  root.append(main, play, endView);
  // 面板必须把自己的根节点挂到 ctx.root 上，否则页面一片空白。
  ctx.root.append(root);

  // 按钮音效：只在点了能点的按钮时响一声；浏览器不给音频就静音降级。
  // 用捕获阶段：按钮自己的 onClick 会立刻把自己 disable 掉（busy()），冒泡到 root 时已经不算「能点」了，
  // 那样「问」「猜」「合作/欺骗」这些按钮就没声了。
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLButtonElement && !target.disabled) playClick();
    },
    true,
  );

  const views: ReadonlyArray<readonly [View, HTMLElement]> = [
    ['main', main],
    ['play', play],
    ['end', endView],
  ];

  // hidden 属性会被内联的 display:flex 盖掉，所以两块一起改。
  function apply(next: View): void {
    for (const [key, el] of views) {
      const on = key === next;
      el.hidden = !on;
      el.style.display = on ? 'flex' : 'none';
    }
  }

  apply('main');

  function show(next: View): void {
    if (view === next) {
      // 同一个画面重复刷新时不重放动效，避免每 2.5 秒闪一下。
      return;
    }
    view = next;
    apply(next);
    fadeIn(next === 'main' ? main : next === 'play' ? play : endView);
  }

  return {
    root,
    main,
    play,
    end: endView,
    primary,
    actions: buttons,
    historyToggle,
    historyBox,
    historyBody,
    historyNote,
    endTitle,
    endDetail,
    endClosing,
    show,
    setPrimary(label: string) {
      primary.textContent = label;
    },
    setProgress(line: string) {
      progressLine.textContent = line;
    },
    setEnd(title: string, closing: string | null, text: Text, detail?: string | null) {
      endTitle.textContent = title;
      endDetail.textContent = detail?.trim() ? detail : '';
      endDetail.hidden = !detail?.trim();
      endClosing.textContent = closing?.trim() ? closing : text('伙伴正在复盘…', 'Your buddy is writing the wrap-up…');
    },
    setEndAnswer(line: string | null) {
      endAnswer.textContent = line?.trim() ? line : '';
      endAnswer.hidden = !line?.trim();
    },
  };
}

function renderHistory(
  scaffold: Scaffold,
  page: HistoryPage,
  text: Text,
  onPage: (page: number) => void,
  onReplay?: (entry: HistoryEntry) => void,
): void {
  const doc = scaffold.historyBody.ownerDocument;
  scaffold.historyNote.textContent =
    page.total === 0
      ? text('还没有对局记录。', 'No games yet.')
      : text(`第 ${page.page + 1} / ${page.pages} 页，共 ${page.total} 局`, `Page ${page.page + 1} / ${page.pages} · ${page.total} games`);

  const bar = scaffold.historyNote.parentElement as HTMLElement | null;
  if (bar) {
    bar.querySelectorAll('button').forEach((button) => button.remove());
    if (page.pages > 1) {
      const prev = doc.createElement('button');
      prev.className = 'btn sm';
      prev.textContent = text('‹ 上一页', '‹ Prev');
      prev.disabled = page.page <= 0;
      prev.addEventListener('click', () => onPage(page.page - 1));
      const next = doc.createElement('button');
      next.className = 'btn sm';
      next.textContent = text('下一页 ›', 'Next ›');
      next.disabled = page.page >= page.pages - 1;
      next.addEventListener('click', () => onPage(page.page + 1));
      bar.append(prev, next);
    }
  }

  scaffold.historyBody.replaceChildren();
  if (page.entries.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'muted';
    empty.style.margin = '0';
    empty.textContent = text('这一页还没有记录。', 'Nothing on this page.');
    scaffold.historyBody.append(empty);
    return;
  }

  for (const entry of page.entries) {
    const item = doc.createElement('div');
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.gap = '2px';
    item.style.padding = '8px 10px';
    item.style.border = '1px solid rgba(127,127,127,0.25)';
    item.style.borderRadius = '10px';

    const headline = doc.createElement('p');
    headline.style.margin = '0';
    headline.style.fontWeight = '700';
    headline.textContent = entry.headline;

    const time = doc.createElement('p');
    time.className = 'muted';
    time.style.margin = '0';
    time.style.fontSize = '12px';
    time.textContent = `${clock(entry.at)} → ${clock(entry.endedAt)}`;

    const summary = doc.createElement('p');
    summary.style.margin = '0';
    summary.style.lineHeight = '1.7';
    summary.textContent = entry.summary?.trim() ? entry.summary : text('伙伴正在复盘…', 'Wrap-up pending…');

    item.append(headline, time, summary);
    for (const line of entry.lines) {
      const detail = doc.createElement('p');
      detail.className = 'muted';
      detail.style.margin = '0';
      detail.style.fontSize = '12px';
      detail.textContent = `· ${line}`;
      item.append(detail);
    }
    if (entry.replay && onReplay) {
      const replayButton = doc.createElement('button');
      replayButton.className = 'btn sm';
      replayButton.textContent = text('复盘', 'Replay');
      replayButton.style.alignSelf = 'flex-start';
      replayButton.style.marginTop = '4px';
      replayButton.addEventListener('click', () => onReplay(entry));
      item.append(replayButton);
    }
    scaffold.historyBody.append(item);
  }
}

interface WireOptions {
  scaffold: Scaffold;
  ctx: WebUiPanelContext;
  text: Text;
  game: string;
  phase(): string;
  render(): void;
  sync(): Promise<void>;
  onReplay?(entry: HistoryEntry): void;
}

/** 三个面板共用的「主界面 / 对局历史 / 轮询」接线。 */
function wire(options: WireOptions): Disposable {
  const { scaffold, ctx, text } = options;
  let historyPage = 0;
  let historyLoaded = false;

  const loadHistory = async (page: number): Promise<void> => {
    try {
      const result = await ctx.invoke<HistoryPage>('history', [page]);
      historyPage = result.page;
      renderHistory(scaffold, result, text, (next) => void loadHistory(next), options.onReplay);
    } catch (error) {
      ctx.ui.toast(errorText(error), 'bad');
    }
  };

  scaffold.historyToggle.addEventListener('click', () => {
    scaffold.historyBox.hidden = !scaffold.historyBox.hidden;
    if (!scaffold.historyBox.hidden) {
      void loadHistory(historyLoaded ? historyPage : 0);
      historyLoaded = true;
    }
  });

  const interval = ctx.interval(() => {
    if (typing(ctx)) return;
    void options.sync().catch((error: unknown) => {
      // 轮询失败静默：WebUI 正在重启时会短暂拉不到，下一次就好。
      void error;
    });
  }, 2500);

  void options.sync().catch((error: unknown) => ctx.ui.toast(errorText(error), 'bad'));

  return interval;
}

function typing(ctx: WebUiPanelContext): boolean {
  const active = ctx.root.ownerDocument.activeElement;
  return (
    active instanceof HTMLInputElement &&
    active.value.length > 0 &&
    ctx.root.contains(active)
  );
}

async function busy(ctx: WebUiPanelContext, button: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  const guard = ctx.ui.disable(button);
  try {
    await fn();
  } catch (error) {
    ctx.ui.toast(errorText(error), 'bad');
  } finally {
    guard.dispose();
  }
}

// ---------------------------------------------------------------- 推理游戏

// ------------------------------------------------------------- 推理游戏

type GameKey = 'mystery' | 'trust' | 'drawguess' | 'reversi';

/** 主界面上那行进度摘要（0、1、2 三条需求里的「主界面显示进度」）。 */
function progressLine(text: Text, home: Home): string {
  if (home.phase === 'playing' || home.phase === 'drawing' || home.phase === 'guessing') {
    return text(`第 ${Math.max(1, home.total)} 局进行中`, `Game ${Math.max(1, home.total)} in progress`);
  }
  if (home.phase === 'ended') {
    return text(`刚结束一局，已记录 ${home.total} 局`, `Last game finished — ${home.total} recorded`);
  }
  return home.total > 0
    ? text(`这台机器上已玩 ${home.total} 局`, `${home.total} games played here`)
    : text('还没玩过，点下面开始。', 'Nothing played yet — start below.');
}

/** 结束页标题按游戏分开，别都用「赢了 / 结束」。 */
function endTitleFor(text: Text, game: GameKey, outcome: 'win' | 'lose' | 'draw'): string {
  if (game === 'mystery') {
    return outcome === 'win' ? text('猜中了！', 'Solved it!') : text('真相揭晓', 'Revealed');
  }
  if (game === 'trust') {
    if (outcome === 'win') return text('赢了！', 'You win!');
    if (outcome === 'lose') return text('输了…', 'You lose…');
    return text('平局！', 'A draw!');
  }
  if (game === 'reversi') {
    if (outcome === 'win') return text('赢了！', 'You win!');
    if (outcome === 'lose') return text('输了…', 'You lose…');
    return text('平局！', 'A draw!');
  }
  return outcome === 'win' ? text('猜中了！', 'Guessed it!') : text('没猜中…', 'Not this time…');
}

/** 收起过的结束页存在浏览器里：切页签会重新 mount，只记在内存里会被忘掉。 */
const DISMISS_PREFIX = 'goodluckhavefun.dismissed.';

function readDismissed(game: string): string | null {
  try {
    return window.localStorage.getItem(DISMISS_PREFIX + game);
  } catch {
    return null;
  }
}

function writeDismissed(game: string, key: string | null): void {
  try {
    if (key === null) window.localStorage.removeItem(DISMISS_PREFIX + game);
    else window.localStorage.setItem(DISMISS_PREFIX + game, key);
  } catch {
    // 存不了就退化成只在这一次 mount 里收起，不影响玩。
  }
}

function mountMystery(ctx: WebUiPanelContext): Disposable {
  const ui = ctx.ui;
  const text = pickText(ctx);
  let phase = 'idle';
  let snapshot: MysterySnapshot | null = null;
  /** 已经按「返回主界面」收起过的结束页；同一个 round 不再弹出来。 */
  let dismissed: string | null = readDismissed('mystery');

  const scaffold = buildScaffold(ctx, {
    title: text('推理游戏', 'Mystery'),
    intro: [
      text('伙伴抽三个标签，现编一道推理题。', 'Your partner draws three tags and writes a puzzle on the spot.'),
      text('你一句一句地问，伙伴回：是 / 不是 / 无关 / 问过了。', 'Ask one question at a time; answers are yes / no / irrelevant / already asked.'),
      text('猜中了，或者你点「查看真相」，这一局就结束。', 'Guess it, or press “Reveal” to end the round.'),
    ],
    primaryLabel: text('开始游戏', 'Start'),
    onPrimary: () => {
      if (phase === 'idle' || phase === 'ended') void start();
      else scaffold.show('play');
    },
    onHistory: () => undefined,
    onBack: () => {
      dismissed = snapshot?.round?.id ?? null;
      writeDismissed('mystery', dismissed);
    },
    text,
  });

  let state: MysterySnapshot | null = null;

  const tags = ui.h('p', 'muted');
  tags.style.margin = '0';
  const title = ui.h('h2');
  title.style.margin = '0';
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  const surface = ui.h('p');
  surface.style.margin = '0';
  surface.style.lineHeight = '1.7';
  surface.style.whiteSpace = 'pre-wrap';
  const drawingNote = ui.msgline(text('伙伴正在出题…', 'Your partner is writing the puzzle…'));
  const questions = ui.h('div');
  questions.style.display = 'flex';
  questions.style.flexDirection = 'column';
  questions.style.gap = '4px';
  const note = ui.h('p', 'muted');
  note.style.margin = '0';
  const askInput = ui.input({
    placeholder: text('问一句（≤50 字）', 'Ask something (≤50 chars)'),
    onCommit: () => void ask(),
  });
  askInput.maxLength = 50;
  askInput.style.flex = '1';
  const askButton = ui.button(text('问', 'Ask'), { variant: 'primary', size: 'md', onClick: () => void ask() });
  const revealButton = ui.button(text('查看真相', 'Reveal'), { variant: 'plain', size: 'md', onClick: () => void reveal() });
  const askRow = ui.h('div');
  askRow.style.display = 'flex';
  askRow.style.gap = '8px';
  askRow.append(askInput, askButton);
  const actionsRow = ui.h('div');
  actionsRow.style.display = 'flex';
  actionsRow.style.gap = '8px';
  actionsRow.append(revealButton);

  const play = ui.h('div');
  play.style.display = 'flex';
  play.style.flexDirection = 'column';
  play.style.gap = '10px';
  play.append(tags, title, surface, drawingNote, questions, note, askRow, actionsRow);
  scaffold.play.append(play);

  async function start(): Promise<void> {
    dismissed = null;
    writeDismissed('mystery', null);
    await busy(ctx, scaffold.primary, async () => {
      await ctx.invoke('start');
      await refresh();
    });
  }

  async function ask(): Promise<void> {
    const value = askInput.value.trim();
    if (!value) return;
    await busy(ctx, askButton, async () => {
      const result = await ctx.invoke<MysterySnapshot>('ask', [value]);
      snapshot = result;
      askInput.value = '';
      render(result);
    });
  }

  async function reveal(): Promise<void> {
    const ok = await ui.confirm({
      title: text('查看真相？', 'Reveal the answer?'),
      body: text('揭晓后这一局就结束了，剩下没问的问题也不会再有答案。', 'This ends the round — remaining questions stay unanswered.'),
      danger: true,
    });
    if (!ok) return;
    await busy(ctx, revealButton, async () => {
      await ctx.invoke('reveal');
      await refresh();
    });
  }

  function render(value: MysterySnapshot): void {
    const round = value.round;
    if (!round) {
      tags.textContent = '';
      title.textContent = '';
      surface.textContent = '';
      questions.replaceChildren();
      note.textContent = '';
      askRow.hidden = true;
      actionsRow.hidden = true;
      drawingNote.hidden = false;
      return;
    }
    tags.textContent = round.tagsLabel;
    title.textContent = round.title;
    surface.textContent = round.surface;
    drawingNote.hidden = Boolean(round.title);
    askRow.hidden = round.phase !== 'ready';
    actionsRow.hidden = round.phase !== 'ready';
    note.textContent = text(
      `已问 ${round.questions.length} / ${round.maxQuestions} 个问题`,
      `${round.questions.length} / ${round.maxQuestions} questions asked`,
    );
    questions.replaceChildren();
    for (const item of round.questions.slice(-14)) {
      const row = ui.h('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'baseline';
      // 整行淡一点：问题列表是回顾用的，不该抢谜面的注意力。
      row.style.opacity = '0.72';
      row.append(
        ui.h('span', 'mono', item.id.toUpperCase()),
        ui.h('span', null, item.text),
        ui.pill(
          item.verdictLabel ?? text('待判', 'pending'),
          item.verdict === 'yes' ? 'on' : item.verdict === 'no' ? 'off' : 'plain',
        ),
      );
      questions.append(row);
    }
  }

  async function refresh(): Promise<void> {
    const home = await ctx.invoke<Home>('home');
    const value = await ctx.invoke<MysterySnapshot>('state');
    snapshot = value;
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (home.phase === 'idle') {
      scaffold.show('main');
      scaffold.setPrimary(text('开始游戏', 'Start'));
      return;
    }
    if (home.phase === 'ended') {
      const key = value.round?.id ?? null;
      if (key !== null && dismissed === key) {
        // 你已经点过「返回主界面」，别再把他推回结束页。
        scaffold.show('main');
        scaffold.setPrimary(text('开始新一局', 'New game'));
        return;
      }
      scaffold.setEnd(
        endTitleFor(text, 'mystery', value.round?.guessed ? 'win' : 'lose'),
        value.round?.closing ?? null,
        text,
      );
      scaffold.setEndAnswer(
        value.round?.answer ? text(`真相：${value.round.answer}`, `The truth: ${value.round.answer}`) : null,
      );
      scaffold.show('end');
      return;
    }
    scaffold.setEndAnswer(null);
    scaffold.setPrimary(text('继续游戏', 'Continue'));
    scaffold.show('play');
    render(value);
  }

  const interval = wire({
    scaffold,
    ctx,
    text,
    game: 'mystery',
    phase: () => phase,
    render: () => {
      if (state) render(state);
    },
    sync: refresh,
  });
  void refresh().catch((error: unknown) => ctx.ui.toast(errorText(error), 'bad'));

  return {
    dispose() {
      interval.dispose();
    },
  };
}

// ------------------------------------------------------------ 信任的进化

function mountTrust(ctx: WebUiPanelContext): Disposable {
  const ui = ctx.ui;
  const text = pickText(ctx);
  let phase = 'idle';
  let snapshot: TrustSnapshot | null = null;
  /** 已经按「返回主界面」收起过的结束页；同一局不再弹出来。 */
  let dismissed: string | null = readDismissed('trust');

  const scaffold = buildScaffold(ctx, {
    title: text('信任的进化', 'Evolution of Trust'),
    intro: [
      text('十二个回合，每回合先各说一句，再各选合作或欺骗。', 'Twelve rounds: say one line each, then both pick cooperate or deceive.'),
      text('都合作各 +1；一骗一合，骗的 +2；都骗各 -1。先到 7 分胜。', 'Both cooperate +1 each; deceive vs cooperate +2 / 0; both deceive -1 each. First to 7 wins.'),
      text('聊天和选择互不影响：你可以改口，也可以想好了直接选。', 'Chat and choice are independent: you can take back your line, or just pick.'),
    ],
    primaryLabel: text('开始游戏', 'Start'),
    onPrimary: () => {
      if (phase === 'idle' || phase === 'ended') void start();
      else scaffold.show('play');
    },
    onHistory: () => undefined,
    onBack: () => {
      dismissed = snapshot?.matchId != null ? String(snapshot.matchId) : null;
      writeDismissed('trust', dismissed);
    },
    text,
  });

  const score = ui.h('h2');
  score.style.margin = '0';
  const roundLine = ui.h('p', 'muted');
  roundLine.style.margin = '0';
  const sayAgent = ui.h('p', 'muted');
  sayAgent.style.margin = '0';
  const sayHuman = ui.h('p', 'muted');
  sayHuman.style.margin = '0';
  const chatInput = ui.input({
    placeholder: text('说一句（≤60 字）', 'Say one line (≤60 chars)'),
    onCommit: () => void say(),
  });
  chatInput.maxLength = 60;
  chatInput.style.flex = '1';
  const chatButton = ui.button(text('说这句', 'Say'), { variant: 'plain', size: 'md', onClick: () => void say() });
  const chatRow = ui.h('div');
  chatRow.style.display = 'flex';
  chatRow.style.gap = '8px';
  chatRow.append(chatInput, chatButton);
  const choiceNote = ui.msgline('');
  const cooperate = ui.button(text('合作', 'Cooperate'), { variant: 'primary', size: 'md', onClick: () => void choose('cooperate') });
  const deceive = ui.button(text('欺骗', 'Deceive'), { variant: 'danger', size: 'md', onClick: () => void choose('deceive') });
  const chooseRow = ui.h('div');
  chooseRow.style.display = 'flex';
  chooseRow.style.gap = '8px';
  chooseRow.append(cooperate, deceive);
  const revealBox = ui.h('div');
  revealBox.style.display = 'flex';
  revealBox.style.flexDirection = 'column';
  revealBox.style.gap = '4px';
  const roundsBox = ui.h('div');
  roundsBox.style.display = 'flex';
  roundsBox.style.flexDirection = 'column';
  roundsBox.style.gap = '2px';

  const play = ui.h('div');
  play.style.display = 'flex';
  play.style.flexDirection = 'column';
  play.style.gap = '10px';
  play.append(score, roundLine, sayAgent, sayHuman, chatRow, choiceNote, chooseRow, revealBox, roundsBox);
  scaffold.play.append(play);

  const profilesMain = ui.h('p', 'muted');
  profilesMain.style.margin = '0';
  profilesMain.style.lineHeight = '1.6';
  profilesMain.style.whiteSpace = 'pre-line';
  scaffold.main.append(profilesMain);
  const profilesPlay = ui.h('p', 'muted');
  profilesPlay.style.margin = '0';
  profilesPlay.style.lineHeight = '1.6';
  profilesPlay.style.whiteSpace = 'pre-line';
  play.append(profilesPlay);

  function profileText(profile: Profile): string {
    const entries = profile.entries
      .filter((item) => item.score > 0)
      .slice()
      .sort((a, b) => b.score - a.score);
    const sum = entries.reduce((total, item) => total + item.score, 0);
    if (entries.length === 0 || sum === 0) return text('还没攒够历史', 'not enough history yet');
    return entries
      .slice(0, 2)
      .map((item) => `${item.label} ${Math.round((item.score / sum) * 100)}%`)
      .join(' · ');
  }

  function renderProfiles(profiles: { agent: Profile; human: Profile }): void {
    // 只列前两项，用百分比表示；你与伙伴分行写。
    const line = text(
      `画像（${profiles.human.samples} 回合）\n你：${profileText(profiles.human)}\nAI：${profileText(profiles.agent)}`,
      `Profiles (${profiles.human.samples} rounds)\nYou: ${profileText(profiles.human)}\nAI: ${profileText(profiles.agent)}`,
    );
    profilesMain.textContent = line;
    profilesPlay.textContent = line;
  }

  let lastReveal = -1;

  async function start(): Promise<void> {
    dismissed = null;
    writeDismissed('trust', null);
    await busy(ctx, scaffold.primary, async () => {
      await ctx.invoke('start');
      await refresh();
    });
  }

  async function say(): Promise<void> {
    const value = chatInput.value.trim();
    if (!value) return;
    await busy(ctx, chatButton, async () => {
      await ctx.invoke('say', [value]);
      chatInput.value = '';
      await refresh();
    });
  }

  async function choose(choice: 'cooperate' | 'deceive'): Promise<void> {
    await busy(ctx, choice === 'cooperate' ? cooperate : deceive, async () => {
      await ctx.invoke('choose', [choice]);
      await refresh();
    });
  }

  function render(value: TrustSnapshot): void {
    score.textContent = text(
      `你 ${value.humanScore} : ${value.agentScore} 伙伴`,
      `You ${value.humanScore} : ${value.agentScore} Partner`,
    );
    roundLine.textContent = text(
      `第 ${value.round} / ${value.maxRounds} 回合 · 先到 ${value.targetScore} 分`,
      `Round ${value.round} / ${value.maxRounds} · first to ${value.targetScore}`,
    );
    sayAgent.textContent = value.say.agent ? `${text('伙伴', 'Partner')}：${value.say.agent}` : '';
    sayHuman.textContent = value.say.human ? `${text('你', 'You')}：${value.say.human}` : '';
    const playing = value.phase === 'playing';
    chatRow.hidden = !playing;
    chooseRow.hidden = !playing;
    const chose = Boolean(value.choice.human);
    cooperate.disabled = !playing || chose || false;
    deceive.disabled = !playing || chose || false;
    choiceNote.hidden = !playing;
    if (!playing) {
      choiceNote.textContent = '';
    } else if (chose) {
      choiceNote.textContent = text(`已选：${value.choice.human === 'cooperate' ? '合作' : '欺骗'} · 等待揭晓…`, 'Picked — waiting for the reveal…');
    } else if (value.choice.agent) {
      choiceNote.textContent = text('伙伴已经选了，轮到你了。', 'Your partner has picked — your turn.');
    } else {
      choiceNote.textContent = text('说话不影响选择：想好了就点合作或欺骗。', 'Chat does not lock your choice — pick when ready.');
    }

    const latest = value.rounds[value.rounds.length - 1];
    revealBox.replaceChildren();
    if (latest) {
      const head = ui.h('div');
      head.style.display = 'flex';
      head.style.gap = '8px';
      head.style.alignItems = 'center';
      head.append(
        ui.h('strong', null, text(`揭示 #${latest.index}`, `Reveal #${latest.index}`)),
        ui.pill(clock(latest.at)),
      );
      const deltas = ui.h('p');
      deltas.style.margin = '0';
      deltas.textContent = text(
        `你 ${latest.human === 'cooperate' ? '合作' : '欺骗'} · 伙伴 ${latest.agent === 'cooperate' ? '合作' : '欺骗'}  →  你 ${latest.humanDelta >= 0 ? '+' : ''}${latest.humanDelta} / 伙伴 ${latest.agentDelta >= 0 ? '+' : ''}${latest.agentDelta}`,
        `You ${latest.human} · Partner ${latest.agent} → you ${latest.humanDelta >= 0 ? '+' : ''}${latest.humanDelta} / Partner ${latest.agentDelta >= 0 ? '+' : ''}${latest.agentDelta}`,
      );
      revealBox.append(head, deltas);
      if (latest.index !== lastReveal) {
        lastReveal = latest.index;
        fadeIn(revealBox);
      }
    }

    roundsBox.replaceChildren();
    for (const item of value.rounds.slice(-6).reverse()) {
      const row = ui.h('p', 'muted');
      row.style.margin = '0';
      row.textContent = `${item.index}. ${text('你', 'you')} ${item.human === 'cooperate' ? text('合作', 'C') : text('欺骗', 'D')} · ${text('伙伴', 'Partner')} ${item.agent === 'cooperate' ? text('合作', 'C') : text('欺骗', 'D')} → ${item.humanDelta >= 0 ? '+' : ''}${item.humanDelta} / ${item.agentDelta >= 0 ? '+' : ''}${item.agentDelta}`;
      roundsBox.append(row);
    }
  }

  async function refresh(): Promise<void> {
    const home = await ctx.invoke<Home>('home');
    const payload = await ctx.invoke<TrustPanelPayload>('state');
    const value = payload.snapshot;
    snapshot = value;
    renderProfiles(payload.profiles);
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (home.phase === 'idle') {
      scaffold.show('main');
      scaffold.setPrimary(text('开始游戏', 'Start'));
      return;
    }
    if (home.phase === 'ended') {
      const key = value.matchId != null ? String(value.matchId) : null;
      if (key !== null && dismissed === key) {
        scaffold.show('main');
        scaffold.setPrimary(text('开始新一局', 'New game'));
        return;
      }
      scaffold.setEnd(
        endTitleFor(text, 'trust', value.winner === 'human' ? 'win' : value.winner === 'agent' ? 'lose' : 'draw'),
        value.closing,
        text,
        text(
          `你 ${value.humanScore} : ${value.agentScore} 伙伴 · 第 ${value.round} / ${value.maxRounds} 回合`,
          `You ${value.humanScore} : ${value.agentScore} Partner · Round ${value.round} / ${value.maxRounds}`,
        ),
      );
      scaffold.show('end');
      return;
    }
    scaffold.setPrimary(text('继续游戏', 'Continue'));
    scaffold.show('play');
    render(value);
  }

  const interval = wire({
    scaffold,
    ctx,
    text,
    game: 'trust',
    phase: () => phase,
    render: () => undefined,
    sync: refresh,
  });
  void refresh().catch((error: unknown) => ctx.ui.toast(errorText(error), 'bad'));

  return {
    dispose() {
      interval.dispose();
    },
  };
}

// ----------------------------------------------------------- 你画我猜

const DRAW_SPACE = 1000;

function paint(canvas: HTMLCanvasElement, strokes: DrawPanelSnapshot['attempts'][number]['strokes']): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#1b1b1b';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const scale = canvas.width / DRAW_SPACE;
  for (const stroke of strokes) {
    context.lineWidth = Math.max(0.8, stroke.width * scale);
    context.beginPath();
    stroke.points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x * scale, y * scale);
      else context.lineTo(x * scale, y * scale);
    });
    context.stroke();
  }
}

function mountDraw(ctx: WebUiPanelContext): Disposable {
  const ui = ctx.ui;
  const text = pickText(ctx);
  let phase = 'idle';
  let latest: DrawPanelSnapshot | null = null;
  let visionMode: DrawVisionMode = 'on';
  /** 已经按「返回主界面」收起过的结束页；同一局不再弹出来。 */
  let dismissed: string | null = readDismissed('drawguess');

  const scaffold = buildScaffold(ctx, {
    title: text('你画我猜', 'Draw & Guess'),
    intro: [
      text('伙伴拿一个词，用折线把它画出来；每张画先让视觉模型盲评一次。', 'Your partner gets a word and draws it with polylines; every picture is blind-scored by a vision model.'),
      text('评到 2 分就算定稿；不到 2 分它会重画，预算按张数算。', 'Two points means done; otherwise it redraws, within a per-round budget.'),
      text('你来猜。猜错了它还能再画；预算用完再猜错，这一局就结束。', 'Then you guess. A wrong guess lets it redraw; once the budget is out, a wrong guess ends the round.'),
    ],
    primaryLabel: text('开始游戏·简单', 'Start · easy'),
    onPrimary: () => {
      if (phase === 'idle' || phase === 'ended') void start('easy', scaffold.primary);
      else scaffold.show('play');
    },
    onHistory: () => undefined,
    onBack: () => {
      dismissed = `draw:${latest?.round ?? 0}`;
      writeDismissed('drawguess', dismissed);
    },
    text,
  });

  // 简单与困难都是蓝底主按钮；困难插在「对局历史」前面。
  const hardStart = bigButton(ui, text('开始游戏·困难', 'Start · hard'), 'primary', () => {
    if (phase === 'idle' || phase === 'ended') void start('hard', hardStart);
    else scaffold.show('play');
  });
  scaffold.actions.insertBefore(hardStart, scaffold.historyToggle);

  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1000;
  canvas.style.width = '100%';
  canvas.style.maxWidth = '420px';
  canvas.style.aspectRatio = '1 / 1';
  canvas.style.borderRadius = '12px';
  canvas.style.border = '1px solid rgba(127,127,127,0.35)';
  canvas.style.background = '#fff';

  const note = ui.msgline('');
  const budget = ui.h('div');
  budget.style.display = 'flex';
  budget.style.gap = '6px';
  budget.style.flexWrap = 'wrap';
  const guessInput = ui.input({
    placeholder: text('猜一个词', 'Your guess'),
    onCommit: () => void guess(),
  });
  guessInput.maxLength = 20;
  guessInput.style.flex = '1';
  const guessButton = ui.button(text('猜', 'Guess'), { variant: 'primary', size: 'md', onClick: () => void guess() });
  const guessRow = ui.h('div');
  guessRow.style.display = 'flex';
  guessRow.style.gap = '8px';
  guessRow.append(guessInput, guessButton);
  const guesses = ui.h('div');
  guesses.style.display = 'flex';
  guesses.style.flexDirection = 'column';
  guesses.style.gap = '2px';
  const revealButton = ui.button(text('查看谜底', 'Reveal'), { variant: 'plain', size: 'md', onClick: () => void reveal() });

  const play = ui.h('div');
  play.style.display = 'flex';
  play.style.flexDirection = 'column';
  play.style.gap = '10px';
  play.append(canvas, note, budget, guessRow, guesses, revealButton);
  scaffold.play.append(play);

  const uploaded = new Set<string>();
  let uploading = false;

  async function start(tier: 'easy' | 'hard', button: HTMLButtonElement): Promise<void> {
    dismissed = null;
    writeDismissed('drawguess', null);
    await busy(ctx, button, async () => {
      await ctx.invoke('start', [tier]);
      await refresh();
    });
  }

  async function guess(): Promise<void> {
    const value = guessInput.value.trim();
    if (!value) return;
    await busy(ctx, guessButton, async () => {
      await ctx.invoke('guess', [value]);
      guessInput.value = '';
      await refresh();
    });
  }

  async function reveal(): Promise<void> {
    const ok = await ui.confirm({
      title: text('查看谜底？', 'Reveal the word?'),
      body: text('揭晓后这一局就结束了。', 'This ends the round.'),
      danger: true,
    });
    if (!ok) return;
    await busy(ctx, revealButton, async () => {
      await ctx.invoke('reveal');
      await refresh();
    });
  }

  async function upload(value: DrawPanelSnapshot): Promise<void> {
    if (uploading) return;
    const target = value.attempts.find((item) => !item.hasPng && !uploaded.has(item.id));
    if (!target) return;
    uploading = true;
    try {
      paint(canvas, target.strokes);
      const dataUrl = canvas.toDataURL('image/png');
      uploaded.add(target.id);
      await ctx.invoke('art', [target.id, dataUrl]);
    } catch (error) {
      uploaded.delete(target.id);
      ctx.ui.toast(errorText(error), 'bad');
    } finally {
      uploading = false;
    }
  }

  function render(value: DrawPanelSnapshot): void {
    const last = value.attempts[value.attempts.length - 1];
    if (last) {
      paint(canvas, last.strokes);
    } else {
      // 新的一局、还没有任何一张画：把上一局留在画板上的线条擦掉。
      const context = canvas.getContext('2d');
      if (context) context.clearRect(0, 0, DRAW_SPACE, DRAW_SPACE);
    }
    if (visionMode === 'unavailable') {
      note.hidden = false;
      note.textContent = text(
        '辅助视觉连续失败，已降级为主模型自己判断。',
        'Vision checks failed twice — falling back to the main model.',
      );
    } else if (visionMode === 'off') {
      note.hidden = false;
      note.textContent = text(
        '辅助视觉已关闭，由主模型自己判断（可能会偷懒）。',
        'Vision is off — the main model judges its own drawing (it may slack off).',
      );
    } else {
      note.hidden = phase !== 'drawing';
      note.textContent = text('伙伴正在画…', 'Your partner is drawing…');
    }
    budget.replaceChildren();
    if (value.attempts.length > 0) {
      budget.append(ui.pill(text(`画图 ${value.attempts.length} / ${value.maxChecks}`, `Drawings ${value.attempts.length} / ${value.maxChecks}`)));
      value.attempts.forEach((item, index) => {
        const score = item.points === null ? '…' : `${item.points}/3`;
        const label = text(`第 ${index + 1} 张 ${score}`, `#${index + 1} ${score}`);
        const chip = ui.pill(label, item.points === null ? 'plain' : item.points >= 2 ? 'on' : 'off');
        chip.title = text('这张画的盲评得分（满分 3，2 分即定稿）', 'Blind score for this drawing (max 3; 2 locks it in)');
        budget.append(chip);
      });
    }
    guessRow.hidden = value.phase !== 'guessing';
    revealButton.hidden = value.phase === 'idle' || value.phase === 'ended';
    guesses.replaceChildren();
    for (const item of value.guesses) {
      const row = ui.h('p', 'muted');
      row.style.margin = '0';
      row.textContent = `${item.correct ? '✓' : '✗'} ${item.text}`;
      guesses.append(row);
    }
  }

  async function refresh(): Promise<void> {
    const home = await ctx.invoke<Home>('home');
    const payload = await ctx.invoke<DrawPanelPayload>('state');
    const value = payload.snapshot;
    latest = value;
    visionMode = payload.vision;
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (home.phase === 'idle') {
      scaffold.show('main');
      scaffold.setPrimary(text('开始游戏·简单', 'Start · easy'));
      return;
    }
    if (home.phase === 'ended') {
      const key = `draw:${value.round}`;
      if (dismissed === key) {
        scaffold.show('main');
        scaffold.setPrimary(text('开始游戏·简单', 'Start · easy'));
        return;
      }
      scaffold.setEnd(
        endTitleFor(text, 'drawguess', value.guessed ? 'win' : 'lose'),
        value.closing,
        text,
      );
      scaffold.show('end');
      return;
    }
    scaffold.setPrimary(text('继续游戏', 'Continue'));
    scaffold.show('play');
    render(value);
    await upload(value);
  }

  const interval = wire({
    scaffold,
    ctx,
    text,
    game: 'drawguess',
    phase: () => phase,
    render: () => {
      if (latest) render(latest);
    },
    sync: refresh,
  });
  void refresh().catch((error: unknown) => ctx.ui.toast(errorText(error), 'bad'));

  return {
    dispose() {
      interval.dispose();
    },
  };
}


// ------------------------------------------------------------------ 黑白棋

const REVERSI_FILES = 'abcdefgh';

const REVERSI_LEVELS: ReadonlyArray<{ value: number; zh: string; en: string }> = [
  { value: 1, zh: '伙伴自己来', en: 'Partner solo' },
  { value: 2, zh: '伙伴看提示', en: 'Partner with hints' },
  { value: 3, zh: '伙伴不留情', en: 'Partner unleashed' },
];

function levelLabel(text: Text, level: number): string {
  const item = REVERSI_LEVELS.find((entry) => entry.value === level) ?? REVERSI_LEVELS[1]!;
  return text(item.zh, item.en);
}

function levelHint(text: Text, level: number): string {
  if (level === 1) {
    return text('只给可落点，伙伴自己算。', 'Only the legal moves — your partner works it out.');
  }
  if (level === 3) {
    return text('每个可落点都附三层搜索的参考分。', 'Every legal move comes with a 3-ply search score.');
  }
  return text('每个可落点都附贪心参考分，但只是参考。', 'Every legal move comes with a greedy score — a hint, not an order.');
}

function mountReversi(ctx: WebUiPanelContext): Disposable {
  const ui = ctx.ui;
  const text = pickText(ctx);
  const doc = ctx.root.ownerDocument;
  let phase = 'idle';
  let snapshot: ReversiPanelSnapshot | null = null;
  let replay: ReversiReplayView | null = null;
  let dismissed: string | null = readDismissed('reversi');
  let level = 2;

  const scaffold = buildScaffold(ctx, {
    title: text('黑白棋', 'Reversi'),
    intro: [
      text('8×8 标准盘，黑先；先后手每局随机。', 'Standard 8×8 board, black moves first; the first move is randomised each game.'),
      text('伙伴自己算棋，World 只校验落点；它想太久会暂停，等你点「继续」。', 'Your partner picks the moves and the world only checks them. If it thinks too long the game pauses until you continue.'),
      text('每局可以悔棋两次，也可以随时认输。', 'Two undos per game; you can resign at any time.'),
    ],
    primaryLabel: text('开始游戏', 'Start'),
    onPrimary: () => {
      if (phase === 'idle' || phase === 'ended') void start();
      else scaffold.show('play');
    },
    onHistory: () => undefined,
    onReplay: (entry) => {
      void openReplay(entry.id);
    },
    onBack: () => {
      dismissed = snapshot?.createdAt ?? null;
      writeDismissed('reversi', dismissed);
      // 结束页收起后马上回主界面：难度要立刻能用，不必等下一次轮询。
      syncLevelControl(false);
    },
    text,
  });

  // 难度滑块：开局前可改，开局后锁住。
  const levelRow = doc.createElement('div');
  levelRow.style.display = 'flex';
  levelRow.style.alignItems = 'center';
  levelRow.style.gap = '10px';
  const levelTitle = ui.h('span', 'muted', text('难度', 'Level'));
  const slider = doc.createElement('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '3';
  slider.step = '1';
  slider.value = String(level);
  slider.style.flex = '1';
  slider.style.minWidth = '120px';
  const levelValue = ui.h('span', 'mono', levelLabel(text, level));
  levelRow.append(levelTitle, slider, levelValue);
  const hint = ui.h('p', 'muted', levelHint(text, level));
  hint.style.margin = '0';
  hint.style.fontSize = '12px';
  scaffold.main.insertBefore(levelRow, scaffold.actions);
  scaffold.main.insertBefore(hint, scaffold.actions);

  slider.addEventListener('input', () => {
    level = Number(slider.value);
    levelValue.textContent = levelLabel(text, level);
    hint.textContent = levelHint(text, level);
  });

  // 游戏页：难度、比分、轮到谁，三行分开，互不挤压。
  const statusLevel = ui.h('p', 'muted');
  statusLevel.style.margin = '0';
  statusLevel.style.fontSize = '13px';
  const statusScore = ui.h('p');
  statusScore.style.margin = '0';
  statusScore.style.fontSize = '20px';
  statusScore.style.fontWeight = '800';
  const statusTurn = ui.h('p', 'muted');
  statusTurn.style.margin = '0';
  statusTurn.style.fontWeight = '600';

  const boardEl = doc.createElement('div');
  boardEl.style.display = 'grid';
  boardEl.style.gridTemplateColumns = 'repeat(8, 1fr)';
  // 固定 630px（原 420 的 1.5 倍）：不跟着上方文字缩放，窄屏由外层横向滚动。
  boardEl.style.width = '630px';
  boardEl.style.minWidth = '630px';
  boardEl.style.flex = '0 0 auto';
  boardEl.style.aspectRatio = '1';
  boardEl.style.gap = '2px';
  boardEl.style.padding = '6px';
  boardEl.style.boxSizing = 'border-box';
  boardEl.style.background = '#2f6a4b';
  boardEl.style.borderRadius = '12px';

  const boardWrap = doc.createElement('div');
  boardWrap.style.overflowX = 'auto';
  boardWrap.style.maxWidth = '100%';
  boardWrap.append(boardEl);

  const cells: HTMLButtonElement[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const cell = doc.createElement('button');
      cell.type = 'button';
      cell.style.position = 'relative';
      cell.style.padding = '0';
      cell.style.border = 'none';
      cell.style.borderRadius = '4px';
      cell.style.background = 'rgba(0, 0, 0, 0.18)';
      cell.style.aspectRatio = '1';
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => void playAt(row, col));
      cells.push(cell);
      boardEl.append(cell);
    }
  }

  const pauseNote = ui.msgline('');
  pauseNote.hidden = true;

  const undoButton = ui.button(text('悔棋', 'Undo'), { variant: 'plain', size: 'md', onClick: () => void undo() });
  const resignButton = ui.button(text('认输', 'Resign'), { variant: 'danger', size: 'md', onClick: () => void resign() });
  const resumeButton = ui.button(text('继续', 'Continue'), { variant: 'primary', size: 'md', onClick: () => void resume() });
  resumeButton.hidden = true;

  // 复盘条：从对局历史里点「复盘」才出现，平时整条隐藏。
  const replayBar = doc.createElement('div');
  replayBar.hidden = true;
  replayBar.style.display = 'none';
  replayBar.style.flexDirection = 'column';
  replayBar.style.gap = '8px';
  const replayNote = ui.msgline('');
  const replayRow = doc.createElement('div');
  replayRow.style.display = 'flex';
  replayRow.style.gap = '8px';
  replayRow.style.flexWrap = 'wrap';
  const replayFirst = ui.button('⏮', { variant: 'plain', size: 'sm', onClick: () => void stepReplay(-9999) });
  const replayPrev = ui.button('◀', { variant: 'plain', size: 'sm', onClick: () => void stepReplay(-1) });
  const replayNextBtn = ui.button('▶', { variant: 'plain', size: 'sm', onClick: () => void stepReplay(1) });
  const replayLast = ui.button('⏭', { variant: 'plain', size: 'sm', onClick: () => void stepReplay(9999) });
  const replayResumeButton = ui.button(text('从此刻开始对局', 'Play from here'), {
    variant: 'primary',
    size: 'md',
    onClick: () => void resumeReplay(),
  });
  const replayExitButton = ui.button(text('退出复盘', 'Exit replay'), {
    variant: 'plain',
    size: 'md',
    onClick: () => void exitReplay(),
  });
  replayRow.append(replayFirst, replayPrev, replayNextBtn, replayLast, replayResumeButton, replayExitButton);
  replayBar.append(replayNote, replayRow);

  const actionsRow = doc.createElement('div');
  actionsRow.style.display = 'flex';
  actionsRow.style.gap = '8px';
  actionsRow.style.flexWrap = 'wrap';
  actionsRow.append(undoButton, resignButton, resumeButton);

  const play = doc.createElement('div');
  play.style.display = 'flex';
  play.style.flexDirection = 'column';
  play.style.gap = '10px';
  play.append(statusLevel, statusScore, statusTurn, boardWrap, pauseNote, replayBar, actionsRow);
  scaffold.play.append(play);

  async function start(): Promise<void> {
    dismissed = null;
    writeDismissed('reversi', null);
    await busy(ctx, scaffold.primary, async () => {
      await ctx.invoke('start', [level]);
      await refresh();
    });
  }

  async function playAt(row: number, col: number): Promise<void> {
    const value = snapshot;
    if (!value || value.phase !== 'playing' || value.turn !== 'human') return;
    const label = `${REVERSI_FILES[col]}${row + 1}`;
    if (!value.legal.some((item) => item.label === label)) return;
    await busy(ctx, cells[row * 8 + col]!, async () => {
      await ctx.invoke('move', [label]);
      await refresh();
    });
  }

  async function undo(): Promise<void> {
    await busy(ctx, undoButton, async () => {
      await ctx.invoke('undo');
      await refresh();
    });
  }

  async function resign(): Promise<void> {
    const ok = await ui.confirm({
      title: text('认输？', 'Resign?'),
      body: text('这一局会直接结束，记成伙伴赢。', 'This game ends right away and counts as a win for your partner.'),
      danger: true,
    });
    if (!ok) return;
    await busy(ctx, resignButton, async () => {
      await ctx.invoke('resign');
      await refresh();
    });
  }

  async function resume(): Promise<void> {
    await busy(ctx, resumeButton, async () => {
      await ctx.invoke('resume');
      await refresh();
    });
  }

  /** 只把盘面画出来；能不能点由调用方决定。 */
  function paint(
    board: ReadonlyArray<ReadonlyArray<'B' | 'W' | null>>,
    legal: ReadonlySet<string>,
    lastMove: string | null,
    clickable: boolean,
  ): void {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const cell = cells[row * 8 + col]!;
        const label = `${REVERSI_FILES[col]}${row + 1}`;
        cell.replaceChildren();
        const disc = board[row]?.[col] ?? null;
        if (disc) {
          const dot = doc.createElement('span');
          dot.style.position = 'absolute';
          dot.style.inset = '10%';
          dot.style.borderRadius = '50%';
          dot.style.background = disc === 'B' ? '#15181c' : '#f4f1e8';
          dot.style.boxShadow = 'inset 0 -2px 4px rgba(0,0,0,0.35)';
          cell.append(dot);
        } else if (clickable && legal.has(label)) {
          const dot = doc.createElement('span');
          dot.style.position = 'absolute';
          dot.style.inset = '36%';
          dot.style.borderRadius = '50%';
          dot.style.background = 'rgba(255, 255, 255, 0.42)';
          cell.append(dot);
        }
        if (lastMove === label) {
          cell.style.outline = '2px solid #ffd166';
          cell.style.outlineOffset = '-2px';
        } else {
          cell.style.outline = '';
        }
        cell.disabled = !clickable || !legal.has(label);
      }
    }
  }

  /** 游玩中锁住难度；回到主界面、终局、复盘时恢复。 */
  function syncLevelControl(disabled: boolean): void {
    slider.disabled = disabled;
    slider.style.opacity = disabled ? '0.55' : '1';
    slider.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }

  /** 伙伴落子后补一声轻响，让「它下过了」有听觉上的落点。 */
  let seenMoves = 0;
  let seenGame: string | null = null;

  function renderBoard(value: ReversiPanelSnapshot): void {
    const legal = new Set(value.legal.map((item) => item.label));
    paint(value.board, legal, value.lastMove, value.phase === 'playing' && value.turn === 'human');
    replayBar.hidden = true;
    replayBar.style.display = 'none';
    actionsRow.hidden = false;

    const yourColor = value.yourColor === 'B' ? text('黑', 'black') : text('白', 'white');
    const partnerColor = value.partnerColor === 'B' ? text('黑', 'black') : text('白', 'white');
    statusLevel.textContent = text(`难度：${value.levelLabel}`, `Level: ${value.levelLabel}`);
    statusScore.textContent = text(
      `你 ${value.score.human} : ${value.score.model} 伙伴`,
      `You ${value.score.human} : ${value.score.model} partner`,
    );
    let turnText = text(`轮到你（你执${yourColor}）`, `Your move (you are ${yourColor})`);
    if (value.phase === 'paused') turnText = text('已暂停', 'Paused');
    else if (value.phase === 'ended') turnText = text(`终局（你执${yourColor}，伙伴执${partnerColor}）`, `Finished (you ${yourColor}, partner ${partnerColor})`);
    else if (value.turn === 'model') turnText = text(`伙伴在想…（伙伴执${partnerColor}）`, `Your partner is thinking… (partner is ${partnerColor})`);
    statusTurn.textContent = turnText;

    if (value.id !== seenGame) {
      seenGame = value.id;
      seenMoves = 0;
    }
    if (value.moves.length > seenMoves) {
      const lastMove = value.moves[value.moves.length - 1];
      if (lastMove && lastMove.side === 'model') playClick();
      seenMoves = value.moves.length;
    }

    pauseNote.hidden = value.phase !== 'paused';
    if (value.phase === 'paused') {
      pauseNote.textContent = text(
        `伙伴卡住了（${value.pausedReason ?? '没有落子'}），点「继续」再让它想一次。`,
        `Your partner stalled (${value.pausedReason ?? 'no move'}). Press “Continue” to let it think again.`,
      );
      pauseNote.classList.add('bad');
    } else {
      pauseNote.classList.remove('bad');
    }

    undoButton.disabled = value.phase !== 'playing' || value.undoLeft <= 0;
    undoButton.textContent = text(`悔棋（剩 ${value.undoLeft}）`, `Undo (${value.undoLeft} left)`);
    resignButton.hidden = value.phase === 'ended';
    resumeButton.hidden = value.phase !== 'paused';
    syncLevelControl(value.phase === 'playing' || value.phase === 'paused');
  }

  /** 复盘画面：棋盘只读，能不能「从此刻接着下」由 World 决定。 */
  function renderReplay(value: ReversiReplayView): void {
    paint(value.board, new Set<string>(), value.lastMove, false);
    replayBar.hidden = false;
    replayBar.style.display = 'flex';
    replayNote.classList.remove('bad');
    replayNote.textContent = text(
      '这是复盘，不是新的一局：可以逐步看，也可以从此刻接着下。',
      'This is a replay, not a new game: step through it, or continue from here.',
    );
    actionsRow.hidden = true;
    pauseNote.hidden = true;
    replayFirst.disabled = value.step <= 0;
    replayPrev.disabled = value.step <= 0;
    replayNextBtn.disabled = value.step >= value.total;
    replayLast.disabled = value.step >= value.total;
    replayResumeButton.disabled = value.step >= value.total;
    statusLevel.textContent = text(`难度：${value.levelLabel}`, `Level: ${value.levelLabel}`);
    statusScore.textContent = text(
      `你 ${value.score.human} : ${value.score.model} 伙伴`,
      `You ${value.score.human} : ${value.score.model} partner`,
    );
    statusTurn.textContent = text(
      `复盘 · 第 ${value.step} / ${value.total} 手`,
      `Replay · move ${value.step} / ${value.total}`,
    );
    syncLevelControl(true);
  }

  async function openReplay(entryId: string): Promise<void> {
    try {
      const payload = await ctx.invoke<ReversiPayload>('replay', [entryId]);
      snapshot = payload.snapshot;
      replay = payload.replay;
      if (replay) {
        scaffold.show('play');
        renderReplay(replay);
      }
    } catch (error) {
      ctx.ui.toast(errorText(error), 'bad');
    }
  }

  async function stepReplay(delta: number): Promise<void> {
    try {
      const payload = await ctx.invoke<ReversiPayload>('replayStep', [delta]);
      snapshot = payload.snapshot;
      replay = payload.replay;
      if (replay) renderReplay(replay);
    } catch (error) {
      ctx.ui.toast(errorText(error), 'bad');
    }
  }

  async function resumeReplay(): Promise<void> {
    try {
      const payload = await ctx.invoke<ReversiPayload>('replayResume');
      snapshot = payload.snapshot;
      replay = payload.replay;
      await refresh();
    } catch (error) {
      ctx.ui.toast(errorText(error), 'bad');
    }
  }

  async function exitReplay(): Promise<void> {
    try {
      await ctx.invoke<ReversiPayload>('replayExit');
      replay = null;
      await refresh();
    } catch (error) {
      ctx.ui.toast(errorText(error), 'bad');
    }
  }

  async function refresh(): Promise<void> {
    const home = await ctx.invoke<Home>('home');
    const payload = await ctx.invoke<ReversiPayload>('state');
    snapshot = payload.snapshot;
    replay = payload.replay;
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (replay) {
      scaffold.show('play');
      renderReplay(replay);
      return;
    }
    const value = payload.snapshot;
    if (!value || home.phase === 'idle') {
      scaffold.show('main');
      scaffold.setPrimary(text('开始游戏', 'Start'));
      syncLevelControl(false);
      return;
    }
    if (home.phase === 'ended') {
      if (dismissed !== null && dismissed === value.createdAt) {
        scaffold.show('main');
        scaffold.setPrimary(text('开始新一局', 'New game'));
        syncLevelControl(false);
        return;
      }
      const outcome = value.winner === 'human' ? 'win' : value.winner === 'model' ? 'lose' : 'draw';
      scaffold.setEnd(
        endTitleFor(text, 'reversi', outcome),
        value.closing,
        text,
        text(
          `你 ${value.score.human} : ${value.score.model} 伙伴 · ${value.levelLabel}`,
          `You ${value.score.human} : ${value.score.model} partner · ${value.levelLabel}`,
        ),
      );
      scaffold.setEndAnswer(null);
      scaffold.show('end');
      return;
    }
    scaffold.setPrimary(text('继续游戏', 'Continue'));
    scaffold.show('play');
    renderBoard(value);
  }

  const interval = wire({
    scaffold,
    ctx,
    text,
    game: 'reversi',
    phase: () => phase,
    render: () => {
      if (replay) renderReplay(replay);
      else if (snapshot) renderBoard(snapshot);
    },
    sync: refresh,
    onReplay: (entry) => {
      void openReplay(entry.id);
    },
  });
  void refresh().catch((error: unknown) => ctx.ui.toast(errorText(error), 'bad'));

  return {
    dispose() {
      interval.dispose();
    },
  };
}

const bundle: WebUiClientBundle = {
  panels: {
    mystery: { mount: mountMystery },
    trust: { mount: mountTrust },
    drawguess: { mount: mountDraw },
    reversi: { mount: mountReversi },
  },
};

export default bundle;
