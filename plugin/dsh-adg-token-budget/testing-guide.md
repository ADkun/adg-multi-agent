---
title: dsh-adg-token-budget 模块测试指南
owner: Adg 插件维护者
status: current
last_reviewed: 2026-09-28
---

# 测试与验证指南（`dsh-adg-token-budget`）

本文只讲**怎么验证**：用例从不变量穷举而来，每条不变量对应一组用例。
行为与语义见 `design.md`；实测数字与日志原文见本目录 `README.md` 与仓库根 `README.md` 的
"第二层"一节——本文不复制它们。

状态分层（引用时必须保留）：**源码级事实** / **单元测试** / **变异验证** / **真机实测（有日志为证）** /
**未观测**。本目录 `README.md` 记载的实测是证据来源，引用时写"插件 README 记载"。

## 0. 怎么跑

在模块目录里跑（**必须在 `plugin/dsh-adg-token-budget/` 下**，`node --test test` 是相对路径参数）：

```sh
cd plugin/dsh-adg-token-budget && node --test test
```

`package.json` 的 `scripts.test` 与这条等价。

**沙箱（DSH `workspace-write`）里有两个**独立的**拦截，别混成一个。**
下面四条命令都真跑过（2026-09-25；第二行的用例数在 2026-09-28 复跑过，见该行括注）：

| 命令形态 | 结果 |
|---|---|
| `node --test test`（无管道、无重定向） | **失败**：测试文件报 `Error: spawn EPERM`（`node --test` 默认给每个测试文件起 piped-stdio 子进程，沙箱拒绝 pipe）。`tests 1 / fail 1`，与断言无关 |
| `node --test --test-isolation=none test`（无管道、无重定向） | **跑通，54 个测试全过**（末尾 `pass 54 / fail 0`；2026-09-28 加 I17 那条用例后从 50 变 51，**同日**再加三条钉住 bundle 挂载行形状的用例 ⇒ 54，见第 1 节末的补充表） |
| `node --test test > out.txt 2>&1`（重定向到文件） | 被**上一条**拦下：重定向本身允许，失败原因仍是子进程 pipe |
| `node --test --test-isolation=none test 2>&1 \| Select-Object -Last 15` | 被拒：`Program 'node.exe' failed to run: Access is denied` —— 这一层拦的是**PowerShell 管道** |

所以：
- 沙箱里**必须**加 `--test-isolation=none`（它让 runner 不再起子进程，走的是同一份测试文件）；
- `spawn EPERM` 是**沙箱边界，不是断言失败**，别把它读成红灯；
- 看到 `Access is denied` 时那是**管道**被拒，改重定向到文件即可；
- 全绿与否看输出末尾的 `fail 0`。

全部测试只依赖 `node:test` / `node:assert`，在没有任何 `node_modules` 的检出里也能跑
（模块不静态 import 任何 `@deepseek-ai/*`，见 I3）。

## 1. 不变量 → 用例 → 类型（全表覆盖）

类型说明：**单测** = `test/plugin.test.js` 里真实存在的用例（名字逐字照抄）；
**变异** = 本目录 `README.md`「Mutation verification」小节里真实存在的变异编号；
**人工/实测** = 单元测试与变异都不覆盖，必须人工 review 或真机观测。

