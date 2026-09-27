---
title: browser 模块测试指南
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-27
---

# browser 模块测试指南

不变量编号见 `design.md`（I1..I8 一一对应，本文不重复定义）。类型三种：**单元测试**（`node --test test`，本机实测 **27 个用例全通过**，不需要浏览器）、**真机实测**（要有本机 Chrome，有日志为证）、**人工 review**（脚本抓不到）。

## 命令（可直接照抄）

```sh
cd browser && node --test test                       # 27 个用例
cd browser && node --test --test-isolation=none test # DSH 沙箱（workspace-write）里必须加这个 flag
```

`node --test` 默认给每个测试文件起一个 pipe-stdio 子进程，沙箱拒绝 pipe（失败形态是测试文件本身报 `Error: spawn EPERM`，不是断言失败）——加 `--test-isolation=none` 即走同一条路径且不需要子进程（口径与 `plugin/dsh-adg-token-budget` 一致，见根 `AGENTS.md`「Quality Gates」第 2 条）。

## 1. 不变量 → 用例 → 类型（全表）

| 不变量 | 用例（`test/browser.test.mjs` 里的测试名） | 类型 | 状态 |
|---|---|---|---|
| I1 profile 只能来自显式配置或规范默认 | A1 `I1 默认 profile 固定在 <DSH_HOME>/browser-profile`；A2 `I1 没有 DSH_HOME 时回落成 <home>/.dsh/browser-profile`；A3 `I1 profile 与工作区无关：换 cwd 不改变默认结果`；A4 `I1 显式 --profile 优先于 ADG_BROWSER_PROFILE 与默认值`；A5 `I1 dshHome 优先 DSH_HOME，缺省 ~/.dsh` | 单元测试 | 已实现 |
| I2 启动参数不得含伪装 / 降权旗标 | A6 `I2 启动参数必须带 user-data-dir 与 remote-debugging-port`；A7 `I2 启动参数禁止出现伪装 / 降权旗标` | 单元测试 | 已实现（反例来自旧形态 `start-chrome-headed.ps1`） |
| I3 `live` 时禁止重启 | A8 `I3 实例活着 → reuse，且不产生启动参数`；A9 `I3 实例不在且找到 Chrome → start`；A10 `I3 找不到浏览器 → error CHROME_NOT_FOUND` | 单元测试 | 已实现（决策层；`launch` 真机复用见 M2） |
| I4 非法端口不静默回落 | A11 `I4 非法端口一律抛错`；A12 `I4 合法端口接受数字与数字串，并遵循优先级` | 单元测试 | 已实现 |
| I5 页面选择确定性、不可猜测 | A13 `I5 只认有 ws 端点、非 devtools:// 的 page 目标`；A14 `I5 --match 命中 url 或 title；未命中必须报错而不是随便挑一页`；A15 `I5 --tab 越界与负数必须报错`；A16 `I5 刚创建的标签按 id 定位（站内跳转也能找回来）`；A17 `I5 空目标列表报「没有可用页面目标」` | 单元测试 | 已实现 |
| I6 零第三方依赖 | A18 `I6 只允许 node: 内建与相对路径的 import（零依赖）`；A19 `I6 本机 Node 满足运行时要求（>= 22 的全局 WebSocket）` | 单元测试 | 已实现 |
| I6（同上，Chrome 探测） | A20 `I6 ADG_CHROME 永远排第一，win32 候选含 Chrome 与 Edge`；A21 `I6 findChrome 取第一个真实存在的候选；都没有则 null` | 单元测试 | 已实现 |
| I7 CDP 通道的四条协议行为 | A22 `I7 id 关联：乱序返回也能各归各位`；A23 `I7 错误映射成 Error，并带上方法名`；A24 `I7 事件通知与未知 id 被忽略，不炸掉连接`；A25 `I7 关闭后 send 拒绝，在途请求也被拒绝`；A26 `I7 连不上时报错，不静默返回半个客户端` | 单元测试 | 已实现（用可注入的假 socket，不需要浏览器） |
| I8 只有 `close` 能关浏览器 | A27 `I8 关浏览器只有一个入口：closeBrowser 发 Browser.close` | 单元测试（源码级断言） | 已实现（断言 `Browser.close` 全文只出现 1 次、`pageSession` 的 `close` 是 `cdp.close()`） |
| I8（同上，行为侧） | A28 真实会话里 `text` / `eval` / `shot` 跑完后浏览器**仍在**（`status` 报 `ALIVE=true`），只有 `close` 能让它变 `false` | 真机实测 | 已实现（2026-09-27 冒烟：`status` → `ALIVE=true`，`close` → `ALIVE=false`） |
| I9 关标签页必须点名，且不许关到 0 个页面 | A29 `I9 --match 关掉所有匹配的页，没命中必须报错`；A30 `I9 --tab 关且只关一个；越界、负数、缺值都必须报错`；A31 `I9 不给选择器就不关：不猜要关哪个`；A32 `I9 拒绝关到 0 个页面（那等于关浏览器，绕过 close）`；A33 `I9 关标签页只走 Target.closeTarget，且 closeBrowser 仍是唯一的 Browser.close` | 单元测试（纯函数 + 源码级断言） | 已实现 |
| I9（同上，行为侧） | A34 真机：临时实例里 `close-tab --match` 命中全部 → 拒绝且退出码 1、浏览器仍 `ALIVE=true`；不给选择器 / `--tab 9` 越界 → 同样拒绝；`--tab 0` → `CLOSED_TABS=1`、`TABS` 3→2 | 真机实测 | 已实现（2026-09-27，端口 9444 的一次性 profile） |
| I10 一次性读取不留标签页 | A35 `I10 pageSession 标出「这一页是不是本命令自己开的」`；A36 `I10 读取命令的收尾只关自己开的页，且受 --keep 控制`（含"text / eval / shot 三个命令都要走这个收尾"的计数断言） | 单元测试（源码级断言） | 已实现 |
| I10（同上，行为侧） | A37 真机：`text --url <全新地址>` → 打完 `TAB_CLOSED=` 后 `TABS` **不变**（零残留）；同一地址加 `--keep` → `TABS` +1；`close-tab --match example.com` → `CLOSED_TABS=1` 并回到原值 | 真机实测 | 已实现（2026-09-27，用户实例端口 9333：21 → 21 → 22 → 21） |

