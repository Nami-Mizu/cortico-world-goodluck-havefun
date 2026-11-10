# 给接手这个包的人 / 模型

- `cortico.api` 是 6（world 契约版本）。Cortico 升到新契约时，先跑 `pnpm check:extension <包目录>` 看它打印的版本再改。
- 改了工具、事件或 `src/ENV_PROMPT.md` 之后，重跑 `pnpm describe:extension <包目录>`，否则 `describe.json` 与代码不一致（check 会报）。
- 工具名前缀固定 `goodluckhavefun_`；World id 固定 `goodluckhavefun`（必须全小写：WebUI 页 id 是 `world:<id>`，协议只接受小写字母数字与连字符，大小写或下划线写错整页会被 manifest 丢掉），配置路径因此是 `worlds.goodluckhavefun.*`。
- 四张面板 `mystery` / `trust` / `drawguess` / `reversi`（Cortico 每张面板就是一个页签，所以它们与「配置」「提示词」同级）。
  每张都实现 `home` / `history` / `state` 与各自的动作方法（`start`、`ask`/`say`/`choose`/`guess`、`reveal`、`art` 等），
  统一由 `private invoke(panel, method, args)` 分发。旧的单面板 `games` 已不存在。
  **切页签不许重置局面**（局面在 World 实例里，面板只做渲染）。
- `src/webui/client.ts` 是浏览器侧：只能 `import type` 来自 `cortico/*` 的东西，改完用 `pnpm build:webui` 重新产出 `dist/webui.js`。
  结束页在「复盘收尾」上面有一行 `setEndAnswer()`（推理游戏用来放「真相：…」）；有答案才显示，非 ended 分支记得 `setEndAnswer(null)` 清掉。
  四张面板共用 `buildScaffold()` 那套「主界面 / 一局 / 结束页 / 对局历史」骨架；输入框必须常驻节点，
  轮询重绘前先看 `typing()`（有焦点且有内容就跳过），否则会重演「输入框每几秒失焦」。
- 面板只调 `ctx.invoke`，不要在浏览器里直接 `fetch`。
- 面板拿到的 `state` **不是裸快照**：信任是 `{ snapshot, profiles }`、你画我猜是 `{ snapshot, vision }`，
  形状就是 `TrustPanelPayload` / `DrawPanelPayload`（分别在 `src/trust.ts` / `src/drawguess.ts`）。
  World 的返回类型与面板的读取共用这两个类型——0.9.2 的「分数 undefined」就是把载荷当裸快照读出来的，
  改形状先改类型，让 `tsc` 报错而不是在浏览器里 `undefined`。
- 改完面板除了两份 `tsc`，跑一次面板冒烟：把 `scratch/panel.ts` 打成 `_dev/panel-smoke.mjs` 再 `node` 跑。
  它在极小的 DOM 桩上真的 `mount()` 四张面板，能拦住「空白页（忘了往 `ctx.root` 挂）」和「渲染时读错形状」。
  桩里的 `El` 要带 `classList`（1.1.2 补的）：面板会用 `classList.add('bad')`，缺了它 `renderBoard` 会抛异常、refresh 被 catch 吞掉，画面停在主界面却没人发现。
- 对局历史在 `src/history.ts`：结束时 `save(entry)` 到 `<dataDir>/history/<游戏>.json`，**一页最多 5 局**（`HISTORY_PAGE_SIZE`）、每游戏留 100 局；
  同一局按 id 覆盖（收尾话后到也会更新）。**id 必须带开局时间**（`mystery:<createdAt>`、`drawguess:<createdAt>`），别用进程内局号——重启后局号会重数，撞上盘上的旧记录会被覆盖成「只剩两条」。`home`/`history` 前会先 `ensureRecorded()`。
- `buildScaffold()` 的 `show()` 只在视图真的变化时才 `fadeIn()`——别为了「每帧都刷新」去掉这个守卫，
  否则轮询会每 2.5 秒把整页渐入一次。`view` 初值是 `null`、并同时切 `hidden` 与 `style.display`：
  这样切页签重新 `mount()` 后的第一次 `show()` 会被当成「切换」，正好播一次渐入；
  只改 `hidden` 是不够的，`main` / 结束页的内联 `display:flex` 会把 `hidden` 盖掉。
