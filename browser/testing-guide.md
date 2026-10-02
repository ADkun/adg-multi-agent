---
title: browser 模块测试指南
owner: Adg preset 维护者
status: current
last_reviewed: 2026-10-03
---

# browser 模块测试指南

不变量编号见 `design.md`（I1..I11 一一对应，本文不重复定义；运行模式见 `design.md` 的 `### BrowserMode`）。类型三种：**单元测试**（`node --test test`，本机实测 **48 个用例全通过**，不需要浏览器）、**真机实测**（要有本机 Chromium 系浏览器，有日志为证）、**人工 review**（脚本抓不到）。

## 命令（可直接照抄）

```sh
cd browser && node --test test                       # 48 个用例
cd browser && node --test --test-isolation=none test # DSH 沙箱（workspace-write）里必须加这个 flag
```

`node --test` 默认给每个测试文件起一个 pipe-stdio 子进程，沙箱拒绝 pipe（失败形态是测试文件本身报 `Error: spawn EPERM`，不是断言失败）——加 `--test-isolation=none` 即走同一条路径且不需要子进程。

## 用例总表

（本节＝原 §1「不变量 → 用例 → 类型（全表）」；别处写「§1」仍指本节。每条都带类型与状态档。）

| 不变量 | 用例（`test/browser.test.mjs` 里的测试名） | 类型 | 状态 |
|---|---|---|---|
| I1 profile 只能来自显式配置或规范默认 | A1 `I1 默认 profile 固定在 <DSH_HOME>/browser-profile`；A2 `I1 没有 DSH_HOME 时回落成 <home>/.dsh/browser-profile`；A3 `I1 profile 与工作区无关：换 cwd 不改变默认结果`；A4 `I1 显式 --profile 优先于 ADG_BROWSER_PROFILE 与默认值`；A5 `I1 dshHome 优先 DSH_HOME，缺省 ~/.dsh` | 单元测试 | 已实现 |
| I2 启动参数不得含伪装 / 降权旗标 | A6 `I2 启动参数必须带 user-data-dir 与 remote-debugging-port`；A7 `I2 启动参数禁止出现伪装 / 降权旗标` | 单元测试 | 已实现（反例来自旧形态 `start-chrome-headed.ps1`；无头同样**不需要** `--no-sandbox`，2026-10-03 实测） |
| I3 `live` 时禁止重启 | A8 `I3 实例活着且模式相同 → reuse，且不产生启动参数`；A9 `I3 实例不在且找到 Chrome → start`；A10 `I3 找不到浏览器 → error CHROME_NOT_FOUND（不静默换浏览器）`；A41 `I3 活着的实例是另一种模式 → switch，且必须带上**目标模式**的启动参数`（说明：**显式**要求另一种模式 → switch，且必须带上目标模式的启动参数 —— 判定在 `modeIsExplicit`，未显式要求一律复用，见 A52 / A53）（2026-10-03 事故的回归锁）；A42 `I3 活着的是另一种模式但没有可用浏览器 → error（不退化成空参数启动）`；A43 `I3 活着的实例模式未知 → 也 reuse（不认识的活实例不许被静默换掉）`（同时给出 `modeUnverified=true`） | 单元测试 | 已实现（决策层。**唯一的重启例外＝显式换到另一种模式**，见 I11；`launch` 真机复用与换模式见 A50 / A51） |
| I4 非法端口不静默回落 | A11 `I4 非法端口一律抛错`；A12 `I4 合法端口接受数字与数字串，并遵循优先级` | 单元测试 | 已实现 |
| I5 页面选择确定性、不可猜测 | A13 `I5 只认有 ws 端点、非 devtools:// 的 page 目标`；A14 `I5 --match 命中 url 或 title；未命中必须报错而不是随便挑一页`；A15 `I5 --tab 越界与负数必须报错`；A16 `I5 刚创建的标签按 id 定位（站内跳转也能找回来）`；A17 `I5 空目标列表报「没有可用页面目标」` | 单元测试 | 已实现 |
| I6 零第三方依赖 | A18 `I6 只允许 node: 内建与相对路径的 import（零依赖）`；A19 `I6 本机 Node 满足运行时要求（>= 22 的全局 WebSocket）` | 单元测试 | 已实现 |
| I6（同上，浏览器探测） | A20 `I6 ADG_CHROME 永远排第一，win32 候选含 Chrome / Brave / Edge 且 Brave 在 Edge 前`；A20b `I6 只有 Brave 与 Edge 时选中 Brave（不静默换成系统自带的 Edge）`；A21 `I6 findChrome 取第一个真实存在的候选；都没有则 null` | 单元测试 | 已实现 |
| I7 CDP 通道的四条协议行为 | A22 `I7 id 关联：乱序返回也能各归各位`；A23 `I7 错误映射成 Error，并带上方法名`；A24 `I7 事件通知与未知 id 被忽略，不炸掉连接`；A25 `I7 关闭后 send 拒绝，在途请求也被拒绝`；A26 `I7 连不上时报错，不静默返回半个客户端` | 单元测试 | 已实现（用可注入的假 socket，不需要浏览器） |
| I8 只有 `close` 能关浏览器 | A27 `I8 关浏览器只有一个入口：closeBrowser 发 Browser.close` | 单元测试（源码级断言） | 已实现（断言 `Browser.close` 全文只出现 1 次、`pageSession` 的 `close` 是 `cdp.close()`） |
| I8（同上，行为侧） | A28 真实会话里 `text` / `eval` / `shot` 跑完后浏览器**仍在**（`status` 报 `ALIVE=true`），只有 `close` 能让它变 `false` | 真机实测 | 已实现（2026-09-27 冒烟：`status` → `ALIVE=true`，`close` → `ALIVE=false`） |
| I9 关标签页必须点名，且不许关到 0 个页面 | A29 `I9 --match 关掉所有匹配的页，没命中必须报错`；A30 `I9 --tab 关且只关一个；越界、负数、缺值都必须报错`；A31 `I9 不给选择器就不关：不猜要关哪个`；A32 `I9 拒绝关到 0 个页面（那等于关浏览器，绕过 close）`；A33 `I9 关标签页只走 Target.closeTarget，且 closeBrowser 仍是唯一的 Browser.close` | 单元测试（纯函数 + 源码级断言） | 已实现 |
| I9（同上，行为侧） | A34 真机：临时实例里 `close-tab --match` 命中全部 → 拒绝且退出码 1、浏览器仍 `ALIVE=true`；不给选择器 / `--tab 9` 越界 → 同样拒绝；`--tab 0` → `CLOSED_TABS=1`、`TABS` 3→2 | 真机实测 | 已实现（2026-09-27，端口 9444 的一次性 profile） |
| I10 一次性读取不留标签页 | A35 `I10 pageSession 标出「这一页是不是本命令自己开的」`；A36 `I10 读取命令的收尾只关自己开的页，且受 --keep 控制`（含"text / eval / shot 三个命令都要走这个收尾"的计数断言） | 单元测试（源码级断言） | 已实现 |
| I10（同上，行为侧） | A37 真机：`text --url <全新地址>` → 打完 `TAB_CLOSED=` 后 `TABS` **不变**（零残留）；同一地址加 `--keep` → `TABS` +1；`close-tab --match example.com` → `CLOSED_TABS=1` 并回到原值 | 真机实测 | 已实现（2026-09-27，用户实例端口 9333：21 → 21 → 22 → 21） |
| I10（同上，**抢跑修复**） | A38 `I10 新建临时页先开空白标签、attach 后再导航等可读状态（不许抢跑）`（断言 `about:blank` 建页、`sleep(600)` 已消失、复用 `goto`、超时报错）；A39 `I10 初始导航失败也要收走自己开的临时页（失败路径同样「谁开的谁收」）` | 单元测试（源码级断言） | 已实现 |
| I10（同上，抢跑修复，行为侧） | A40 真机：`text --url` 三个真实站点正文分别 **129 / 547 / 2061 字节**（**修复前三个全是 `BYTES=0`**），每条都打 `TAB_CLOSED=` 且 `TABS` 1 → 1；单轮工具侧耗时 **0.78 / 1.43 / 1.98 s** | 真机实测 | 已实现（2026-09-27，一次性实例端口 9444 + 临时 profile） |
| I11 运行模式：默认无头、按需显式换有头 | A44 `I11 默认模式是无头：不给 mode 时 launchArgs 带 --headless=new`；A45 `I11 --headed 只去掉无头旗标，其余参数逐字相同`；A46 `I11 模式优先级：显式 > ADG_BROWSER_MODE > 默认；非法值抛错不回落`；A47 `I11 detectMode 从 User-Agent 读出模式（2026-10-03 三条真实读数）`（有头 Chrome / 无头 Chrome / 无头 Edge；同一条 `/Headless/i` 同时认 Chrome / Brave / Edge）；A48 `I11 detectMode 拿不到 User-Agent 时报 unknown，不猜` | 单元测试 | 已实现（纯函数；真机 UA 读数与换模式闭环见 A50） |
| I11（同上，**显式换模式闸门**） | A52 `I11 没显式要求模式 → 活着的有头实例**不动它**（modeNotRequested）`；A53 `I11 只有显式要求（旗标 / ADG_BROWSER_MODE）才允许换掉活着的实例` | 单元测试 | 已实现（`planLaunch` 的 `modeNotRequested` 分支 ＋ `modeIsExplicit` 判定；A53 同时覆盖两条显式路径（单次旗标 / `ADG_BROWSER_MODE`），并断言"不带旗标"与 `modeExplicit: false` 都只 `reuse`） |
| I11（同上，源码级闸门） | A54 ＝ 原 **A49** 的落点：`I11 launch 在 spawn 前拒绝空 / 非数组启动参数（源码级断言）` | 单元测试（源码级断言） | 已实现（断言 `cli.mjs` 里"拒绝空参数"的闸门文本先于 `spawn(plan.chrome, plan.args` 出现，且闸门检查 `Array.isArray(plan.args)`。**A49 缺口已关闭**：A49 是台账里"'spawn' 前拒绝空参数只有源码级事实、没有断言"那条缺口条目，A54 是关掉它的断言 —— 两者指同一件事、同一状态，不再有第二个状态） |
| I11（同上，真机闭环） | A50 真机：`launch`（`STATE=STARTED` / `MODE=headless`）→ `launch --headed`（`SWITCHED_FROM=headless` / `CLOSED=true` / `STATE=SWITCHED` / `MODE=headed`）→ `launch --headless`（`SWITCHED_FROM=headed` / 其余同上）→ `launch`（`STATE=REUSED`）；换模式必须落在**同一个** `--port` 与 `--profile` 上，且全程不出现 `RETRY=`；`close` → `ALIVE=false` / `CLOSED=true`；关掉后 `status` → `MODE=none` | 真机实测 | 已实现（2026-10-03，Windows / Brave `154.0.8037.58`。同次读数：优雅关后端口 ~1–2 ms 就不可达、进程 ~215–217 ms 后才退出（退出码 0）；换模式（＝任意一次优雅关 + 重开）后**持久 cookie 留住、会话 cookie 丢**。读数不是判据） |
| I11（同上，单例语义） | A51 真机：同一 profile 同一时刻只能有一个实例 —— 第二个**有头**实例 → `exit 0` + stderr `已在运行的浏览器会话中打开。`（请求被转交给活着的实例，且该实例多出 1 个页：1 → 2）；第二个**无头**实例 → **退出码 21**、不转交 | 真机实测 | 已实现（2026-10-03，Windows / Brave `154.0.8037.58`） |

