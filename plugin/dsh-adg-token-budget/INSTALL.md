# 部署与启用清单（`dsh-adg-token-budget`）

这份文件是**操作清单**，只讲"怎么装、怎么开、怎么确认、怎么回滚"。
插件做什么、每个键什么含义、安全设计、证据边界，见本目录的 `README.md`；
子代理步数检查点这一层的整体口径（含实测分布与实测证据）见仓库根 `README.md` 里对应的那一节。

**本文件是仓库文档，不在部署集合里** —— 装到 `$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`
的是 `package.json` / `src/` / `README.md` / `examples/` / `LICENSE` 五项，`test/` 与 `INSTALL.md` 都不进去。

> **包名是历史遗留。** 这个包现在**只做一件事**：受管子代理在第 N 步收到的收敛检查点。
> token 软档与硬档取消**已移除（本次改动）**，`budgetTokens` / `softRatio` /
> `cacheReadWeight` / `softNudge` / `hardDryRun` 五个键**被静默忽略**（旧组合仍然能加载，只是不起作用）。
> 名字与行 id（`adg-token-budget`）保留，是为了不改部署路径、不改热重载身份。

## 0. 一条约束先记住

**`enabled: false` 时插件不注册任何监听器、不写任何决策日志。** 但它**会写一行加载期的激活行**
（`activation: inactive (enabled: false) …`），所以"装上了"这件事**看得见**，
不再需要先改成 `true` 才知道插件被加载过。想看到决策行，必须让一个受管的子代理真的走到
`stepTiers` 上的某一步（或先开 `dryRun: true` 校准）。

## 1. 部署（复制文件）

目标：`$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`（`$DSH_HOME` 默认 `~/.dsh`）。
这是**所有 profile 共享的模块解析根**，从 profile 目录按 Node 的常规 `node_modules` 父级上溯会走到它；
本机的 `dsh-windows-notifier` 也在同一位置。

- 复制 `package.json`、`src/`、`README.md`、`examples/`、`LICENSE`；**`test/` 与 `INSTALL.md` 不要拷**。
- **先删目标目录再拷**（重复执行必须干净覆盖，不留上一版残留）。
- **真拷贝，不要建 junction / symlink**：部署出来的插件必须独立于仓库，否则仓库一删或一挪，
  dsh 启动就会去一个不存在的路径找这个包。
- 部署目录里没有 `node_modules` 也正常：插件不静态 import 任何 `@deepseek-ai/*`，
  需要什么都在调用时用 `createRequire` 解析，解析失败也可存活。

## 2. 挂载行（写 profile 的 patch 层）

目标：`$DSH_HOME/profiles/web/cordis.patch.yml`（web profile 自己的 patch 层，`patchReload: live`）。

- **先备份**成 `cordis.patch.yml.bak-adg-token-budget`。
- 文件里**已经出现 `dsh-adg-token-budget`** → 不要改动，只报告"已注册"。
- 末行**不是恰好 `[]`** → **不要猜**：放弃编辑，让用户手工把 `examples/cordis.patch.yml` 里的行贴进去。
- 否则：保留原有注释头，把 `[]` 换成 `examples/cordis.patch.yml` 里那条 `insert:` 行，
  `enabled: false`（例子文件里这一行**已经取消注释**，直接贴进来就是关着的），
  `logFile` 写成**真实绝对路径**（单引号 YAML 字符串，相对路径会被插件关掉文件日志）。
- 写文件用**不带 BOM 的 UTF-8**（`Set-Content -Encoding UTF8` 在 PowerShell 5.1 下会写 BOM）。
- **行里还带着 `budgetTokens` 等已移除的键？不用动。** 新构建对未知键静默忽略，
  旧组合照常加载，只是那五个键没有任何效果；想清理可以删掉，但不删也不会报错。

安装脚本（`install.ps1` / `install.sh`）已经把这四步做完，并且在输出里说明备份路径与"行是新增还是已存在"。
两者行为等价、零依赖。

## 3. 启用（三步、可撤回）

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
      config:
        enabled: true
        dryRun: true        # 先校准；确认无误后改成 false