- 结束页要能被「收起」：每个 mount 记一个 `dismissed` 键（推理游戏用局号、信任用 `matchId`、你画我猜用
  `draw:<局号>`），点「返回主界面」时记下它，refresh 看到 `phase==='ended'` 且键相同就留在主界面；
  结束时主按钮是「开始新一局」。这个键同时写进 `localStorage`（`goodluckhavefun.dismissed.<游戏>`），
  因为切页签会重新 `mount()`，只记在内存里会被忘掉、结束页又会弹出来（0.9.4 修的）。
- 三个输入框都用 `ui.input({ onCommit })` 接回车提交（0.9.4）；别改成监听 keydown 自己判 IME，
  `onCommit` 已经处理了中文组词。
- 信任的进化：玩家说话后如果模型这回合已选过、玩家还没选，`trustSayFromPanel` 会推
  `trust_prompt`，模型可以再调一次 `trust_choose` 覆盖；`TrustGame.choose('agent', …)` 因此是
  「赋值」而不是「已选过就抛错」，别把这条改回去。
- 二十二个工具，四组：
  - 推理游戏：`goodluckhavefun_mystery_{start,redraw,write,ask,judge,close,secret}`。判定有五种：是 / 不是 / 无关 / 问过了 / 不能回答（`cannot` 给「没法用是/否判」的问题，比如问原因、问过程、问感受、一次问好几件事；`ask` 的重复问题由 World 自动标「问过了」，不推事件、不占判定）。
  - 信任的进化：`goodluckhavefun_trust_{start,say,choose,close,state}`。
  - 你画我猜：`goodluckhavefun_drawguess_{start,draw,finish,judge,close,state}`。
  - 黑白棋：`goodluckhavefun_reversi_{start,move,state,close}`。
- `_redraw` 只在题目写下来之前可用（`MysteryGame.phase() === 'drawing'`），用途是标签互相打架时换一组；写下真相后调用会被拒。
- 三个维度（类型 / 基调 / 题材）写死在 `src/tags.ts` 的 `TAG_LABELS`，每个维度的候选标签读配置 `typeTags` / `toneTags` / `themeTags`（`、` 分隔，留空回落 `DEFAULT_TAG_VALUES`）。
- 违禁词：配置 `bannedWords`（`、` 分隔，默认空）。`MysteryGame.writePuzzle` 在长度校验之后用 `findBannedWords` 扫标题 + 谜面 + 真相，命中就抛错，这一局不落盘、可以重写。
- 一局的状态与题目落盘在 `<dataDir>/mystery/<局号>.json`：`_write` 写一次就不许改口，这是「真相防变卦」的实现；改落盘格式要同时看 `src/store.ts` 与 `src/mystery.ts`。
- 提问上限 50 字在 `src/mystery.ts` 的 `MAX_QUESTION_LENGTH`；一局题数上限读配置 `worlds.goodluckhavefun.maxQuestions`（默认 50），改配置立即生效。
- 真相（`answer`）只发给模型，别放进面板在揭晓前的任何返回值里（`snapshot()` 只在 `ended` 后给 `answer`）。
- 信任的进化在 `src/trust.ts`：`TARGET_SCORE=7`、`MAX_ROUNDS=12`、`MAX_SAY_LENGTH=60`；结算 CC +1/+1、D 对 C +2/0、DD -1/-1，分数 `Math.max(0, ...)`；双方都 `choose` 才 `settle()` 并进下一回合。
- 面板侧 `panelTrust()` 会把 `choice.agent` 抹成 null —— 玩家选之前浏览器不能看到 AI 的选择，这个遮罩别拆。
- 画像算法在 `src/trust.ts` 的 `buildProfile()`：复读机 / 一根筋按连续操作计数，老油条 / 小粉红 / 胡乱来按「同一回合序号跨局」的合作率（`deceiveGap`，`STRONG_GAP=0.34`、`CLOSE_GAP=0.15`，连续两轮才 +1）。模型只能读（`trust_state`），任何工具都不许写画像。
  面板只显示分数最高的两项、按「该项得分 / 画像总分」折算成百分比，你与伙伴各一行。
  复读机 / 一根筋的计数要乘 `PATTERN_WEIGHT = 0.6`：几乎每回合都会命中，不压一下会把另外三种挤出前两名。
- 称呼口径（0.9.6 起）：界面与提示词里模型称**伙伴**、玩家称**你**；`src/ENV_PROMPT.md` 里指代玩家一律用**对方**。改文案时保持这个口径，别再出现「AI」「主持人」「人类」「玩家」。工具名、事件名、配置键不受影响。
  **例外（1.1.4 起，按变量名走）**：给模型读的事件、工具回执、提示词里，**模型自己叫「你」、人类叫「对方」**；比分写 `你 X : Y 对方`（X = 模型的分、Y = 人类的分），胜负写「你赢了 / 对方赢了 / 平局」；模型侧不再出现「伙伴」「玩家」。面板侧仍是 `你 X : Y 伙伴`（人类视角）。