| 不变量 | 用例 | 类型 |
|---|---|---|
| **I1** 禁止 `apply` 抛出 | `apply never throws, for any config or context, and registers nothing without an event API`；`a throwing logger or an unwritable logFile cannot break apply` | 单测 |
| **I2** 禁止 `static inject` | `apply never throws, for any config or context, and registers nothing without an event API`（无任何服务可用时仍不抛、仍降级） | 单测 |
| **I3** 禁止静态 `import` 任何 `@deepseek-ai/*` | 无任何单测覆盖；由**结构**保证（`resolveCreateUserMessage` 的调用时解析 + 本地 fallback）。间接证据：`no token projection is ever consulted, even when the service is present` 断言 `ctx.get` **零次调用** | 人工 review（见第 5 节） |
| **I4** 每次 `apply` 恰好写一行激活行 | `apply always writes exactly one activation line, enabled or not`；`a throwing logger or an unwritable logFile cannot break apply` | 单测 |
| **I5** 禁止计"没真正进入的步" | `only an entered step is counted, so a rejected step costs no tier`；`a downstream reject is honoured: the checkpoint stage never invents messages` | 单测；变异 **M1**（数被 reject 的步）、**M8**（把每个判定都当 `enter`） |
| **I6** 禁止同一档位在同一驻留期内触发两次 | `a checkpoint injects its reminder on the tier step, once per tier` | 单测；变异 **M2**（`dueStepTier` 忽略 `firedTiers`） |
| **I7** 禁止同一步注入超过一条消息 | `a checkpoint injects its reminder on the tier step, once per tier`（档位逐次触发）；多个档位同时到期只发最靠前的那个由 `dueStepTier reports the lowest tier that is due and unfired` 钉住 | 单测 |
| **I8** `stepNudge: false` 时禁止分配任何状态 | `stepNudge: false turns the whole feature off and allocates nothing` | 单测；变异 **M6** |
| **I9** 禁止未知名让整行挂载失败 | `normalizeConfig ignores the retired token-budget keys`；`normalizeConfig fills exactly the surviving keys from defaults for unusable input`；`the token-budget helpers are gone from budget.js`；`the module exposes the loader-facing shape, and no retired export` | 单测 |
| **I10** 禁止提醒变成没有正文的空话 | `normalizeConfig reads a custom step body and refuses to be left wordless`；`stepNudgeText offers a choice, marks the last tier, takes a custom body, and is total` | 单测 |
| **I11** 禁止 `stepTiers` 被清空后静默关掉功能 | `unusable step tiers fall back to the defaults, not to "off"` | 单测；变异 **M12** |
| **I12** 阶数上限 56、`stepText` 上限 4000 字符（截断非拒绝） | `normalizeConfig bounds how many tiers it will honour`；`normalizeConfig reads a custom step body and refuses to be left wordless`；`the default ladder is a flat 10-step cadence from step 10 through step 300, and within the tier cap`（默认 30 档 < 上限 56，并断言 `normalizeConfig({})` 不截断默认阶梯 ⇒ 上限留余量、默认**永远**不会被自己的上限截断） | 单测；变异 **M16**（不再截断超长 `stepText`） |
| **I13** 禁止相对路径 `logFile` 静默写文件 | **无单测断言**：`a throwing logger or an unwritable logFile cannot break apply` 只覆盖"日志不可写"（目录当文件），不覆盖"相对路径被关闭"；`normalizeConfig keeps an unusable logFile out of the way` 只覆盖空白/非字符串回落 | 人工 review（见第 5 节）；变异表中亦无对应项。真机实测（2026-09-25 复核，见 `docs/evidence.md` §9）：**矩阵里没有"相对路径被写入"的痕迹** —— 属于"负面证据"，只说明没发生过，不构成覆盖 |
| **I14** 禁止正文被读成停止指令 | `the built-in checkpoint wording is pinned literally`；`stepNudgeText offers a choice, marks the last tier, takes a custom body, and is total`（含 `doesNotMatch(/立即停止/)`）。**2026-09-29 追加**：同一用例还钉住"继续"分支必须含 `通往目标的最短路径上的那一步` 与 `为什么最短`，且必须**同时**保留 `不要为了回应它而缩减或改写计划`（最短路径不得被读成"少做几项验证"）。**2026-09-30 追加**：字面量钉里必须含过期声明，并由 `match(/压缩（compaction）/)`、`match(/那份副本已经过期/)`、`match(/直接忽略它/)`、`match(/只对注入它的这一步有效/)`、`match(/本条在注入它的那一步仍然适用/)` 五条断言各自钉住（最后一条是防"整条提醒可以直接扔掉"的误读） | 单测；变异 **M13**（把那句"可以直接无视"反过来写） |
| **I15** 禁止各档正文递进 | `stepNudgeText offers a choice, marks the last tier, takes a custom body, and is total`；`a checkpoint injects its reminder on the tier step, once per tier`（只有最后一档带尾句） | 单测；变异 **M11**（去掉最后一档的尾句） |
| **I16** 禁止自定义 `stepText` 再被追加内置尾句 | `a configured stepText is what actually reaches the child`；`stepNudgeText offers a choice, marks the last tier, takes a custom body, and is total` | 单测；变异 **M15** |
| **I17** 禁止把注入消息的来源写回已废弃的 `{kind:'plugin', plugin}`（v4 在持久化写入路径上拒它，整轮失败） | `the reminder source passes the session format v4 admission rule`（两条构造路径 + 规则本身 + 旧包装的 `plugin` 属性必须消失）；`localCreateUserMessage matches createUserMessage output shape`；`the running profile from ctx.baseUrl is the first createUserMessage anchor`；`createNudgeFactory always yields a usable factory`；`a checkpoint injects its reminder on the tier step, once per tier` | 单测；变异 **M18**（被 4 条断言抓住）；**真机实测**（2026-09-28 事故 + 用装好的宿主 `assertV4RowAdmission` 复测，见 `docs/evidence.md` §15） |
| **I18** 阶梯不设间隔变化（每 10 步一档、第 10 步起、第 300 步止、30 档） | `the default ladder is a flat 10-step cadence from step 10 through step 300, and within the tier cap`（首档 = 10、末档 = 300、**每个**相邻间隔恒 = 10、档数 = 30） | 单测。**注意变异的形状**：改成"首档 10 + 间隔恒 10"之外的任何阶梯（含恢复几何拉开、或把档距改成递增）都会被这条抓住 |

补充（I1–I17 之外、但属于本模块对外契约的检查）：

