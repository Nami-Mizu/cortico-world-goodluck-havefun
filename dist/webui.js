// _dev/packages/cortico-world-goodluck-havefun/src/webui/client.ts
var FADE_IN = [
  { opacity: 0, transform: "translateY(10px)" },
  { opacity: 1, transform: "translateY(0)" }
];
function fadeIn(el) {
  try {
    el.animate(FADE_IN, { duration: 280, easing: "ease-out" });
  } catch {
  }
}
function clock(iso) {
  if (!iso) return "\u2014";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "\u2014" : date.toLocaleString(void 0, { hour12: false });
}
var audio = null;
function playClick() {
  try {
    const ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!ctor) return;
    audio ??= new ctor();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(1e-4, now + 0.08);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {
  }
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function pickText(ctx) {
  const zh = ctx.language.startsWith("zh");
  return (a, b) => zh ? a : b;
}
function bigButton(ui, label, variant, onClick) {
  const button = ui.button(label, { variant, size: "md", onClick });
  button.style.minHeight = "44px";
  button.style.padding = "0 22px";
  button.style.fontSize = "15px";
  button.style.fontWeight = "600";
  return button;
}
function spacer(px) {
  const el = document.createElement("div");
  el.style.height = `${px}px`;
  return el;
}
function buildScaffold(ctx, opts) {
  const ui = ctx.ui;
  let view = null;
  const root = ui.h("div");
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "10px";
  root.style.padding = "6px 2px 2px";
  root.style.maxWidth = "640px";
  const main = ui.h("section");
  main.setAttribute("data-view", "main");
  main.style.display = "flex";
  main.style.flexDirection = "column";
  main.style.gap = "12px";
  const title = ui.h("h1", null, opts.title);
  title.style.margin = "0";
  title.style.fontSize = "22px";
  title.style.fontWeight = "800";
  title.style.letterSpacing = "0.01em";
  const intro = ui.h("div");
  intro.style.display = "flex";
  intro.style.flexDirection = "column";
  intro.style.gap = "6px";
  for (const line of opts.intro) {
    const p = ui.h("p", "muted", line);
    p.style.margin = "0";
    p.style.lineHeight = "1.6";
    intro.append(p);
  }
  const primary = bigButton(ui, opts.primaryLabel, "primary", opts.onPrimary);
  const historyToggle = bigButton(ui, opts.text("\u5BF9\u5C40\u5386\u53F2", "History"), "plain", opts.onHistory);
  const buttons = ui.h("div");
  buttons.style.display = "flex";
  buttons.style.gap = "10px";
  buttons.style.flexWrap = "wrap";
  buttons.style.marginTop = "4px";
  buttons.append(primary, historyToggle);
  const historyBox = ui.h("div");
  historyBox.hidden = true;
  historyBox.style.borderTop = "1px solid rgba(127,127,127,0.25)";
  historyBox.style.paddingTop = "10px";
  historyBox.style.display = "flex";
  historyBox.style.flexDirection = "column";
  historyBox.style.gap = "8px";
  const historyBar = ui.rowbar();
  historyBar.style.display = "flex";
  historyBar.style.alignItems = "center";
  historyBar.style.gap = "8px";
  const historyNote = ui.msgline("");
  historyBar.append(historyNote);
  const historyBody = ui.h("div");
  historyBody.style.display = "flex";
  historyBody.style.flexDirection = "column";
  historyBody.style.gap = "6px";
  historyBox.append(historyBar, historyBody);
  const progressLine2 = ui.h("p", "muted");
  progressLine2.style.margin = "0";
  progressLine2.style.lineHeight = "1.6";
  main.append(title, intro, progressLine2, spacer(24), buttons, historyBox);
  const play = ui.h("section");
  play.setAttribute("data-view", "play");
  play.hidden = true;
  const endView = ui.h("section");
  endView.setAttribute("data-view", "end");
  endView.hidden = true;
  endView.style.display = "flex";
  endView.style.flexDirection = "column";
  endView.style.gap = "10px";
  const endTitle = ui.h("h1");
  endTitle.style.margin = "4px 0 0";
  endTitle.style.fontSize = "26px";
  endTitle.style.fontWeight = "800";
  const endDetail = ui.h("p", "muted");
  endDetail.style.margin = "0";
  endDetail.style.fontSize = "14px";
  endDetail.style.fontWeight = "600";
  const endAnswer = ui.h("p");
  endAnswer.style.margin = "0";
  endAnswer.style.lineHeight = "1.7";
  endAnswer.style.whiteSpace = "pre-wrap";
  endAnswer.hidden = true;
  const endHeading = ui.h("h2", null, opts.text("\u590D\u76D8\u6536\u5C3E", "Wrap-up"));
  endHeading.style.margin = "0";
  endHeading.style.fontSize = "16px";
  endHeading.style.fontWeight = "700";
  const endClosing = ui.h("p");
  endClosing.style.margin = "0";
  endClosing.style.lineHeight = "1.75";
  endClosing.style.whiteSpace = "pre-wrap";
  const endHint = ui.h("p", "muted", opts.text("\u5BF9\u5C40\u8BE6\u60C5\u5DF2\u8BB0\u5F55\uFF0C\u53EF\u5728\u3010\u5BF9\u5C40\u5386\u53F2\u3011\u4E2D\u67E5\u770B\u3002", "The game is saved \u2014 see it under \u201CHistory\u201D."));
  endHint.style.margin = "0";
  const back = bigButton(ui, opts.text("\u8FD4\u56DE\u4E3B\u754C\u9762", "Back"), "primary", () => {
    opts.onBack();
    show("main");
  });
  back.style.alignSelf = "flex-start";
  endView.append(endTitle, endDetail, endAnswer, spacer(8), endHeading, spacer(10), endClosing, spacer(12), endHint, spacer(6), back);
  root.append(main, play, endView);
  ctx.root.append(root);
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLButtonElement && !target.disabled) playClick();
    },
    true
  );
  const views = [
    ["main", main],
    ["play", play],
    ["end", endView]
  ];
  function apply(next) {
    for (const [key, el] of views) {
      const on = key === next;
      el.hidden = !on;
      el.style.display = on ? "flex" : "none";
    }
  }
  apply("main");
  function show(next) {
    if (view === next) {
      return;
    }
    view = next;
    apply(next);
    fadeIn(next === "main" ? main : next === "play" ? play : endView);
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
    setPrimary(label) {
      primary.textContent = label;
    },
    setProgress(line) {
      progressLine2.textContent = line;
    },
    setEnd(title2, closing, text, detail) {
      endTitle.textContent = title2;
      endDetail.textContent = detail?.trim() ? detail : "";
      endDetail.hidden = !detail?.trim();
      endClosing.textContent = closing?.trim() ? closing : text("\u4F19\u4F34\u6B63\u5728\u590D\u76D8\u2026", "Your buddy is writing the wrap-up\u2026");
    },
    setEndAnswer(line) {
      endAnswer.textContent = line?.trim() ? line : "";
      endAnswer.hidden = !line?.trim();
    }
  };
}
function renderHistory(scaffold, page, text, onPage, onReplay) {
  const doc = scaffold.historyBody.ownerDocument;
  scaffold.historyNote.textContent = page.total === 0 ? text("\u8FD8\u6CA1\u6709\u5BF9\u5C40\u8BB0\u5F55\u3002", "No games yet.") : text(`\u7B2C ${page.page + 1} / ${page.pages} \u9875\uFF0C\u5171 ${page.total} \u5C40`, `Page ${page.page + 1} / ${page.pages} \xB7 ${page.total} games`);
  const bar = scaffold.historyNote.parentElement;
  if (bar) {
    bar.querySelectorAll("button").forEach((button) => button.remove());
    if (page.pages > 1) {
      const prev = doc.createElement("button");
      prev.className = "btn sm";
      prev.textContent = text("\u2039 \u4E0A\u4E00\u9875", "\u2039 Prev");
      prev.disabled = page.page <= 0;
      prev.addEventListener("click", () => onPage(page.page - 1));
      const next = doc.createElement("button");
      next.className = "btn sm";
      next.textContent = text("\u4E0B\u4E00\u9875 \u203A", "Next \u203A");
      next.disabled = page.page >= page.pages - 1;
      next.addEventListener("click", () => onPage(page.page + 1));
      bar.append(prev, next);
    }
  }
  scaffold.historyBody.replaceChildren();
  if (page.entries.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "muted";
    empty.style.margin = "0";
    empty.textContent = text("\u8FD9\u4E00\u9875\u8FD8\u6CA1\u6709\u8BB0\u5F55\u3002", "Nothing on this page.");
    scaffold.historyBody.append(empty);
    return;
  }
  for (const entry of page.entries) {
    const item = doc.createElement("div");
    item.style.display = "flex";
    item.style.flexDirection = "column";
    item.style.gap = "2px";
    item.style.padding = "8px 10px";
    item.style.border = "1px solid rgba(127,127,127,0.25)";
    item.style.borderRadius = "10px";
    const headline = doc.createElement("p");
    headline.style.margin = "0";
    headline.style.fontWeight = "700";
    headline.textContent = entry.headline;
    const time = doc.createElement("p");
    time.className = "muted";
    time.style.margin = "0";
    time.style.fontSize = "12px";
    time.textContent = `${clock(entry.at)} \u2192 ${clock(entry.endedAt)}`;
    const summary = doc.createElement("p");
    summary.style.margin = "0";
    summary.style.lineHeight = "1.7";
    summary.textContent = entry.summary?.trim() ? entry.summary : text("\u4F19\u4F34\u6B63\u5728\u590D\u76D8\u2026", "Wrap-up pending\u2026");
    item.append(headline, time, summary);
    for (const line of entry.lines) {
      const detail = doc.createElement("p");
      detail.className = "muted";
      detail.style.margin = "0";
      detail.style.fontSize = "12px";
      detail.textContent = `\xB7 ${line}`;
      item.append(detail);
    }
    if (entry.replay && onReplay) {
      const replayButton = doc.createElement("button");
      replayButton.className = "btn sm";
      replayButton.textContent = text("\u590D\u76D8", "Replay");
      replayButton.style.alignSelf = "flex-start";
      replayButton.style.marginTop = "4px";
      replayButton.addEventListener("click", () => onReplay(entry));
      item.append(replayButton);
    }
    scaffold.historyBody.append(item);
  }
}
function wire(options) {
  const { scaffold, ctx, text } = options;
  let historyPage = 0;
  let historyLoaded = false;
  const loadHistory = async (page) => {
    try {
      const result = await ctx.invoke("history", [page]);
      historyPage = result.page;
      renderHistory(scaffold, result, text, (next) => void loadHistory(next), options.onReplay);
    } catch (error) {
      ctx.ui.toast(errorText(error), "bad");
    }
  };
  scaffold.historyToggle.addEventListener("click", () => {
    scaffold.historyBox.hidden = !scaffold.historyBox.hidden;
    if (!scaffold.historyBox.hidden) {
      void loadHistory(historyLoaded ? historyPage : 0);
      historyLoaded = true;
    }
  });
  const interval = ctx.interval(() => {
    if (typing(ctx)) return;
    void options.sync().catch((error) => {
      void error;
    });
  }, 2500);
  void options.sync().catch((error) => ctx.ui.toast(errorText(error), "bad"));
  return interval;
}
function typing(ctx) {
  const active = ctx.root.ownerDocument.activeElement;
  return active instanceof HTMLInputElement && active.value.length > 0 && ctx.root.contains(active);
}
async function busy(ctx, button, fn) {
  const guard = ctx.ui.disable(button);
  try {
    await fn();
  } catch (error) {
    ctx.ui.toast(errorText(error), "bad");
  } finally {
    guard.dispose();
  }
}
function progressLine(text, home) {
  if (home.phase === "playing" || home.phase === "drawing" || home.phase === "guessing") {
    return text(`\u7B2C ${Math.max(1, home.total)} \u5C40\u8FDB\u884C\u4E2D`, `Game ${Math.max(1, home.total)} in progress`);
  }
  if (home.phase === "ended") {
    return text(`\u521A\u7ED3\u675F\u4E00\u5C40\uFF0C\u5DF2\u8BB0\u5F55 ${home.total} \u5C40`, `Last game finished \u2014 ${home.total} recorded`);
  }
  return home.total > 0 ? text(`\u8FD9\u53F0\u673A\u5668\u4E0A\u5DF2\u73A9 ${home.total} \u5C40`, `${home.total} games played here`) : text("\u8FD8\u6CA1\u73A9\u8FC7\uFF0C\u70B9\u4E0B\u9762\u5F00\u59CB\u3002", "Nothing played yet \u2014 start below.");
}
function endTitleFor(text, game, outcome) {
  if (game === "mystery") {
    return outcome === "win" ? text("\u731C\u4E2D\u4E86\uFF01", "Solved it!") : text("\u771F\u76F8\u63ED\u6653", "Revealed");
  }
  if (game === "trust") {
    if (outcome === "win") return text("\u8D62\u4E86\uFF01", "You win!");
    if (outcome === "lose") return text("\u8F93\u4E86\u2026", "You lose\u2026");
    return text("\u5E73\u5C40\uFF01", "A draw!");
  }
  if (game === "reversi") {
    if (outcome === "win") return text("\u8D62\u4E86\uFF01", "You win!");
    if (outcome === "lose") return text("\u8F93\u4E86\u2026", "You lose\u2026");
    return text("\u5E73\u5C40\uFF01", "A draw!");
  }
  return outcome === "win" ? text("\u731C\u4E2D\u4E86\uFF01", "Guessed it!") : text("\u6CA1\u731C\u4E2D\u2026", "Not this time\u2026");
}
var DISMISS_PREFIX = "goodluckhavefun.dismissed.";
function readDismissed(game) {
  try {
    return window.localStorage.getItem(DISMISS_PREFIX + game);
  } catch {
    return null;
  }
}
function writeDismissed(game, key) {
  try {
    if (key === null) window.localStorage.removeItem(DISMISS_PREFIX + game);
    else window.localStorage.setItem(DISMISS_PREFIX + game, key);
  } catch {
  }
}
function mountMystery(ctx) {
  const ui = ctx.ui;
  const text = pickText(ctx);
  let phase = "idle";
  let snapshot = null;
  let dismissed = readDismissed("mystery");
  const scaffold = buildScaffold(ctx, {
    title: text("\u63A8\u7406\u6E38\u620F", "Mystery"),
    intro: [
      text("\u4F19\u4F34\u62BD\u4E09\u4E2A\u6807\u7B7E\uFF0C\u73B0\u7F16\u4E00\u9053\u63A8\u7406\u9898\u3002", "Your partner draws three tags and writes a puzzle on the spot."),
      text("\u4F60\u4E00\u53E5\u4E00\u53E5\u5730\u95EE\uFF0C\u4F19\u4F34\u56DE\uFF1A\u662F / \u4E0D\u662F / \u65E0\u5173 / \u95EE\u8FC7\u4E86\u3002", "Ask one question at a time; answers are yes / no / irrelevant / already asked."),
      text("\u731C\u4E2D\u4E86\uFF0C\u6216\u8005\u4F60\u70B9\u300C\u67E5\u770B\u771F\u76F8\u300D\uFF0C\u8FD9\u4E00\u5C40\u5C31\u7ED3\u675F\u3002", "Guess it, or press \u201CReveal\u201D to end the round.")
    ],
    primaryLabel: text("\u5F00\u59CB\u6E38\u620F", "Start"),
    onPrimary: () => {
      if (phase === "idle" || phase === "ended") void start();
      else scaffold.show("play");
    },
    onHistory: () => void 0,
    onBack: () => {
      dismissed = snapshot?.round?.id ?? null;
      writeDismissed("mystery", dismissed);
    },
    text
  });
  let state = null;
  const tags = ui.h("p", "muted");
  tags.style.margin = "0";
  const title = ui.h("h2");
  title.style.margin = "0";
  title.style.fontSize = "18px";
  title.style.fontWeight = "700";
  const surface = ui.h("p");
  surface.style.margin = "0";
  surface.style.lineHeight = "1.7";
  surface.style.whiteSpace = "pre-wrap";
  const drawingNote = ui.msgline(text("\u4F19\u4F34\u6B63\u5728\u51FA\u9898\u2026", "Your partner is writing the puzzle\u2026"));
  const questions = ui.h("div");
  questions.style.display = "flex";
  questions.style.flexDirection = "column";
  questions.style.gap = "4px";
  const note = ui.h("p", "muted");
  note.style.margin = "0";
  const askInput = ui.input({
    placeholder: text("\u95EE\u4E00\u53E5\uFF08\u226450 \u5B57\uFF09", "Ask something (\u226450 chars)"),
    onCommit: () => void ask()
  });
  askInput.maxLength = 50;
  askInput.style.flex = "1";
  const askButton = ui.button(text("\u95EE", "Ask"), { variant: "primary", size: "md", onClick: () => void ask() });
  const revealButton = ui.button(text("\u67E5\u770B\u771F\u76F8", "Reveal"), { variant: "plain", size: "md", onClick: () => void reveal() });
  const askRow = ui.h("div");
  askRow.style.display = "flex";
  askRow.style.gap = "8px";
  askRow.append(askInput, askButton);
  const actionsRow = ui.h("div");
  actionsRow.style.display = "flex";
  actionsRow.style.gap = "8px";
  actionsRow.append(revealButton);
  const play = ui.h("div");
  play.style.display = "flex";
  play.style.flexDirection = "column";
  play.style.gap = "10px";
  play.append(tags, title, surface, drawingNote, questions, note, askRow, actionsRow);
  scaffold.play.append(play);
  async function start() {
    dismissed = null;
    writeDismissed("mystery", null);
    await busy(ctx, scaffold.primary, async () => {
      await ctx.invoke("start");
      await refresh();
    });
  }
  async function ask() {
    const value = askInput.value.trim();
    if (!value) return;
    await busy(ctx, askButton, async () => {
      const result = await ctx.invoke("ask", [value]);
      snapshot = result;
      askInput.value = "";
      render(result);
    });
  }
  async function reveal() {
    const ok = await ui.confirm({
      title: text("\u67E5\u770B\u771F\u76F8\uFF1F", "Reveal the answer?"),
      body: text("\u63ED\u6653\u540E\u8FD9\u4E00\u5C40\u5C31\u7ED3\u675F\u4E86\uFF0C\u5269\u4E0B\u6CA1\u95EE\u7684\u95EE\u9898\u4E5F\u4E0D\u4F1A\u518D\u6709\u7B54\u6848\u3002", "This ends the round \u2014 remaining questions stay unanswered."),
      danger: true
    });
    if (!ok) return;
    await busy(ctx, revealButton, async () => {
      await ctx.invoke("reveal");
      await refresh();
    });
  }
  function render(value) {
    const round = value.round;
    if (!round) {
      tags.textContent = "";
      title.textContent = "";
      surface.textContent = "";
      questions.replaceChildren();
      note.textContent = "";
      askRow.hidden = true;
      actionsRow.hidden = true;
      drawingNote.hidden = false;
      return;
    }
    tags.textContent = round.tagsLabel;
    title.textContent = round.title;
    surface.textContent = round.surface;
    drawingNote.hidden = Boolean(round.title);
    askRow.hidden = round.phase !== "ready";
    actionsRow.hidden = round.phase !== "ready";
    note.textContent = text(
      `\u5DF2\u95EE ${round.questions.length} / ${round.maxQuestions} \u4E2A\u95EE\u9898`,
      `${round.questions.length} / ${round.maxQuestions} questions asked`
    );
    questions.replaceChildren();
    for (const item of round.questions.slice(-14)) {
      const row = ui.h("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "baseline";
      row.style.opacity = "0.72";
      row.append(
        ui.h("span", "mono", item.id.toUpperCase()),
        ui.h("span", null, item.text),
        ui.pill(
          item.verdictLabel ?? text("\u5F85\u5224", "pending"),
          item.verdict === "yes" ? "on" : item.verdict === "no" ? "off" : "plain"
        )
      );
      questions.append(row);
    }
  }
  async function refresh() {
    const home = await ctx.invoke("home");
    const value = await ctx.invoke("state");
    snapshot = value;
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (home.phase === "idle") {
      scaffold.show("main");
      scaffold.setPrimary(text("\u5F00\u59CB\u6E38\u620F", "Start"));
      return;
    }
    if (home.phase === "ended") {
      const key = value.round?.id ?? null;
      if (key !== null && dismissed === key) {
        scaffold.show("main");
        scaffold.setPrimary(text("\u5F00\u59CB\u65B0\u4E00\u5C40", "New game"));
        return;
      }
      scaffold.setEnd(
        endTitleFor(text, "mystery", value.round?.guessed ? "win" : "lose"),
        value.round?.closing ?? null,
        text
      );
      scaffold.setEndAnswer(
        value.round?.answer ? text(`\u771F\u76F8\uFF1A${value.round.answer}`, `The truth: ${value.round.answer}`) : null
      );
      scaffold.show("end");
      return;
    }
    scaffold.setEndAnswer(null);
    scaffold.setPrimary(text("\u7EE7\u7EED\u6E38\u620F", "Continue"));
    scaffold.show("play");
    render(value);
  }
  const interval = wire({
    scaffold,
    ctx,
    text,
    game: "mystery",
    phase: () => phase,
    render: () => {
      if (state) render(state);
    },
    sync: refresh
  });
  void refresh().catch((error) => ctx.ui.toast(errorText(error), "bad"));
  return {
    dispose() {
      interval.dispose();
    }
  };
}
function mountTrust(ctx) {
  const ui = ctx.ui;
  const text = pickText(ctx);
  let phase = "idle";
  let snapshot = null;
  let dismissed = readDismissed("trust");
  const scaffold = buildScaffold(ctx, {
    title: text("\u4FE1\u4EFB\u7684\u8FDB\u5316", "Evolution of Trust"),
    intro: [
      text("\u5341\u4E8C\u4E2A\u56DE\u5408\uFF0C\u6BCF\u56DE\u5408\u5148\u5404\u8BF4\u4E00\u53E5\uFF0C\u518D\u5404\u9009\u5408\u4F5C\u6216\u6B3A\u9A97\u3002", "Twelve rounds: say one line each, then both pick cooperate or deceive."),
      text("\u90FD\u5408\u4F5C\u5404 +1\uFF1B\u4E00\u9A97\u4E00\u5408\uFF0C\u9A97\u7684 +2\uFF1B\u90FD\u9A97\u5404 -1\u3002\u5148\u5230 7 \u5206\u80DC\u3002", "Both cooperate +1 each; deceive vs cooperate +2 / 0; both deceive -1 each. First to 7 wins."),
      text("\u804A\u5929\u548C\u9009\u62E9\u4E92\u4E0D\u5F71\u54CD\uFF1A\u4F60\u53EF\u4EE5\u6539\u53E3\uFF0C\u4E5F\u53EF\u4EE5\u60F3\u597D\u4E86\u76F4\u63A5\u9009\u3002", "Chat and choice are independent: you can take back your line, or just pick.")
    ],
    primaryLabel: text("\u5F00\u59CB\u6E38\u620F", "Start"),
    onPrimary: () => {
      if (phase === "idle" || phase === "ended") void start();
      else scaffold.show("play");
    },
    onHistory: () => void 0,
    onBack: () => {
      dismissed = snapshot?.matchId != null ? String(snapshot.matchId) : null;
      writeDismissed("trust", dismissed);
    },
    text
  });
  const score = ui.h("h2");
  score.style.margin = "0";
  const roundLine = ui.h("p", "muted");
  roundLine.style.margin = "0";
  const sayAgent = ui.h("p", "muted");
  sayAgent.style.margin = "0";
  const sayHuman = ui.h("p", "muted");
  sayHuman.style.margin = "0";
  const chatInput = ui.input({
    placeholder: text("\u8BF4\u4E00\u53E5\uFF08\u226460 \u5B57\uFF09", "Say one line (\u226460 chars)"),
    onCommit: () => void say()
  });
  chatInput.maxLength = 60;
  chatInput.style.flex = "1";
  const chatButton = ui.button(text("\u8BF4\u8FD9\u53E5", "Say"), { variant: "plain", size: "md", onClick: () => void say() });
  const chatRow = ui.h("div");
  chatRow.style.display = "flex";
  chatRow.style.gap = "8px";
  chatRow.append(chatInput, chatButton);
  const choiceNote = ui.msgline("");
  const cooperate = ui.button(text("\u5408\u4F5C", "Cooperate"), { variant: "primary", size: "md", onClick: () => void choose("cooperate") });
  const deceive = ui.button(text("\u6B3A\u9A97", "Deceive"), { variant: "danger", size: "md", onClick: () => void choose("deceive") });
  const chooseRow = ui.h("div");
  chooseRow.style.display = "flex";
  chooseRow.style.gap = "8px";
  chooseRow.append(cooperate, deceive);
  const revealBox = ui.h("div");
  revealBox.style.display = "flex";
  revealBox.style.flexDirection = "column";
  revealBox.style.gap = "4px";
  const roundsBox = ui.h("div");
  roundsBox.style.display = "flex";
  roundsBox.style.flexDirection = "column";
  roundsBox.style.gap = "2px";
  const play = ui.h("div");
  play.style.display = "flex";
  play.style.flexDirection = "column";
  play.style.gap = "10px";
  play.append(score, roundLine, sayAgent, sayHuman, chatRow, choiceNote, chooseRow, revealBox, roundsBox);
  scaffold.play.append(play);
  const profilesMain = ui.h("p", "muted");
  profilesMain.style.margin = "0";
  profilesMain.style.lineHeight = "1.6";
  profilesMain.style.whiteSpace = "pre-line";
  scaffold.main.append(profilesMain);
  const profilesPlay = ui.h("p", "muted");
  profilesPlay.style.margin = "0";
  profilesPlay.style.lineHeight = "1.6";
  profilesPlay.style.whiteSpace = "pre-line";
  play.append(profilesPlay);
  function profileText(profile) {
    const entries = profile.entries.filter((item) => item.score > 0).slice().sort((a, b) => b.score - a.score);
    const sum = entries.reduce((total, item) => total + item.score, 0);
    if (entries.length === 0 || sum === 0) return text("\u8FD8\u6CA1\u6512\u591F\u5386\u53F2", "not enough history yet");
    return entries.slice(0, 2).map((item) => `${item.label} ${Math.round(item.score / sum * 100)}%`).join(" \xB7 ");
  }
  function renderProfiles(profiles) {
    const line = text(
      `\u753B\u50CF\uFF08${profiles.human.samples} \u56DE\u5408\uFF09
\u4F60\uFF1A${profileText(profiles.human)}
AI\uFF1A${profileText(profiles.agent)}`,
      `Profiles (${profiles.human.samples} rounds)
You: ${profileText(profiles.human)}
AI: ${profileText(profiles.agent)}`
    );
    profilesMain.textContent = line;
    profilesPlay.textContent = line;
  }
  let lastReveal = -1;
  async function start() {
    dismissed = null;
    writeDismissed("trust", null);
    await busy(ctx, scaffold.primary, async () => {
      await ctx.invoke("start");
      await refresh();
    });
  }
  async function say() {
    const value = chatInput.value.trim();
    if (!value) return;
    await busy(ctx, chatButton, async () => {
      await ctx.invoke("say", [value]);
      chatInput.value = "";
      await refresh();
    });
  }
  async function choose(choice) {
    await busy(ctx, choice === "cooperate" ? cooperate : deceive, async () => {
      await ctx.invoke("choose", [choice]);
      await refresh();
    });
  }
  function render(value) {
    score.textContent = text(
      `\u4F60 ${value.humanScore} : ${value.agentScore} \u4F19\u4F34`,
      `You ${value.humanScore} : ${value.agentScore} Partner`
    );
    roundLine.textContent = text(
      `\u7B2C ${value.round} / ${value.maxRounds} \u56DE\u5408 \xB7 \u5148\u5230 ${value.targetScore} \u5206`,
      `Round ${value.round} / ${value.maxRounds} \xB7 first to ${value.targetScore}`
    );
    sayAgent.textContent = value.say.agent ? `${text("\u4F19\u4F34", "Partner")}\uFF1A${value.say.agent}` : "";
    sayHuman.textContent = value.say.human ? `${text("\u4F60", "You")}\uFF1A${value.say.human}` : "";
    const playing = value.phase === "playing";
    chatRow.hidden = !playing;
    chooseRow.hidden = !playing;
    const chose = Boolean(value.choice.human);
    cooperate.disabled = !playing || chose || false;
    deceive.disabled = !playing || chose || false;
    choiceNote.hidden = !playing;
    if (!playing) {
      choiceNote.textContent = "";
    } else if (chose) {
      choiceNote.textContent = text(`\u5DF2\u9009\uFF1A${value.choice.human === "cooperate" ? "\u5408\u4F5C" : "\u6B3A\u9A97"} \xB7 \u7B49\u5F85\u63ED\u6653\u2026`, "Picked \u2014 waiting for the reveal\u2026");
    } else if (value.choice.agent) {
      choiceNote.textContent = text("\u4F19\u4F34\u5DF2\u7ECF\u9009\u4E86\uFF0C\u8F6E\u5230\u4F60\u4E86\u3002", "Your partner has picked \u2014 your turn.");
    } else {
      choiceNote.textContent = text("\u8BF4\u8BDD\u4E0D\u5F71\u54CD\u9009\u62E9\uFF1A\u60F3\u597D\u4E86\u5C31\u70B9\u5408\u4F5C\u6216\u6B3A\u9A97\u3002", "Chat does not lock your choice \u2014 pick when ready.");
    }
    const latest = value.rounds[value.rounds.length - 1];
    revealBox.replaceChildren();
    if (latest) {
      const head = ui.h("div");
      head.style.display = "flex";
      head.style.gap = "8px";
      head.style.alignItems = "center";
      head.append(
        ui.h("strong", null, text(`\u63ED\u793A #${latest.index}`, `Reveal #${latest.index}`)),
        ui.pill(clock(latest.at))
      );
      const deltas = ui.h("p");
      deltas.style.margin = "0";
      deltas.textContent = text(
        `\u4F60 ${latest.human === "cooperate" ? "\u5408\u4F5C" : "\u6B3A\u9A97"} \xB7 \u4F19\u4F34 ${latest.agent === "cooperate" ? "\u5408\u4F5C" : "\u6B3A\u9A97"}  \u2192  \u4F60 ${latest.humanDelta >= 0 ? "+" : ""}${latest.humanDelta} / \u4F19\u4F34 ${latest.agentDelta >= 0 ? "+" : ""}${latest.agentDelta}`,
        `You ${latest.human} \xB7 Partner ${latest.agent} \u2192 you ${latest.humanDelta >= 0 ? "+" : ""}${latest.humanDelta} / Partner ${latest.agentDelta >= 0 ? "+" : ""}${latest.agentDelta}`
      );
      revealBox.append(head, deltas);
      if (latest.index !== lastReveal) {
        lastReveal = latest.index;
        fadeIn(revealBox);
      }
    }
    roundsBox.replaceChildren();
    for (const item of value.rounds.slice(-6).reverse()) {
      const row = ui.h("p", "muted");
      row.style.margin = "0";
      row.textContent = `${item.index}. ${text("\u4F60", "you")} ${item.human === "cooperate" ? text("\u5408\u4F5C", "C") : text("\u6B3A\u9A97", "D")} \xB7 ${text("\u4F19\u4F34", "Partner")} ${item.agent === "cooperate" ? text("\u5408\u4F5C", "C") : text("\u6B3A\u9A97", "D")} \u2192 ${item.humanDelta >= 0 ? "+" : ""}${item.humanDelta} / ${item.agentDelta >= 0 ? "+" : ""}${item.agentDelta}`;
      roundsBox.append(row);
    }
  }
  async function refresh() {
    const home = await ctx.invoke("home");
    const payload = await ctx.invoke("state");
    const value = payload.snapshot;
    snapshot = value;
    renderProfiles(payload.profiles);
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (home.phase === "idle") {
      scaffold.show("main");
      scaffold.setPrimary(text("\u5F00\u59CB\u6E38\u620F", "Start"));
      return;
    }
    if (home.phase === "ended") {
      const key = value.matchId != null ? String(value.matchId) : null;
      if (key !== null && dismissed === key) {
        scaffold.show("main");
        scaffold.setPrimary(text("\u5F00\u59CB\u65B0\u4E00\u5C40", "New game"));
        return;
      }
      scaffold.setEnd(
        endTitleFor(text, "trust", value.winner === "human" ? "win" : value.winner === "agent" ? "lose" : "draw"),
        value.closing,
        text,
        text(
          `\u4F60 ${value.humanScore} : ${value.agentScore} \u4F19\u4F34 \xB7 \u7B2C ${value.round} / ${value.maxRounds} \u56DE\u5408`,
          `You ${value.humanScore} : ${value.agentScore} Partner \xB7 Round ${value.round} / ${value.maxRounds}`
        )
      );
      scaffold.show("end");
      return;
    }
    scaffold.setPrimary(text("\u7EE7\u7EED\u6E38\u620F", "Continue"));
    scaffold.show("play");
    render(value);
  }
  const interval = wire({
    scaffold,
    ctx,
    text,
    game: "trust",
    phase: () => phase,
    render: () => void 0,
    sync: refresh
  });
  void refresh().catch((error) => ctx.ui.toast(errorText(error), "bad"));
  return {
    dispose() {
      interval.dispose();
    }
  };
}
var DRAW_SPACE = 1e3;
function paint(canvas, strokes) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#1b1b1b";
  context.lineCap = "round";
  context.lineJoin = "round";
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
function mountDraw(ctx) {
  const ui = ctx.ui;
  const text = pickText(ctx);
  let phase = "idle";
  let latest = null;
  let visionMode = "on";
  let dismissed = readDismissed("drawguess");
  const scaffold = buildScaffold(ctx, {
    title: text("\u4F60\u753B\u6211\u731C", "Draw & Guess"),
    intro: [
      text("\u4F19\u4F34\u62FF\u4E00\u4E2A\u8BCD\uFF0C\u7528\u6298\u7EBF\u628A\u5B83\u753B\u51FA\u6765\uFF1B\u6BCF\u5F20\u753B\u5148\u8BA9\u89C6\u89C9\u6A21\u578B\u76F2\u8BC4\u4E00\u6B21\u3002", "Your partner gets a word and draws it with polylines; every picture is blind-scored by a vision model."),
      text("\u8BC4\u5230 2 \u5206\u5C31\u7B97\u5B9A\u7A3F\uFF1B\u4E0D\u5230 2 \u5206\u5B83\u4F1A\u91CD\u753B\uFF0C\u9884\u7B97\u6309\u5F20\u6570\u7B97\u3002", "Two points means done; otherwise it redraws, within a per-round budget."),
      text("\u4F60\u6765\u731C\u3002\u731C\u9519\u4E86\u5B83\u8FD8\u80FD\u518D\u753B\uFF1B\u9884\u7B97\u7528\u5B8C\u518D\u731C\u9519\uFF0C\u8FD9\u4E00\u5C40\u5C31\u7ED3\u675F\u3002", "Then you guess. A wrong guess lets it redraw; once the budget is out, a wrong guess ends the round.")
    ],
    primaryLabel: text("\u5F00\u59CB\u6E38\u620F\xB7\u7B80\u5355", "Start \xB7 easy"),
    onPrimary: () => {
      if (phase === "idle" || phase === "ended") void start("easy", scaffold.primary);
      else scaffold.show("play");
    },
    onHistory: () => void 0,
    onBack: () => {
      dismissed = `draw:${latest?.round ?? 0}`;
      writeDismissed("drawguess", dismissed);
    },
    text
  });
  const hardStart = bigButton(ui, text("\u5F00\u59CB\u6E38\u620F\xB7\u56F0\u96BE", "Start \xB7 hard"), "primary", () => {
    if (phase === "idle" || phase === "ended") void start("hard", hardStart);
    else scaffold.show("play");
  });
  scaffold.actions.insertBefore(hardStart, scaffold.historyToggle);
  const canvas = document.createElement("canvas");
  canvas.width = 1e3;
  canvas.height = 1e3;
  canvas.style.width = "100%";
  canvas.style.maxWidth = "420px";
  canvas.style.aspectRatio = "1 / 1";
  canvas.style.borderRadius = "12px";
  canvas.style.border = "1px solid rgba(127,127,127,0.35)";
  canvas.style.background = "#fff";
  const note = ui.msgline("");
  const budget = ui.h("div");
  budget.style.display = "flex";
  budget.style.gap = "6px";
  budget.style.flexWrap = "wrap";
  const guessInput = ui.input({
    placeholder: text("\u731C\u4E00\u4E2A\u8BCD", "Your guess"),
    onCommit: () => void guess()
  });
  guessInput.maxLength = 20;
  guessInput.style.flex = "1";
  const guessButton = ui.button(text("\u731C", "Guess"), { variant: "primary", size: "md", onClick: () => void guess() });
  const guessRow = ui.h("div");
  guessRow.style.display = "flex";
  guessRow.style.gap = "8px";
  guessRow.append(guessInput, guessButton);
  const guesses = ui.h("div");
  guesses.style.display = "flex";
  guesses.style.flexDirection = "column";
  guesses.style.gap = "2px";
  const revealButton = ui.button(text("\u67E5\u770B\u8C1C\u5E95", "Reveal"), { variant: "plain", size: "md", onClick: () => void reveal() });
  const play = ui.h("div");
  play.style.display = "flex";
  play.style.flexDirection = "column";
  play.style.gap = "10px";
  play.append(canvas, note, budget, guessRow, guesses, revealButton);
  scaffold.play.append(play);
  const uploaded = /* @__PURE__ */ new Set();
  let uploading = false;
  async function start(tier, button) {
    dismissed = null;
    writeDismissed("drawguess", null);
    await busy(ctx, button, async () => {
      await ctx.invoke("start", [tier]);
      await refresh();
    });
  }
  async function guess() {
    const value = guessInput.value.trim();
    if (!value) return;
    await busy(ctx, guessButton, async () => {
      await ctx.invoke("guess", [value]);
      guessInput.value = "";
      await refresh();
    });
  }
  async function reveal() {
    const ok = await ui.confirm({
      title: text("\u67E5\u770B\u8C1C\u5E95\uFF1F", "Reveal the word?"),
      body: text("\u63ED\u6653\u540E\u8FD9\u4E00\u5C40\u5C31\u7ED3\u675F\u4E86\u3002", "This ends the round."),
      danger: true
    });
    if (!ok) return;
    await busy(ctx, revealButton, async () => {
      await ctx.invoke("reveal");
      await refresh();
    });
  }
  async function upload(value) {
    if (uploading) return;
    const target = value.attempts.find((item) => !item.hasPng && !uploaded.has(item.id));
    if (!target) return;
    uploading = true;
    try {
      paint(canvas, target.strokes);
      const dataUrl = canvas.toDataURL("image/png");
      uploaded.add(target.id);
      await ctx.invoke("art", [target.id, dataUrl]);
    } catch (error) {
      uploaded.delete(target.id);
      ctx.ui.toast(errorText(error), "bad");
    } finally {
      uploading = false;
    }
  }
  function render(value) {
    const last = value.attempts[value.attempts.length - 1];
    if (last) {
      paint(canvas, last.strokes);
    } else {
      const context = canvas.getContext("2d");
      if (context) context.clearRect(0, 0, DRAW_SPACE, DRAW_SPACE);
    }
    if (visionMode === "unavailable") {
      note.hidden = false;
      note.textContent = text(
        "\u8F85\u52A9\u89C6\u89C9\u8FDE\u7EED\u5931\u8D25\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u4E3B\u6A21\u578B\u81EA\u5DF1\u5224\u65AD\u3002",
        "Vision checks failed twice \u2014 falling back to the main model."
      );
    } else if (visionMode === "off") {
      note.hidden = false;
      note.textContent = text(
        "\u8F85\u52A9\u89C6\u89C9\u5DF2\u5173\u95ED\uFF0C\u7531\u4E3B\u6A21\u578B\u81EA\u5DF1\u5224\u65AD\uFF08\u53EF\u80FD\u4F1A\u5077\u61D2\uFF09\u3002",
        "Vision is off \u2014 the main model judges its own drawing (it may slack off)."
      );
    } else {
      note.hidden = phase !== "drawing";
      note.textContent = text("\u4F19\u4F34\u6B63\u5728\u753B\u2026", "Your partner is drawing\u2026");
    }
    budget.replaceChildren();
    if (value.attempts.length > 0) {
      budget.append(ui.pill(text(`\u753B\u56FE ${value.attempts.length} / ${value.maxChecks}`, `Drawings ${value.attempts.length} / ${value.maxChecks}`)));
      value.attempts.forEach((item, index) => {
        const score = item.points === null ? "\u2026" : `${item.points}/3`;
        const label = text(`\u7B2C ${index + 1} \u5F20 ${score}`, `#${index + 1} ${score}`);
        const chip = ui.pill(label, item.points === null ? "plain" : item.points >= 2 ? "on" : "off");
        chip.title = text("\u8FD9\u5F20\u753B\u7684\u76F2\u8BC4\u5F97\u5206\uFF08\u6EE1\u5206 3\uFF0C2 \u5206\u5373\u5B9A\u7A3F\uFF09", "Blind score for this drawing (max 3; 2 locks it in)");
        budget.append(chip);
      });
    }
    guessRow.hidden = value.phase !== "guessing";
    revealButton.hidden = value.phase === "idle" || value.phase === "ended";
    guesses.replaceChildren();
    for (const item of value.guesses) {
      const row = ui.h("p", "muted");
      row.style.margin = "0";
      row.textContent = `${item.correct ? "\u2713" : "\u2717"} ${item.text}`;
      guesses.append(row);
    }
  }
  async function refresh() {
    const home = await ctx.invoke("home");
    const payload = await ctx.invoke("state");
    const value = payload.snapshot;
    latest = value;
    visionMode = payload.vision;
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (home.phase === "idle") {
      scaffold.show("main");
      scaffold.setPrimary(text("\u5F00\u59CB\u6E38\u620F\xB7\u7B80\u5355", "Start \xB7 easy"));
      return;
    }
    if (home.phase === "ended") {
      const key = `draw:${value.round}`;
      if (dismissed === key) {
        scaffold.show("main");
        scaffold.setPrimary(text("\u5F00\u59CB\u6E38\u620F\xB7\u7B80\u5355", "Start \xB7 easy"));
        return;
      }
      scaffold.setEnd(
        endTitleFor(text, "drawguess", value.guessed ? "win" : "lose"),
        value.closing,
        text
      );
      scaffold.show("end");
      return;
    }
    scaffold.setPrimary(text("\u7EE7\u7EED\u6E38\u620F", "Continue"));
    scaffold.show("play");
    render(value);
    await upload(value);
  }
  const interval = wire({
    scaffold,
    ctx,
    text,
    game: "drawguess",
    phase: () => phase,
    render: () => {
      if (latest) render(latest);
    },
    sync: refresh
  });
  void refresh().catch((error) => ctx.ui.toast(errorText(error), "bad"));
  return {
    dispose() {
      interval.dispose();
    }
  };
}
var REVERSI_FILES = "abcdefgh";
var REVERSI_LEVELS = [
  { value: 1, zh: "\u4F19\u4F34\u81EA\u5DF1\u6765", en: "Partner solo" },
  { value: 2, zh: "\u4F19\u4F34\u770B\u63D0\u793A", en: "Partner with hints" },
  { value: 3, zh: "\u4F19\u4F34\u4E0D\u7559\u60C5", en: "Partner unleashed" }
];
function levelLabel(text, level) {
  const item = REVERSI_LEVELS.find((entry) => entry.value === level) ?? REVERSI_LEVELS[1];
  return text(item.zh, item.en);
}
function levelHint(text, level) {
  if (level === 1) {
    return text("\u53EA\u7ED9\u53EF\u843D\u70B9\uFF0C\u4F19\u4F34\u81EA\u5DF1\u7B97\u3002", "Only the legal moves \u2014 your partner works it out.");
  }
  if (level === 3) {
    return text("\u6BCF\u4E2A\u53EF\u843D\u70B9\u90FD\u9644\u4E09\u5C42\u641C\u7D22\u7684\u53C2\u8003\u5206\u3002", "Every legal move comes with a 3-ply search score.");
  }
  return text("\u6BCF\u4E2A\u53EF\u843D\u70B9\u90FD\u9644\u8D2A\u5FC3\u53C2\u8003\u5206\uFF0C\u4F46\u53EA\u662F\u53C2\u8003\u3002", "Every legal move comes with a greedy score \u2014 a hint, not an order.");
}
function mountReversi(ctx) {
  const ui = ctx.ui;
  const text = pickText(ctx);
  const doc = ctx.root.ownerDocument;
  let phase = "idle";
  let snapshot = null;
  let replay = null;
  let dismissed = readDismissed("reversi");
  let level = 2;
  const scaffold = buildScaffold(ctx, {
    title: text("\u9ED1\u767D\u68CB", "Reversi"),
    intro: [
      text("8\xD78 \u6807\u51C6\u76D8\uFF0C\u9ED1\u5148\uFF1B\u5148\u540E\u624B\u6BCF\u5C40\u968F\u673A\u3002", "Standard 8\xD78 board, black moves first; the first move is randomised each game."),
      text("\u4F19\u4F34\u81EA\u5DF1\u7B97\u68CB\uFF0CWorld \u53EA\u6821\u9A8C\u843D\u70B9\uFF1B\u5B83\u60F3\u592A\u4E45\u4F1A\u6682\u505C\uFF0C\u7B49\u4F60\u70B9\u300C\u7EE7\u7EED\u300D\u3002", "Your partner picks the moves and the world only checks them. If it thinks too long the game pauses until you continue."),
      text("\u6BCF\u5C40\u53EF\u4EE5\u6094\u68CB\u4E24\u6B21\uFF0C\u4E5F\u53EF\u4EE5\u968F\u65F6\u8BA4\u8F93\u3002", "Two undos per game; you can resign at any time.")
    ],
    primaryLabel: text("\u5F00\u59CB\u6E38\u620F", "Start"),
    onPrimary: () => {
      if (phase === "idle" || phase === "ended") void start();
      else scaffold.show("play");
    },
    onHistory: () => void 0,
    onReplay: (entry) => {
      void openReplay(entry.id);
    },
    onBack: () => {
      dismissed = snapshot?.createdAt ?? null;
      writeDismissed("reversi", dismissed);
      syncLevelControl(false);
    },
    text
  });
  const levelRow = doc.createElement("div");
  levelRow.style.display = "flex";
  levelRow.style.alignItems = "center";
  levelRow.style.gap = "10px";
  const levelTitle = ui.h("span", "muted", text("\u96BE\u5EA6", "Level"));
  const slider = doc.createElement("input");
  slider.type = "range";
  slider.min = "1";
  slider.max = "3";
  slider.step = "1";
  slider.value = String(level);
  slider.style.flex = "1";
  slider.style.minWidth = "120px";
  const levelValue = ui.h("span", "mono", levelLabel(text, level));
  levelRow.append(levelTitle, slider, levelValue);
  const hint = ui.h("p", "muted", levelHint(text, level));
  hint.style.margin = "0";
  hint.style.fontSize = "12px";
  scaffold.main.insertBefore(levelRow, scaffold.actions);
  scaffold.main.insertBefore(hint, scaffold.actions);
  slider.addEventListener("input", () => {
    level = Number(slider.value);
    levelValue.textContent = levelLabel(text, level);
    hint.textContent = levelHint(text, level);
  });
  const statusLevel = ui.h("p", "muted");
  statusLevel.style.margin = "0";
  statusLevel.style.fontSize = "13px";
  const statusScore = ui.h("p");
  statusScore.style.margin = "0";
  statusScore.style.fontSize = "20px";
  statusScore.style.fontWeight = "800";
  const statusTurn = ui.h("p", "muted");
  statusTurn.style.margin = "0";
  statusTurn.style.fontWeight = "600";
  const boardEl = doc.createElement("div");
  boardEl.style.display = "grid";
  boardEl.style.gridTemplateColumns = "repeat(8, 1fr)";
  boardEl.style.width = "630px";
  boardEl.style.minWidth = "630px";
  boardEl.style.flex = "0 0 auto";
  boardEl.style.aspectRatio = "1";
  boardEl.style.gap = "2px";
  boardEl.style.padding = "6px";
  boardEl.style.boxSizing = "border-box";
  boardEl.style.background = "#2f6a4b";
  boardEl.style.borderRadius = "12px";
  const boardWrap = doc.createElement("div");
  boardWrap.style.overflowX = "auto";
  boardWrap.style.maxWidth = "100%";
  boardWrap.append(boardEl);
  const cells = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const cell = doc.createElement("button");
      cell.type = "button";
      cell.style.position = "relative";
      cell.style.padding = "0";
      cell.style.border = "none";
      cell.style.borderRadius = "4px";
      cell.style.background = "rgba(0, 0, 0, 0.18)";
      cell.style.aspectRatio = "1";
      cell.style.cursor = "pointer";
      cell.addEventListener("click", () => void playAt(row, col));
      cells.push(cell);
      boardEl.append(cell);
    }
  }
  const pauseNote = ui.msgline("");
  pauseNote.hidden = true;
  const undoButton = ui.button(text("\u6094\u68CB", "Undo"), { variant: "plain", size: "md", onClick: () => void undo() });
  const resignButton = ui.button(text("\u8BA4\u8F93", "Resign"), { variant: "danger", size: "md", onClick: () => void resign() });
  const resumeButton = ui.button(text("\u7EE7\u7EED", "Continue"), { variant: "primary", size: "md", onClick: () => void resume() });
  resumeButton.hidden = true;
  const replayBar = doc.createElement("div");
  replayBar.hidden = true;
  replayBar.style.display = "none";
  replayBar.style.flexDirection = "column";
  replayBar.style.gap = "8px";
  const replayNote = ui.msgline("");
  const replayRow = doc.createElement("div");
  replayRow.style.display = "flex";
  replayRow.style.gap = "8px";
  replayRow.style.flexWrap = "wrap";
  const replayFirst = ui.button("\u23EE", { variant: "plain", size: "sm", onClick: () => void stepReplay(-9999) });
  const replayPrev = ui.button("\u25C0", { variant: "plain", size: "sm", onClick: () => void stepReplay(-1) });
  const replayNextBtn = ui.button("\u25B6", { variant: "plain", size: "sm", onClick: () => void stepReplay(1) });
  const replayLast = ui.button("\u23ED", { variant: "plain", size: "sm", onClick: () => void stepReplay(9999) });
  const replayResumeButton = ui.button(text("\u4ECE\u6B64\u523B\u5F00\u59CB\u5BF9\u5C40", "Play from here"), {
    variant: "primary",
    size: "md",
    onClick: () => void resumeReplay()
  });
  const replayExitButton = ui.button(text("\u9000\u51FA\u590D\u76D8", "Exit replay"), {
    variant: "plain",
    size: "md",
    onClick: () => void exitReplay()
  });
  replayRow.append(replayFirst, replayPrev, replayNextBtn, replayLast, replayResumeButton, replayExitButton);
  replayBar.append(replayNote, replayRow);
  const actionsRow = doc.createElement("div");
  actionsRow.style.display = "flex";
  actionsRow.style.gap = "8px";
  actionsRow.style.flexWrap = "wrap";
  actionsRow.append(undoButton, resignButton, resumeButton);
  const play = doc.createElement("div");
  play.style.display = "flex";
  play.style.flexDirection = "column";
  play.style.gap = "10px";
  play.append(statusLevel, statusScore, statusTurn, boardWrap, pauseNote, replayBar, actionsRow);
  scaffold.play.append(play);
  async function start() {
    dismissed = null;
    writeDismissed("reversi", null);
    await busy(ctx, scaffold.primary, async () => {
      await ctx.invoke("start", [level]);
      await refresh();
    });
  }
  async function playAt(row, col) {
    const value = snapshot;
    if (!value || value.phase !== "playing" || value.turn !== "human") return;
    const label = `${REVERSI_FILES[col]}${row + 1}`;
    if (!value.legal.some((item) => item.label === label)) return;
    await busy(ctx, cells[row * 8 + col], async () => {
      await ctx.invoke("move", [label]);
      await refresh();
    });
  }
  async function undo() {
    await busy(ctx, undoButton, async () => {
      await ctx.invoke("undo");
      await refresh();
    });
  }
  async function resign() {
    const ok = await ui.confirm({
      title: text("\u8BA4\u8F93\uFF1F", "Resign?"),
      body: text("\u8FD9\u4E00\u5C40\u4F1A\u76F4\u63A5\u7ED3\u675F\uFF0C\u8BB0\u6210\u4F19\u4F34\u8D62\u3002", "This game ends right away and counts as a win for your partner."),
      danger: true
    });
    if (!ok) return;
    await busy(ctx, resignButton, async () => {
      await ctx.invoke("resign");
      await refresh();
    });
  }
  async function resume() {
    await busy(ctx, resumeButton, async () => {
      await ctx.invoke("resume");
      await refresh();
    });
  }
  function paint2(board, legal, lastMove, clickable) {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const cell = cells[row * 8 + col];
        const label = `${REVERSI_FILES[col]}${row + 1}`;
        cell.replaceChildren();
        const disc = board[row]?.[col] ?? null;
        if (disc) {
          const dot = doc.createElement("span");
          dot.style.position = "absolute";
          dot.style.inset = "10%";
          dot.style.borderRadius = "50%";
          dot.style.background = disc === "B" ? "#15181c" : "#f4f1e8";
          dot.style.boxShadow = "inset 0 -2px 4px rgba(0,0,0,0.35)";
          cell.append(dot);
        } else if (clickable && legal.has(label)) {
          const dot = doc.createElement("span");
          dot.style.position = "absolute";
          dot.style.inset = "36%";
          dot.style.borderRadius = "50%";
          dot.style.background = "rgba(255, 255, 255, 0.42)";
          cell.append(dot);
        }
        if (lastMove === label) {
          cell.style.outline = "2px solid #ffd166";
          cell.style.outlineOffset = "-2px";
        } else {
          cell.style.outline = "";
        }
        cell.disabled = !clickable || !legal.has(label);
      }
    }
  }
  function syncLevelControl(disabled) {
    slider.disabled = disabled;
    slider.style.opacity = disabled ? "0.55" : "1";
    slider.style.cursor = disabled ? "not-allowed" : "pointer";
  }
  let seenMoves = 0;
  let seenGame = null;
  function renderBoard(value) {
    const legal = new Set(value.legal.map((item) => item.label));
    paint2(value.board, legal, value.lastMove, value.phase === "playing" && value.turn === "human");
    replayBar.hidden = true;
    replayBar.style.display = "none";
    actionsRow.hidden = false;
    const yourColor = value.yourColor === "B" ? text("\u9ED1", "black") : text("\u767D", "white");
    const partnerColor = value.partnerColor === "B" ? text("\u9ED1", "black") : text("\u767D", "white");
    statusLevel.textContent = text(`\u96BE\u5EA6\uFF1A${value.levelLabel}`, `Level: ${value.levelLabel}`);
    statusScore.textContent = text(
      `\u4F60 ${value.score.human} : ${value.score.model} \u4F19\u4F34`,
      `You ${value.score.human} : ${value.score.model} partner`
    );
    let turnText = text(`\u8F6E\u5230\u4F60\uFF08\u4F60\u6267${yourColor}\uFF09`, `Your move (you are ${yourColor})`);
    if (value.phase === "paused") turnText = text("\u5DF2\u6682\u505C", "Paused");
    else if (value.phase === "ended") turnText = text(`\u7EC8\u5C40\uFF08\u4F60\u6267${yourColor}\uFF0C\u4F19\u4F34\u6267${partnerColor}\uFF09`, `Finished (you ${yourColor}, partner ${partnerColor})`);
    else if (value.turn === "model") turnText = text(`\u4F19\u4F34\u5728\u60F3\u2026\uFF08\u4F19\u4F34\u6267${partnerColor}\uFF09`, `Your partner is thinking\u2026 (partner is ${partnerColor})`);
    statusTurn.textContent = turnText;
    if (value.id !== seenGame) {
      seenGame = value.id;
      seenMoves = 0;
    }
    if (value.moves.length > seenMoves) {
      const lastMove = value.moves[value.moves.length - 1];
      if (lastMove && lastMove.side === "model") playClick();
      seenMoves = value.moves.length;
    }
    pauseNote.hidden = value.phase !== "paused";
    if (value.phase === "paused") {
      pauseNote.textContent = text(
        `\u4F19\u4F34\u5361\u4F4F\u4E86\uFF08${value.pausedReason ?? "\u6CA1\u6709\u843D\u5B50"}\uFF09\uFF0C\u70B9\u300C\u7EE7\u7EED\u300D\u518D\u8BA9\u5B83\u60F3\u4E00\u6B21\u3002`,
        `Your partner stalled (${value.pausedReason ?? "no move"}). Press \u201CContinue\u201D to let it think again.`
      );
      pauseNote.classList.add("bad");
    } else {
      pauseNote.classList.remove("bad");
    }
    undoButton.disabled = value.phase !== "playing" || value.undoLeft <= 0;
    undoButton.textContent = text(`\u6094\u68CB\uFF08\u5269 ${value.undoLeft}\uFF09`, `Undo (${value.undoLeft} left)`);
    resignButton.hidden = value.phase === "ended";
    resumeButton.hidden = value.phase !== "paused";
    syncLevelControl(value.phase === "playing" || value.phase === "paused");
  }
  function renderReplay(value) {
    paint2(value.board, /* @__PURE__ */ new Set(), value.lastMove, false);
    replayBar.hidden = false;
    replayBar.style.display = "flex";
    replayNote.classList.remove("bad");
    replayNote.textContent = text(
      "\u8FD9\u662F\u590D\u76D8\uFF0C\u4E0D\u662F\u65B0\u7684\u4E00\u5C40\uFF1A\u53EF\u4EE5\u9010\u6B65\u770B\uFF0C\u4E5F\u53EF\u4EE5\u4ECE\u6B64\u523B\u63A5\u7740\u4E0B\u3002",
      "This is a replay, not a new game: step through it, or continue from here."
    );
    actionsRow.hidden = true;
    pauseNote.hidden = true;
    replayFirst.disabled = value.step <= 0;
    replayPrev.disabled = value.step <= 0;
    replayNextBtn.disabled = value.step >= value.total;
    replayLast.disabled = value.step >= value.total;
    replayResumeButton.disabled = value.step >= value.total;
    statusLevel.textContent = text(`\u96BE\u5EA6\uFF1A${value.levelLabel}`, `Level: ${value.levelLabel}`);
    statusScore.textContent = text(
      `\u4F60 ${value.score.human} : ${value.score.model} \u4F19\u4F34`,
      `You ${value.score.human} : ${value.score.model} partner`
    );
    statusTurn.textContent = text(
      `\u590D\u76D8 \xB7 \u7B2C ${value.step} / ${value.total} \u624B`,
      `Replay \xB7 move ${value.step} / ${value.total}`
    );
    syncLevelControl(true);
  }
  async function openReplay(entryId) {
    try {
      const payload = await ctx.invoke("replay", [entryId]);
      snapshot = payload.snapshot;
      replay = payload.replay;
      if (replay) {
        scaffold.show("play");
        renderReplay(replay);
      }
    } catch (error) {
      ctx.ui.toast(errorText(error), "bad");
    }
  }
  async function stepReplay(delta) {
    try {
      const payload = await ctx.invoke("replayStep", [delta]);
      snapshot = payload.snapshot;
      replay = payload.replay;
      if (replay) renderReplay(replay);
    } catch (error) {
      ctx.ui.toast(errorText(error), "bad");
    }
  }
  async function resumeReplay() {
    try {
      const payload = await ctx.invoke("replayResume");
      snapshot = payload.snapshot;
      replay = payload.replay;
      await refresh();
    } catch (error) {
      ctx.ui.toast(errorText(error), "bad");
    }
  }
  async function exitReplay() {
    try {
      await ctx.invoke("replayExit");
      replay = null;
      await refresh();
    } catch (error) {
      ctx.ui.toast(errorText(error), "bad");
    }
  }
  async function refresh() {
    const home = await ctx.invoke("home");
    const payload = await ctx.invoke("state");
    snapshot = payload.snapshot;
    replay = payload.replay;
    phase = home.phase;
    scaffold.setProgress(progressLine(text, home));
    if (replay) {
      scaffold.show("play");
      renderReplay(replay);
      return;
    }
    const value = payload.snapshot;
    if (!value || home.phase === "idle") {
      scaffold.show("main");
      scaffold.setPrimary(text("\u5F00\u59CB\u6E38\u620F", "Start"));
      syncLevelControl(false);
      return;
    }
    if (home.phase === "ended") {
      if (dismissed !== null && dismissed === value.createdAt) {
        scaffold.show("main");
        scaffold.setPrimary(text("\u5F00\u59CB\u65B0\u4E00\u5C40", "New game"));
        syncLevelControl(false);
        return;
      }
      const outcome = value.winner === "human" ? "win" : value.winner === "model" ? "lose" : "draw";
      scaffold.setEnd(
        endTitleFor(text, "reversi", outcome),
        value.closing,
        text,
        text(
          `\u4F60 ${value.score.human} : ${value.score.model} \u4F19\u4F34 \xB7 ${value.levelLabel}`,
          `You ${value.score.human} : ${value.score.model} partner \xB7 ${value.levelLabel}`
        )
      );
      scaffold.setEndAnswer(null);
      scaffold.show("end");
      return;
    }
    scaffold.setPrimary(text("\u7EE7\u7EED\u6E38\u620F", "Continue"));
    scaffold.show("play");
    renderBoard(value);
  }
  const interval = wire({
    scaffold,
    ctx,
    text,
    game: "reversi",
    phase: () => phase,
    render: () => {
      if (replay) renderReplay(replay);
      else if (snapshot) renderBoard(snapshot);
    },
    sync: refresh,
    onReplay: (entry) => {
      void openReplay(entry.id);
    }
  });
  void refresh().catch((error) => ctx.ui.toast(errorText(error), "bad"));
  return {
    dispose() {
      interval.dispose();
    }
  };
}
var bundle = {
  panels: {
    mystery: { mount: mountMystery },
    trust: { mount: mountTrust },
    drawguess: { mount: mountDraw },
    reversi: { mount: mountReversi }
  }
};
var client_default = bundle;
export {
  client_default as default
};