## 2. 状态机迁移矩阵（全表）

### BrowserInstance（`design.md`）

起始状态为行，事件为列。**自环**=合法但状态不变。

| 起始 \ 事件 | `launch` 探测到端口可达 | `launch` 探测不到且找到 Chrome | `launch` 等待超时 | `close` | 手工 kill 进程 | `text` / `eval` / `shot` |
|---|---|---|---|---|---|---|
| `absent` | → `live`（`STATE=REUSED`） | → `starting` → `live`（`STATE=STARTED`） | 禁止：报 `ERROR=启动后 Ns 内 … 没有起来`，停在 `starting` | 自环（打印 `CLOSED=already`） | 自环 | 禁止：`ERROR=端口 N 上没有运行中的浏览器` |
| `starting` | 自环 | 禁止：并发第二次 `launch` 会撞端口，由超时分支报错 | → `starting`（保持，调用方拿到非 0 退出码） | 自环 | → `absent`（无落盘） | 禁止：同上 |
| `live` | 自环（I3：复用，不重启） | 禁止（不会走到这一格：探测已成功） | 禁止 | → `closed`（**登录态在此落盘**） | → `absent`（跳过落盘，禁止） | 允许（`PageSession` open → closed） |
| `closed` | → `live`（新实例，同一 profile） | → `starting` → `live` | 同 `absent` | 自环 | 自环 | 禁止 |

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

## 3. 跨模块消费侧契约测试

