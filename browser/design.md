---
title: browser 模块设计
owner: Adg preset 维护者
status: current
last_reviewed: 2026-10-03
---

## 职责与边界

负责：把「用 Chromium 系浏览器（Chrome / Brave / Edge）做一次需要登录态的网页交互」收敛成**确定性的一组值和一个命令行契约** —— 规范 profile 路径、调试端口、浏览器可执行文件、**运行模式（默认无头，需要人工介入时才换有头）**、启动参数、实例的复用 / 启动 / 换模式决策，以及一条最小 CDP 通道（navigate / evaluate / screenshot）。

不负责（逐条防越权）：

- 不拥有浏览器：用的是**系统已装的** Chromium 系浏览器（Chrome / Brave / Edge，标准位置探测 + `ADG_CHROME` 覆盖，次序见「非功能红线」），不下载、不安装、不打包浏览器；
- 不拥有用户浏览器里**既有的**标签页：本模块只关它自己刚开的临时页、以及调用方用 `--match` / `--tab` 明确点名的页（I9 / I10）。「哪一页已经不需要了」这种语义判断不在本模块 —— 它只在工具侧留护栏（不点名不关、不关到 0 个）；
- 不拥有 profile 里的登录态：本模块只**指向**一个目录，从不在其中读写 cookie 库、不导出凭据、不给任何站点代填账号密码 —— 登录永远由人**在有头窗口里**完成（所以"默认无头"不是"不许登录"：撞上登录墙就换成有头，让人进去，见 I11）；
- 不拥有沙箱与权限：本机沙箱（`workspace-write` / `read-only`）下浏览器起不来是 host-plane 的事实，本模块只能在失败时**如实报错**，不做降级、不重试换参数（闸门本身在 preset 侧，见 `preset/design.md` I11）。**无头不是绕开它的路径**：受限令牌下有头无头死在同一条 IPC 上（2026-10-03 实测，见 `testing-guide.md` 的人工 review 项与 `docs/evidence.md` §6）；
- 不拥有"这里需不需要人工"这个判断：什么时候必须换成有头窗口，由专家按站点信号决定（登录墙 / 验证码 / 挑战页），本模块只执行**换模式**这个动作并把状态如实报出；换成有头之后人在窗口里做什么，同样不属于本模块；
- 不拥有用户问答通道：撞上登录墙 / 验证码时的**转达**由调度者做（`preset/design.md` I12），本模块只负责「把窗口开好」与「如实报出状态」；
- 不拥有预设与部署：`preset/agent.cordis.yml` 的 persona 引用本模块的契约，`install.ps1` / `install.sh` 把它拷到用户根 —— 两者都不是本模块的一部分；
- 不做浏览器指纹伪装、不做验证码识别、不做反检测：这三件事既越界也不稳定（见非功能红线）。

## 依赖关系

- 依赖：Node 内建的 `node:child_process` / `node:fs` / `node:path` / `node:os`，以及两个**全局**对象 `fetch` 与 `WebSocket`（后者要求 Node ≥ 22，`assertRuntime()` 显式报错，不静默降级）。无第三方包依赖 —— 这是不变量 I6，由 `test/browser.test.mjs` 钉住。
- 被依赖：
  - `preset/agent.cordis.yml` 的 `agent-browser` 行（`agent_browser` 专家）按本模块的命令行契约执行浏览器交互；**persona 只写命令与纪律，不复制选项表**；
  - `install.ps1` / `install.sh` 把 `browser/` 拷到 `${DSH_HOME:-~/.dsh}/browser/`（部署落点与仓库路径同名，减少一层映射）；
  - `docs/evidence.md` 引用本模块的真机实测（§8）；根 `README.md` 的「浏览器工具链与登录态资产」一节向人解释同一套东西。
