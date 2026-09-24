# 部署与启用清单（`dsh-adg-token-budget`）

这份文件是**操作清单**，只讲"怎么装、怎么开、怎么确认、怎么回滚"。
插件做什么、每个键什么含义、安全设计、证据边界，见本目录的 `README.md`；
两层预算的整体口径（含实测分布与 300 万这个默认值怎么来的）见仓库根 `README.md` 的
「第二层：子代理 token 预算的硬兜底」一节。

**本文件是仓库文档，不在部署集合里** —— 装到 `$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`
的是 `package.json` / `src/` / `README.md` / `examples/` / `LICENSE` 五项，`test/` 与 `INSTALL.md` 都不进去。

## 0. 一条约束先记住

**`enabled: false` 时插件不注册任何监听器、不写任何决策日志。** 但它**会写一行加载期的激活行**
（`activation: inactive (enabled: false) …`），所以"装上了"这件事**看得见**，
不再需要先改成 `true` 才知道插件被加载过。想看到软/硬档的决策行，才必须让一个受管的子代理真的越过软阈值。

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

安装脚本（`install.ps1` / `install.sh`）已经把这四步做完，并且在输出里说明备份路径与"行是新增还是已存在"。
两者行为等价、零依赖。

## 3. 启用（一步、可撤回）

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
      config:
        enabled: true
```

这个文件热重载：**改完立即生效，不用重启 dsh** —— 运行中的宿主会就地 import 这个包，
本机已经这样跑过一次（见下）。想先小范围试，把 `budgetTokens` 调到 `20000`、`softRatio` 调到 `0.05`。

**想先校准、不想真的砍掉任何工作，就先只打开 `dryRun: true`**（`enabled: true` + `dryRun: true`）：
插件会把每一次软/硬档判定按原样写进 `logFile`，但不注入消息、不 `agent.cancel`、硬档也照常放行，
而且**不消耗"只提醒一次"的标记**。这样 `logFile` 就变成了一份"按你自己的流量，这个预算会砍掉多少"的测量，
看着能接受了再把 `dryRun` 改回 `false`。

## 4. 确认已武装

| 看哪里 | 期望看到什么 |
|---|---|
| `logFile`（安装脚本写的是 `$DSH_HOME/adg-token-budget.log`） | **加载期就有第一行**：`activation: active createUserMessage=<解析策略> budgetTokens=… softThreshold=… softRatio=… presets=[…] cacheReadWeight=… softNudge=… dryRun=… logFile=…`；`enabled: false` 时写的是 `activation: inactive (enabled: false) …`（同样是"宿主确实加载过"的证据） |
| `logFile`（决策行） | 只有**事件**才写：软档（`soft stage: nudged …`）、硬档（`hard stage: cancel …`）、dry-run 判定、`settled: released session state …`、至多一次的 `no budget data: passing through …`。**普通放行（PASS）一步什么都不写**，所以文件不会膨胀 |
| 宿主日志（加载期） | `dsh-adg-token-budget: activation: active createUserMessage=…`；**出现** `apply failed (…); the token budget is inactive` 就是降级成 no-op 了 |
| 宿主日志（第一次决策时，一次） | `dsh-adg-token-budget: first decision: …` |
| 行为 | 用一次**超过预算的委派**（临时把 `budgetTokens` 调小）看：调度者收到的那份结果以 `Partial output before the run ended: …` 结尾 |

**本机的实测证据**（`C:\Users\cenqian\.dsh\adg-token-budget.log`，逐字引用）：

```
2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
```

这三行证明：宿主加载了行且没有报 fatal（第一行）、激活行与解析策略都对（第二行）、
`agent/pre-step` 真的走到了这个监听器且读到了真实的 `tokenUsage` 累计值、并走到了 `agent.cancel` 那一支（第三行）。

之后这一行被切成 `dryRun: true`，用户自己的真实委派又写了 100+ 行 dry-run 判定（下面只摘三行）：

```
2026-09-24T14:11:23.331Z dry-run soft stage: would nudge usage=2185852 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
2026-09-24T14:12:35.408Z dry-run hard stage: would cancel usage=3065764 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
2026-09-24T14:19:17.856Z dry-run hard stage: would cancel usage=9824410 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
```

（截至 `2026-09-24T22:19:40+08:00` 的统计快照，这个文件还在长：`would nudge` **21** 行、`would cancel` **90** 行、
`agent.cancel` **0** 次、`soft stage: nudged` **0** 行、`settled: …` **0** 行。）
这证明两档的比较逻辑确实按真实账单在跑（软阈值 2,100,000、硬阈值 3,000,000），也证明 `dryRun` 真的不动作。

**哪些还没观测过 —— 说清楚：**

- **真软档（`soft stage: nudged`）从来没在真机上出现过。** 上面那次唯一的硬停是"从软阈值以下直接跳到硬阈值以上"
  （`usage=7651807` 对 300 万的预算）。之后的软档行**全都是 dry-run 的**，消息从未真正注入过：
  注入的消息有没有被循环接受、有没有出现在子代理的转写里，都**未观测**。
- **`settled: released session state …`** 也从未出现；**调度者怎么渲染部分输出**、**恢复的子代理会不会被再次提醒**同样未观测。
- dry-run 的行是**每一步**写一行，所以那个行数是"超预算的步数"，不是"子代理个数"。

## 5. 关掉 / 回滚

1. `enabled: false` —— 不注册监听器、不写决策日志（最干净；安装脚本写进挂载行的就是这个值，
   注意**插件自己的默认值是 `true`**，例子文件里那一行现在也是显式 `enabled: false`）。
2. `disabled: true`（写在 `- id: adg-token-budget` 那一行同级）或整行删掉 —— 连包都不 import。
3. 还原 `cordis.patch.yml.bak-adg-token-budget`。
4. 想清干净：删 `$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`（没有行指向它就不会被 import）。