计数：**单元 48 个（全实现、无缺口）＋ 真机 6 个（A28 / A34 / A37 / A40 / A50 / A51）＋ 缺口 0 个**，id 区间 **A1–A54 加 A20b**（A49 与 A54 是同一件事的两个编号层，见上表）。单元用例的判据是一次实跑：`cd browser && node --test --test-isolation=none test` → `tests 48 / pass 48 / fail 0`（2026-10-03）；真机用例要有本机 Chromium 系浏览器与日志。

## 迁移矩阵

（本节＝原 §2「状态机迁移矩阵（全表）」；下面按对象分小节，行是起始状态、列是事件。）

### BrowserInstance（`design.md`）

起始状态为行，事件为列。**自环**=合法但状态不变。

| 起始 \ 事件 | `launch` 可达 · 目标模式＝活实例模式（或活实例 `unknown`） | `launch` 可达 · 目标是另一种模式（**显式**要求 / **未显式**要求两格） | `launch` 探测不到且找到浏览器 | `launch` 等待超时 | `close` | 手工 kill 进程 | `text` / `eval` / `shot` |
|---|---|---|---|---|---|---|---|
| `absent` | 不会走到（端口可达就说明它其实在 `live`） | 不会走到（同上） | → `starting` → `live`（`STATE=STARTED`） | 禁止：报 `ERROR=启动后 Ns 内 … 没有起来`，停在 `starting` | 自环（打印 `CLOSED=already`） | 自环 | 禁止：`ERROR=端口 N 上没有运行中的浏览器` |
| `starting` | 自环 | **未观测**（**显式**换模式窗口里的并发第二次 `launch` 没有测过；代码路径与 `live` 行相同。未显式要求的并发第二次 `launch` 按 `live` 行那格是复用，不撞端口） | 禁止：并发第二次 `launch` 会撞端口，由超时分支报错 | → `starting`（保持，调用方拿到非 0 退出码） | 自环 | → `absent`（无落盘） | 禁止：同上 |
| `live` | 自环（I3：复用，不重启） | **显式**要求时才 → `closed` → `starting` → `live`（`STATE=SWITCHED`、`SWITCHED_FROM=<旧模式>`、`CLOSED=true`：先 `Browser.close` 优雅关、等端口落下，再按**同一** profile / 同一端口重开）；**未显式**要求时是**自环**（`STATE=REUSED`、`MODE=<活实例的实际模式>`，窗口不动，输出带一条"你没有显式要求模式，所以没有动它"的说明行 —— I11 ③ / A52） | 禁止（不会走到这一格：探测已成功） | 禁止 | → `closed`（**登录态在此落盘**） | → `absent`（跳过落盘，禁止） | 允许（`PageSession` open → closed） |
| `closed` | → `live`（新实例，同一 profile；`MODE=` 即目标模式） | 不会走到（可达就说明它其实在 `live`） | → `starting` → `live` | 同 `absent` | 自环 | 自环 | 禁止 |