| 契约 | 用例 | 类型 |
|---|---|---|
| 没有破坏性路径（不 `agent.cancel`、不读 `sessionProjections`、不返回 `{kind:'reject'}`） | `no token projection is ever consulted, even when the service is present`；`a child is never cancelled, however many steps it takes`；`the decision log never carries a retired stage line` | 单测 + 源码级检查（见第 4 节） |
| 激活行是版本判据（新形状含 `stepText=`，不含旧键） | `activationLine reports the surviving configuration and none of the retired fields`；`apply always writes exactly one activation line, enabled or not` | 单测；变异 **B2-activation**（跳过激活行） |
| 同上下文重复 `apply` 只注册一个 hook；dispose 后可重新注册 | `applying the same context twice registers exactly one hook`；`a re-apply after disposal registers again (the hot-reload path)`；`a second distinct context warns that the plugin is mounted twice`；`the listeners are registered globally and exactly once` | 单测；变异 **D2**（去掉同上下文去重） |
| 深度闸门（`'1'`/`1.5`/`-1`/越界/`NaN` 一律算深度 0） | `delegationDepthOf takes the deeper of the header and the runtime options`；`an out-of-contract header delegationDepth is no depth at all`；`isDelegatedChild is exactly depth > 0`；`a resumed child with only a header depth is still governed` | 单测；变异 **D5-header**、**D5-runtime** |
| preset 命中 fail-open（header 无 `agentPreset` 即不受管） | `presetIsGoverned fails open when the header carries no preset`；`a child of another preset, or with no preset, is never touched and allocates nothing`；`a top-level agent is never touched` | 单测 |
| 下游失败不被吞、`next()` 只调一次 | `a failing downstream listener is never swallowed, and next() is called once`；`a malformed payload is contained rather than propagating` | 单测；变异 **D1b**、**D1b-all** |
| `dryRun` 只算不做、不消费档位 | `dryRun checkpoints inject nothing, log every decision and consume nothing`；`dryRun counts the steps it watches and spends no tier` | 单测；变异 **M14**（`dryRun` 竟然注入） |
| 状态回收（`subagent/end` 与 disposer） | `the per-session map is released on subagent/end`；`the disposal effect clears the map` | 单测 |
| 计数与档位判定的纯函数性（越界输入不抛） | `dueStepTier refuses out-of-contract input instead of throwing`；`dueStepTier reports the lowest tier that is due and unfired` | 单测 |
| **bundle 层的挂载行形状**：包必须声明 `dsh.bundle.patch`、那个文件必须真的存在并能读出行；**部署集合 = `package.json` 的 `files` 六项** | `the package ships its own bundle patch and declares it` | 单测（**逐行文本扫描，不是 YAML 解析器**；"真实 profile 组合挂得上"属真机档，判据见 `INSTALL.md` 第 4 节） |
| bundle 层只有**一条**挂载行、必须挂本包、`config:` 里每个键都是 `DEFAULT_CONFIG` 读得懂的键、不写 `stepText`、出厂 `enabled: true` + `dryRun: false`、`logFile` 必须是 `!!js dshHomePath(...)` 求值而非写死某台机器的绝对路径 | `the bundle row is the mount row: one row, this package, armed by default` | 单测（同上） |
| 已移除的 token 键**不得回到生效行**（注释里记录它们不算） | `the bundle row cannot resurrect the retired token stages` | 单测（与 I9 / design.md 非功能红线 2 是同一件事，守卫在"行"这一层） |
| **profile 层不得再出现 `adg-token-budget` 的挂载行** —— **实测后果**（本机 2026-09-28）：同 id 残留**不多挂一行**（条目总数仍 190、激活行只写一行），但**整块接管** bundle 行的 `config:`（`dryRun` 被顶成 `true` ⇒ **注入当场停掉，而 `fiberPhase` 仍是 `active`、日志看起来完全正常**）**并让该行脱离管理**（`patchId` 消失、`readOnlyReason: "unaddressable"` ⇒ Plugins 页与 `set_plugin` 都点不动它）。逐字日志与三条结论见 `INSTALL.md` 第 4 节第 6 条（台账：`docs/evidence.md` §16.4 第 6 条） | **未实现**自动化：检测判据两条 —— `list_plugins` 里这一条**还有没有 `patchId`**（`list_bundles` 的 `overrides` 发现不了残留），以及文本侧 `Select-String -Path "$env:DSH_HOME/profiles/*/cordis.patch.yml" -Pattern 'adg-token-budget'` 应为 **0 处**（本机现状 0，见 `INSTALL.md` 第 2 节末） | 人工 review（缺口：一条扫 profile patch 文件的检查没写） |

### 本表"状态/类型"列的观测来源（2026-09-25 复核后的口径）

本表的**类型**（单测 / 变异 / 人工 review）来自源码与测试本身；**哪些现象被真机观测过**
则以下列来源为准，冲突时看后者：