- 跨模块改动路由：改命令行契约（命令名、输出行、退出码）→ 先读 `preset/agent.cordis.yml` 的 `agent-browser` persona 与本模块 `testing-guide.md` 的消费侧契约，再改；改 `launch` 的默认行为（**尤其默认模式**）→ 先读 `preset/design.md` I11（权限闸门）与 I12（人工介入）、根 `README.md` 的浏览器小节，确认没有把闸门或"登录由人完成"的分工写坏。

## 核心数据模型

### BrowserTarget（不可变值对象）

一次调用要驱动的「哪个浏览器」：`profile`（绝对路径）、`port`、`chrome`（可执行文件绝对路径）、`mode`（目标运行模式，见下）、`args`（启动参数数组）。创建后冻结，改 = 用新的输入重新解析。

- 不变量：
  - I1: profile 只能来自**显式配置**（`--profile` / `ADG_BROWSER_PROFILE`）或**规范默认**（`<DSH_HOME>/browser-profile`）；禁止任何随会话工作区漂移的推断（相对路径只在 `--profile` 显式给出时按 cwd 解析）。
  - I2: 启动参数禁止出现伪装 / 降权旗标（`--no-sandbox`、`--disable-blink-features=…`、`--user-agent=…`、`--disable-web-security`）。来源：本机旧形态（那时用一个一次性启动脚本按变体拼旗标，2026-10-02 复核该脚本已不在机器上，**未随仓库分发、当前不可复跑**）同时传了前三个，而它的驱动方式是 `connectOverCDP`（只连不启），这三个旗标零收益。**无头不需要 `--no-sandbox`**：2026-10-03 实测，`--headless=new` 在全访问下裸起即可（这条是"不需要"，不是"可以加"）。
  - I4: 端口非法值（非整数、< 1、> 65535）禁止静默回落到默认值 —— 静默回落会让两个不同的实例占同一个默认端口，或让调用方以为自己连的是 A 其实连的是 B。

### BrowserMode（值对象）

一次启动要用的**运行模式**：`headless`（默认）或 `headed`。它不是一个可以事后猜的状态 —— 活着那个实例的模式由 CDP `/json/version` 的 `User-Agent` 读出（`detectMode`），不需要状态文件。来源：2026-10-03 用户拍板「默认无头，只在需要人工介入时才用有头」。

- 不变量：
  - I11: **默认无头；换模式必须显式、且先优雅关后开**。
    - ① 不给 `--headless` / `--headed` 时一律无头（也可用 `ADG_BROWSER_MODE` 全局指定；非法值直接报错、不回落 —— 与 I4 同口径）。
    - ② 活着的实例与目标模式**相同**、模式**读不出来**（`unknown`）、或**模式不同但调用方没有显式要求模式**（当时解析出来的只是"默认值"）→ 一律 **复用**，绝不为了"顺便统一模式"去动它（unknown 分支标 `modeUnverified`、未显式分支标 `modeNotRequested`，两者都要在输出里说明"没有动它"并给出显式换法的命令）。来源：不带旗标的 `launch` 是专家最常打的那条命令，而它撞上"用户正在有头窗口里登录"就会砸掉现场。
    - ③ 只有**显式请求的另一种模式**才换（单次 `--headless` / `--headed`，或环境变量 `ADG_BROWSER_MODE`；判定在 `modeIsExplicit`），且换法只有一条：`Browser.close` 优雅关掉（登录态落盘）→ 等端口落下 → 用**同一个 profile、同一个端口**按目标模式重开。理由是硬事实：一个 profile 同一时刻只能有一个实例 —— 第二个进程要么把启动请求转交给活着的那个然后自己退 0，要么直接失败退出（2026-10-03 实测：有头第二个实例 `exit 0` + 转交，无头第二个实例 `exit 21`）。
    - ④ 启动参数必须由 `launchArgs` 构造且**非空**。空 argv 等于"不带任何参数启动浏览器"——那是浏览器**自己的默认 profile**，请求会被转交给用户日常那个实例（2026-10-03 真机事故：换模式一直 `exit=0`、端口从未起来，用户侧还多出一堆窗口）。所以 `planLaunch` 的 `switch` 与 `start` 一样必须给出 `args`，调用方在 spawn 前还要再拒一次空数组。

