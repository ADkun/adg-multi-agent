---
title: browser 模块设计
owner: Adg preset 维护者
status: current
last_reviewed: 2026-10-01
---

## 职责与边界

负责：把「用有头 Chromium 系浏览器（Chrome / Brave / Edge）做一次需要登录态的网页交互」收敛成**确定性的一组值和一个命令行契约** —— 规范 profile 路径、调试端口、浏览器可执行文件、启动参数、实例的复用/启动决策，以及一条最小 CDP 通道（navigate / evaluate / screenshot）。

不负责（逐条防越权）：

- 不拥有浏览器：用的是**系统已装的** Chromium 系浏览器（Chrome / Brave / Edge，标准位置探测 + `ADG_CHROME` 覆盖，次序见「非功能红线」），不下载、不安装、不打包浏览器；
- 不拥有用户浏览器里**既有的**标签页：本模块只关它自己刚开的临时页、以及调用方用 `--match` / `--tab` 明确点名的页（I9 / I10）。「哪一页已经不需要了」这种语义判断不在本模块 —— 它只在工具侧留护栏（不点名不关、不关到 0 个）；
- 不拥有 profile 里的登录态：本模块只**指向**一个目录，从不在其中读写 cookie 库、不导出凭据、不给任何站点代填账号密码 —— 登录永远由人**在有头窗口里**完成；
- 不拥有沙箱与权限：本机沙箱（`workspace-write` / `read-only`）下浏览器起不来是 host-plane 的事实，本模块只能在失败时**如实报错**，不做降级、不重试换参数（闸门本身在 preset 侧，见 `preset/design.md` I11）；
- 不拥有用户问答通道：撞上登录墙 / 验证码时的**转达**由调度者做（`preset/design.md` I12），本模块只负责「把窗口开好」与「如实报出状态」；
- 不拥有预设与部署：`preset/agent.cordis.yml` 的 persona 引用本模块的契约，`install.ps1` / `install.sh` 把它拷到用户根 —— 两者都不是本模块的一部分；
- 不做浏览器指纹伪装、不做验证码识别、不做反检测：这三件事既越界也不稳定（见非功能红线）。

## 依赖关系

- 依赖：Node 内建的 `node:child_process` / `node:fs` / `node:path` / `node:os`，以及两个**全局**对象 `fetch` 与 `WebSocket`（后者要求 Node ≥ 22，`assertRuntime()` 显式报错，不静默降级）。无第三方包依赖 —— 这是不变量 I6，由 `test/browser.test.mjs` 钉住。
- 被依赖：
  - `preset/agent.cordis.yml` 的 `agent-browser` 行（`agent_browser` 专家）按本模块的命令行契约执行浏览器交互；**persona 只写命令与纪律，不复制选项表**；
  - `install.ps1` / `install.sh` 把 `browser/` 拷到 `${DSH_HOME:-~/.dsh}/browser/`（部署落点与仓库路径同名，减少一层映射）；
  - `docs/evidence.md` 引用本模块的真机实测（§8）。
- 跨模块改动路由：改命令行契约（命令名、输出行、退出码）→ 先读 `preset/agent.cordis.yml` 的 `agent-browser` persona 与本模块 `testing-guide.md` 的消费侧契约，再改；改 `launch` 的默认行为 → 先读 `preset/design.md` I11（权限闸门）与 I12（人工介入），确认没有把闸门或分工写坏。

## 核心数据模型

### BrowserTarget（不可变值对象）

一次调用要驱动的「哪个浏览器」：`profile`（绝对路径）、`port`、`chrome`（可执行文件绝对路径）、`args`（启动参数数组）。创建后冻结，改 = 用新的输入重新解析。

- 不变量：
  - I1: profile 只能来自**显式配置**（`--profile` / `ADG_BROWSER_PROFILE`）或**规范默认**（`<DSH_HOME>/browser-profile`）；禁止任何随会话工作区漂移的推断（相对路径只在 `--profile` 显式给出时按 cwd 解析）。
  - I2: 启动参数禁止出现伪装 / 降权旗标（`--no-sandbox`、`--disable-blink-features=…`、`--user-agent=…`、`--disable-web-security`）。来源：本机旧形态 `D:\dsh\.browser-tools\start-chrome-headed.ps1` 同时传了前三个，而它的驱动方式是 `connectOverCDP`（只连不启），这三个旗标零收益。
  - I4: 端口非法值（非整数、< 1、> 65535）禁止静默回落到默认值 —— 静默回落会让两个不同的实例占同一个默认端口，或让调用方以为自己连的是 A 其实连的是 B。

### BrowserInstance（生命周期型）

端口上的那个浏览器进程（本模块**不持有**它的 pid：实测启动进程可能先退出而浏览器还活着，定位只能靠端口与 profile）。