「目标模式」＝显式旗标 > `ADG_BROWSER_MODE` > 默认无头 三者解析出来的那一个；但**只有前两者算"显式要求"**（判定在 `modeIsExplicit`）—— **默认值只决定新起的实例，不会关活着的实例**，所以不带旗标的 `launch` 撞上"活着的正好是另一种模式"时一律 `STATE=REUSED` ＋ `MODE=<活实例的实际模式>`，窗口不动（A52 / A53）。**显式**换模式才会关掉当前实例，而实例里可能正有人在登录：详见「人工 review 项」里那条人为时序。

### PageSession（`design.md`）

| 起始 \ 事件 | `close()` | 再次 `close()` | `goto` / `text` / `evalJs` / `shot` |
|---|---|---|---|
| `open` | → `closed`（只断 CDP，**不关浏览器**，I8） | — | 允许 |
| `closed` | — | 自环（幂等） | 禁止：`ERROR=CDP 连接已关闭` |

### PageTab（`design.md`）

`TABS` 是**当前**标签页数；`created` 是「本次调用自己开的那一页」。

| 起始 \ 事件 | `text/eval/shot --url <新地址>` 收尾 | 同一条命令加 `--keep` | `close-tab --match/--tab` | `close-tab` 会剩 0 个页面 | `close`（关浏览器） |
|---|---|---|---|---|---|
| 本命令自己开的临时页（`created=true`） | → `closed`（打 `TAB_CLOSED=`） | 自环（留着） | → `closed`（若被点名匹配） | 禁止：报「会剩 0 个页面」 | 强制 `closed` |
| 用户早先开的页 / `open` `launch` 开的页（`created=false`） | 自环（**绝不自动关**） | 自环 | → `closed`（仅当被 `--match` / `--tab` 点名） | 禁止：同上 | 强制 `closed` |
| 已关闭的 target | 自环（幂等，不报错） | 自环 | 自环（幂等） | — | 自环 |