### BrowserInstance（生命周期型）

端口上的那个浏览器进程（本模块**不持有**它的 pid：实测启动进程可能先退出而浏览器还活着，定位只能靠端口与 profile）。

- 属性：`port`、`profile`、`chrome`、`browser`（CDP 报回的版本串，absent 时未知）、`mode`（由 UA 读出的 `headless` / `headed` / `unknown`，absent 时未知）。
- 状态机：`absent` → `starting` → `live` → `closed`
  - `absent`：端口上没有任何 CDP 端点。**它不是**「没有浏览器在跑」——用户日常的浏览器就在跑，只是没有调试端口。
  - `starting`：已 spawn，正在等 `/json/version` 起来。**它不是**「可用」：这期间任何页面操作都必须先失败。
  - `live`：`/json/version` 可达。**它不是**「当前页已登录」——登录是与站点之间的事，本模块无从判断。
  - `closed`：`Browser.close` 之后端口不再可达。**它不是**「数据丢了」：优雅关闭正是登录态落盘的时刻（§8 实测）。**注意端口先落、进程后走**：实测端口约 1–2 ms 就不可达，而进程还要约 215 ms 才退出（退出码 0）—— 所以"端口没了"不等于"锁放了"。
  - 迁移唯一入口：`absent|closed → starting → live` 只能由 `cli.mjs launch` 触发；`live|starting → closed` 只能由 `cli.mjs close` 触发，**或者**由 `cli.mjs launch` 的显式换模式触发（I11 是这条"唯一入口"的唯一例外：它自己先关后开）。禁止绕过对象直接改状态（例如手工 kill 进程：那会跳过落盘）。
- 不变量：
  - I3: `live` 时禁止重启。`launch` 必须先探测端口，活着就**复用**并按需补开标签页。来源：重启会丢内存里的会话态，并逼用户重新登录 —— 而「用户刚登录完」正是最不该被打断的时刻。**唯一例外是 I11 的显式换模式**：调用方明说"要另一种模式"，才允许先优雅关掉再重开；这不是"重启"，是模式迁移，且只有这一条路。
  - I8: 关浏览器只有一个入口（`closeBrowser` → `Browser.close`）。`PageSession.close()` 只断开 CDP 连接，**禁止**关浏览器。

### PageSession（句柄型）

一次「连上某一页并操作它」的句柄：短生命周期、对外只暴露 `goto` / `text` / `evalJs` / `shot` / `close`，外加一个 `created` 标记（这一页是不是本次调用自己开的 —— I10 的判据）与 `target`（被操作的页面目标）。

- 状态机：`open` → `closed`。迁移唯一入口：`pageSession()` 创建、`close()` 结束；`open` 调用 `close`、`closed` 再调用 `close` 都是自环（幂等）。
- 不变量：
  - I5: 页面选择必须**确定性**且**不可猜测**：只认 `type === 'page'`、带 `webSocketDebuggerUrl`、非 `devtools://` 的目标；`--match` 未命中、`--tab` 越界或为负、目标列表为空，四种情形都必须报错，禁止「随便挑一页」。
  - I7: CDP 通道的协议行为必须守四件事：请求按 `id` 关联（乱序返回各归各位）、CDP 错误映射成带方法名的 `Error`、事件通知与未知 `id` 被忽略、连接关闭后 `send` 与在途请求都拒绝。

### PageTab（清理型）

一个**标签页目标**，以及「谁有权关掉它」。来源是实测：一次真实的酒店比价任务在用户窗口里留下 **19 个标签页**（12 个携程酒店详情页，另有只差 query 的列表页与重复的首页）—— 旧实现里 `text/eval/shot --url <新地址>` 为了读一页会新开标签，读完就再也不管，于是「读得越多、页越乱」。