```

这个文件热重载：**改 `config:` 立即生效，不用重启 dsh** —— 宿主会重新 `apply` 这一行。
推荐的武装顺序是三步，**没有需要校准的破坏性档**：

1. `enabled: false` —— 装上但完全惰性（示例行就是这个值）；
2. `enabled: true` + `dryRun: true` —— 按你自己的流量校准：每个到期的检查点写一行
   `dry-run step stage: would nudge …`，不注入任何消息；**步数照常计数**（那正是校准要看的），
   而且**不消耗任何 tier**，所以之后武装仍然会补发那个检查点；
3. `enabled: true` + `dryRun: false` —— 提醒真的注入。

**第 3 步就是终点。** 取消已经从插件里删除，所以**没有 `hardDryRun`，后面也没有"再武装一次"这回事**：
剩下的唯一动作是措辞（`stepText`）与阶梯（`stepTiers`），两者都是 `config:` 改动，热重载即可。
想先小范围看到效果，把 `stepTiers` 临时改成 `[1, 2]`。

> **但改了包里的代码就必须重启，而且顺序不能反。** 已实测：替换包目录之后，宿主重放了这一行、
> 激活行里的 `dryRun` 跟着变了，**但激活行没有新字段** —— 因为热重载不会重新 `import`
> 已经加载过的模块（Node 的 ESM registry 按文件 URL 缓存，而 URL 没变）。
> 正确顺序是：**复制新代码 → 重启 dsh → 确认激活行是当前形状 → 这时才动 `dryRun` / `stepTiers`。**
>
> **怎么判断激活行是哪一版写的**：当前形状是
> `activation: active createUserMessage=<解析策略> presets=[adg] stepNudge=… stepTiers=[…] stepText=builtin|custom dryRun=… logFile=…`。
> 只要行里还带着 `budgetTokens=` / `softThreshold=` / `softRatio=` / `cacheReadWeight=` /
> `softNudge=` / `hardDryRun=`，或者**没有 `stepText=`**，它就是**旧模块**写的：
> 旧代码不认识新键，反过来，**在旧模块还活着的时候改配置，改的是一个旧代码读得懂的更小集合**。
> （当年那次就踩过这个组合：以 `dryRun: false` 生效、加载的却是旧模块，好在那一分多钟里没有
> Adg 委派跑过。）

## 4. 确认已武装

| 看哪里 | 期望看到什么 |
|---|---|
| `logFile`（安装脚本写的是 `$DSH_HOME/adg-token-budget.log`） | **加载期就有第一行**：`activation: active createUserMessage=<解析策略> presets=[adg] stepNudge=true stepTiers=[…] stepText=builtin\|custom dryRun=… logFile=…`；`enabled: false` 时写的是 `activation: inactive (enabled: false) …`（同样是"宿主确实加载过"的证据）。行里若还有 `budgetTokens=` / `softNudge=` / `hardDryRun=` 之类的旧字段，说明内存里跑的还是旧模块 |
| `logFile`（决策行） | 只有**事件**才写：步数检查点 `step stage: nudged tier=n/N step=S label=…`、`step stage (no nudge injected: …) …`、dry-run 判定（`dry-run step stage: would nudge …` / `dry-run step stage: would not nudge (…) …`）、`settled: released session state label=…`。**普通放行一步什么都不写** |
| 宿主日志（加载期） | `dsh-adg-token-budget: activation: active createUserMessage=…`；出现 `apply failed (…); the step checkpoints are inactive` 或 `context has no event API; the step checkpoints are inactive` 就是降级成 no-op 了 |
| 宿主日志（第一次决策时，一次） | `dsh-adg-token-budget: first decision: …` |
| 行为（检查点） | 受管子代理走到阶梯上的某一步时会收到一条 `【收敛检查点 n／N】调度代理提醒：这是你的第 N 步。…`，正文是一条**可选**提醒（自己选"收尾汇报"还是"继续"）。想最快看到，把 `stepTiers` 临时改成 `[1, 2]`；想连措辞都自己认，用 `stepText` 写一句——**这两件都只是 `config:` 改动，热重载、不用重启** |
| 源码（确认没有破坏性路径） | 见下面的代码级检查：滤掉注释行后，`agent.cancel` / `sessionProjections` / `kind: 'reject'` **一个都不应匹配** —— 这是"token 两档真的被删掉了"的事实，和日志无关 |
| 测试 | 在插件目录里 `node --test test`（不依赖 `node_modules`；沙箱里若 piped stdio 被挡，用 `node --test --test-isolation=none test`） |

源码检查（模块注释里**故意**留着"这里曾经 agent.cancel / 读 sessionProjections"的说明文字，所以要先滤掉注释行）：

```powershell
Get-ChildItem src\*.js | ForEach-Object { Get-Content -LiteralPath $_.FullName } |
  Where-Object { $_ -notmatch '^\s*(\*|//|/\*)' } |
  Select-String "agent\.cancel|sessionProjections|kind: 'reject'"