## 消费方契约测试

（本节＝原 §3「跨模块消费侧契约测试」；两个消费方各一小节，附人工 review 的漂移检测口径。）

### `preset/agent.cordis.yml` 的 `agent-browser` persona 消费的是**命令行契约的形状**

persona 里出现 `cli.mjs` 的命令名、`KEY=value` 输出行与退出码语义。契约一变（改命令名、改 `STATE=` 的取值、改退出码），persona 的指示就会指向不存在的命令。运行模式给这套形状加了三个输出行与一个新取值：`status` 的 `MODE=none|headless|headed`、`profile` 的 `DEFAULT_MODE=`、换模式时的 `SWITCHED_FROM=` 与 `STATE=SWITCHED` —— persona 若把「`launch` 一定开出一个有头窗口」当前置、或只认 `STATE=STARTED` / `REUSED`，就已经过期。

过期检测（人工 review）：`Select-String -Path preset\agent.cordis.yml -Pattern 'cli\.mjs' -Encoding UTF8` 取出 persona 里出现的命令，逐个对照 `node cli.mjs help`（`cli.mjs` 的 `USAGE` 常量是唯一真相源）。任何对不上的命令即已过期。再读一遍 persona 里与模式有关的指示：默认形态已经翻成无头，凡把「看见窗口」「窗口一直在」当成功判据的写法都要改掉。