- 权威台账：`docs/evidence.md` §9（活证据复核快照，`2026-09-25T13:46:37Z` / `21:46:37+08:00`，附 `sha256` 指纹；数字是某一刻的下界，引用时必须同时给时间戳与哈希）；
- 迁移成 bundle 那一批（2026-09-28）的证据：`docs/evidence.md` **§16**（§16.1–§16.5；逐字日志行同时
  记在 `INSTALL.md` 第 4 节，其中**第 5 条**是"用 `disabled: true` 关掉再放开"、**第 6 条**是
  "profile 层残留同 id 手贴行"这两组本机日志）。引用时**保留它自己的状态档**：§16.1–§16.3 是
  **源码级事实**、§16.4 是**真机实测（有日志为证）**、§16.5 里那几条（`adg` 那一面的注入、
  冷启动后的 bundle 层、`desktop` profile）是**未观测** —— 见下面「未观测清单」；
- **冲突只剩一条**：本目录 `README.md` 与仓库根 `README.md` 把"第一档之外的档 / 新阶梯下的注入"
  记为**未观测**，而 §9 的活日志复核显示它**已被观测**——**处置权在人类**（§9 的"文档冲突处置"一节）。
  引用时必须说清两边口径。**"恢复的子代理被再次提醒"不在冲突之列**：那一条两边都不算错，
  见下一节第 2 条的机制 / 事实之分。

### 只有人工/实测兜底的不变量

| 不变量 | 为什么单测兜不住 | 兜底方式 |
|---|---|---|
| **I3** | 除 `@deepseek-ai/*` 解析路径外，无法在无宿主的单测里"证明装载期没发生静态 import" | 人工 review 导出面 + 在真机部署位置（`$DSH_HOME/bundles/dsh-adg-token-budget/`，由 profile 的 `node_modules` 链接指向它、并由该 profile 的 `dsh.profile.bundles` 选中）确认整行能挂起；变异表无对应项 |
| **I13** | 相对路径关闭文件日志这条分支**没有任何断言**（测试里只有"目录不可写"） | 人工 review `createLogger`；变异表无对应项 |

## 2. 状态机迁移矩阵（全表）

行 = 起始状态，列 = 事件，格 = 目标状态或**禁止**。

### 2.1 `PluginActivation`（`apply` 的加载生命周期）

| 起始 → 事件 | `apply` 正常返回（`enabled:true`、有 `ctx.on`、首次） | `apply`（`enabled:false`） | `apply`（`ctx` 无 `on`） | `apply` 内部抛错（被外层 `catch` 兜住） | 同一 `ctx` 再次 `apply` | disposer 被调用 | 宿主重放该行（热重载） |
|---|---|---|---|---|---|---|---|
| `not-loaded` | `active` | `inactive(enabled:false)` | `no-op` | `no-op` | 不适用（还没加载） | 不适用 | 不适用 |
| `applying` | 同上（`applying` 只在栈内） | 同上 | 同上 | 同上 | 同上 | 不适用 | 不适用 |
| `active` | — | 新行生效 → 该行 `inactive` | 新行生效 → 该行 `no-op` | 新行生效 → 该行 `no-op` | **`active` + 告警**（`already applied`；**不是** fatal，也**不是**没注册） | `not-loaded`（注册被摘掉，`appliedContexts` 记录被删） | **`applying` → `active`**（再入，唯一合法路径） |
| `inactive(enabled:false)` | — | — | — | — | **禁止**：该状态没注册任何监听器，重复 `apply` 仍只会再写一行激活行，不得据此认为有监听器存在 | `not-loaded` | `applying` |
| `no-op` | — | — | — | — | **禁止**：不得把 `no-op` 当成"再 `apply` 一次就能修好"——`ctx` 的事件 API 缺失或内部失败是环境问题，不是状态问题 | `not-loaded` | `applying` |

禁止格的共同原因：**迁移唯一入口是 `apply(ctx, rawConfig)`**，进程级注册账本（`appliedContexts` /
`activeRegistrations`）只由 `apply` 及其 disposer 写；任何"直接置状态"的写法都会让
`applying the same context twice registers exactly one hook` 或
`a second distinct context warns that the plugin is mounted twice` 失去意义。

> **这两格是"进程内连调两次 `apply`"打出来的，别读成"宿主会挂两行"。** 真实宿主里跨层同 id
> （bundle 行 + profile 层残留一条同 id 的旧 `- insert:` 手贴行）**不会**走到这两格：Loader 按 id
> 合并成**一条**、只 `apply` 一次、条目总数不变（仍 190）—— **真机实测**（本机 2026-09-28），
> 三条结论与逐字日志见 `INSTALL.md` 第 4 节第 6 条。残留的代价不是多一行，而是那一行的 `config:`
> 被整块接管（实测 `dryRun` 被顶成 `true`）+ `patchId` 消失、`readOnlyReason: "unaddressable"`。

### 2.2 `ChildStepState`（一次驻留期的计数句柄）