- 属性：`port`、`profile`、`chrome`、`browser`（CDP 报回的版本串，absent 时未知）。
- 状态机：`absent` → `starting` → `live` → `closed`
  - `absent`：端口上没有任何 CDP 端点。**它不是**「没有浏览器在跑」——用户日常的浏览器就在跑，只是没有调试端口。
  - `starting`：已 spawn，正在等 `/json/version` 起来。**它不是**「可用」：这期间任何页面操作都必须先失败。
  - `live`：`/json/version` 可达。**它不是**「当前页已登录」——登录是与站点之间的事，本模块无从判断。
  - `closed`：`Browser.close` 之后端口不再可达。**它不是**「数据丢了」：优雅关闭正是登录态落盘的时刻（§8 实测）。
  - 迁移唯一入口：`absent|closed → starting → live` 只能由 `cli.mjs launch` 触发；`live|starting → closed` 只能由 `cli.mjs close` 触发。禁止绕过对象直接改状态（例如手工 kill 进程：那会跳过落盘）。
- 不变量：
  - I3: `live` 时禁止重启。`launch` 必须先探测端口，活着就**复用**并按需补开标签页。来源：重启会丢内存里的会话态，并逼用户重新登录 —— 而「用户刚登录完」正是最不该被打断的时刻。
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
- 输出行契约：`KEY=value` 单行（`STATE` / `PORT` / `PROFILE` / `CHROME` / `BROWSER` / `TABS` / `TAB <i> | <title> | <url>` / `TAB_EXISTS` / `TAB_OPENED` / `TAB_CLOSED` / `CLOSED_TABS` / `SHOT` / `OUT` / `RESULT`），失败写 stderr 的 `ERROR=<msg>`。退出码：0 成功 / 1 运行期错误 / 2 用法错误（与 `tools/check-preset.mjs` 的 0/1/2 同形）。
- 库接口：`lib/target.mjs`（纯函数层）与 `lib/cdp.mjs`（通道层）；`cdp.mjs` 的 `connect()` 接受可注入的 `socketFactory`，这是测试能在无浏览器机器上跑的原因。

## 非功能红线

- 禁止引入第三方依赖（playwright / puppeteer / ws 等一律不许）。来源：旧形态为驱动浏览器装了 `playwright-core`，它启动时自带 `--remote-debugging-pipe` 与 `Page.addScriptToEvaluateOnNewDocument` 注入、并自带 `--disable-blink-features=AutomationControlled`；本模块要的只是三个方法，不值得换那套注入面。I6 由测试钉住。
- 禁止把 profile 写进会话工作区、或写死任何本机绝对路径（`D:\dsh\…`、`C:\Users\<某人>\…`）。来源：旧 persona 写的是「放工作区里一个固定目录」，工作区一换 profile 就换，登录态当场清零 —— 这正是「浏览器代理经常被登录拦住」的直接成因。
- 浏览器候选次序是 **Chrome → Brave → Edge**，且只用「环境变量给出的标准安装位置」探测，禁止写死本机路径。来源：2026-10-01 本机实测——该机只装了 Brave 与 Edge，旧次序（Chrome → Edge）因此选中系统自带的 Edge，而用户要的是他主动装的 Brave。由 A20（次序、三种候选形状）与 A20b（只有 Brave + Edge 时选中 Brave）钉住。
- 禁止在人不在场的情况下关闭有头窗口。来源：`live → closed` 会丢内存会话态；用户可能正登录到一半。要用 `close` 必须先确认本轮交互已完成。
- 禁止代填账号密码、禁止导出/读取 profile 的 cookie 库、禁止验证码识别或指纹伪装。来源：旧形态的 `start-chrome-headed.ps1` 带了伪装旗标与伪 UA；这三件事既不稳定（站点风控升级比脚本快），也越过了「登录由人完成」的边界（`preset/design.md` I12）。
- 禁止把「浏览器起不来」写成需要重试的情形：命中沙箱失败签名（Chrome 退出码 21 / Edge `platform_channel.cc … 拒绝访问。(0x5)`）时必须停手如实报（`preset/design.md` I11）。**Brave 的失败签名未观测**：受限令牌下它是否同样失败、以什么签名失败都没有量过（量法见 `testing-guide.md` 第 4 节），禁止把上面两条签名套到它头上。
- 禁止关掉**不是本任务开的**标签页（尤其用户正在登录 / 正在看的那个），也禁止用 `close-tab` 把页面关到 0 个来间接关浏览器（I9 / I10）。来源：用户窗口里既有登录态也有人正在用的页 —— 一个"清理得干净"的动作如果关掉了用户登录到一半的表单，代价远大于多留几个标签页。

## For Agents

动手前先读：`browser/AGENTS.md` → 本文件 → 改命令行契约再读 `preset/agent.cordis.yml` 的 `agent-browser` persona。

绝不能做：上面 7 条非功能红线；I3（重启活着的实例）；I8（用 `PageSession.close()` 关浏览器）；I9 / I10（关掉别人开的页、把页面关到 0 个、抢在页面加载之前就读、失败后把自己开的临时页留在窗口里）。

停止并升级人类：要推翻「登录由人完成」这条边界；要改 profile 的规范默认路径；要引入第三方依赖；要增加任何形式的验证码自动化。

## 测试与验证

见 `browser/testing-guide.md`。