- 对局历史落 `<dataDir>/trust/history.json`（`src/trust-store.ts`，最多 100 局）；删掉它就等于清空画像。
- 你画我猜在 `src/drawguess.ts`：`DrawGame` 只做局面与预算，`src/strokes.ts` 校验笔画（0–1000 坐标、40 笔、每笔 60 点、宽 1–40），`src/words.ts` 是词库与 `wordsMatch`。
- 盲猜的判定权在 `src/vision.ts` 的 `scoreReading()`（top1=3、top3=2、描述命中=1、否则 0，`PASS_POINTS=2`）与 World 手里；**主模型不能自己宣布画对了**，这条别改回去。
- 辅助视觉走 OpenRouter 兼容的 `/chat/completions`，密钥是部署 `.env` 的 `GOODLUCKHAVEFUN_VISION_KEY`（`ctx.secret` 读）；配置 `visionEnabled` / `visionBaseUrl` / `visionModel` / `maxAttempts` / `maxChecks` 全都 `x-hot`。
- 开局前 `ensureVisionReady()` 会 ping 一次；连不上就把 `VISION_UNREADY_MESSAGE` 原样抛给面板。连续失败两次降级成「主模型自己判断」，别改成静默卡死。
- 预算：`maxChecks` 是**一局能画几张**的总闸（`DrawGame.budgetExhausted()` 为 `attempts.length >= maxChecks`），不是每批的次数。
  预算用完后 `_draw` 拒收、只能 `_finish`；玩家再猜错一次，`drawJudgeTool` 会直接 `end(false)` 收局并请模型写收尾——别改回「留在猜词阶段无限猜」。
- 揭晓前 `DrawPanelSnapshot` 的 `word` 必须是 null、也不能带 `description` / `guesses`：浏览器只能看到笔画与分数。
- `finish()` 要求面板已经回传过 PNG（`bestAttempt()` 只认 `png !== null` 的）；面板的 canvas 用同一套归一化坐标渲染，改坐标规则要三处一起改（`strokes.ts`、`client.ts` 的 `paint()`、`ENV_PROMPT.md`）。
- 一局落在 `<dataDir>/drawguess/<局号>/`（`round.json` + 每张 PNG）。
- 你画我猜的词表读配置 `wordsEasy` / `wordsHard`（`、` 分隔，`parseWordList` 负责切，空则回落 `WORD_BANK`）；
  `pickWordFrom(lists, previous, random, tier)` 是抽词入口，别再写死 `WORD_BANK`。
- 难度：`_start` 工具的 `tier`（`easy` / `hard`）由面板按钮传进来，不传则随机；面板用 `ctx.invoke('start',[tier])`。
  主界面两个开始按钮（都是蓝底主按钮，困难插在「对局历史」前）；结束页**不再放**「再来一次」那一排
  （0.10.1 删掉），换难度回主界面。别把它们挪回单按钮，那是 0.10.0 的玩法入口。
- 给模型看的比分文案（`trustText()`、`trust_state`、`trust_*` 的推送、收尾提示、黑白棋的 `reversi_*`）必须写成
  `你 X : Y 对方`（**X = 模型、Y = 人类**，见 1.1.4 的例外条款），胜负写「你赢了 / 对方赢了 / 平局」。0.10.1 与 1.1.3 各错过一次方向，改这类文案时先想「模型读到这句，会不会把『你』当成对面」
  的问题——面板显示是对的，只有模型读到的文本错了，改文案时两边一起对。
- 按钮音效在 `client.ts` 的 `playClick()`，由 `buildScaffold` 给 `root` 挂一个 click 委托（只对可用按钮响）。**必须用捕获阶段**（`addEventListener(..., true)`）：按钮自己的 onClick 会先 `busy()` 把自己置灰，冒泡回来时已经不算「可用」，「问」「猜」「合作/欺骗」就没声了。
  它懒建 `AudioContext`、整体 try/catch；不要在别处再建 AudioContext，也不要把没声音当成错误。
- 辅助视觉的 Key：配置 `visionApiKey` 优先，留空才用 `.env` 的 `GOODLUCKHAVEFUN_VISION_KEY`
  （World 里是 `visionKey()`）。填配置那一项是明文进部署 `config.json`，README 已写明取舍。