| 起始 → 事件 | 首个受管 `enter` 步（`stepNudge:true`） | `enter` 步命中到期档位且消息构造成功 | `enter` 步到期但消息构造失败 | 判定非 `enter`（如 `reject`）的那一步 | `subagent/end`（带可用 id） | `subagent/end`（无 id） | `ctx.effect` disposer | `stepNudge:false` | 同键在释放后再来一步 |
|---|---|---|---|---|---|---|---|---|---|
| 不存在 | `open`（`steps:1`） | `open`（`steps+1`，该档下标进 `firedTiers`） | `open`（`steps+1`，**档位不消费**） | **禁止进入本状态机**：不建、不计数、不消费档位（`entryOf(key,false)` 只读） | 无状态可释放 | 无状态可释放 | 无状态可释放 | **禁止分配**（I8） | — |
| `open` | `open`（`steps+1`） | `open`（`steps+1` + 标记一次） | `open`（`steps+1`，档位仍欠） | `open`（**不变**：`steps` 与 `firedTiers` 都不动） | `released`（并写一行 settle） | `open`（忽略，不崩） | `released` | 不适用 | 不适用 |
| `released` | `open`（**新的驻留期**：`steps` 与 `firedTiers` 从头开始） | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | `open`，`steps:1` |

禁止格的共同原因：**迁移唯一入口是 `markStep` / `entryOf(key,true)`（开）与 `subagent/end` /
`ctx.effect` disposer（释放）**。禁止就地改 `steps` / `firedTiers`：这两项是
`a checkpoint injects its reminder on the tier step, once per tier` 与
`only an entered step is counted, so a rejected step costs no tier` 断言的对象。

### 2.3 迁移矩阵的未覆盖格（如实登记）

- `判定非 enter（如 reject）` 一列只被 `{kind:'reject'}` 这一种取值驱动过；
  其它非 `enter` 的 `kind` 走的是同一个分支（`decision?.kind === 'enter'` 为假），
  但**没有任何用例以别的 `kind` 驱动它**。
- `同键在释放后再来一步`（恢复的子代理被再次提醒）：单测只覆盖"状态被清掉后再来一步会重新计数"
  这一**机制**。**真机复核升级的是机制、不是事实**（2026-09-25，见 `docs/evidence.md` §9）：
  同一 label 先出现 `settled:`、随后出现新驻留期的首个检查点，另一个 label 有多轮完整驻留期、
  每轮都从第一档重新开始 —— **驻留期重置确实在跑**；但"那个子代理是被恢复的"仍无从判定
  （`subagent/end` 对"结束"与"被恢复"发同一个事件），所以**"真实的续跑子代理会重新收到提醒"
  仍属未观测**，只是它的前提有了观测支持。本目录 `README.md` 与仓库根 `README.md` 的"未观测"记载
  **因此仍然成立，不是冲突**。

## 3. 跨模块消费侧契约测试

本插件消费 preset 侧的**两个 header 字段**：`session.header.agentPreset`（必须命中 `presets` 配置）
与 `session.header.delegationDepth`（必须 > 0）。插件侧的落地测试是
`presetIsGoverned fails open when the header carries no preset`、
`isDelegatedChild is exactly depth > 0`、
`a resumed child with only a header depth is still governed`、
`a child of another preset, or with no preset, is never touched and allocates nothing`。

这些用例的**桩形状**来自 `test/plugin.test.js` 的 `fakeAgent()`，它构造
`{ session: { header: { id, cwd, agentPreset?, delegationDepth? } }, options: { subagentDepth? } }`。
桩是"手写理解的固化"，所以要在 preset 侧留一道**消费侧契约测试**，用来发现理解漂移：

1. **`preset/agent.cordis.yml` 改名册不影响这两个字段**：该文件只列专家智能体行，
   `agentPreset` 与 `delegationDepth` 由 session header 写入，不来自名册。验证方式：
   改/增删专家行后重跑 `node tools/check-preset.mjs`（命令见根 `AGENTS.md`），
   并在一次真实委派后确认子代理转写里本插件的提醒仍出现。
   **读转写核对注入必须按多帧处理**：`session.v4.jsonl.zstd` 是**多帧（multi-frame）**文件，
   一次 `zlib.zstdDecompressSync(整个文件)` 只解出**第一帧**（= 只有 session 头那一行），
   会把"提醒没出现"读成假阴性；要按 magic `28 B5 2F FD` 逐个偏移分别解压才是全部记录
   （出处与本机数字：`docs/evidence.md` §15.5 与 §16.4，**真机实测**；本文不复制其口径细节）。
2. **换 preset id 或改 `preset/preset.yml`**：id 来自生成 patch 里声明行的 `config.id`（值由
   `tools/gen-preset-bundle.mjs` 的 `PRESET_ID` 决定），`preset.yml` 只提供显示元数据、改它**不**动 id。
   换 id 时必须同时改**挂载行里的 `presets:`** —— 那一行现在住在 **bundle 层**
   （`plugin/dsh-adg-token-budget/cordis.patch.yml`，键参考与注释在 `examples/cordis.patch.yml`），
   **改它要按重启处理**（`INSTALL.md` 第 3 节）。否则插件的 `presetIsGoverned` 会 fail-open
   —— 表现为**静默不提醒**，不是报错。
   验证方式：新 preset id 下跑一次真实委派，确认 `logFile` 里出现决策行；没有决策行即命中此漂移。