- 状态机：`open` → `closed`。迁移唯一入口：`Target.createTarget` 创建、`Target.closeTarget` 关闭 —— 后者必须在**浏览器级**端点上发（页面级端点关不掉别人，也关不掉自己所在的 target）。幂等：已关闭的 target 再关一次不报错。
- 不变量：
  - I9: 关标签页必须**显式点名**，且**不许关到 0 个页面**。`close-tab` 只接受 `--match <子串>`（关掉所有匹配的）或 `--tab <n>`（关那一个）；不给选择器、没命中、越界、缺值、以及「这一关会剩下 0 个页面」五种情形一律报错。最后一条是护栏 I8 的必要条件：把页面关到 0 个会让 Chrome 自己退出，那等于**绕过 `close`**（而 `close` 才带着「登录态落盘」的语义与提示）。
  - I10: **谁开的谁收**：`text` / `eval` / `shot --url <新地址>` 为读一页而开的临时标签，命令结束时要自己收走（`--keep` 明确要留才留）；`open` / `launch` 开的页**不**自动关（它们是「把窗口留给用户」的动作）。判据来自 `pageSession` 的 `created` —— 没有它就分不清「这一页是我开的」与「这一页用户早就开着了」，而后者绝不能被自动关掉。**补充两半（2026-09-27 实测）**：① **不许抢跑**：临时页必须先在 `about:blank` 建、attach 之后再 `Page.navigate` 并等可读状态 —— 早先是「按目标 URL 建页 + 固定等 600ms 就读」，实测 example.com / qunar / ctrip 三个真实站点**全部读到 `BYTES=0`**；空正文与「这页本来就空」在调用方看来一模一样，会白烧一整轮，所以等不到可读状态必须**报错**而不是返回空正文。② **失败路径同样"谁开的谁收"**：初始导航失败或超时时，`pageSession` 自己关掉那个临时页（只关 `created` 的），别人开的页一律不碰。
  - 边界（I9 / I10 都适用）：本模块**不判断**哪一页「已经不需要了」。它只关 (a) 自己刚开的临时页、(b) 调用方点名匹配的页 —— 语义判断留给专家（收尾时点名清站点），护栏留在工具侧。

## 对外接口

- 命令行契约：`cli.mjs` 的 `USAGE` 常量（**唯一真相源**，命令名、选项、退出码都在那里；本文不复制选项表）。`node cli.mjs help` 打印它。
- 输出行契约：`KEY=value` 单行（`STATE` / `MODE` / `DEFAULT_MODE` / `SWITCHED_FROM` / `RETRY` / `PORT` / `PROFILE` / `CHROME` / `BROWSER` / `TABS` / `TAB <i> | <title> | <url>` / `TAB_EXISTS` / `TAB_OPENED` / `TAB_CLOSED` / `CLOSED_TABS` / `CLOSED` / `SHOT` / `OUT` / `RESULT`），失败写 stderr 的 `ERROR=<msg>`。退出码：0 成功 / 1 运行期错误 / 2 用法错误（与 `tools/check-preset.mjs` 的 0/1/2 同形）。
- 库接口：`lib/target.mjs`（纯函数层：`resolveMode` / `detectMode` / `launchArgs` / `planLaunch`）与 `lib/cdp.mjs`（通道层）；`cdp.mjs` 的 `connect()` 接受可注入的 `socketFactory`，这是测试能在无浏览器机器上跑的原因。

## 非功能红线