```

预期：**没有任何输出**。

**本机的实测证据**（`C:\Users\cenqian\.dsh\adg-token-budget.log`，逐字引用）。
步数检查点**已经真机注入过三次**，三次都是 `tier=1/3 step=12`：

```
2026-09-24T17:45:49.845Z step stage: nudged tier=1/3 step=12 usage=124291 budget=3000000 label=adg/fdd55c65-4584-4082-83d2-618570604e5f
2026-09-24T17:55:04.609Z step stage: nudged tier=1/3 step=12 usage=104900 budget=3000000 label=adg/12bf2213-0322-4dfb-9c85-80e12066ab40
2026-09-24T18:22:13.725Z step stage: nudged tier=1/3 step=12 usage=142986 budget=3000000 label=adg/41c07ec8-a997-47e7-8bb1-9457ccf4bd89
```

（这三行是当时的旧日志格式，所以还带 `usage=` / `budget=`；**当前格式是
`step stage: nudged tier=n/N step=S label=…`，没有 token 字段**。）
它们同时证明：`agent/pre-step` 真的走到了这个监听器、步数计数与 tier 判定按真实子代理在跑、
而且被注入的消息确实出现在每个子代理的 `session.v3.jsonl.zstd` 转写里
（`role: user`、`source: {kind:'plugin', plugin:'dsh-adg-token-budget'}`），与日志行毫秒级对齐；
第 12 步时它们只花了 10–14 万 token。`settled: released session state …` 也已经观测到（17:55:33）。

**已移除的 token 两档：当年实测（历史证据，不代表当前行为）。** 下面三行来自仍然带
token 两档的旧构建，插件再也不会写出这类行；保留它们是因为"为什么会删掉"就是这些实测：

```
2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
```

之后这一行被切成 `dryRun: true`，用户自己的真实委派又写了几百行 dry-run 判定。截至
`2026-09-25T01:1x+08:00` 的统计快照：**5 个**真实子代理、`dry-run soft stage: would nudge`
**36** 行、`dry-run hard stage: would cancel` **437** 行、`agent.cancel` **0** 次、
`soft stage: nudged` **0** 行；
最大的那一个子代理自己就占了 297 行 `would cancel`、峰值 **48,992,135**。
这证明 dry-run 真的不动作，也证明**300 万落在这台机器自己流量的主体里**（5/5 都越过去了）
—— 这正是把两档删掉的理由：按累计 token 介入只会截断正常产出，累计量大本身不是"跑飞了"的证据。

**哪些还没观测过 —— 说清楚：**

- **新阶梯下的注入还没观测过。** 三次真实注入都是旧的三档阶梯下的 `tier=1/3 step=12`；
  `[4, 8, …, 280]` 这 14 档下还没有一次注入记录，`dry-run step stage: would nudge` 这类行
  在本机也**从来没出现过**（这台机器从"没有这个 stage"直接到"已武装"，中间没停过）。
  （旧版"步数检查点与 token 软档同一步的折叠路径"已经随软档一起删除，不再是待观测项。）
- **更早更密的阶梯 + 选择式措辞有没有用，完全未观测。** 分布（37 个子代理，中位数 39 步、p10 只有 6）
  与成本（214 条提醒约占总账单 0.25%）都是实测的；"收到检查点的子代理是否更早收敛"没有证据。
  量法：`node D:\dsh\.dsh-token-audit\audit-steps.mjs "C:\Users\cenqian\.dsh\sessions"`
  前后各跑一次，比 p50/p75/p90，不要比均值。
- **注入的提醒是否真的让子代理收敛得更快**：三个子代理对提醒做出了反应（两个说要收敛、
  一个选继续并说明理由），说明提醒被读到并被当成决策输入；但三例、三个不同任务，
  不足以说明它让任何东西变快了。**恢复的子代理会不会被再次提醒**仍未观测。
- dry-run 的行是**每一步**写一行，所以那个行数是"检查点到期的步数"，不是"子代理个数"；
  真正武装的检查点每个 tier 只注入一次，也只写一行 `step stage: nudged`。

## 5. 关掉 / 回滚

1. `enabled: false` —— 不注册监听器、不写决策日志（最干净；安装脚本写进挂载行的就是这个值，
   注意**插件自己的默认值是 `true`**，例子文件里那一行现在也是显式 `enabled: false`）。
2. `disabled: true`（写在 `- id: adg-token-budget` 那一行同级）或整行删掉 —— 连包都不 import。
3. 还原 `cordis.patch.yml.bak-adg-token-budget`。
4. 想清干净：删 `$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`（没有行指向它就不会被 import）。
   顺带可以把挂载行里遗留的 `budgetTokens` / `softRatio` / `cacheReadWeight` / `softNudge` /
   `hardDryRun` 删掉 —— 它们已经被静默忽略，删不删都不影响行为，只影响可读性。
