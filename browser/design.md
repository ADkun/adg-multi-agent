---
title: browser 模块设计
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-27
---

## 职责与边界

负责：把「用有头 Chrome 做一次需要登录态的网页交互」收敛成**确定性的一组值和一个命令行契约** —— 规范 profile 路径、调试端口、Chrome 可执行文件、启动参数、实例的复用/启动决策，以及一条最小 CDP 通道（navigate / evaluate / screenshot）。

不负责（逐条防越权）：

- 不拥有 Chrome：用的是**系统已装的** Chrome / Edge（标准位置探测 + `ADG_CHROME` 覆盖），不下载、不安装、不打包浏览器；
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
  - `docs/evidence.md` 引用本模块的真机实测（§13）。
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
  - `absent`：端口上没有任何 CDP 端点。**它不是**「没有 Chrome 在跑」——用户日常的 Chrome 就在跑，只是没有调试端口。
  - `starting`：已 spawn，正在等 `/json/version` 起来。**它不是**「可用」：这期间任何页面操作都必须先失败。
  - `live`：`/json/version` 可达。**它不是**「当前页已登录」——登录是与站点之间的事，本模块无从判断。
  - `closed`：`Browser.close` 之后端口不再可达。**它不是**「数据丢了」：优雅关闭正是登录态落盘的时刻（§13 实测）。
  - 迁移唯一入口：`absent|closed → starting → live` 只能由 `cli.mjs launch` 触发；`live|starting → closed` 只能由 `cli.mjs close` 触发。禁止绕过对象直接改状态（例如手工 kill 进程：那会跳过落盘）。
- 不变量：
  - I3: `live` 时禁止重启。`launch` 必须先探测端口，活着就**复用**并按需补开标签页。来源：重启会丢内存里的会话态，并逼用户重新登录 —— 而「用户刚登录完」正是最不该被打断的时刻。
  - I8: 关浏览器只有一个入口（`closeBrowser` → `Browser.close`）。`PageSession.close()` 只断开 CDP 连接，**禁止**关浏览器。

### PageSession（句柄型）

一次「连上某一页并操作它」的句柄：短生命周期、对外只暴露 `goto` / `text` / `evalJs` / `shot` / `close`，自带超时回收（`timeoutMs`，默认 30s）。

- 状态机：`open` → `closed`。迁移唯一入口：`pageSession()` 创建、`close()` 结束；`open` 调用 `close`、`closed` 再调用 `close` 都是自环（幂等）。
- 不变量：
  - I5: 页面选择必须**确定性**且**不可猜测**：只认 `type === 'page'`、带 `webSocketDebuggerUrl`、非 `devtools://` 的目标；`--match` 未命中、`--tab` 越界或为负、目标列表为空，四种情形都必须报错，禁止「随便挑一页」。
  - I7: CDP 通道的协议行为必须守四件事：请求按 `id` 关联（乱序返回各归各位）、CDP 错误映射成带方法名的 `Error`、事件通知与未知 `id` 被忽略、连接关闭后 `send` 与在途请求都拒绝。

## 对外接口

- 命令行契约：`cli.mjs` 的 `USAGE` 常量（**唯一真相源**，命令名、选项、退出码都在那里；本文不复制选项表）。`node cli.mjs help` 打印它。
- 输出行契约：`KEY=value` 单行（`STATE` / `PORT` / `PROFILE` / `CHROME` / `BROWSER` / `TABS` / `TAB <i> | <title> | <url>` / `SHOT` / `OUT` / `RESULT`），失败写 stderr 的 `ERROR=<msg>`。退出码：0 成功 / 1 运行期错误 / 2 用法错误（与 `tools/check-preset.mjs` 的 0/1/2 同形）。
- 库接口：`lib/target.mjs`（纯函数层）与 `lib/cdp.mjs`（通道层）；`cdp.mjs` 的 `connect()` 接受可注入的 `socketFactory`，这是测试能在无浏览器机器上跑的原因。

## 非功能红线

- 禁止引入第三方依赖（playwright / puppeteer / ws 等一律不许）。来源：旧形态为驱动浏览器装了 `playwright-core`，它启动时自带 `--remote-debugging-pipe` 与 `Page.addScriptToEvaluateOnNewDocument` 注入、并自带 `--disable-blink-features=AutomationControlled`；本模块要的只是三个方法，不值得换那套注入面。I6 由测试钉住。
- 禁止把 profile 写进会话工作区、或写死任何本机绝对路径（`D:\dsh\…`、`C:\Users\<某人>\…`）。来源：旧 persona 写的是「放工作区里一个固定目录」，工作区一换 profile 就换，登录态当场清零 —— 这正是「浏览器代理经常被登录拦住」的直接成因。
- 禁止在人不在场的情况下关闭有头窗口。来源：`live → closed` 会丢内存会话态；用户可能正登录到一半。要用 `close` 必须先确认本轮交互已完成。
- 禁止代填账号密码、禁止导出/读取 profile 的 cookie 库、禁止验证码识别或指纹伪装。来源：旧形态的 `start-chrome-headed.ps1` 带了伪装旗标与伪 UA；这三件事既不稳定（站点风控升级比脚本快），也越过了「登录由人完成」的边界（`preset/design.md` I12）。
- 禁止把「浏览器起不来」写成需要重试的情形：命中沙箱失败签名（Chrome 退出码 21 / Edge `platform_channel.cc … 拒绝访问。(0x5)`）时必须停手如实报（`preset/design.md` I11）。

## For Agents

动手前先读：`browser/AGENTS.md` → 本文件 → 改命令行契约再读 `preset/agent.cordis.yml` 的 `agent-browser` persona。

绝不能做：上面 5 条非功能红线；I3（重启活着的实例）；I8（用 `PageSession.close()` 关浏览器）。

停止并升级人类：要推翻「登录由人完成」这条边界；要改 profile 的规范默认路径；要引入第三方依赖；要增加任何形式的验证码自动化。

## 测试与验证

见 `browser/testing-guide.md`。