3. **怎么确认这份理解没漂移**：把插件侧的 header 读取路径与 `preset/agent.cordis.yml`
   （**唯一真相源**；生成物 `bundle/adg-preset/cordis.patch.yml` 由 `tools/gen-preset-bundle.mjs` 产出，
   装进 profile 后被注册的那一行才是运行期事实）对齐 —— 读一个真实子代理转写里的 header
   （`session.v3.jsonl.zstd` 解压后；**解压必须按多帧处理**，见本节第 1 条）确认字段名与取值形态
   （`agentPreset` 为字符串、`delegationDepth` 为安全整数）。字段名一旦变化，`presetIsGoverned` 会 fail-open 而
   `isDelegatedChild` 会判成顶层 —— 两者都**不会抛错**，只能靠这条对齐发现。
   **取值形态有本机实测对照**：`adg` 专家行委派出去的子代理 label 是 `adg/<uuid>`；而通用
   `subagent` / `subagent_fork` 委派出去的子代理 header 记的是 `agentPreset: "cordis"`、
   `delegationDepth: 1`（**真机实测**，2026-09-28，出处见 `docs/evidence.md` §16.4 与
   `INSTALL.md` 第 4 节）。所以 `presets: ['adg']` 按设计**不治理**通用委派（fail open）——
   **拿通用委派去验"提醒有没有出现"会得到假阴性**，要么走一次 Adg 专家委派，要么临时加一条
   profile 覆盖行把 `presets` 写成 `['cordis']`。

**部署集合的消费侧契约**：`INSTALL.md` 第 1 节声明"部署集合 = `package.json` + `cordis.patch.yml` +
`src/` + `README.md` + `examples/` + `LICENSE` **六项**；`test/` 与 `INSTALL.md` 不进部署"，
`install.ps1` / `install.sh` 消费这条事实。真正的定义在 `package.json` 的 `files`
（`src` / `examples` / `cordis.patch.yml` / `README.md` / `LICENSE`，`package.json` 自身由 npm/拷贝脚本
另行包含），并由 `dsh.bundle.patch: ./cordis.patch.yml` 声明那个文件是 bundle 层。
**这一条现在有测试钉住**：`the package ships its own bundle patch and declares it` 断言 `files` 恰为
那六项、`dsh.bundle.patch` 的值、以及那个文件真的存在且读得出行（见第 1 节末的补充表）。
少拷 `cordis.patch.yml` 的后果不是"多带/少带一个文件"，而是**挂载行整个消失**：这个包退化成一条
普通依赖，行静默不挂载。改动 `files` 时三处（`files`、`INSTALL.md` 第 1 节、两个脚本的拷贝清单）
脱钩的发现方式：

```powershell
cd D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget
Select-String -Path .\package.json -Pattern '"src"|"examples"|"cordis.patch.yml"|"README.md"|"LICENSE"|"patch"'
Select-String -Path .\INSTALL.md -Pattern 'examples/|LICENSE|cordis.patch.yml|test/ 与 INSTALL.md'
Select-String -Path ..\..\install.ps1,..\..\install.sh -Pattern 'examples|LICENSE|cordis.patch.yml|test|INSTALL.md'
```

判据：若 `package.json` 的 `files` 里新增/删除了名目，而 `INSTALL.md` 第 1 节与两个安装脚本的
拷贝清单没跟着变，就是脱钩 —— 后果是"手动部署多带/少带了东西"或"部署出来的包与 npm 包不一致"，
**而少带 `cordis.patch.yml` 是少带挂载行本身**。
（本检查是**文本级**的：它证明不了拷贝逻辑正确，只证明三处名目一致。）

**落点不在本节的判据里**：部署目标是稳定 bundle 根 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-token-budget/`
（由 profile 的 `node_modules` 链接指向它，**并由该 profile 的 `dsh.profile.bundles` 选中** ——
只 link 不选中，它的 patch 层根本不会被读），**不是**共享的 `profiles/node_modules/` —— 后者在本版
dsh 的模块解析里被排除（**实测**：放那儿解析不到、行挂不起来）；旧落点 `$DSH_HOME/plugins/dsh-adg-token-budget/`
自 2026-09-28 起已废弃并由脚本清理。见 `design.md`「依赖关系」与 `INSTALL.md` 第 1、2 节。

## 4. 无破坏性路径的源码级检查

照 `INSTALL.md` 第 4 节那条，在**模块目录**里跑，可直接照抄：

```powershell
cd D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget
Get-ChildItem src\*.js | ForEach-Object { Get-Content -LiteralPath $_.FullName } |
  Where-Object { $_ -notmatch '^\s*(\*|//|/\*)' } |
  Select-String "agent\.cancel|sessionProjections|kind: 'reject'"