### `install.ps1` / `install.sh` 消费的是**目录名**

部署落点 `${DSH_HOME:-~/.dsh}/browser/` 与仓库路径 `browser/` **同名**。改名会同时打断两处（脚本找不到源目录、persona 里的路径失效）。

漂移检测（人工 review）：核对 `install.ps1` 的 `$browserSrc` / `$browserDest` 与 `install.sh` 的对应变量同时指向 `browser`，且 `agent-browser` persona 里写的用户根路径与之一致。

## 人工 review 项

（本节＝原 §4「未观测清单（不许写成实测）」：这些是自动化抓不到、必须真机跑或必须有人看的部分。**每条都带量法**，不许把没跑过的写成实测。）

- **真实站点的登录墙 / 验证码端到端没有跑过**：本模块实测的是**机制**（模式可判、换模式闭环、实例复用、优雅关闭后 cookie 落盘并跨重启存活，见 `docs/evidence.md` §8），**不是**「用户在某个真实网站上登录、专家接着抓到了登录后的内容」。量法：让一次真实 Adg 会话在需要登录的站点上走完「专家默认无头开抓 → 撞登录墙 → `launch --headed` 换有头 → 用户登录 / 过验证 → 重派 → 抓到登录后内容」。
- **专家是否真的照 persona 用这套工具**：没有真实 Adg 会话走过。量法：转写里检索 `cli.mjs` 的调用；出现「现场手写 CDP 脚本」即 persona 未被遵守。
- **macOS / Linux 上的 Chromium 系探测与两种模式的启动**：候选路径写进了代码（A20 只测了 win32 的候选形状），**没有**在那两个平台上跑过 —— 连「默认无头能不能起」都没跑过，换模式闭环更是只在 Windows 上验过。
- **多实例并发**：两个 Adg 会话同时 `launch` 同一端口的行为没有观测（矩阵里按「第二次 launch 撞端口 → 超时分支报错」登记为**推断**，不是实测）；换模式又添了第二条并发路径 —— 第二次 `launch` 恰好落在「先关后开」的窗口里（迁移矩阵 `starting` 行标**未观测**的那一格）。同一 profile 的单例语义本身已实测（A51）。量法：起一次换模式，在关-开窗口里并发再 `launch` 一次，看是复用、切换还是端口报错。
- **无头（`--headless`）路径不再是「不提供」**：无头是**默认**（启动参数带 `--headless=new`），有头是「需要人工介入时」的**显式升级**（`launch --headed` / `ADG_BROWSER_MODE` 指定）—— 卡在有头窗口仍然是「让人来登录 / 过验证」的载体（`preset/design.md` I12），但默认形态已经翻过来。**仍未观测**：换模式之后人真的在真实站点上把登录 / 验证走完（见上一条），以及「用户正在有头窗口里登录时，被一次**显式**换模式 / `close` 关掉」这类**人为时序** —— 显式换模式不区分「人是否在场」（不带旗标的 `launch` 已被 A52 挡住：它只 `reuse`、不会去关那个有头实例），防线目前只在 `design.md` 的非功能红线里。量法：在一个有头实例里开始登录，另起一次 `launch --headless`（或 `close`），观察窗口是否被关、登录态是否还在。
- **「哪一页已经不需要了」这个判断没有自动化**：本模块只有两条确定规则（自己开的临时页自己收；调用方点名的页才关）。专家收尾时是否真的会点名清理、以及会不会把该留的页关掉，没有真实 Adg 会话为证。量法：转写里检索 `close-tab` 的调用与 `TABS=` 的变化；一次任务结束时 `TABS` 仍显著增长即纪律未被遵守。
- **超时 / 失败清理分支没有在真机上触发过**：Chrome 对不可达站点会给出错误页（`.invalid` 域名 → 224 字节的错误页，退出码 0）或在约 10.7s 后正常返回（不可路由 IP `10.255.255.1`），所以 `state.timeout` 报错与"失败时收走自己开的临时页"这两条**只有源码级断言（A38 / A39）**，没有真机证据。量法：拿一个 30s 内既不 `interactive` 也不 `complete` 的本地页面（例如无限 `document.write` 的 `data:`/本地文件）跑 `text --url`，应报 `页面在 30000ms 内没有进入可读状态` 且 `TABS` 不变。