- 禁止引入第三方依赖（playwright / puppeteer / ws 等一律不许）。来源：旧形态为驱动浏览器装了 `playwright-core`，它启动时自带 `--remote-debugging-pipe` 与 `Page.addScriptToEvaluateOnNewDocument` 注入、并自带 `--disable-blink-features=AutomationControlled`；本模块要的只是三个方法，不值得换那套注入面。I6 由测试钉住。
- 禁止把 profile 写进会话工作区、或写死任何本机绝对路径。来源：旧 persona 写的是「放工作区里一个固定目录」，工作区一换 profile 就换，登录态当场清零 —— 这正是「浏览器代理经常被登录拦住」的直接成因。（这一条里出现的本机路径一律是**反例示范，非真实引用**：`<仓库根>\…`、`<用户根>\…` —— 它们是"不要写成什么样"的示例，不是让你去读的文件。）
- 浏览器候选次序是 **Chrome → Brave → Edge**，且只用「环境变量给出的标准安装位置」探测，禁止写死本机路径。来源：2026-10-01 本机实测——该机只装了 Brave 与 Edge，旧次序（Chrome → Edge）因此选中系统自带的 Edge，而用户要的是他主动装的 Brave。由 A20（次序、三种候选形状）与 A20b（只有 Brave + Edge 时选中 Brave）钉住。
- 禁止在人不在场 / 人可能正在窗口里操作的情况下关闭**有头**实例。来源：`live → closed` 会丢内存会话态；用户可能正登录到一半。这条对 I11 的换模式同样成立：**刚刚**换成有头、用户进去登录完之后，不许顺手切回无头 —— 切回去会把这个实例关掉。要用 `close` 或要换模式，必须先确认本轮交互已完成、且没人在这个窗口里做事。
- 禁止代填账号密码、禁止导出/读取 profile 的 cookie 库、禁止验证码识别或指纹伪装。来源：旧形态的 `start-chrome-headed.ps1` 带了伪装旗标与伪 UA；这三件事既不稳定（站点风控升级比脚本快），也越过了「登录由人完成」的边界（`preset/design.md` I12）。
- 禁止把「浏览器起不来」写成需要重试的情形：命中沙箱失败签名时必须停手如实报（`preset/design.md` I11）。**已知签名三条**（都是 2026-10-03 之前/当日的真机读数）：Chrome 退出码 **21**；Edge `FATAL:mojo\…\platform_channel.cc… Check failed: . : 拒绝访问。(0x5)`（行号随二进制版本变，本机 2026-10-03 是 146，2026-09-26 是 183 —— 行号是读数、不是判据，**认文本不认行号**）；Brave 退出码 **4294930433**（`0xFFFF7001`）配 `crashpad_client_win.cc… OpenProcess: 拒绝访问。 (0x5)` / `crash server failed to launch, self-terminating` —— **Brave 走的是 crashpad 这一条，不是 Mojo 那条**（2026-10-03 首次观测；此前"未观测"，不许再写成未观测，也不许把 Mojo 那行的文本套到它头上）。**无头不改变这个结论**：受限令牌下有头无头同形失败（2026-10-03 实测）。
- 禁止关掉**不是本任务开的**标签页（尤其用户正在登录 / 正在看的那个），也禁止用 `close-tab` 把页面关到 0 个来间接关浏览器（I9 / I10）。来源：用户窗口里既有登录态也有人正在用的页 —— 一个"清理得干净"的动作如果关掉了用户登录到一半的表单，代价远大于多留几个标签页。

## For Agents

动手前先读：`browser/AGENTS.md` → 本文件 → 改命令行契约再读 `preset/agent.cordis.yml` 的 `agent-browser` persona。

绝不能做：上面 7 条非功能红线；I3（重启活着的实例，唯一的例外是 I11 的**显式**换模式）；I8（用 `PageSession.close()` 关浏览器）；I9 / I10（关掉别人开的页、把页面关到 0 个、抢在页面加载之前就读、失败后把自己开的临时页留在窗口里）；I11（把有头当默认、拿默认模式去关一个活着的实例、静默换掉一个模式不明的活实例、用空参数启动浏览器）。

停止并升级人类：要推翻「登录由人完成」这条边界；要把默认模式改回有头；要改 profile 的规范默认路径；要引入第三方依赖；要增加任何形式的验证码自动化。

## 测试与验证

见 `browser/testing-guide.md`。