```

预期：**没有任何输出**。它证明的是"token 两档（含硬档取消）真的被删掉了"这个**源码级事实**，
与任何日志无关；对应的行为级证据是
`no token projection is ever consulted, even when the service is present`、
`a child is never cancelled, however many steps it takes`、
`the decision log never carries a retired stage line`。

**为什么必须先滤注释行**：模块的头部注释**故意**保留着"这里曾经读 `sessionProjections`、
在阈值上 `agent.cancel({ kind: 'parent' })` 并返回 `{ kind: 'reject' }`"这段说明文字（记录移除口径）。
不滤注释就一定会匹配到那些行，检查会变成永远失败的假警报；滤掉注释行之后，只要还有任何一行匹配，
就说明破坏性路径真的被加回了代码。

## 5. 安全设计的三条不可测面（如实登记）

以下三项**被单元测试完全无覆盖**，是本模块的已知缺口，也是未来重构的暴露面：

| 变异 | 状态 | 为什么没有断言 | 未来重构的暴露面 |
|---|---|---|---|
| **D1a**（允许第二次 `next()`：删掉 `call.called` 守卫） | **未被抓住** | 该守卫**由构造不可达**（每条路径只调一次 `callNext()`），没有用例能驱动第二次调用，删掉它无可观测变化 | "`next()` 最多调用一次"这条不变量靠**结构**（每条路径一个 `callNext()`）与 **D1b-all 被抓**共同保证；重构 handler 的控制流时必须人工复核这条结构 |
| **D1b-inner**（只掐掉内层 `call.failed` 重抛） | **未被抓住** | 内层重抛被去掉后，执行仍会撞上第二道防线（`if (call.called) throw error`），错误照样传播，变异体根本到不了断言的观测面 | 两道重抛是**冗余**关系；若重构时删掉第二道，D1b-inner 就会变成真缺口而测试不会变红 |
| **B2-logger** + **B2-logfile**（跳过激活行） | **未被抓住**（由专用探针测过） | 插件 README 记载：这两个变异是用**专用探针**（而不是套件）量的 —— 抛错的 `logger.info` 与不可写的 `logFile` 各自驱动一遍 `apply`，六次运行里 `apply` 都没抛，因为激活行写在 `apply` 外层 `try` **之内**的独立 `try`/`catch` 里 | `apply` 永不抛出这条契约靠**结构**（外层 `try` + 内层独立 `try`）保证；**任何移除外层 `try` 的重构都会让它们变成 fatal，而没有任何测试会变红** |

三条对应的**人工 review 动作**：改 `apply` 或 `handler` 的 `try`/`catch` 骨架时，
逐行核对"是否仍存在外层 `try`"与"每条路径是否只调一次 `callNext()`"，并把结论写进改动说明。

## 6. 变异验证总表（编号来自本目录 `README.md` 的「Mutation verification」小节）

- **被抓住**：M1、M2、M6、M7、M8、M9、M10、M11、M12、M13、M14、M15、M16、M17、**M18**、
  D1b、D1b-all、D2、D5-header、D5-runtime、B2-activation。
- **未被抓住（4 个）**：**D1a**、**D1b-inner**、**B2-logger**、**B2-logfile** ——
  原因与暴露面见第 5 节。
- **`NOT-APPLIED`（5 个，2026-09-28 复核新增记录）**：**M1**、**M3**、**M4**、**M5**、**M6** ——
  它们的 `from` 串描述的是 **token 两档移除之前**的代码（两触发 `else if` 分支、软/硬档、
  `postStep` 里旧的 `stepNudge` 判定），在当前代码里已经匹配不到，所以是 **harness 漂移，不是回归**；
  它们当年那次"被抓住"是针对当时存在的代码实测的，表格照原样保留。罩住同一行为的**存活**变异是
  **M8**（把每个判定都当 `enter`）与 **M13**，两者本次仍被抓住。
- **I17 的复测不是单测能兜的那一半**：宿主准入规则在包外（I3 禁止静态 import），所以除了 M18，
  还要用装好的宿主复测一次 —— `node D:\dsh\.adg-step-mutations\verify-v4-source-admission.mjs`
  （用真实 `assertV4RowAdmission` 跑插件的真实消息：当前 kind 通过、旧包装被拒并给出用户报的那句）。
- 变异表里**没有**编号的缺口：I3（静态 import）与 I13（相对路径 `logFile`）既没有单测断言，
  也没有对应的变异项，只能靠人工 review（见第 1 节末表）。

### 观测状态对照表（原依据 vs 2026-09-25 复核）

| 条目 | 原依据的记载 | 本次复核后的状态 |
|---|---|---|
| 第一档之外的档位是否真的注入过 | 本目录 `README.md` 与仓库根 `README.md` 都记载"从未观测"（真实注入只发生在旧阶梯） | **真机实测（2026-09-25 复核，见 `docs/evidence.md` §9）**：**当时的 14 档阶梯**（`[4, 8, …, 280]`）下第一档之外的多个档位各自触发过，且档位越靠后触发次数越少。**注意时效**：默认阶梯此后换过两次（2026-09-29 的 56 档平坦阶梯、2026-09-30 的 30 档平坦阶梯：每 10 步一档、10→300），这条观测**不覆盖**后两者 |
| 现默认阶梯下是否有真实注入 | 同上，记为"新阶梯下的注入还没观测过" | **§9 那次复核时成立（真机实测）**：当时**默认的 14 档**阶梯下已有大量真实注入，分布在多个不同子代理上。**每次换阶梯之后都重新变成未观测** —— 56 档那版没有留下注入记录，**2026-09-30 的 30 档平坦阶梯同样一条都没有**（阶梯是 bundle 行里的 `config:`，改动要重启 dsh 才生效） |
| 恢复的子代理被再次提醒 | 同上，记为"仍未观测" | **仍未观测，原记载成立**：§9 的活日志显示同一 label 先 `settled:`、后从第一档重新计数（=驻留期重置机制在真机上执行），但"该子代理是被恢复的"无从判定（`subagent/end` 对两种情形发同一事件）。**机制已观测、事实未观测**，不要合并成一句 |
| `dry-run step stage: …` 这类校准行是否在本机出现过 | 记为"从来没出现过" | **仍未观测，原记载成立**（§9 复核该前缀行数为 0：本机从未停留在校准态）。真机实测形态是**计数与判定枚举**，不是同一条 dry-run 行 |
| **现行"每 10 步一档、不设间隔变化"的平坦阶梯是否让子代理更快收敛，以及"通向目标的最短路径"那句自述是否真的把它留在最快路径上** | 记为"完全未观测" | **仍未观测**（不许升级）。量法见 `INSTALL.md` 第 4 节末；**2026-09-29 追加两个观测量**：① 子代理在选"继续"之后的下一条消息里是否真的写出了"为什么这一步最短"（没有 = 提示没被当成决策输入）② 换阶梯前后的步数分布（p50/p75/p90，比分位数不比均值）与中途改道次数。**2026-09-30 追加第三个观测量**：③ 过期声明有没有真的拦住"压缩后把旧提醒当现役指令"（量法：压缩发生后子代理的下一条消息里有没有再次出现"我在第 N 步"式的定位，或凭空开始收敛汇报） |
| 阶梯之外的步数是否触发/消费档位 | 记为"任意一档之外的 tier 从未观测" | **真机实测（同上）**：§9 的注入分布只落在配置的档位上；配合**源码级事实**（不命中档位的步不写任何决策行，见 `a step below the first tier passes through and is counted`） |
| 改目录名能否强制重新 `import`（绕过热重载缓存） | 未观测 | **仍未观测**（不许升级） |

### 未观测清单（不许写成实测）

以下事实**没有任何观测记录**，属于"禁止的假设"：

- **现行平坦阶梯（每 10 步一档、10→300）是否让子代理更快收敛、以及"最短路径"自述是否真的把它留在最快路径上**（量法见 `INSTALL.md` 第 4 节末；比 p50/p75/p90，不比均值）。**同一条也覆盖"新阶梯下有没有注入过"**：30 档是 2026-09-30 才写进 bundle 行的，重启前不会生效，生效后也需要真实 Adg 会话才有记录；
- **过期声明是否真的生效**（2026-09-30 新增）：压缩（compaction）之后，子代理还会不会把摘要/复述里的旧提醒当成现役指令（观测量：压缩后的下一条消息里有没有再次按"第 N 步"定位、或凭空开始收敛汇报）；
- `dry-run step stage: …` 这类校准行是否在本机出现过（本机从未停留在校准态）；
- **改目录名能否强制重新 `import`**（热重载不重新 import 已加载模块这条机制本身有真机实测支持，
  但"改名目录可以绕过"这一对策从未验证过。现在的落点是 `$DSH_HOME/bundles/dsh-adg-token-budget/`
  加一条 profile 内的 `link:`、并由该 profile 的 `dsh.profile.bundles` 选中，改名要同步这三处
  —— 这件事同样**未观测**）；
- **迁移成 bundle 之后，`presets: ['adg']` 对**真实 Adg 专家子代理**的注入**：未观测。
  2026-09-28 那两条注入走的是临时覆盖行 `presets: ['cordis']` 下的通用委派（见上面第 3 节那条
  取值形态对照）。量法：新对话里走一次 Adg 专家委派，或临时加 profile 覆盖行
  `presets: ['adg']` + `stepTiers: [1, 2]`，看 `step stage: nudged … label=adg/…`；
- **重启（冷启动）之后的 bundle 层**：未观测 —— 那次迁移是在**迁移前就起来的进程**里生效的，
  触发点是改写 profile 清单带来的整份 patch 栈重读，**不是** bundle 层被 watch。
  量法：重启 dsh → `plugin_manager list_bundles` 仍有 `dsh-adg-token-budget` 这一条 + 日志新出现一行
  `activation: …`（`INSTALL.md` 第 4 节末）；
- **`desktop` profile 生效**：未观测（它的 `patchReload` 不是 `live` ⇒ 要下次启动才生效）。
  量法：启动 desktop profile → 看同一份日志的 `activation` 行。

冲突登记：上表中与本次复核结果相冲突的原记载，**处置权在人类**——引用任何"是否观测过"的结论前，
先读 `docs/evidence.md` §9（本节的权威来源）。