### 3.1 `preset/agent.cordis.yml` 的 `agent-browser` persona 消费的是**命令行契约的形状**

persona 里出现 `cli.mjs` 的命令名、`KEY=value` 输出行与退出码语义。契约一变（改命令名、改 `STATE=` 的取值、改退出码），persona 的指示就会指向不存在的命令。

过期检测（人工 review）：`Select-String -Path preset\agent.cordis.yml -Pattern 'cli\.mjs' -Encoding UTF8` 取出 persona 里出现的命令，逐个对照 `node cli.mjs help`（`cli.mjs` 的 `USAGE` 常量是唯一真相源）。任何对不上的命令即已过期。

### 3.2 `install.ps1` / `install.sh` 消费的是**目录名**

部署落点 `${DSH_HOME:-~/.dsh}/browser/` 与仓库路径 `browser/` **同名**。改名会同时打断两处（脚本找不到源目录、persona 里的路径失效）。

漂移检测（人工 review）：核对 `install.ps1` 的 `$browserSrc` / `$browserDest` 与 `install.sh` 的对应变量同时指向 `browser`，且 `agent-browser` persona 里写的用户根路径与之一致。

## 4. 未观测清单（不许写成实测）

- **真实站点的登录墙端到端没有跑过**：本模块实测的是**机制**（有头启动 / 实例复用 / 优雅关闭后 cookie 落盘并跨重启存活，见 `docs/evidence.md` §13），**不是**「用户在某个真实网站上登录、专家接着抓到了登录后的内容」。量法：让一次真实 Adg 会话在需要登录的站点上走完「专家开窗 → 用户登录 → 重派 → 抓到登录后内容」。
- **专家是否真的照 persona 用这套工具**：没有真实 Adg 会话走过。量法：转写里检索 `cli.mjs` 的调用；出现「现场手写 CDP 脚本」即 persona 未被遵守。
- **macOS / Linux 上的 Chrome 探测与有头启动**：候选路径写进了代码（A20 只测了 win32 的候选形状），**没有**在那两个平台上跑过。
- **多实例并发**：两个 Adg 会话同时 `launch` 同一端口的行为没有观测（矩阵里按「第二次 launch 撞端口 → 超时分支报错」登记为**推断**，不是实测）。
- **无头（`--headless`）路径**：本模块**不提供**，也不打算提供 —— 卡在有头窗口正是「让人来登录 / 过验证」的载体（`preset/design.md` I12）。
- **「哪一页已经不需要了」这个判断没有自动化**：本模块只有两条确定规则（自己开的临时页自己收；调用方点名的页才关）。专家收尾时是否真的会点名清理、以及会不会把该留的页关掉，没有真实 Adg 会话为证。量法：转写里检索 `close-tab` 的调用与 `TABS=` 的变化；一次任务结束时 `TABS` 仍显著增长即纪律未被遵守。

## 5. 交付前的最小闭环

```sh
cd browser && node --test --test-isolation=none test     # 须 34/34 通过
node cli.mjs profile                                     # 须报出 profile / 端口 / Chrome
node cli.mjs launch --url https://example.com            # 须 STATE=STARTED 或 STATE=REUSED
node cli.mjs launch                                      # 须 STATE=REUSED（I3）
node cli.mjs text --url https://example.com/            # 须打 TAB_CLOSED= 且 tabs 数不变（I10）
node cli.mjs tabs                                        # 记下 TABS=N
node cli.mjs close-tab --match example.com               # 须 CLOSED_TABS= 且不报「会剩 0 个页面」
node cli.mjs close                                       # 须 ALIVE=false + CLOSED=true
```

N>1 时 `close-tab --match` 一次命中全部「会剩 0 个页面」的情形必须被拒（I9）；要在**一次性实例**上验这条，别在用户正在用的窗口上试。以上真机口径在 2026-09-27 本机实测跑通（原始输出见 `docs/evidence.md` §13）。