- 面板里的输入框是**常驻节点**：`render()` / `renderTrust()` / `renderDraw()` 只切 `hidden` 与 `disabled`，
  不许 `clear()` 之后再 `append` 回去——每 3 秒的轮询会因此把焦点抢掉。另有 `typing()` 守卫：
  有输入框正在打字时整轮不重绘。
- 信任的进化：`say` 可覆盖这一回合那句（“改口”），`choose` 只管自己的选择，两者互不阻塞；
  回合记录带 `at`（ISO），面板用 `clock(at)` 显示「真相揭晓」的时间。揭晓只用 `flash()` 动一次，
  别在每次轮询时重播。
- 黑白棋拆三块：`src/reversi.ts` 纯规则（`legalMoves` / `flipsFor` / `applyMove` / `discCount`，8×8，黑先），
  `src/reversi-ai.ts` 只算参考分（档 1 不给、档 2 贪心、档 3 三层搜索；权重角 +100、X 位 −40），
  `src/reversi-game.ts` 一局状态机（回合、pass、悔棋帧栈、暂停、认输、收尾）。
- **伙伴出招、World 校验**：`reversiMoveTool` 只能下 `legal` 里的点；非法一次回执重来，连续两次就 `pause()`。
  别改成「替它下」或「直接判负」。
- 超时暂停靠 `armReversiTimer()`（`MODEL_MOVE_TIMEOUT_MS = 90_000`，`unref()`），`stop()` 里要 `clearReversiTimer()`。
  暂停期间两侧都不能落子，等面板 `resume`。
- 悔棋每局两次（`UNDO_LIMIT`），`undo()` 退回「你上一次落子之前」，连伙伴的应手一起撤；别改成只撤一手。
- 难度读配置 `reversiLevel`（1/2/3，默认 2），面板的滑动条通过 `start(level)` 覆盖这一局；参考分只是参考，
  提示词里写明了「不强制按最高分下」。
- 黑白棋历史条目除了输赢/子数/手数/难度，还带 `replay: { level, humanColor, moves: [{ label, side }] }`——
  棋谱只给复盘用、不在面板上直接列。历史 id 用开局时间（`reversi:<createdAt>`）。
- 复盘：`src/reversi.ts` 的 `replayBoard(steps)` 从空盘重放（坏记录跳过），`world.ts` 用
  `reversiReplayView()` 出只读盘面、`reversiReplayStep(delta)` 钳步数、`reversiReplayResume()` 以当前局面
  新建一局（`ReversiGame({ start: { board, turn, baseMoves } })`，新局从零手记起、前缀只进历史）。
  面板的复盘条是常驻节点、只读盘面时藏起落子区；别在复盘状态下允许落子或悔棋。
- 面板棋盘用 `ctx.root.ownerDocument.createElement`（浏览器侧）与 0–1000 归一化坐标无关，格子是方形按钮；
  别把棋盘做成图片，注释里写明了「不引素材」。
- 测试不联网：`tests/` 用 `dryMountWorld`、`fakeWorldContext` 与 `FakeHost`；你画我猜的用例统一把 `ctx.cfg.visionEnabled` 设成 false。
- 提交前：`pnpm typecheck && pnpm test`；发布前再跑 `describe:extension` 与 `check:extension`。

## 发布（作者看的，不进 npm 包）

- **GitHub**：仓库名与包名一致（`cortico-world-goodluck-havefun`）。`dist/webui.js` 要提交进仓库（manifest 的 `webUiClient` 指着它，check 也拒绝缺产物的包）。
- **npm**：`npm publish --access public`。发布不可撤销，改内容只能升版本号。
- **版本号**：现在是 `1.0.0`，工具名、事件名、`worlds.goodluckhavefun.*` 配置键视为已承诺的接口。之后：
  PATCH +1 给「文档、提示词措辞、标签候选、面板排版」这类不碰接口也不碰一局规则的改动；
  MINOR +1 给「新游戏 / 新工具 / 新事件 / 新配置项 / 玩家能感知的规则变化」；
  破坏性改名或改语义才升 MAJOR，并在 CHANGELOG 里点名。
- **发布前自查**：`npm pack --dry-run` 看文件清单（应只有 src、dist、README、CHANGELOG、describe.json、package.json）；确认 `src/__check-entry.mjs`、`scratch/` 这类本地产物没被打进去。