## 交付前的最小闭环

```sh
cd browser && node --test --test-isolation=none test     # 须 48/48 通过
node cli.mjs profile                                     # 须报出 profile / 端口 / 浏览器可执行文件 / DEFAULT_MODE=（CHROME= 行是路径）
node cli.mjs launch --url https://example.com            # 须 STATE=STARTED 或 STATE=REUSED，并打出 MODE=（该实例是另一种模式**且你显式要求了另一种模式**时才是 STATE=SWITCHED；不带旗标只会 STATE=REUSED + MODE=<实际模式> 并说明没有动它）
node cli.mjs launch                                      # 须 STATE=REUSED（I3：同一模式复用，不重启）
node cli.mjs launch --headed                             # 显式换模式：须 SWITCHED_FROM=headless / CLOSED=true / STATE=SWITCHED / MODE=headed
node cli.mjs launch                                      # 活着的是有头实例，但这次**不带旗标**：须 STATE=REUSED + MODE=headed，且**不得**出现 SWITCHED_FROM=（A52：未显式要求就不动它）
node cli.mjs launch --headless                           # 显式换回去：须 SWITCHED_FROM=headed / CLOSED=true / STATE=SWITCHED / MODE=headless
node cli.mjs text --url https://example.com/            # 须打 TAB_CLOSED=、正文非空（BYTES>0）、tabs 数不变（I10）
node cli.mjs tabs                                        # 记下 TABS=N
node cli.mjs close-tab --match example.com               # 须 CLOSED_TABS= 且不报「会剩 0 个页面」
node cli.mjs close                                       # 须 ALIVE=false + CLOSED=true
node cli.mjs status                                      # 须 MODE=none（关掉之后没有运行中的实例）
```

N>1 时 `close-tab --match` 一次命中全部「会剩 0 个页面」的情形必须被拒（I9）；要在**一次性实例**上验这条，别在用户正在用的窗口上试。**显式**换模式那两步也**会关掉当前实例**（`Browser.close` → 等端口落下 → 同 profile / 同端口重开），别在用户正在用的窗口上验，也别指望它保住会话 cookie（持久 cookie 留住、会话 cookie 丢 —— 2026-10-03 读数）；中间那一步不带旗标的 `launch` 不动任何实例，可以在不打扰用户的前提下随时跑。

以上真机口径在 2026-09-27 本机实测跑通（原始输出见 `docs/evidence.md` §8）；换模式两步、单例语义与无头 UA 判据在 2026-10-03 本机（Windows / Brave `154.0.8037.58`）跑通。