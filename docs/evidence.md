---
title: 实测证据台账
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-28
---

# 实测证据台账（docs/evidence.md）

本文件是**证据层**：只登记"哪个结论、由什么证据支撑、证据到什么程度"。
它不写设计（设计在 `<模块>/design.md`），不写用法（用法在 `README.md` 与 `plugin/dsh-adg-token-budget/INSTALL.md`），
也不替代原始日志——**任何数字被引用前都必须回到列出的原始文件重算一次**。

## 状态分层（引用时不许抹平）

| 档 | 含义 | 允许的宣称 |
|---|---|---|
| **源码级事实** | 读代码即可确认，无运行期依赖 | "代码里是这样的" |
| **检验**（单元 / 静态自检 / 变异验证） | 单元测试 / 静态自检 / 变异验证跑过，有退出码或断言为凭 | "测试钉住了这个行为" |
| **真机实测** | 本机运行的 dsh 产生的日志/转写为凭，可逐行复核 | "在本机观测到过"（附时间、文件、行） |
| **未观测** | 没有证据，只有设计意图或论证 | 只能说"设计上如此，未经观测" |

**本仓库的核心问题（步数检查点到底有没有用）至今仍是"未观测"**：分布、成本、覆盖都是实测的，
"收到检查点的子代理是否更早收敛"没有任何证据。这一条不许因为下面的覆盖数字好看就改口。

## 证据来源（原始文件，本机路径）

| 来源 | 路径 | 它是什么 |
|---|---|---|
| 插件决策日志 | `C:\Users\cenqian\.dsh\adg-token-budget.log` | 每行带 ISO-8601 时间戳。**行前缀**是计数依据（`activation:` / `step stage:` / `settled:` / 已移除的 `hard stage:`），**不是事件语义**——例如 `activation:` 数出来的是"宿主加载次数"。逐前缀的含义见 `plugin/dsh-adg-token-budget/README.md`「什么进 logFile」 |
| 活行 | `C:\Users\cenqian\.dsh\bundles\dsh-adg-token-budget\cordis.patch.yml`（bundle 层，`$DSH_HOME/bundles/dsh-adg-token-budget/cordis.patch.yml`） | 当前插件挂载行（`enabled: true` + `dryRun: false`，出厂即武装，**没有** §7 那 5 个惰性旧键）。2026-09-28 起它在 **bundle 层**、由 profile 的 `dsh.profile.bundles` 选中；**profile 层（`profiles/web/cordis.patch.yml`）已无该条目**，只有人手贴的整块覆盖行时才会在那里出现（迁移事实见 §16） |
| 子代理转写 | `C:\Users\cenqian\.dsh\sessions\…\session.v3.jsonl.zstd` | 注入消息的原文与子代理的回应，与日志行毫秒级对齐 |
| 审计脚本 | `D:\dsh\.dsh-token-audit\audit-run.mjs`（成本）/ `audit-steps.mjs`（步数分布） | 从会话目录重算；报告写到同目录的 `audit-report.txt` / `audit-report.steps.txt`。`audit-steps.mjs` 打印 `children=… min=… p10=… p25=… p50=… p75=… p90=… max=… mean=…`、排序表、直方图，以及"每个候选 tier 会命中谁" |
| 变异验证 | `D:\dsh\.adg-step-mutations\run-mutations.ps1` | 每个变异一个独立目录，跑完把原始 `node --test` 输出留在旁边。**不属于任何交付包** |
| 沙箱探测（§11） | `D:\dsh\_archive\2026-09-26-sandbox-probes\probe1.js` / `probe2.js`（输出 `probe1.log` / `probe2.log`，外加按变体命名的 `<变体>.out.txt` / `<变体>.err.txt`，如 `edge-dumpdom.err.txt`） | 在受限会话里逐条探测管道 stdio 与浏览器启动。**不属于任何交付包** |
| 人工介入探测（§12） | `D:\dsh\_archive\2026-09-26-sandbox-probes\probe3-launch.js`（分离启动有头浏览器）/ `probe3-attach.js`（另一次调用重连它）/ `probe4-cookie.js`（cookie 是否落盘） | 验证「用户手动登录后专家接着用」的**机制**：窗口存活 + 跨调用 CDP 重连。**不属于任何交付包** |
| 静态自检 | `node tools/check-preset.mjs` | 见 `tools/testing-guide.md` |
| 生成物自检（§17） | `node tools/check-bundle-flavor.mjs <cordis.patch.yml> <plain\|bili>` | 钉住 **bundle 产物**里 billion-context 那四个名字的有无；`check-preset.mjs` 读的是源文件（专家行在第 4 列），产物里它们在第 14 列，产物是它的盲区。零依赖按行扫、自己探测缩进 |
| billion-context 挂载判据（§17） | 判据实现 `tools/has-billion-context.mjs`；被判对象 = 某 profile 的 `package.json` 里 `dsh.profile.bundles` 含 `billion-context` **且** `profiles/<p>/node_modules/billion-context/dsh.bundle.patch.yml` 存在 | 同一份判据管两件方向相反的事（给专家注入那四个工具 / 让 token-budget 不启用），实现只在这一处 |

## 1. 步数分布与阶梯校准（真机实测）

来源：`audit-steps.mjs` 跑同一份会话目录，37 个受委派的 `adg` 会话。
分布（`README.md`「第二层」的行文是 `min 1 / p10 6 / p25 14 / 中位数 39 / 平均 51.7 / p75 61 / p90 103 / max 329`，脚本按 `p50` 打印中位数）：
`min 1 / p10 6 / p25 14 / p50 39 / p75 61 / p90 103 / max 329 / mean 51.7`。
校准结论：阶梯锚在**分布**而不是均值（按均值放，第一个检查点会在四分之一人口已经结束后才问）。

| 阶梯 | 覆盖到 | 注入条数 | 首次检查点之后的步数占比 | 最后一个 tier 之后的步数 |
|---|---|---|---|---|
| `[12, 24, 40]` | 30/37 | 71 | 79.5% | 872 |
| `[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]`（2026-09-29 之前的默认，**已不是默认**） | 34/37 | 214 | 92.6% | 49 |

**2026-09-29 起默认阶梯是 `[5, 10, 15, …, 280]`（每 5 步一档、共 56 档）。上表两行都是换阶梯之前的读数；
新阶梯的覆盖与成本还没有重跑**（量法同上，`audit-steps.mjs`）。

成本：全部 214 条消息约 **0.5M token 等量**，对比同一批子代理约 205M ≈ **0.25%**。
（每条约 180 字符，且会随之后每一步重发——这是"一步最多注入一条"的原因。这个数同样是旧 14 档阶梯的读数。）

## 2. 成本基线（真机实测，改动前的 32 会话 / 983 请求快照）

| 观测量 | 实测值 |
|---|---|
| 总 token | **94.1M** = 未缓存输入 8.0M + 输出 0.9M + cache-read **85.1M** |
| cache-read 占提示 token | **91%** |
| 输出占总花费 | **1%** |
| 调度智能体 / 专家 | 55.9M（59%）/ 38.2M（41%），22 个子代理 |
| 每个子代理 | ≈1.73M |
| 子代理内最大单一上下文来源 | `web_fetch` 3.5M 字符 / 369 次 |

**三条口径警告，引用数字时必须一起说**：
① 94.1M 是**下界**——`cacheWriteTokens` 在全部 1183 个 usage 对象里都不存在，"未上报"不等于"没有写入"；
② 语料是活的，报告是某一刻快照，两次跑不会完全一致，**比较看比例与量级**；
③ 报告内部有约 0.02% 的口径差（`=== sessions by preset ===` 的分组总计与 `main + sub` 拆分之和对不齐）。

## 3. 三个体积旋钮的实际生效值（源码级事实 + 静态自检）

`compaction-basic` = 0.8 / 0.16；`tool-result-pruner` = 8192 / 4096 / 1024（标记 `PRUNE_MARKER` 39 字符，
实际吐出 4096 + 39 + 1024 = 5159）；`tool-web` = 200000 / 8 / 4。
它们**不是被覆盖成这些值，而是本 preset 不写这些键**，于是插件用出厂默认。
`node tools/check-preset.mjs` 会把"生效值"和"是否被写回"打印出来对照。

## 4. 已移除的 token 两档：为什么移除（真机实测，历史）

下表的数字**全部来自已删除的代码路径**，只证明"当年那条路为什么走不通"，不代表当前行为。

| 观测量 | 实测值 |
|---|---|
| 平均值 / 最大 | ≈1.73M / 5,217,983（审计快照） |
| 审计快照里 ≥ 300 万 | 22 个里的 **5 个** |
| 真机 dry-run 快照里越过 300 万 | **5/5**，最小 3.36M，最大 **48,992,135** |
| 当年真机硬停一次 | `usage=7651807`（预算的 2.5 倍；`README.md` 记作 **7.65M**） |

结论：300 万落在**正常流量主体内部**，按它武装硬档必然截断正常委派；
真正出问题的信号是**步数**（那个 48.99M 的子代理在越线后又走了约 300 步）。

## 5. 热重载边界（真机实测）

**已挂载的 preset 不会因为 composition 文件被改动而重新组合**；改 preset 必须重启 dsh 验收（`preset/design.md` 的 `PresetRevision`）。
插件那一行不同：`profiles/web/cordis.patch.yml` 是 `patchReload: live`，**改 `config:` 立即生效、不用重启**；
但**换过 `src/` 里的代码之后必须重启**——已实测：替换包目录后宿主重放了这一行、激活行里的 `dryRun` 跟着变了，
**但激活行没有新字段**，因为热重载不会重新 `import` 已经加载过的模块（Node 的 ESM registry 按文件 URL 缓存）。
正确顺序：**复制新代码 → 重启 dsh → 确认激活行是当前形状 → 这时才动 `dryRun` / `stepTiers`**。

## 6. 两个容易误判的观测口径

- **`dry-run step stage: would nudge …` 证明的是"计数到了"，不是"消息发出去了"。**
  只有 `step stage: nudged …`（不带 `dry-run` 前缀）才是真注入。
- **dry-run 的行数是按"步"写的，不是按"提醒"写的。** 校准不消耗 tier，所以一个到期的检查点会在它之后的每一步重复报自己；
  真正武装时每个 tier 只注入一次、只写一行。

## 7. 本机的惰性旧键（真机实测，切换窗口的安全网）

> **本节描述的是迁移前手贴在 profile 层的那条活行（历史状态）**：2026-09-28 起挂载行在 bundle 层、只有 6 个键，profile 层已无该条目（见开头「证据来源」表的「活行」行与 §16.1 / §16.5），所以下面这五个键**现在不在任何活行里**。原文按"历史证据不回改"的纪律保留 —— 它记录的是当时为什么必须那样贴。

活行里仍带着 `budgetTokens: 1000000000000000`、`softRatio: 1`、`cacheReadWeight: 1`、
`softNudge: true`、`hardDryRun: true`。这**不是配置意图**：重启前进程里跑的可能还是旧代码，
少了 `hardDryRun` 旧代码会按默认值把已删除的硬档**真武装**；把 `budgetTokens` 抬到 10^15 且 `softRatio: 1` 让旧软档也永不触发。
新代码对这五个键**静默忽略**，重启加载新代码后可以整段删掉。

## 8. 未观测清单（引用本仓库任何结论前先看这里）

| 事项 | 状态 |
|---|---|
| **更密的阶梯 + 选择式措辞到底有没有用**（收到检查点的子代理是否更早收敛） | **未观测，而且这是本功能的核心问题。** 量法：`audit-steps.mjs` 前后各跑一次，**比分位数，不比均值**。注意 §9 只量到"注入确实发生"，**证不了效果**。**2026-09-29 追加两个观测量**：① 平坦阶梯（每 5 步一档、56 档）下的步数分布与改道次数；② 被提醒的子代理在选"继续"之后，有没有真的写出"为什么这一步最短" |
| 提醒是否改变子代理行为（作为**效果**） | **仍然未观测**：只有个例（3 例、3 个不同任务）证明"消息被读到并当成决策输入"，不足以证明"让它更快收敛"。§9 量到的是**注入条数与分布**，不是效果——两件事不要混读 |
| 校准期（`dryRun: true`）在本机的 `dry-run step stage` 行 | 本机是从"没有这个 stage"直接到"已武装"，**从未停留在校准态**；`dry-run step stage` 命中 0 行（§9 复核仍为 0） |
| 包被替换后，**改名目录 / 先删行再加行**能不能强制重新 import | 未尝试。安全结论就是"重启" |
| 第一个 tier 之外的档（新阶梯下的注入） | **§9 复核：已被观测**（tier 1/14–11/14 都真的注入过，那是**当时的 14 档阶梯**）——下表既有文档记为"未观测"的说法在 §9 复核后已过期，处置权在人类。**注意时效：2026-09-29 默认阶梯换成 56 档平坦阶梯之后，"新阶梯下的注入"重新变成未观测**（要重启 dsh 才生效，生效后也需要真实 Adg 会话才有记录） |
| 恢复的子代理被再次提醒 | **仍未观测（原记载成立）**：§9 观测到的是**驻留期重置机制**在跑（同一 `label` 在 `settled:` 后从 tier 1/14 重新计数）；**"该子代理确实是被恢复的"无从判定**（`subagent/end` 对"结束"与"被恢复"发同一事件） |
| **注入消息在会话转写里的原文**（`session.v3.jsonl.zstd`；2026-09-28 起还有 `session.v4.jsonl.zstd`，§1/§6 引用的"毫秒级对齐"） | **2026-09-28 已独立复核（§15.2 就是按转写比对的）**：旧记载"本机没有 zstd 解压能力"**不成立** —— Node 26 自带 `zlib.zstdDecompressSync`，但**一次只解第一帧**，session 文件是多帧拼接，必须按魔数 `28 B5 2F FD` 切帧后逐帧解（脚本与判据见 §15.5） |
| **调度者的权限闸门是否真的每次都触发**（派发 `agent_browser` 前是否先问用户） | **未观测**：闸门于 2026-09-26 落地，还没有一次真实 Adg 会话走过它。量法：Adg 会话转写里查 `ask_user_question` 的调用是否出现在 `agent_browser` 之前，以及本会话文件策略那一行当时是不是 `danger-full-access` |
| **在沙箱外手工拉起浏览器、专家只连 CDP 端口** | **未实测**：`workspace-write` 下网络不受限、受限进程自建监听与本地 `fetch` 都通（§11），所以**设计上可能可行**；但没有人真的做过，不许写成可行。量法：用户在自己的（非沙箱）终端里起一个 `--remote-debugging-port=…` 的浏览器，再让 Adg 会话里的专家只调用 CDP HTTP/WebSocket |
| **真实站点的登录／验证码端到端流程**（用户手动登录 → 专家接着抓登录后的内容） | **未观测**：§12 只验了**机制**（有头窗口跨工具调用存活 + 新进程 CDP 重连并继续驱动），没有一次真的走完「人工登录 → 继续」。量法：按 §12 的 `probe3-*` 起实例，请人在窗口里登录一个真实站点，再由另一个进程重连并断言登录后的页面元素存在 |
| **关掉浏览器之后再靠 profile 复用登录态** | **未观测**：§12 的 `probe4-cookie.js` 往 profile 写了 cookie，live store 立即可见，但 30 秒内磁盘上没有 cookie 库（Chrome 惰性刷盘）。量法：同一 profile 优雅关掉浏览器后再启动，看 `Network.getCookies` 还在不在 |
| **调度者是否真的每次都转达人工介入**（收到「需要用户介入」报告后是否真的先问用户） | **未观测**：与上面那条闸门同源 —— 提示级协议，没有真实 Adg 会话走过它。量法：Adg 转写里 `agent_browser` 返回「需要用户介入」之后，紧跟的应当是一次 `ask_user_question`，而不是第二次同路径派发 |
| **五条编排层规则是否真的被遵守**（同实体合并 / 优先恢复既有专家 / 先定位再改 / digest 中转 / 必要性闸门） | **未观测**：五条规则于 2026-09-26 落地，尚无真实 Adg 会话带着它们跑过（`preset/testing-guide.md` 的 N3 / N5 / N7 同此结论）。四个观测量：① **子代理个数**（主指标 —— "同一份材料买 N 次"的乘数就是它）② 子代理步数 **p50 / p90**（**比分位数不比均值**：已实测中位数 39 步、p10 仅 6、四分之一 ≤14 步，分布很偏）③ 审计脚本按 preset 分组的 `requests`（同口径重跑同一批会话，不许拿单次绝对值比）④ **挂号抽查**（人工，见下一行） |
| **子代理还在 `running` 时调度者是否**不再**把它 steer 进去**（2026-09-29 追加的规则 7 `status` 判据） | **未观测**：该半条于 2026-09-29 按用户报告追加，尚无真实 Adg 会话走过（`preset/testing-guide.md` 的 N10 / N11 同此结论）。**机制**是源码级事实（`send_message` 恒为 steer、落点是 `inbox.nextStep` —— §19），**行为**没有真机证据。量法：造一个长任务派给某个专家，在它 `running` 时对调度者提一个**同实体但不同交付物**的问题 —— 判据是①转录里**没有**指向该 `running` 子代理的 `send_message` ②调度者要么自己答、要么结束本轮等结算通知 ③结算后那件新事确实被接给**同一个**子代理（`list_agents` + `send_message`） |
| **旁路是否被"记录而非被做"**（必要性闸门 + 强制挂号） | **未观测**。**来源（这是这条规则的依据，不是结论）**：一次真实任务的旁路委派 —— 用户要"便携小巧的录音笔"，调度者为"录音合规性"单独开了一个子代理，而那次调研只服务同一条选购需求（同实体同性质）、且不在验收标准里。判据：抽 3–5 个含旁路诱因的任务，最终答复里**有**挂号句「未纳入本次：X（可能影响 Y，未调研）」且转录里**没有**对应委派 = 遵守；挂号句缺失 = 旁路被**静默丢掉**（省了 token 却让用户不知道有东西没查，比不做这条规则更糟）；出现委派 = 闸门未生效 |
| **浏览器任务是否真的"同一份信息只在一个站点取"**（I13 ① 的浏览器那半） | **未观测**：该半条于 2026-09-27 按用户要求追加，尚无真实 Adg 会话走过（`preset/testing-guide.md` 的 N8 / N9 同此结论）。**来源是用户报告**（"浏览器操作是非常耗时的"）＋本机实测的成本下限（一次性读页 **0.8–2.0 秒**、工具侧且不含每个模型步，见 §13）。量法：给一个**单站点即可答完**的信息需求（例如某酒店某晚房价），数 `agent_browser` 委派里点名的站点数（同一份信息应为 **1 个**；三个例外都不成立却出现 ≥2 个 = 违例），并对照同任务 `TABS` 的净增长 |
| **迁移成 bundle 后，`presets: ['adg']` 对真实 `adg` 专家子代理的注入** | **未观测**（§16.5）：迁移后那次真实委派走的是临时覆盖行 `presets: ['cordis']` 的**通用委派**路径（§16.4 第 3 条），不是 `adg` 专家行。**机制前提（本机实测，§16.4 第二条技术事实，不许丢）**：通用 `subagent` / `subagent_fork` 委派出去的子代理，session 头记的是 `agentPreset: "cordis"`、`delegationDepth: 1`，**不是 `adg`**（`adg` 专家行委派出来的记 `adg/<uuid>`）⇒ `presets: ['adg']` 按设计**不治理**通用委派（fail open）。量法：新对话里走一次 Adg 专家委派（或临时在 profile 层加覆盖行 `presets: ['adg']` + `stepTiers: [1, 2]`），看 `step stage: nudged … label=adg/…` |
| **冷启动后的 bundle 层** | **未观测**（§16.5）：迁移是在**迁移前就起来的进程**里生效的 —— 触发点是 `install_bundle` 改写 profile 清单导致**整份 patch 栈重读**（§16.3 第二条、§16.4 第 1 条的机制归属），**不是** bundle 层自己被 watch。量法：重启 dsh → `plugin_manager list_bundles` 仍有 `dsh-adg-token-budget` 这一条 + 日志新出现一行 `activation: …` |
| **`desktop` profile 迁移后生效** | **未观测**（§16.5）：该 profile 已装成同一形状（§16.5「已就位」），但它的 `patchReload` **不是** `live` ⇒ 要下次启动才生效。量法：启动 `desktop` profile → 看同一日志的 `activation` 行。（§14.6 未观测 ① 那条 `desktop` 挂载未观测仍然独立成立） |
| **已撤销的 token 两档旧口径**（§4 / §7 / §15 里的历史行） | **仍是历史证据，不许写成当前行为**：包括那五个惰性旧键（§7）、`hard stage:` / `dry-run …would cancel` 前缀（§9）、`{kind:'plugin', plugin}` 包装（§15），以及"旧落点 `$DSH_HOME/plugins/dsh-adg-token-budget/`"与旧部署集合的五项形状（§14.5 / §14.6 的历史标注、§15.4 那条探针跑的部署位置、§16.1）。量法：无 —— 代码路径已删；本行只是防止引用时把历史数字读成现值 |
| **重启后真实 `adg` 专家行是否看得见、调得通 bili 那四个上下文工具** | **未观测**（§17 未观测 ①）：注入只在产物里，可见性探针走的是**通用委派**路径（§17.1 第 1 条），不是 `adg` 专家行。量法：重启 dsh → 新会话选「Adg 多智能体模式」→ 让调度者派一次 `agent_search`，在委派 prompt 里要求"先调一次 `acp_status` 并把结果原样报回来"；成功 = 该步返回工具结果而不是 `names unknown global tool`。注意第二个前提：bili 的 proxy 必须活着（端口读 `C:\Users\cenqian\.local\state\billion-context\proxy-origin`，本机上一进程留下的端口会失效） |
| **从 `dsh.profile.bundles` 移除 `dsh-adg-token-budget` 后冷启动无副作用** | **未观测**（§17 未观测 ②）。量法：重启挂了 bili 的那个 profile → dsh 正常起来 + 该 profile 日志里**不再**出现 `adg-token-budget` 的 `activation:` 行 + `list_bundles` 里这一条变成未选中 |
| **preset realm 里 `compaction-basic` 的 `auto` 到底取什么值** | **部分已处置，仍有一条未观测**。2026-09-28 晚按用户裁决**不再留在范围外**：生成物在 preset 自己的 `compaction` 组里构建期注入 `config: {auto: false}`（§17.1 第 10 条，与 bili 官方 patch 同键同值 ⇒ 幂等），所以"专家会不会被两套压缩同时折叠"在设计上已封住。**仍未观测**：(a) bili profile 层那份 `- id: compaction-basic` 到底能不能跨 lane 命中 realm 实例；(b) 注入的键在**真实 Adg 会话**里确实关掉了原生自动折叠（产物断言只证明键写对了）。量法：Adg 会话转写里找 `compress` 工具调用之外的自动折叠痕迹，与 bili 的 `/acp-cache` 台账对齐；`/compact` 手动触发应当仍可用 |
| **截断之后就"就地续跑同一个子代理"**（2026-09-29 追加的规则 7 接续半条） | **未观测（行为）**：机制与频次都已实测（§21：6 条 `max-tokens` 截断，全在 `adg` 子代理会话里），但这 6 个会话在截断后**记录数为 0** —— 没有一条续写过，所以"调度者会不会真的去接""接住之后产出是否完整"都没有先例。量法：转录里找 `max-tokens` 的 `turn/end` 之后**有没有**指向**同一个 child session** 的 `send_message`，并检查续写后该委派的交付块是否完整（`preset/testing-guide.md` 的 N12 / N13 是人工 review 那半） |
| **异实体按实体拆 + 共同结论层工件的真实效果**（2026-09-29 追加的规则 6 两半） | **未观测**：同上，规则刚落、无真实 Adg 会话走过。量法：造一个"同一性质、N 个实体"的任务（用户例子 1：3 款手表），数①**子代理个数**是否等于实体数（而不是 1 个通读全部）②各条委派的产出里有没有跨实体内容（有 = 边界没写死）③调度者上下文增量（聚合 N 份结论会抬高它的上下文 —— 观测量要从"子代理个数"扩成"**子代理个数 + 调度者上下文增量**"）；再造一个"同一批材料、多个问题"的任务（用户例子 2），看有没有先产出**一份**共同结论层工件、后续委派是否只读工件与切片（而不是各自全量重读），以及源材料变更后有没有先刷新工件（`preset/testing-guide.md` 的 N1 / N2 / N3） |

## 9. 活证据复核快照（2026-09-25T13:46:37Z / 21:46:37+08:00）

**快照指纹（第三方据以判断"是快照不同还是口径不同"的唯一依据）**：
`sha256 = 796f30c4df270e905dbdd514df186520a321f7f538be8fa6c79ecf0c85e5a660`、`129,579 字节`、`1025 行`、`mtime 2026-09-25T21:46:37+08:00`。
下表每个数字都对应这一份指纹；**引用时必须同时给时间戳与哈希**，否则无法与别人的读数对齐。

抽取方式：对 `C:\Users\cenqian\.dsh\adg-token-budget.log` 做**逐行文本匹配**（`Get-Content` + `-match`，不做管道分组；管道分组在本沙箱里会被拒，且用错分组口径会数出错误结果）。
**该文件仍在被追加，下面每个数字都是某一刻的下界，不是常量。**

**时效（先读这句）**：本节通篇说的"新阶梯"都是 **2026-09-29 之前**的默认 `[4, 8, …, 280]`（14 档）；
现行默认是 `[5, 10, 15, …, 280]` 的 **56 档平坦阶梯**，本节所有数字（`tier 1/14`–`11/14` 等）**都不覆盖它**。

**先分清两种日志格式（这是本节的第一个坑）**：同一个"新 14 档阶梯"下前后出现过两种行形态 ——

- **当前格式**：`step stage: nudged tier=n/N step=S label=…`（无 token 字段）；
- **过渡格式**：`step stage: nudged tier=n/N step=S usage=… budget=… label=…`。

过渡格式里的 `usage=` / `budget=` 是**当时日志还没精简掉的字段**，**不代表那几行来自旧的 token 两档**：
88 行过渡格式里 **85 行已经是 14 档阶梯**，只有 **3 行**是真正的旧三档阶梯（`tier=1/3 step=12`）。
（本节早先版本把 88 行都当成"旧阶梯历史"、并给出 370 这个数，**已作废**；下面这张表是重算后的口径。）

| 观测量 | 本次计数 |
|---|---|
| 文件规模 | 1025 行 / 129,579 字节 |
| `activation:` 行 | 16 |
| `step stage: nudged` 行（合计） | **390** |
| ├ 当前格式（无 `usage=`） | 302 |
| └ 过渡格式（带 `usage=`） | 88（其中旧三档阶梯 3 行，其余 85 行已是 14 档） |
| 其中带 `dry-run` 前缀的 | 0 |
| 有 `step stage: nudged` 的不同子代理（`label`） | 86（只看当前格式：64） |
| `settled:` 行 | 90 |
| 旧代码的历史行（`hard stage` / `dry-run …would cancel` / 已移除的软档） | 523 |

**同一套命令行隔一秒再跑，低档计数各 +1**（`tier=3/14` 76、`4/14` 48、`5/14` 34；高档纹丝不动）——
**这不是口径差，就是文件又长了一行**。凡出现这种 +1，先比 `sha256` 再谈差异。

**逐 tier 的 `nudged` 分布**（当前格式 + 过渡格式合并；这是本仓库第一次量到"第一个 tier 之外"的档）：

| tier | 步 | 条数 | | tier | 步 | 条数 |
|---|---|---|---|---|---|---|
| 1/14 | 4 | 87 | | 7/14 | 42 | 17 |
| 2/14 | 8 | 86 | | 8/14 | 55 | 10 |
| 3/14 | 12 | 75 | | 9/14 | 72 | 5 |
| 4/14 | 18 | 47 | | 10/14 | 95 | 4 |
| 5/14 | 24 | 33 | | 11/14 | 125 | 1 |
| 6/14 | 32 | 22 | | 12–14/14 | 165 / 215 / 280 | 0 |
| 旧三档阶梯（`tier=1/3 step=12`，历史） | — | 3 | | | | |

**需要人类复核的一条（以及一条容易误判成冲突、实际不是的）：**

1. **冲突（成立）——"第一个 tier 之外的档 / 新阶梯下的注入从未观测"**：
   新 14 档阶梯下 `nudged` 覆盖 tier 1/14–11/14。根 `README.md`「现在的证据到哪为止」与插件
   `README.md`「What has still never been observed live」写的是该阶梯下"还没有一次注入记录"、
   三次真实注入都是旧三档的 `tier=1/3 step=12`——**这两处陈述已过期**（旧三档确实只有 3 次，
   但新阶梯已数百次）。它们属于既有交付，本文档不擅自改写（见下"文档冲突处置"）。
2. **不是冲突——"恢复的子代理被再次提醒"**：日志确实是
   `label=adg/807257e4-…` 在 `18:52:10` 有 `settled:`、`18:53:47` 又出现 `nudged tier=1/14 step=4` ——
   新的驻留期**从第 1 档重新开始**；`label=adg/448965ba-…` 也有多轮完整驻留期（各自从 `tier=1/14` 起）。
   这说明**插件的驻留期重置机制在真机上确实执行**（也印证了插件 `README.md` 把"可再次提醒"写成
   designed behavior）。
   **但它证不出"那个子代理是被恢复的"**：`subagent/end` 对"结束"与"被恢复"发的是同一个事件，
   插件只做 `sessions.delete(id)`，**从日志无从分辨**。所以用户可见的那条事实
   （根 `README.md` 记"恢复的子代理被再次提醒仍未观测"）**依然未观测**，只是它的**前提**现在有了观测支持。
   `plugin/dsh-adg-token-budget/design.md` 自己写的就是这个区分：单测与日志覆盖的是**机制**，不是**事实**。
   （本节早先版本把这条写成"已被推翻"，**已作废**。）

**已核实的其他事实**：本机是从"没有这个 stage"直接到"已武装"，**从未停留在校准态** ——
`dry-run step stage` 命中 **0** 行（这一条与既有文档一致）。

**另外两条口径差异，只报告不裁决**：
`soft stage: nudged` 本次命中 **5** 行（其中一个 `label` 也在后续 `nudged` 序列里），
而插件 `README.md` 的同一格记 **0**；`dry-run hard stage: would cancel` 本次 **481** 行，
同处记 **437**。差异来源是**时间快照不同**（该日志一直在被新事件追加），还是**统计口径不同**，
需要按各自记录的时间点复核后才能下结论——本文档不下结论。

**上面两条只说明"现象发生过"，都不说明"功能有用"**：提醒是否让子代理更早收敛，仍属未观测（见第 8 节）。

### 文档冲突处置（本次交付的边界）

本次交付**新增**文档层（根 `AGENTS.md`、`docs/`、三个模块目录），**不改写**既有的人向手册与其实测叙述。
上面第 9 节的两条冲突按"新增证据"登记，处置建议：
**由人类决定是把 `README.md` / 插件 `README.md` 的"未观测"改成"已观测（附本次数字）"，还是先复核再改。**
在人类决定之前，任何引用都必须同时说清"人向手册写未观测、本台账的活日志复核显示已观测"。

## 10. 怎么重新测量（可直接照抄）

```powershell
# 成本：报告写到 D:\dsh\.dsh-token-audit\audit-report.txt（覆盖上一次）
node D:\dsh\.dsh-token-audit\audit-run.mjs "C:\Users\cenqian\.dsh\sessions"

# 步数分布：比分位数，不比均值
node D:\dsh\.dsh-token-audit\audit-steps.mjs "C:\Users\cenqian\.dsh\sessions"
```

两条都必须**改动前后各跑一次**才能判断一次改动是帮忙还是添乱；
拿不出前后对比数字就不要宣称某个改动"省了成本"（这条同时是 `preset/design.md` 的非功能红线来源）。

## 11. 浏览器自动化的沙箱前提（真机实测 A/B，2026-09-26）

**这一节回答一件事：`agent_browser` 在 `workspace-write` / `read-only` 下为什么起不来。**
结论：本机的 Chrome 与 Edge **都无法在受限令牌下完成进程初始化**，全访问（`danger-full-access`）是硬前提。
`README.md` 的「浏览器专家需要完全权限」一节引用本节。

**观测条件与方法**：本机（Windows）、同一个 `node`（v26.9.0）、同一批浏览器二进制，**只改会话文件策略**
（A 列 = `workspace-write`，B 列 = `danger-full-access`）；两次都由 `pwsh` 工具启动 `node` 脚本 ——
也就是「受限令牌的孙进程」，与专家侧的实际运行条件一致。
**复现脚本**：`D:\dsh\_archive\2026-09-26-sandbox-probes\probe1.js`（stdio 与浏览器启动 + 真驱动一次 CDP）、
`D:\dsh\_archive\2026-09-26-sandbox-probes\probe2.js`（按变体收集浏览器 stderr）；原始输出在 `D:\dsh\_archive\2026-09-26-sandbox-probes\` 下的
`probe1.log` / `probe2.log`，外加按变体命名的 `<变体>.out.txt` / `<变体>.err.txt`（如 `edge-dumpdom.err.txt`）。**这两个脚本不属于任何交付包**
（与 `D:\dsh\.dsh-token-audit\` 那批审计脚本同一口径）。B 列是同一份脚本在同一天重跑的，不是旁证。

| 探测 | A：`workspace-write` | B：`danger-full-access` |
|---|---|---|
| `spawn('cmd.exe', ['/c','echo hi'], { stdio: 'pipe' })` | `spawn THREW EPERM` | `exit=0` |
| 同上，`stdio: 'ignore'` / `'inherit'` | `exit=0` | `exit=0` |
| `chrome.exe --version` | `exit=0` | `exit=0` |
| `chrome.exe --headless=new --no-sandbox --remote-debugging-port=9441` | `exit=21`，**CDP 端口从未起来** | **`exit=0`，CDP 起来：`Chrome/152.0.7977.76`，随后 `Page.navigate` + `Runtime.evaluate` 取回 `"HELLO-CDP\n\n42"`（真的驱动了页面）** |
| 同上再加 `--no-zygote --single-process`（端口 9442） | `exit=21` | `exit=0` |
| `chrome.exe --headless=new … --dump-dom about:blank` | `exit=21` | `exit=0` |
| `chrome.exe --headless=new … --user-data-dir=<TEMP>\cprof` | `exit=21` | `exit=0` |
| `msedge.exe`（与上面同一组参数） | `exit=2147483651`（`0x80000003`）；stderr 首行 `FATAL:mojo\public\cpp\platform\platform_channel.cc:183] Check failed: . : 拒绝访问。(0x5)` | `exit=0`（stderr 只剩一条无害的 QQBrowser 导入器提示） |
| `TMP` / `TEMP` 的值 | `…\Temp\dsh-mHNX1M`（会话私有临时目录） | `…\Temp`（正常值） |

**两层原因，`spawn EPERM` 只是第一层。** 第一层**与后端自己的记载一致**：
`@deepseek-ai/dsh-sandbox-windows-acl` 的「已知限制」写着「受限孙进程的管道 stdio 捕获不可用 ……
受限进程内 `spawn(..., { stdio: 'pipe' })` 以 EPERM 失败；继承与忽略 stdio 的 spawn 可用」——
A 列头两行就是它的复现。**本次新增的观测是第二层**：即使换成 `stdio: 'ignore'` 绕开第一层，
浏览器仍在**内部 IPC** 上死掉 —— Edge 把原因打了出来（Mojo 的 platform channel 创建被拒 `0x5`），
而 `--no-sandbox` / `--single-process` / `--no-zygote` / 换 profile 位置都改变不了它；B 列全部转绿。
**所以「换 stdio 就能救浏览器」是错的**：浏览器要的是进程内部 IPC，不是它自己的 stdout。

**只对本机成立的边界**：只测了 Chrome 与 Edge（本机只有这两个，Firefox 未安装），**其它浏览器未测试**；
chromium 系之外的浏览器是否同样受限于有名管道，本台账不下结论。
**驱动深度**：B 列只有 Chrome 做了完整的「启动 → 连 CDP → 导航 → 取回页面文本」；
Edge 在全访问下只做到 `--dump-dom` 退出码 0，**没有再往深做**。

**与本节相关的源码级事实**（不是实测，逐条都能读代码确认；`README.md` 那节把它们列成三问三答）：
父智能体不能给子智能体指定权限（`dsh-tool-subagent` 的 `lib/index.js` 里 `sandbox` 零命中）；
沙箱模式解析是 `request.mode ?? 会话的 sandbox/mode 事件 ?? 部署默认`
（`dsh-sandbox-policy/lib/index.js` 的 `resolve()` / `overrideOf()`），而 `sandbox-policy` / `permission` /
`approval` 三行都在 host-plane 的 `dsh-base/cordis.patch.yml`；子会话的审批策略被钉成 `never`
（`dsh-subagent/lib/index.js` 的 `captureDelegatedPolicyOverrides()`），而 `dsh-user-approval` 对该策略
直接返回 `rejected`、不弹窗 —— 所以子代理**不能**用 `sandbox_permissions` 升权。

**怎么重测**（第 1 条是 A 列第一行的最小复现，已逐字跑过；浏览器那两列跑 `probe1.js` / `probe2.js` 即可）：

```powershell
node -e "const{spawn}=require('child_process');try{spawn('cmd.exe',['/c','echo hi'],{stdio:'pipe'})}catch(e){console.log('THREW',e.code)}"
```

在受限策略下输出必须是 `THREW EPERM`，切到全访问后同一句不再抛（`exit=0`）。
**注意浏览器那一路的 stderr 必须重定向到真文件**（管道会被沙箱拒），
`probe2.js` 里就是用 `fs.openSync` 拿文件句柄再传给 `stdio` 的。

## 12. 子代理能不能直接问用户？人工介入的可行路径（源码级事实 + 机制实测，2026-09-26）

**这一节回答两件事**：`agent_browser` 遇到登录墙／验证码时**能不能自己弹一个问题给用户**（不能），
以及「用户手动登录、专家接着用」在机制上**能不能成立**（能，但只在同一轮里复用那个还活着的实例）。
`README.md` 的「登录墙与验证码：人工介入协议」一节引用本节。

**源码级事实：被委派的子代理不能问用户。**

| 事实 | 位置 |
|---|---|
| `ask_user_question` 是**按 preset 注册**的模型可见工具，**不在**全局工具层（全局层只管渲染 UI）。所以「谁能问」由组合决定：Adg 组合里有 `tool-ask-user` 那一行，调度者是 runtime root，能问 | `@deepseek-ai/dsh-tool-ask-user` 的 `apply()`（`ctx.tools.register(defineTool({ name: 'ask_user_question', … }))`）；`@deepseek-ai/dsh-client-ui-user-questions` 的 node 半边 `apply()` 是空实现，注释原话「Mounting `ask_user_question` in the tools registry's global layer expands every agent's tool list regardless of its preset … the model-facing tool belongs to the presets that include it」 |
| 工具把调用者 agent 传下去 | `dsh-tool-ask-user/lib/index.js` 的 `execute`：`...exec.agent !== void 0 ? { agent: exec.agent } : {}` |
| 服务在带上 agent 时**只认 live runtime root**，被委派的子代理拿 `DELEGATED_CALLER` | `@deepseek-ai/dsh-user-questions` 的 `ask()`：`if (!agents.roots().includes(agent)) throw new UserQuestionError("human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result", "DELEGATED_CALLER")`；同文件文档注释另写「an owned child has no human answerer and would block forever」 |
| 所以往专家行的 `allow` 里加它没有意义 | **推论**（不是实测）：调用会走上面那条分支 |

**结论**：人工介入只能「专家停手并把未决问题写进最终结果 → 调度者用 `ask_user_question` 转达 →
按回答重派／换方式／收手」。那句错误文本本身就把这个分工写成了规定动作。

**机制实测**（同一台机器、同一天；脚本 `D:\dsh\_archive\2026-09-26-sandbox-probes\probe3-launch.js` 与 `probe3-attach.js`，
**不属于任何交付包**）：「用户手动登录、专家接着用」要求浏览器比启动它的那次工具调用活得更久，
并且能被**另一个进程**重新接上。分两次进程（= 两次工具调用）实测：

| 探测 | 结果 |
|---|---|
| 有头 Chrome（**不加** `--headless`）+ 固定 `--user-data-dir` + `--remote-debugging-port=9451`，**detached 启动** | 启动那次调用内 CDP 就起来了（`Chrome/152.0.7977.76`） |
| 启动进程退出后，**另一次工具调用的新进程**访问 `GET /json/version` | **200** —— 浏览器还活着 |
| 那个新进程对留下的页面 `Page.navigate` + `Runtime.evaluate` | 成功，取回 `"RESUMED\n\n7"` —— 是**同一个实例**，不是新开的 |
| 它是真的窗口吗 | `MainWindowHandle` 非 0、`MainWindowTitle` 可读（`… - Google Chrome`），即用户能真的在里面操作 |
| 靠 pid 定位它？ | **不行**：启动进程的 pid 后来消失了，浏览器却还活着 → 必须用**端口号 / profile 目录**定位 |

**未观测（不要把上面那半读成「登录流程已经跑通」）**：

- **真实站点的登录／验证码流程没有端到端跑过**：本次只验机制（窗口存活 + 跨调用 CDP 重连 + 能继续驱动），
  没有一次「用户真的在某网站登录／过验证码，专家真的接着抓到了登录后的内容」。
  **2026-09-27 复核：仍未观测**（§13 只把"cookie 落盘并跨重启存活"升为实测，端到端那一步没有）。
- **「关掉浏览器之后再靠 profile 复用登录态」已被 §13 复核并部分推翻（2026-09-27）**：本条当时观测到的是
  `probe4-cookie.js` 往 profile 写了 cookie、**live store 立即可见**（`Network.getCookies` 返回 `["adg_probe"]`），
  但 **30 秒内磁盘上始终没有 cookie 库**（`Default\Network\Cookies` 不存在）—— 当时的结论是"Chrome 惰性刷盘，本次没观测到落盘"。
  **推翻的那一半**：落盘确实会发生，只是不在那 30 秒窗口里 —— 优雅关闭（CDP `Browser.close`）之后磁盘上出现了
  `Default\Network\Cookies`，而且同一个 cookie **跨浏览器重启被读回**（详见 §13）。所以
  「同一轮里复用那个还活着的实例」是实测的，「优雅关闭 → 下一轮靠同一个 profile 免登录」**也已升为实测**；
  仍然未观测的是**真实站点**的登录态端到端复用。
- **调度者是否真的每次都转达**：提示级协议，没有真实 Adg 会话为证（与 §11 那条同源）。

**怎么重测**：先 `node probe3-launch.js`（它退出后浏览器应仍在）→ 隔一次 shell 再 `node probe3-attach.js`
（应打印 `reattach OK` 并取回 `RESUMED`）；cookie 落盘口径用 `probe4-cookie.js` 重测。
用完按 profile 关掉那个实例（`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"` 里
`CommandLine -like '*<profile>*'` 的那些 pid），否则会留一个浏览器窗口在桌面上。

### 规则缺口复核：调度者事前禁止登录（用户报告 + 源码级复核，2026-09-27）

**用户报告（真实挂载观测，转写未提供）**：上一版 Adg 实测里，调度代理会给 `agent_browser` 下「不登录」的要求。
用户给的口径是：**本模式本来就可以请用户手动登录，除非用户自己说过不登录。**

**源码级复核（逐行检索 `preset/agent.cordis.yml`）**：这条行为与文本一致，属**规则缺口**，不是模型乱来 ——

| 调度 persona 里与登录有关的位置 | 说了什么 | 缺了什么 |
|---|---|---|
| 名册（`agent_browser｜网页交互专员：需要登录…`）与规则 4（`要在网页上登录/填表/点击/多页抓取 → agent_browser`） | 只把"需要登录"当**路由关键词** | —— |
| 规则 11（权限硬前置） | 三个选项：切权限 / **降级静态抓取（不能交互）** / 暂不做 | **没有"请用户登录"这条路** —— 非完全权限时最省事的分支天然排除登录 |
| 规则 12（人工介入） | **纯事后**分支：只在专家**报墙之后**才触发；四个选项里三个是收手 / 降级；当时还带「同一条路径的人工介入每任务至多一轮」（**该上限已于同日按用户要求删除**，见下面的追加处置） | 缺**事前**许可：没有一句说"需要登录态时照常派发、请用户登录一次"；当时的「每任务至多一轮」反而让调度者倾向事前就禁掉登录（省下这一轮） |
| 规则 5（五项必填，含「本次不做」） | 要求调度者写"本次不做" | 没有任何一句阻止它把「不登录」填进去 |
| `agent_browser` persona（`不得尝试绕过验证码、登录墙…`） | 约束**代理自己不许**代填 / 绕过 | 与「不许**请用户**登录」**没有区分开** → 最容易被合并读成"不要登录" |

**全仓检索**：「需要登录时请用户手动登录（除非用户说过不）」这条**事前规则在任何文件里都不存在**
（README 的四行表也只描述"你已经登录之后"的分支）。
**历史证据（git）**：`6cfdbe6`「压缩浏览器细则」把规则 11 / 12 从 1281 → 812 字符，选项文案从
「**我去手动登录**／过验证，已完成」压成「已手动完成」—— 归属信息在文案里变弱，但**旧版同样只有事后分支**，
所以这是长期缺口，不是压缩引入的。

**处置（2026-09-27）**：规则 12 补**事前半条**（请用户手动登录是正常路径、派发前不得预先禁止、只有用户明确
说过不想登录才禁止、并区分"不许代理代填密码"与"不许请用户登录"）；`agent_browser` persona 补一句"委派里写了
「不登录」就照办、但最终回答要如实写未登录"；`preset/design.md` I12 下半与非功能红线、`preset/AGENTS.md` 红线、
`README.md`「登录墙与验证码」导语、`preset/testing-guide.md` M5 / M6 同步。
**改动后的行为未观测**：没有一次真实 Adg 会话跑过新规则（M6 登记为"有反例、改动后待复核"）。

**同日追加处置（按用户要求）：删除「同一条路径的人工介入每任务至多一轮」。** 用户的判断是：这条上限把所有任务
（不只浏览器）的人工介入都变成了一次性配额 —— 需要用户本人做的事（登录／验证码／二次验证／切换会话权限／需要用户
拍板／需要用户在本机操作）默认**想做几轮就几轮**；**唯一例外是用户自己要求的**：「不要打扰我」→ 需要介入时直接
如实报「因为没有打扰你，X 拿不到」（不许换路径偷试），「只介入一轮」→ 该任务最多请他介入一次，之后停手如实报；
两种情形都要在交付里写明这是**用户的要求**。删掉它的直接理由：次数上限会让智能体把「还能请用户帮忙」误判成
「已经没救了」，从而过早放弃、或干脆**事前**就禁掉某条路径 —— 这正是上一版「要求不登录」的成因之一。
落地位置：调度 persona **新增规则 16**（写成**一般规则**，不挂在浏览器那一条下）+ 规则 12 的「试过了还是被挡」
分支改口径 + `agent_browser` persona 同分支改口径；`preset/design.md` I12 修订（标记 2026-09-27）与「非功能红线」、
`preset/AGENTS.md` 模块红线、`README.md`（表格行 + 新增「人工介入没有次数上限」段 + 压缩那句加日期标注）、
`preset/testing-guide.md` M7 同步。**历史条目（`docs/changelog.md` 的旧条目、README 里"压缩时全部保留"那句）
按变更记录纪律保留、不回改**，只在 README 那句上加日期标注说明它现在已不存在。

## 13. 浏览器工具链：规范 profile / 幂等复用 / 登录态跨重启（真机实测，2026-09-27）

**这一节回答三件事**：规范 profile 该落在哪（为什么不再放会话工作区）、实例复用是不是真的幂等、
登录态能不能跨浏览器重启；外加第四件：**标签页为什么会堆积、修复后靠什么保证不再堆积**。根 `README.md`「浏览器工具链与登录态资产」、`browser/design.md`（I1 / I3 / I8 / I9 / I10）
与 `browser/testing-guide.md` 引用本节。

**旧形态的直接成因（本机观测，不是推测）**：`D:\dsh\.browser-tools\` 下有 130+ 个一次性脚本
（`lib.js` 用 `playwright-core` 的 `connectOverCDP`；`start-chrome-headed.ps1` 用 PowerShell `Start-Process`
起系统 Chrome，并额外传了 `--no-sandbox` / `--disable-blink-features=AutomationControlled` / 伪造 `--user-agent`）。
旧 persona 写的是「profile 放**工作区里**一个固定目录，例如 `.browser-profile`」—— 工作区一换 profile 就换。
**对既有登录态的只读取证**（把 `D:\dsh\.browser-profile\Default\Network\Cookies` 拷到临时目录后用
`node:sqlite` 只读查询，不碰原文件）：

| 观测 | 值 |
|---|---|
| cookie 库 | `D:\dsh\.browser-profile\Default\Network\Cookies`，94,208 B，最后写入 2026-09-27 17:40 |
| 域名数 / 带 Secure 或 HttpOnly 的条数 | **32 / 58** |
| 主要登录域 | `.ctrip.com`(22)、`.huazhu.com`(9)、`mpassport.huazhu.com`(5)、`passport.ctrip.com`(5)、`.qunar.com`(9)、`login.microsoftonline.com`(7)、`login.live.com`(6) |

→ 登录态**确实在落盘**（这半推翻了 §12 当时的结论）；问题不在 Chrome 会不会存，而在**路径不稳**。

**工具链闭环实测**（`browser/cli.mjs`，零依赖；Node v26.9.0、Chrome/152.0.7977.76、Windows）：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 解析 | `node cli.mjs profile` | `PROFILE=C:\Users\cenqian\.dsh\browser-profile`、`PROFILE_EXISTS=false`、`CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 有头启动 | `node cli.mjs launch --url https://example.com` | `STATE=STARTED`、`BROWSER=Chrome/152.0.7977.76`、`TABS=1` |
| **幂等复用** | 再跑一次 `node cli.mjs launch` | `STATE=REUSED`（**没有重启**）、`TABS=1`、标题 `Example Domain` |
| 读页 | `node cli.mjs text --match example.com --out <文件>` | `TITLE=Example Domain`、`BYTES=129`、正文写进 `OUT=` 指定的文件（不占工具结果） |
| 求值 | `node cli.mjs eval --match example.com --js "…innerText"` | `RESULT="Example Domain"` |
| 页面内抛错 | `eval --js "throw new Error('boom-from-page')"` | `ERROR=页面内抛错：Error: boom-from-page`，**退出码 1** |
| 选页未命中 | `eval --match example.com`（此时页面是 `chrome://newtab/`） | `ERROR=没有 url / title 匹配 "example.com" 的页面` —— **报错，而不是随便挑一页** |
| 截图 | `node cli.mjs shot --match example.com --out <png>` | `SHOT=<png>`，26,278 B |
| 优雅关闭 | `node cli.mjs close` | `ALIVE=false`、`CLOSED=true`；随后 `Default\Network\Cookies` 出现在磁盘上（20,480 B） |
| **登录态跨重启** | 写 `document.cookie='adg_probe=1; path=/; max-age=3600'` → `close` → 重新 `launch --url https://example.com` → `eval document.cookie` | **`RESULT="adg_probe=1"`** —— 同一个 profile 里 cookie 活过了浏览器重启 |

**标签页堆积：问题与修复（2026-09-27，同一个实例）**

| 观测 | 值 |
|---|---|
| 用了一轮之后的实际状态 | `TABS=**19**` —— 12 个携程酒店详情页（`hotels.ctrip.com/hotels/<id>.html?checkin=…`）、3 个只差 query 的携程列表页、2 个完全相同的去哪儿首页、1 个美团、1 个 Trip.com |
| 成因（源码级事实） | 旧实现里 `text/eval/shot --url <新地址>` 为读一页会 `Target.createTarget` 开一个新标签，读完只 `cdp.close()`（断连）**从不关目标**；`open` 同样只开不关 → 「读得越多、页越乱」 |
| 修复后：一次性读取 | `text --url https://example.com/` → 打 `TAB_CLOSED=1AA3AA0C…`，`TABS` **21 → 21**（零残留）；同一地址加 `--keep` → **21 → 22**（按需保留） |
| 修复后：存量清理 | `close-tab --match example.com` → `CLOSED_TABS=1`，`TABS` **22 → 21**（回到起点） |
| 修复后：护栏（一次性实例，端口 9444 + 临时 profile） | `close-tab --match example.com`（3 个页全命中）→ `ERROR=关掉它（们）会剩 0 个页面，那等于关浏览器；要关浏览器请用 node cli.mjs close`、**退出码 1**、`ALIVE=true`（浏览器没被带下去）；不给选择器 → 退出码 1；`--tab 9` 越界 → 退出码 1；`--tab 0` → `CLOSED_TABS=1`、`TABS` 3 → 2 |

→ 结论：**「代理自动关掉不需要的标签页」只对"自己刚开的临时页"做自动化**（`created` 标记，确定无疑）；
「哪一页已经不需要了」这种语义判断留在专家侧（收尾时 `close-tab --match <站点>` 点名），
工具侧只留两条护栏：不点名不关、不关到 0 个页面。

**一次性读页的抢跑（2026-09-27 发现并修复，真机实测）**

量耗时的时候顺手量出一个真缺陷：`text --url <新地址>` 早先是「按目标 URL 建页 → 固定 `sleep(600)` → 读」，
**抢在页面加载之前就读**，于是三个真实站点全部读到空正文：

| 站点 | 修复前 | 修复后（先开 `about:blank` → attach → `Page.navigate` → 等可读 → 读 → 收页） | 单轮工具侧耗时 |
|---|---|---|---|
| `https://example.com/` | `BYTES=0`、`TITLE=`（空） | `BYTES=129`、`TITLE=Example Domain` | 0.78 s |
| `https://www.qunar.com/` | `BYTES=0` | `BYTES=547` | 1.43 s |
| `https://hotels.ctrip.com/` | `BYTES=0` | `BYTES=2061` | 1.98 s |

两轮都是**一次性实例**（端口 9444 + 临时 profile），`TABS` 全程 1 → 1（每条都打 `TAB_CLOSED=`）。
「读不到内容」与「这页本来就空」在调用方看来完全一样，会被当成"这个站点没用"而**白烧一整轮**（还常诱发重试 ——
再烧一轮），所以修复同时把「等不到可读状态」改成**报错**而不是返回空正文。这也是同日那条调度纪律
（同一份信息默认只在一个站点取，见 `preset/design.md` I13 ① 与 `docs/changelog.md` 同日条目）的成本依据：
浏览器一轮的**下限**是 0.8–2.0 秒（工具侧，还不含每一个模型步），真实站点上「等到内容可取」通常更久（未测）。

**单元测试**：`cd browser && node --test --test-isolation=none test` → **36/36 通过**（不需要浏览器；CDP 通道用可注入的假 socket 测）。

**部署实测**：`install.ps1` 把 `browser/` 拷到 `C:\Users\cenqian\.dsh\browser\`；用**部署后的副本**重跑了一遍
`profile` / `launch` / `eval` / `close`，全部成功（persona 引用的就是这条路径）。preset 那一份部署后与仓库
`preset/agent.cordis.yml` **SHA256 相同**（`A6F26DFB…7F860`）。

**未观测（不许把上面读成「登录流程已经跑通」）**：

- **真实站点的登录墙端到端**：实测的是**机制**（有头窗口 / 幂等复用 / cookie 跨重启存活），**不是**
  「用户真的在某网站登录、专家真的接着抓到了登录后的内容」。量法：让一次真实 Adg 会话在需要登录的站点上
  走完「专家开窗 → 用户登录 → 重派 → 抓到登录后内容」。
- **专家是否真的照 persona 用这套工具**：没有真实 Adg 会话走过。量法：转写里检索 `cli.mjs` 调用；
  出现「现场手写 CDP 脚本」即 persona 未被遵守。
- **macOS / Linux**：Chrome 候选路径与有头启动**没有**在那两个平台上跑过（单元测试只钉了 win32 的候选形状）。
- **多实例并发同一端口**：没有观测 —— `browser/testing-guide.md` 的迁移矩阵里按「第二次 `launch` 撞端口 → 超时分支报错」
  登记为**推断**，不是实测。
- **`install.sh` 未在 Windows 上执行过**：本机没有 `sh` / `bash`，改动只做了人工核对（`install.ps1` 那一侧是真跑过的）。
- **收尾点名清理没有真实 Adg 会话为证**：工具侧的护栏与自动收页都是实测的（见上表），但「专家会不会在任务收尾时
  主动 `close-tab` 点名清理、会不会关掉该留的页」**未观测**。量法：转写里检索 `close-tab` 与 `TABS=` 的变化；
  一次任务结束时 `TABS` 仍显著增长即纪律未被遵守。
- **超时 / 失败清理分支没有在真机上触发过**：不可达站点不会让 Chrome 挂住 —— `.invalid` 域名给错误页
  （224 字节、退出码 0），不可路由 IP `10.255.255.1` 约 10.7s 后也正常返回。所以「等不到可读状态就报错」与
  「失败时收走自己开的临时页」只有源码级断言（`browser/testing-guide.md` A38 / A39），没有真机证据。
  量法：用一个 30s 内既不 `interactive` 也不 `complete` 的本地页面跑 `text --url`。

**怎么重测**（逐条照抄）：

```sh
cd browser && node --test --test-isolation=none test          # 须 36/36
node cli.mjs launch                                           # 须 STATE=STARTED
node cli.mjs launch                                           # 须 STATE=REUSED
node cli.mjs eval --js "document.cookie='adg_probe=1; path=/; max-age=3600'; document.cookie"
node cli.mjs close                                            # 须 ALIVE=false
node cli.mjs launch --url https://example.com                 # 须 STATE=STARTED
node cli.mjs eval --match example.com --js "document.cookie"   # 须含 adg_probe=1
node cli.mjs tabs | grep '^TABS='                             # 记下 N
node cli.mjs text --url https://example.com/                   # 须打 TAB_CLOSED=、BYTES>0 且 TABS 仍是 N（I10）
node cli.mjs close-tab --match example.com                     # 须 CLOSED_TABS= 且不报「会剩 0 个页面」（I9）
node cli.mjs close
```

（I9 的「会剩 0 个页面」分支要在**一次性实例**上验：`--port 9444 --profile <临时目录>`，别在用户正在用的窗口里试。）

## 14. `preset/` 的挂载形状在 dsh 0.1.7-rc.2 变了：旧目录机制被移除 + 引擎行包名改动（真机实测，2026-09-28）

**症状**：用户升级 dsh 之后报告「预设加载不出来」。**两个独立成因**，两个都必须修 —— 只修一个仍然不可用。
根 `README.md`「给 AI 的安装指令」、`preset/design.md`、`preset/testing-guide.md`、`tools/design.md` 引用本节。

### 14.1 成因一：`.agent-presets/<id>/` 那套目录发现机制被整段移除（源码级事实 + 真机实测）

- 旧装法把 `preset.yml` + `agent.cordis.yml` 拷到 `$DSH_HOME/.agent-presets/adg/`。0.1.7-rc.2 里
  **没有任何组件会读这个目录**（`@deepseek-ai/dsh-agent-presets` 已被整包移到一边）。
  本机那份旧目录（`adg/preset.yml` 412 B + `agent.cordis.yml` 72,242 B）已删除 —— **没有第二份文本了**。
- 现在的形状是 **bundle**：包清单声明 `dsh.bundle.patch` → patch 里 `- insert:` → 一行 Loader 声明
  `id: preset-adg`、`name: '@deepseek-ai/dsh-agent-preset'`、
  `config: {id, name, description, order, plugins}`；`plugins` 用的还是旧的条目列表方言（`!!js` 照旧）。
- 交付物：`tools/gen-preset-bundle.mjs` 从 `preset/preset.yml` + `preset/agent.cordis.yml` +
  `preset/bundle.package.json` 生成 `bundle/adg-preset/{cordis.patch.yml,package.json}`
  （实测 **80,547 B / 18 个顶层子插件条目 / id=adg / order=20**）；`install.ps1` / `install.sh`
  把它拷到 `$DSH_HOME/bundles/dsh-adg-preset`（仓库可删可挪）并 `link:` 进 profile、写
  `dsh.profile.bundles`。**生成物不许手改**：改就改 `preset/` 源文件再重跑。

### 14.2 成因二：引擎行的包名改过 → 整份 preset 被判 `broken`（真机实测）

- 旧名 `@deepseek-ai/dsh-workflow-worker-thread` 已从安装里消失（本机只剩被移开的 0.1.5-rc.3 目录）。
  registry 报出的失败字符串是：
  `broken: "workflow-worker-thread (@deepseek-ai/dsh-workflow-worker-thread): never started"`
  → 该模式在新会话里直接不可用。
- **它不影响挂载，只让整份 preset 变 `broken`**，所以 `check-preset.mjs`（文本扫描器）与
  `--dump-config`（只证明 patch 被读到）**都发现不了** —— 只有运行期读 `agentPresets` 才看得见。
- 出厂（**dsh 安装目录里**的）`presets/standard.patch.yml:119-122` 现在用的是 `@deepseek-ai/dsh-workflow-ptc`
  （行 id `workflow-ptc`、`config: {provider: spawn}`）；`preset/agent.cordis.yml` 已按此改，
  并在文件里留了注释记录这次改名与原诊断字符串。
- **一般教训**：composition 里写的 `@deepseek-ai/*` 包名会随 dsh 升级**改名**；改完必须做真实挂载
  （判据 `resolve('adg').broken` 为空）。

### 14.3 两条路线都实测可用，最终选 bundle 路线（真机实测，含数字）

| 路线 | 挂法 | 实测（2026-09-28） |
|---|---|---|
| **bundle（采用）** | `$DSH_HOME/bundles/dsh-adg-preset` + 该 profile 的 `dsh.profile.bundles` 选入 | 18:23:07 与 18:28:18 各一次：`resolve('adg').broken` 为空、`compositionInventory()` **35 行 / 32 启用 / 3 关闭 / 0 条件**、`fiberState === 2` 的 **32 行**、9 条 `@deepseek-ai/dsh-tool-subagent` 启用、fork **0** 行；引擎行 `workflow-ptc` 与 `tool-workflow` 都 active |
| profile patch 里直接 insert 同一行声明 | profile 的 `cordis.patch.yml` | 18:24:27 一次，同样挂载成功（35 行的形状相同） |

选 bundle 的理由：它是本版文档口径（技能 `editing-cordis-compositions`：preset 一律由 bundle patch
声明）、`desktop` profile 本来就用这条路线、且 `list_bundles` 有生命周期。
**一条护栏**：同一个 profile 里 `preset-adg` 只能有一个"家"（bundle **或** profile patch 二者之一）——
两份同 id 的 insert 行是危险形状；web 上那条临时的 profile-patch 行已撤掉（现在 0 处）。
**本条只登记到"危险形状"，当时没有量过后果**：不要外推到**插件那一行的跨层同 id 合并**（那条已实测，
见 §16.4 第 6 条：合并成一条、整块接管 `config:`、并让该行脱离管理）。
- 3 行关闭的是：`tool-bash`（平台 `!!js` 在 Windows 上求值为 false）+ `tool-subagent-codex` +
  `tool-subagent-claude-code`。`!!js` 行在组合挂载后落成具体布尔值。
- **不挂探针也能拿到的活证据**（本次交付末实测，比挂临时插件安全）：Host 的 Config inspect provider
  里 `listConfigs(name='@deepseek-ai/dsh-agent-preset')` 报 **5 条** `include:preset-*`
  （`preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis` / **`preset-adg`**），
  `include:preset-adg` 的 `patchId=preset-adg`、schema 状态 `schema` —— 声明行确实在**活组合**里；
  插件那一行 `include:adg-token-budget` 也在（`patchId=adg-token-budget`，`status: absent` 是**预期**的：
  本插件不声明 `Config` schema，未知 config 键按 `src/config.js` 的设计本来就被忽略；
  对照 `dsh-windows-notifier` 这类声明了 schema 的插件报的是 `schema`）。
- 26 个 `name:` 里**只有上面那一个包真的缺**（逐个核对过安装目录）；
  `@deepseek-ai/dsh-tool-subagent-control/list-agents` 是合法子路径导出（按目录存在性判断会误报）。

### 14.4 这次踩到的两个机制坑（写下来别再踩）

1. **`ctx.agentPresets` 在已被释放的 scope 里访问会抛
   `cannot get required service "agentPresets" in inactive context`**；这一句放在 `setInterval`
   里就是**未捕获异常 → Host 崩溃**（本机这次真崩过一次，`bundle/_preset-verify3/index.js:54`）。
   探针要：属性访问放进 `try/catch`，并在 `scoped.on('dispose', …)` 里清掉定时器。
2. **ESM registry 按文件 URL 缓存**：同一个目录的探针插件重新挂载**不会**重跑 `apply`
   （第二次运行什么都没写出来）。要重跑就得换一个新目录（新 URL）。

### 14.5 部署路径与解析口径的更正（真机实测）

> **本节与 §14.6 里凡出现 `$DSH_HOME/plugins/dsh-adg-token-budget/` 的地方都是 2026-09-28 上午的落点，属历史证据，不代表当前落点**（当前在 bundle 层：`$DSH_HOME/bundles/dsh-adg-token-budget/`，见 §16.1）。原文按"变更记录不回改"的纪律**保留不抹**；`profiles/node_modules/` 被排除、`link:` 重启安全这两条机制事实**至今仍然成立**，变的只是那一个稳定落点目录。

- **`$DSH_HOME/profiles/node_modules/` 这个"共享解析根"在本版被排除**：插件拷在那里时挂载行
  解析不到这个包；改放 profile **自己的** `node_modules`（或 `link:` 稳定目录）才起得来。
  解析是**两段锚定**：先从 dsh 安装目录，再落到当前 profile
  （`@deepseek-ai/dsh-app-boot/lib/index.js:477-481`）。
- 本机现状：`profiles/web/node_modules/dsh-adg-preset` 与 `dsh-adg-token-budget` 都是指向
  `$DSH_HOME/bundles|plugins` 的 **link**；`profiles/web/node_modules/@deepseek-ai/*` **0 个目录**，
  而全部 `@deepseek-ai/*` 行照样 active。
- preset 声明**不在** profile patch 里（走 bundle）；插件挂载行**在** profile 的
  `cordis.patch.yml`（web 149 行，`adg-token-budget` 一行）。
- **`link:` 是重启安全的**（源码级事实，`@deepseek-ai/dsh-app-boot/lib/index.js:596-598`）：
  启动时那次 fallback 修复**只**删目标落在 `<profile>/.dsh-module-fallback/node_modules` 里的链接，
  原文是"pnpm-installed packages and every other symlink stay"，且没有该目录的 profile 完全不动。
  所以 `link:` 进 profile 的 `dsh-adg-preset` / `dsh-adg-token-budget` 不会被下一次启动清掉。
  反过来说，如果哪天 bundle 真的解析不到，dsh 给的诊断文本是
  `Selected profile bundle "…" could not be loaded; repair or remove its bundle selection.`
  （同文件 `:3179`）。

### 14.6 一个**没修好**的环境问题（如实记录，别读成已解决）

`profiles/web` 的 pnpm 状态在本次交付里**没有修好**，原因是 dsh 正在运行、`node_modules` 里的文件被占用：

- 现象：`pnpm add` 报 `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR` /
  `failed to remove existing directory … 另一个程序正在使用此文件 (os error 32)`；
  `profiles/web/node_modules/.modules.yaml` 现在**缺失**，所以 pnpm 想整目录重建。
- 另有一次失败发生在 `pnpm-lock.yaml` 已被重写之后（18:30:22）而清单保存失败
  （`Failed to save the manifest file: 拒绝访问 (os error 5)`）—— **锁文件与清单有漂移**。
- **影响：0。** 所有已声明的依赖都解析得到、所有行都是 active —— 本节两次真实挂载实测就是在漂移之后做的。
- **修法（必须先关掉 dsh）**：关掉 dsh → 重跑 `install.ps1` / `install.sh`（它会重跑 `pnpm add link:…`），
  或直接在该 profile 里 `pnpm install` 重建 `node_modules` / `.modules.yaml` / 锁文件。
- **本机两个 profile 的当前形状不一样，如实记下来**：
  - `desktop` 的 `pnpm add` **成功了** —— 它的清单是 `dsh-adg-preset: link:C:/Users/cenqian/.dsh/bundles/dsh-adg-preset`
    与 `dsh-adg-token-budget: link:C:/Users/cenqian/.dsh/plugins/dsh-adg-token-budget`（新形状）。
  - `web` 只有 **bundle** 换成了新形状（`link:C:/Users/cenqian/.dsh/bundles/dsh-adg-preset`，是符号链接）；
    它的**插件 dep 还是旧的仓库 tgz**（`file:D:/dsh/adg-multi-agent/bundle/dist/dsh-adg-token-budget-0.2.0.tgz`，
    在 `node_modules` 里落成普通目录 0.2.0）。功能上没影响（那一行现在是 active，文件已经在 `node_modules` 里、
    不依赖仓库是否还在），但它**不是**新文档描述的形状；关掉 dsh 后重跑一次安装脚本就会改成
    `link:$DSH_HOME/plugins/dsh-adg-token-budget`。
- 脚本已按实测加固：**pnpm 失败只报告、不中断**（包已在位就不算失败），而且**只有在包真的出现在
  profile 的 `node_modules` 里之后**才写 `dsh.profile.bundles` 与插件挂载行；
  另有一条 5.1 专属坑：原生命令写 stderr 在 `$ErrorActionPreference='Stop'` 下会变成**终止错误**
  （实测脚本在 web 那一步整个退出、exit 1，后面的 profile 根本没跑到），所以 pnpm 走 `cmd /c` 重定向到日志。
- **2026-09-28 08:50+08:00 更正（本次复核读到的磁盘事实）**：上面那条"`web` 的**插件 dep 还是旧的仓库
  tgz**"**已经不再成立** —— `profiles/web/package.json` 现在写的是
  `dsh-adg-token-budget: link:C:/Users/cenqian/.dsh/plugins/dsh-adg-token-budget`，
  `profiles/web/node_modules/dsh-adg-token-budget` 是指向该目录的**符号链接**（同目录还留着 pnpm 的
  `.ignored_dsh-adg-token-budget` 残余）。也就是说 `web` 与 `desktop` 现在**同形状**。
  **没有重新检查**的是 `.modules.yaml` 缺失与锁文件漂移那两条，仍按本条正文的记载（"没修好"）。

**未观测（不许写成实测）**：① `desktop` profile 的**挂载**没有测过 ——
`dsh --profile desktop --dump-config` 被拒（`error: profile "desktop" is managed exclusively by the
Electron application`）；它的 bundle 依赖与挂载行都已按同一形状就位（本次 `pnpm add` 对它**成功**，
清单里是 `link:C:/Users/cenqian/.dsh/bundles/dsh-adg-preset`），但没有运行期证据。
② Windows 上本机**没有 `sh`**，`install.sh` 这次的改动**没有在本机执行过**（只做了逐行 review 与语法对照）。
③ 探针那次没有单独记录 `agentPresets.list()` 的条数（只记了 `resolve` 与 `compositionInventory()`）。

## 15. session format v4 废弃了 `{kind:'plugin', plugin}`：插件注入的检查点让每个受管子代理在第一档当场失败（真机实测 + 源码级事实，2026-09-28）

**这是 dsh 0.1.7-rc.2 升级引起的第三个独立成因。** 前两个（§14）让「Adg 模式挂不上 / 不可用」，
这一个让**挂上之后每一次委派都失败**：preset 侧的迁移做完了，插件侧漏了同一版里 session format 的
消息来源改名。

### 15.1 用户报告的那句话，原文与出处

调度者（`adg` preset）收到的工具结果，逐字：

```
Error: subagent run failed: Error: subagent run failed; dispose failed: SessionFormatError: format v4 message requires a producer-owned source kind
```

出处：`C:\Users\cenqian\.dsh\sessions\--D-dsh--\session-76dc1198-8c23-4c20-b5ec-235071bf34df\session.v4.jsonl.zstd`
的 `tool/result` seq 23（`2026-09-28T00:34:22Z`）。UI 上用户看到的是「本轮运行失败」后面接同一句。
（`session.v4.jsonl.zstd` 的解压口径见 §15.5。）

### 15.2 定位：失败与检查点严格一一对应（真机实测）

`C:\Users\cenqian\.dsh\adg-token-budget.log` 里四条注入与四个子代理的结束**毫秒级相邻**，
而且每个子代理的转写都**停在检查点那一步的 `step/end`**、没有 `turn/end`：

| 时间（Z，2026-09-28） | 插件日志 | 子代理转写 |
|---|---|---|
| 00:29:39.900 | `step stage: nudged tier=1/14 step=4 label=adg/2bc8a238-…` | 00:29:39.935 `settled: released session state label=2bc8a238…`；转写停在 `step/end` seq 33（step 3），无 `turn/end` |
| 00:30:00.634 | 同上，`6bcfd19c-…` | 00:30:00.682 `settled:`；转写停在 `step/end` seq 33 |
| 00:31:12.810 | 同上，`43a6912c-…` | 00:31:12.842 `settled:`；转写停在 `step/end` seq 32 |
| 00:34:22.173 | 同上，`3fbab55e-…` | 00:34:22.197 `settled:`；转写停在 `step/end` seq 48 |

对照组：同一时段的 `b962f304-…` **没有**注入，它的转写以
`turn/end {reason:{kind:'aborted',reason:{kind:'parent'}}}` 收尾 —— 那是**被父代理取消**的已知路径，
不是这个故障。判据：**四次注入 → 四次失败**，没有注入的那条走另一条路径；
注入的消息**没有**出现在任何一份转写里，因为抛错就发生在写它的那一次
`session.append('user/message', …)` 里（插件在监听器里返回消息，写入是宿主的事）。

### 15.3 成因（源码级事实）

`@deepseek-ai/dsh-session-format-v3-to-v4` 的原生准入只拒绝 **裸 `plugin`** 这一个 `kind`：

```js
function source(message) {
  const value = message["source"];
  if (!isSessionFormatJsonObject(value) || typeof value["kind"] !== "string" ||
      value["kind"].length === 0 || value["kind"] === "plugin")
    throw new SessionFormatError("format v4 message requires a producer-owned source kind");
}
```

（`lib/index.js:126`；同一判据内联在 JSONL writer 的 `worker.cjs:10901`，由
`assertV4SourceRowAdmission`（`:10917`）在 `:10925` 上**只为已经带 `kind === 'plugin'` 的消息**调这一支 ——
所以裸 `plugin` 也是物理行层面唯一会被拒的形状，本次探针把这个边界也测出来了。）
`@deepseek-ai/dsh-llm` 的消息来源文档同时写明这套词表是 merge-extensible、
**没有共享的 catch-all `plugin` kind**（`lib/types/message.d.ts:30-58, 94-108`）。
旧插件写的正是 `{kind:'plugin', plugin:'dsh-adg-token-budget'}`，于是**每一次注入 = 一次持久化异常**，
异常发生在监听器返回之后、插件接不住，整轮委派失败。

### 15.4 修法与验收（本次实测）

- 改 `plugin/dsh-adg-token-budget/src/plugin.js` 的 `PLUGIN_SOURCE`：
  `{kind:'plugin', plugin: name}` → `` {kind: `plugin:${name}`} ``。
  选这个字符串是因为它**逐字等于** v4 读取本插件 v3 记录时分配的 kind
  （未识别生产者 → `` `plugin:${plugin}` ``，`dsh-session-format-v3-to-v4/README.md:130,134`），
  迁移前后的记录因此指向同一个生产者、本仓库的证据 grep 不用改口径。
- 单元测试 **50 → 51**（新增 `the reminder source passes the session format v4 admission rule`），
  实测 `pass 51 / fail 0`；变异 **M18**（把旧包装写回去）被 **4 条断言**抓住。
- **用装好的宿主复测**（不是复述规则）：`node D:\dsh\.adg-step-mutations\verify-v4-source-admission.mjs`，
  实测输出（同一台机器、同一份 dsh）：

  ```
  nudge strategy     = dsh-home-profiles
  message.source     = {"kind":"plugin:dsh-adg-token-budget"}
  PASS: the installed v4 row admission accepts the injected reminder
  EXPECTED refusal on the retired wrapper — SessionFormatError: format v4 message requires a producer-owned source kind
  ```

  探针调的是 `assertV4RowAdmission`（该包**不在** profile 的模块根里，要从
  `dsh-session-persistence-jsonl` 所在位置解析 —— 脚本已这么做）。
- 同一条探针也对**部署位置**的那一份跑过（`$DSH_HOME\plugins\dsh-adg-token-budget\src\plugin.js`，
  与仓库同 `sha256 691e459a24cbafb9f5904ac1a1644ba1ab1e8ffbaf26e647c1afa8396dcf9f8c`），输出相同 ——
  profile（`web` / `desktop`）的 `node_modules` 链接都指向这个目录，所以重启后加载的就是这份代码。
- **未观测（不许写成实测）**：修复后**没有**再跑过一次真实 Adg 委派。改插件 `src/` 必须重启 dsh，
  而重启会结束当时正在跑的会话，所以"子代理现在能跑到收敛"在本台账里仍是**未观测**。
  验收动作：重启 dsh → 新建 Adg 对话 → 委派一件会走到第 4 步以上的任务 → 看三件事：
  ① `logFile` 出现 `step stage: nudged` **且同一 label 没有紧跟着 `settled:`**；
  ② 转写里出现 `"source":{"kind":"plugin:dsh-adg-token-budget"}`；
  ③ 调度者不再收到 `subagent run failed … SessionFormatError`。

### 15.5 附：本机怎么解压 session 转写（补 §8 那条"本机没有 zstd 解压能力"的更正）

**2026-09-28 同日第二次独立确认（数字与出处见 §16.4 第一条技术事实）**：多帧这件事不是孤例，
"读转写核对注入"的口径**必须**按多帧处理。

旧记载**不成立**：Node 26 自带 `zlib.zstdDecompressSync`（`node -e "console.log(typeof
zlib.zstdDecompressSync)"` → `function`）。**坑在帧**：一个 `session.v*.jsonl.zstd` 是**多帧拼接**的，
`zstdDecompressSync` 一次只解**第一帧**（实测一份 35,771 字节的文件只解出 257 字节 / 2 行，
按帧切之后是 96,894 字节 / 50 行）。可用做法：按魔数 `28 B5 2F FD` 切帧后逐帧解再拼接。
本次用的脚本都放在 `D:\dsh\.adg-step-mutations\`（**不属于本仓库**，与那份变异 harness 同一个目录）：
`dump-session.mjs`（按帧解压 + `--tail N` / 搜关键字）、`scan-sessions.mjs`（批量扫）、
`verify-v4-source-admission.mjs`（§15.4 的宿主准入复测探针）。

## 16. 插件挂载行从"手贴进 profile patch"迁成 bundle（源码级事实 + 真机实测，2026-09-28）

**来源声明（引用本节前必读）**：本节由本次迁移的**操作记录**转写（迁移时的台账是一份**临时文件**，
不属于仓库、不长期存在），所以可复核的证据只有下面点名的这些：日志
`C:\Users\cenqian\.dsh\adg-token-budget.log`（本机 `$DSH_HOME` = `C:\Users\cenqian\.dsh`，时间戳全部 UTC（`Z`））、
仓库里的 `plugin/dsh-adg-token-budget/cordis.patch.yml` / `package.json` / `install.ps1` / `install.sh`，
以及本机 profile 的 `package.json` 与 `cordis.patch.yml`。状态档按 `docs/docs-guide.md` 的四档保留，
**"迁移台账说"不构成任何一档证据**。

### 16.1 机制变了什么（源码级事实）

| 项 | 旧 | 新 |
|---|---|---|
| 挂载行来源 | 手贴进 `profiles/<profile>/cordis.patch.yml` 的 `- insert:` 条目 | 包自己的 `plugin/dsh-adg-token-budget/cordis.patch.yml`（**bundle 层**），由 `package.json` 的 `dsh.bundle.patch: ./cordis.patch.yml` 声明 |
| 部署落点 | `$DSH_HOME/plugins/dsh-adg-token-budget/` | `$DSH_HOME/bundles/dsh-adg-token-budget/`（与 `dsh-adg-preset` 同一根；见 §14.5 的历史标注） |
| profile 依赖 spec | `link:$DSH_HOME/plugins/dsh-adg-token-budget` | `link:$DSH_HOME/bundles/dsh-adg-token-budget` |
| 选中方式 | 无（只有依赖 + 手贴行） | 写进该 profile 的 **`dsh.profile.bundles`** |
| 部署集合 | **五项**：`package.json` / `src` / `README.md` / `examples` / `LICENSE` | **六项**：加 `cordis.patch.yml`（= 挂载行本身，缺了它这个包只是普通依赖）；与 `package.json` 的 `files` 一致；`test/` 与 `INSTALL.md` 仍不进部署 |
| bundle 行默认 config | 例子文件 `enabled: false`（要人来武装） | **出厂即武装**：`enabled: true`、`presets: ['adg']`、`stepNudge: true`、`stepTiers: [5, 10, 15, … , 275, 280]`（每 5 步一档、共 56 档；2026-09-29 由 14 档换成）、`dryRun: false`、不写 `stepText`（用内置正文）、`logFile: !!js dshHomePath('adg-token-budget.log')` |
| `logFile` 写法 | 每 profile 硬编码绝对路径 | `!!js dshHomePath('adg-token-budget.log')` → Loader 求值，任何机器都落到 `$DSH_HOME/adg-token-budget.log`（本机实测求值结果就是 `C:\Users\cenqian\.dsh\adg-token-budget.log`，**与旧行逐字相同，历史日志连续** —— 见 §16.4 第 1 条那行日志） |
| `examples/cordis.patch.yml` 的角色 | "可直接贴进 profile patch 层的挂载行" | **键参考 + 手工覆盖模板**（贴之前必须重写全部键，见 §16.2）；`plugin/dsh-adg-token-budget/cordis.patch.yml` 才是挂载行本体 |
| 版本 | `0.2.0` | `0.3.0` |

### 16.2 层序与"整块替换"（源码级事实，必须写进文档的坑）

- profile 自己的 `cordis.patch.yml` 在**所有 bundle 层之后**应用。
- 按 id 命中的 patch **整块替换** `config`（**不是深合并**）：profile 层留一条 `- id: adg-token-budget` 而只写一个键，
  其余键全部回落到 `src/config.js` 的 `DEFAULT_CONFIG`。
- 所以旧的 `- insert:` 行必须删；`install.ps1` / `install.sh` 现在**只报告、不代删**（不猜用户手改过的文件）。
  **残留行到底会坏什么事已实测**（整块接管 `config:` ＋ 让该行变成 `unaddressable`），判据见 §16.4 第 6 条。
- 机器级 `$DSH_HOME/cordis.patch.yml` **仍然禁止**出现这一行（套在每个 profile 上 + 会挡住 Plugins 页保存）——这条没变。

### 16.3 热重载口径的分层（源码级事实；§5 讲的是 profile 层那一行，本节把三层分清）

- **没有任何东西 watch `bundles/`** ⇒ **单独改 bundle 层的 `bundles/dsh-adg-token-budget/cordis.patch.yml` 不会自己触发重读**；
  这一层的改动**以重启 dsh 为生效口径**（**禁止宣称"不重启也会生效"**）。
- **改一次 profile 的 `cordis.patch.yml` 或 profile 清单会让整份 patch 栈重读**（既有实测口径与机制出处见
  `preset/design.md`「`deployed` → `mounted` 的触发」与 `preset/AGENTS.md`「生效方式」），bundle 层**顺带**被重读
  —— 本次迁移就是靠这一步在无重启的情况下挂起来的（§16.4 第 1 条）。**但已挂载的会话不会中途换组合**，
  这条照 preset 侧口径不变。
- 改 **profile 层**的 `config:` 覆盖行 → **热重载**（`web` profile 是 `patchReload: live`）；Plugins 页保存写的就是这一层。
- 改 **`src/` 代码** → **必须重启**（热重载不重新 `import` 已加载模块）——这条与 §5 一致、没变。
- 行 id `adg-token-budget` 与包名都没改，所以**热重载身份不变**。
- **仓库验收口径不变**：新会话 / 重启后才是最终判据。`install.ps1` / `install.sh` 末尾的提示行就是这个口径。

### 16.4 真机实测（有日志为证，2026-09-28；逐字引用本机日志行）

证据文件 `C:\Users\cenqian\.dsh\adg-token-budget.log`（UTC）：

```
2026-09-28T01:47:48.467Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T01:57:12.041Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[1, 2] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T01:58:46.325Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, …, 280] stepText=builtin dryRun=false logFile='…'
2026-09-28T01:59:20.788Z activation: active createUserMessage=profile-fallback:web presets=[cordis] stepNudge=true stepTiers=[1, 2] stepText=builtin dryRun=false logFile='…'
2026-09-28T01:59:25.308Z step stage: nudged tier=1/2 step=1 label=cordis/b625f841-df55-4983-a4eb-66f96ac0b05f
2026-09-28T01:59:31.672Z step stage: nudged tier=2/2 step=2 label=cordis/b625f841-df55-4983-a4eb-66f96ac0b05f
2026-09-28T01:59:43.808Z settled: released session state label=b625f841-df55-4983-a4eb-66f96ac0b05f
2026-09-28T02:00:09.597Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T02:19:52.105Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T02:31:45.335Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T02:32:13.279Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

逐条归属（**不许把这几行读成"迁移后 `adg` 那一面已经实测过"**，见 §16.5）：

1. `01:47:48` —— 手贴行已从 `profiles/web/cordis.patch.yml` 删除**之后**、`plugin_manager install_bundle` 装上 bundle **之后**写的。
   当时进程里唯一能提供这一行的层就是 bundle 层 ⇒ **实测：bundle 层的行确实挂载并 `apply` 了，且 `!!js dshHomePath(...)` 求值成功**
   （`logFile` 落回同一个文件）。**没有重启 dsh**（该进程 09:05:04 本地时间启动，早于迁移）。
   **机制归属**：触发这次重读的是 `install_bundle` 改写 profile 清单 ⇒ **整份 patch 栈重读、顺带重读 bundle 层**（§16.3 第二条），
   **不是**"有人在 watch `bundles/`" —— 别把这条读成 bundle 层会自动热更新。
2. `01:57:12` / `01:58:46` —— 临时在 profile 层加/删一条 `- id: adg-token-budget` 覆盖行（`stepTiers: [1, 2]`）后写的
   ⇒ **实测：profile 覆盖行热重载、不用重启**；且写覆盖行时必须整块重写所有键（§16.2）。
3. `01:59:20` + 三条决策行 —— 临时把 `presets` 改成 `['cordis']`（原因见下面第 2 条技术事实）后的一次真实委派
   ⇒ **实测：迁移后的行确实计数并注入了检查点**（`tier=1/2 step=1`、`tier=2/2 step=2`，收尾 `settled: released session state`）。
   子代理转写 `C:\Users\cenqian\.dsh\sessions\--D-dsh--\b625f841-df55-4983-a4eb-66f96ac0b05f/session.v4.jsonl.zstd`
   里两条 `user/message` 带 `"source":{"kind":"plugin:dsh-adg-token-budget"}`（v4 准入通过，**§15 那次事故没有复发**），
   且 `2/2` 那条带最后一档的追加句；子代理在下一步回复里说明了选择。
4. `02:00:09` —— 临时覆盖行删掉之后，恢复成 bundle 行的出厂形状。
5. **`disabled: true` 能不能关掉 bundle 层那一行（真机实测，有日志为证）** —— 在 profile 层追加一条
   **只写** `- id: adg-token-budget` + `disabled: true`（**不带 `config:`**）的条目。逐字段结果：
   `plugin_manager list_plugins` 里 `include:adg-token-budget` 变成 **`enabled: false` / `fiberPhase: null`**，
   条目总数仍然 **190**（没有重复挂载、也没有少一条）；**日志没有写出任何新行** —— 被 `disabled` 的行
   Loader 根本不 `import`，插件连 `activation: inactive (enabled: false) …` 都来不及写。
   删掉这条覆盖行之后日志**立刻重新写出一行**（`02:19:52`，见上面的代码块），`list_plugins` 回到
   `enabled: true` / `fiberPhase: active` ⇒ **该行确实从 bundle 层恢复**（profile 层没有贴回任何 `config:`）。
   这条实测补上了 `INSTALL.md` 第 5 节原先挂着的"迁移后未实测"缺口。

   两条推论（不变量式）：

   - **`disabled: true`（Loader 层）与 `enabled: false`（插件自己在 `apply` 里写激活行）是两个不同的开关**，
     证据形状也不同：前者**什么都不写**（行不被 `import`），后者**必写一行 `activation: inactive …`**。
     `disabled` 走的是 Loader 的整块替换语义（§16.2），**不需要 `config:`**。
   - **禁止用"日志里没有新行"判断插件还活着**；判据是 `list_plugins` 的 `enabled` / `fiberPhase`，
     或恢复那一刻写出的 `activation:` 行。

6. **profile 层残留一条同 id 的 `- insert:` 手贴行到底会发生什么（真机实测，有日志为证）** —— 与第 5 条**并列、不要合并**：
   两个"关掉"的证据形状完全不同（第 5 条**什么都不写**；本条**照常写一行、但那一行的 `config:` 被接管**）。
   做法：在 `C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml` 末尾追加 `- insert:` / `- id: adg-token-budget` /
   `name: 'dsh-adg-token-budget'`，`config:` 里**只把 `dryRun` 写成 `true`**（其余键照出厂值，含 `logFile: !!js dshHomePath(...)`），
   等热重载，然后删掉。逐字观测：

   - 残留行在位期间日志写出 `02:31:45` 那行 **`dryRun=true`**；删掉后立刻写回 `02:32:13` 那行 **`dryRun=false`**（见上面的代码块）。
   - `plugin_manager list_plugins` 在残留行存在期间：`entryId: include:adg-token-budget`、`enabled: true`、`fiberPhase: active`、
     **`readOnlyReason: "unaddressable"`**，且 **`patchId` 字段消失**；条目总数仍然 **190**；**只写出一行激活行**。
   - 删掉残留行后：`patchId: "adg-token-budget"` 回来、`readOnlyReason` 消失、日志回到 `dryRun=false`。

   三条结论（**不许写成"重复挂载"**）：

   - **同 id 的跨层 `- insert:` 残留不会多挂一行**：总数 190、只有一行激活行。
   - **它整块接管那一行的 `config:`** —— 实测 `dryRun` 被顶成 `true`：**注入当场停掉，而 `fiberPhase` 仍然是 `active`、
     日志看起来完全正常**。这是 §16.2「整块替换」语义落在**残留行**这一形状上的具体后果，**不是新机制**。
   - **它让这一行脱离管理**：变成 `unaddressable`、`patchId` 消失 ⇒ Plugins 页与 `set_plugin` **都点不动它**，只能改 patch 文件。
     （顺带补一句 §14.3 的读法：那里把 `patchId=adg-token-budget` 当"这一行在活组合里"的**正证据**；本条给出反面 ——
     **`patchId` 消失 = 这一行被跨层残留接管、已脱离管理**。）

   两条判据事实：

   - **`list_bundles` 的 `overrides` 发现不了这种残留**（本次仍是 `[]`）⇒ 最快信号是 **`list_plugins` 里这一条还有没有 `patchId`**。
   - **与 §14.3 那条护栏不是一件事，禁止混引**：§14.3 讲的是**同一个 profile 里 `preset-adg` 只能有一个"家"**
     （bundle 或 profile patch 二者之一，两份同 id 的 insert 行是危险形状），说的是**同一层内**该声明的形状；
     本条是**插件行跨层同 id 被合并** —— **既不报错、也不双挂，而是整块接管 `config:` 并让该行脱离管理**。形状与后果都不同。
     （**引用真实性**：§14.3 的原话只记到"危险形状"，本机**没有**"同一层内重复插入被 Loader 拒绝"的那次实测；
     别处若写成"被拒"，那是**未观测**，不许挂到 §14.3 名下。）

**顺带量到的两个技术事实（此前文档没有，源码级 + 本机实测）**：

- **`session.v4.jsonl.zstd` 是多帧文件**：一次 `zlib.zstdDecompressSync(整个文件)` 只解出**第一帧 = 只有 session 头一行**
  （本机实测：38,679 字节的文件解出 **1 行**；按 magic `28 B5 2F FD` 逐个偏移分别解压才拿得到全部 **44 行**）。
  这是对 §15.5 那条口径的**再次确认**（同一次观测的第二个实例）：任何"读转写核对注入"的口径都必须按**多帧**处理。
- **通用 `subagent` / `subagent_fork` 委派出去的子代理，session 头记的是 `agentPreset: "cordis"`、`delegationDepth: 1`，不是 `adg`**
  （本机实测；`adg` 专家行委派出来的记 `adg/<uuid>`）。所以 `presets: ['adg']` 按设计**不治理**通用委派（fail open）——
  上面第 3 条之所以临时把 `presets` 改成 `['cordis']`，就是为了在迁移后仍能走到一条真实注入路径。

### 16.5 本机迁移后的实际状态与未观测（源码级事实 + 当次读数 / 检验 / 未观测）

**已就位（源码级事实 + 本机 Plugin Manager 与 Loader 的当次读数）**：

- `plugin_manager list_bundles`：新增一条 `dsh-adg-token-budget`，`version 0.3.0`、`enabled: true`、`installed: true`、
  `removable: true`、rows `[{rowId: adg-token-budget, moduleName: dsh-adg-token-budget, entryId: include:adg-token-budget}]`、`overrides: []`。
  **迁移前这条根本不存在**（挂载行只存在于手贴的 profile patch 里，Plugin Manager 的 bundle 清单看不到它——
  这就是"看起来没生效"的直接原因）。
- `plugin_manager list_plugins`：`include:adg-token-budget` `enabled: true`、`fiberPhase: active`、`patchId: adg-token-budget`；
  条目总数迁移前后都是 **190**（没有重复行）。
- **检验（单元测试）**：`cd plugin/dsh-adg-token-budget && node --test test` 由 **51 → 54** 个用例（新增**三条**钉住 bundle 形状：
  ① 包声明 `dsh.bundle.patch` 且该文件存在；② 部署集合等于 `package.json` 的 `files` 六项；③ bundle 行只有一条挂载行且出厂即武装、
  旧 token 键不得回到生效行）。**状态档：检验** —— 本机实测 `tests 54 / pass 54 / fail 0`（2026-09-28，同一日跑过两遍；
  DSH 沙箱里须加 `--test-isolation=none`，见根 `AGENTS.md` Quality Gates 第 2 条）。它证明的是**行声明的形状**，
  **证明不了真实 profile 组合挂得上**（那属真机档，判据在 `INSTALL.md` 第 4 节）。
  历史条目里的 `50 → 51`（§15.4）属变更记录，**不回改**。
- profile `web`：`dsh.profile.bundles` 末尾加了 `dsh-adg-token-budget`；`dependencies["dsh-adg-token-budget"] = link:C:/Users/cenqian/.dsh/bundles/dsh-adg-token-budget`；
  手贴行已删（备份 `cordis.patch.yml.bak-adg-token-budget-bundle-migration`）。这一层的清单是
  `plugin_manager install_bundle` 写的（本机 mtime `2026-09-28T01:47:46Z`，与 §16.4 第 1 条那行 `activation:`
  相差 2 秒），所以 web **没有** `package.json.bak-adg-token-budget` 这一份备份。
- profile `desktop`：同一形状（`install.ps1` 于 `2026-09-28T01:54Z` 前后写入，本机文件 mtime 为证；
  `package.json.bak-adg-token-budget` 是它的清单备份）；手贴行已删（`cordis.patch.yml.bak-adg-token-budget-bundle-migration`）。
  它的 `patchReload` **不是** `live` ⇒ 该 profile 要下次启动才生效（**未观测**）。
- profile `headless`：不含 `@deepseek-ai/dsh-web-app`，不是 preset 宿主，脚本按判据跳过。
- 旧落点 `C:\Users\cenqian\.dsh\plugins\dsh-adg-token-budget` **已删除**（`install.ps1` 第 5 步：只有没有任何 profile 的链接还指着它才删）。
- **六份** patch 文件都过了真实 Loader（`loadOverlayPatches('dsh', file)` 全部 OK）：本机 `profiles/web/cordis.patch.yml`、
  `profiles/desktop/cordis.patch.yml`、机器级 `$DSH_HOME/cordis.patch.yml`（仍是空层）、部署后的
  `bundles/dsh-adg-token-budget/cordis.patch.yml`、仓库 `plugin/dsh-adg-token-budget/cordis.patch.yml`、
  仓库 `plugin/dsh-adg-token-budget/examples/cordis.patch.yml`。结论：bundle 行 **6 个键**；两个 profile 层里
  `adg-token-budget` 的行数 **0**。
  状态档：**检验**（这是"能不能解析 + 键集合"的验证，不是挂载验证 —— 挂载判据见 §16.4 与 `INSTALL.md` 第 4 节）。
- **"能不能关掉 bundle 层那一行"已实测**（判据与两条推论见 §16.4 第 5 条，本节不复制数字）：
  `INSTALL.md` 第 5 节原先挂着的"迁移后未实测"缺口就此补上 —— 引用时按**真机实测（有日志为证）**档说。
- **profile 层残留同 id `- insert:` 行的后果已实测**（判据见 §16.4 第 6 条，本节不复制数字）：不会多挂一行，
  但会**整块接管那一行的 `config:`** 并让该行变成 `unaddressable`（`patchId` 消失）。这也是 `install.*`
  **只报告、不代删**这条口径的理由。

**未观测（照 §8 未观测清单登记，不许写成实测）**：① 迁移后 `presets: ['adg']` 对**真实 `adg` 专家子代理**的注入
（第 3 条走的是 `presets: ['cordis']` 的通用委派，机制见 §16.4 第二条技术事实）；② **冷启动后的 bundle 层**
（当前进程是迁移前起的，这次生效靠的是改写 profile 清单带来的**整份 patch 栈重读**，不是 bundle 层自己被 watch，见 §16.3）；
③ **`desktop` profile 生效**（`patchReload` 非 live）。三条的量法都写在 §8 对应行里。

## 17. billion-context 的上下文工具对 ADG 专家可见吗（2026-09-28）

**这一节回答的问题**：ADG 的专家行能不能用 billion-context（下称 bili）那套上下文工具；口径为什么是"构建期条件化注入"；以及"挂了 bili 就别启用 `dsh-adg-token-budget`"这条决定的依据。
**边界**：本节**不**回答"步数检查点到底有没有用"（§8 第 1 行的核心问题，至今未观测），也**不碰任何尺寸旋钮**（红线 3：`compaction-basic` 的 0.8/0.16 与 `tool-result-pruner` 的 8192/4096/1024 一律出厂默认）。本节改动的是 realm 里 `compaction-basic` 的**开关**（`auto`，见 17.1 第 10 条）—— 开关不是旋钮。

### 17.1 结论与依据（逐条带状态档）

1. **真机实测（有局限）**：bili 的工具在子代理可见目录里是**裸名**（`compress` / `decompress` / `search_context` / `acp_status`，另加未纳入的 `acp_cache`），**没有 `mcp__` 前缀** ⇒ 它们能被 `toolFilter.allow` 引用。量法：在挂了 bili 的 profile `web` 的会话里用**通用 `subagent`** 派一个子代理，让它枚举自身可见/可调用工具 —— 回报 **34 个**，其中包含这 5 个裸名。
   **局限（不许读成 Adg 实测）**：这次探测走的是通用委派路径（其 session 头记 `agentPreset: "cordis"`，机制见 §16.4 第二条技术事实），**不是** `adg` 专家行 ⇒ "真实 Adg 专家重启后看得见、调得通"已登记为 §8 未观测。
2. **源码级事实（为什么 allow 是硬边界）**：`dsh-subagent/lib/types/child-agent.js:171-172` `if (composition.toolFilter !== undefined) childCtx.tools.restrict(composition.toolFilter);`；`dsh-tools/lib/types/index.js:488-511` `restrict(filter)` 拿 `this.view(scope).restrictableNames` 比对、**未知名直接抛** `names unknown global tool ...`，L541 把限制作用在 **INHERITED** 可见面上（L553-557 的注释解释了 preset 迁到 agent plane 后"子过滤器不再约束它拿到的东西"这一历史成因）；`dsh-subagent/lib/types/descriptor.js:46` `TOOL_FILTER_KEYS = new Set(['allow', 'deny'])`（两者至少要给一个）。⇒ 后果是**那一次委派当场失败**，不是挂载失败（红线 7）。
3. **源码级事实（为什么只能在 global 层解决）**：`dsh-base/lib/contracts.js:464-467`「A realm context has no session, no model plane, and no agent-facing tool plane」，preset 的工具面是 `@@ global @ preset` ⇒ **realm 里注册的工具永远进不了子代理的可见列表**。所以"给专家压缩能力"这件事必须靠一个注册在**全局层**的工具，bili 恰好如此（第 1 条）。
4. **源码级事实（"不给工具"这一侧的代价）**：bili `src/server.ts:3335-3336` `const shouldInject = opts.compress.injectTool && !isTitleGen;`、`server.ts:3427` `if (shouldInject) sysParts.push(buildCompressSystemPrompt(...))` —— **系统提示那一段没有工具可见性护栏**（护栏只在 `plugin.ts:627` 的 `toolNames` 与 `plugin.ts:959` `const allowed = [...PROXY_TOOL_NAMES]` 这类**注册面**上）。⇒ 专家会收到"该压缩了就调 `compress` / 先看 `acp_status`"的指令，**手里却没有这两个工具**。这是本次改动真正的动机，不是"锦上添花"。
5. **检验（生成物两种味道都验过，脚本已进仓库）**：`tools/check-bundle-flavor.mjs`，2026-09-28 本机输出：
   - plain 产物（`node tools/gen-preset-bundle.mjs bundle/adg-plain`）→ 9 个专家行全 `NONE`，allow 计数 `agent_file[10] agent_computer[7] agent_app[7] agent_browser[10] agent_search[2] agent_researcher[5] agent_coder[9] agent_reviewer[7] agent_general[16]`，`通过：9 个专家行，plain 模式断言成立`，**exit 0**。
   - bili 产物（`node tools/gen-preset-bundle.mjs --with-billion-context`）→ 全 `ALL`，计数 `14 / 11 / 11 / 14 / 6 / 9 / 13 / 11 / 20`（**每行正好 +4**），**exit 0**。
   - 交叉断言（钉"假绿"）：bili 产物按 `plain` 断 → 9 个 ERROR、exit 1；plain 产物按 `bili` 断 → 9 个 ERROR、exit 1。
   - 零回归证据：**不带旗标重跑生成物，去掉注释行后与改动前已装的稳定产物逐行相同**（非注释行 `278 = 278`、diff `0`）。整体 SHA256 从 `8DC3165CD3B439AFFA721D0126E2489A9768ED0CED401EF01BA81A61EEEC5F81`（1.1.0 的 plain）变成 `8FD4D6A5B0C9D64AF33E5E3A9A6B2C65EE506FEC37FBCB91834904A8B1F78289`（1.2.0 的 plain）：**13 行差异全是注释**（生成物头部的 flavor 说明 + 源文件注释块新增的 `auto` 段）**加上 `package.json` 的版本号** ⇒ 行、键、取值一个都没动，改的是说明文字。
   - **踩过的坑（登记，防重踩）**：专家行在**源文件**里缩进 4 列、在**产物**里 14 列（被整体推进 `config.plugins:` 下），写死任一个数字都会"一行都匹配不到却照样通过" ⇒ 判据必须**自己探测缩进**；另外排除 `agent-instructions` 那行靠的是"行内必须有 `toolName:`"。
6. **检验（源文件侧的护栏）**：`tools/check-preset.mjs` 新增 `BUILD_TIME_INJECTED_TOOLS`（那 4 个名字各带理由；`acp_cache` 单独注明"gen 的注入清单里没有这个"），源文件里手写它们 ⇒ **ERROR** 并指回 `--with-billion-context`。冒烟：在临时副本手写一行 `- compress` → `ERROR 第 496 行 agent-search …构建期注入的名字…`、exit 1。源文件本体：**0 错误 / 2 警告**（与改动前同一形状，两处仍是 `read_image`）。
7. **真机实测（判据在本机）**：`node tools/has-billion-context.mjs C:\Users\cenqian\.dsh\profiles web desktop headless` → `web<TAB>1`、`desktop<TAB>0`、`headless<TAB>0`。
8. **真机实测（落点形状，"生成物全机共用一份"的物理根据）**：`C:\Users\cenqian\.dsh\bundles\` 下是 `dsh-adg-preset` 与 `dsh-adg-token-budget` 两个稳定目录；`C:\Users\cenqian\.dsh\profiles\web\node_modules\dsh-adg-preset` 是 **SymbolicLink → `..\..\..\bundles\dsh-adg-preset`** ⇒ 换稳定目录内容即换"已装的 bundle"，不需要 pnpm；也正因各 profile 链接同一份，注入版会波及这台机器上**每一个**装它的 profile（`AGENTS.md` 红线 11 的 auto 口径由此而来）。**（该口径 2026-09-28 已被推翻：生成物现在分两种味道、两个稳定目录，按 profile 各拿一份 —— 见 §18。）**
9. **源码级事实（token-budget 让位为什么选"不选中 bundle"而不是塞 `enabled: false`）**：profile 层按 id 覆盖是**整块替换 `config`**（`plugin/dsh-adg-token-budget/cordis.patch.yml` 的注释 + §16.4 第 6 条），为关一个键要重写整份 config —— 与红线 3 同一个理由；而且 `enabled: false` 时 apply 只写一行 `activation: inactive (enabled: false)`，**行仍然挂着**，与"这个 profile 不启用该插件"在日志上不同形。所以实现是"从 `dsh.profile.bundles` 里移除 + 备份 `.bak-adg-token-budget`"。
10. **第二处交界：挂 bili 的 profile 要关掉 preset realm 里的自动压缩（本次新增）**，依据分四层：
    - **源码级事实（bili 官方就是这么做的）**：`C:\Users\cenqian\.dsh\profiles\web\node_modules\billion-context\dsh.bundle.patch.yml` 全文 10 行，`- insert: - id: bili-native / name: billion-context/dsh` 之后就是 `- id: compaction-basic` / `config:` / `  auto: false`（bili 0.1.165）⇒ 官方口径是**关掉自动压缩**，不是把整行 `disabled`。
    - **源码级事实（键存在，且语义就是"只留手动"）**：`@deepseek-ai/dsh-compaction-basic` 的 `lib/index.js:62` `if (config.auto !== void 0 && typeof config.auto !== "boolean") throw new Error("BasicCompactionConfig: auto must be a boolean")`；`:85` `auto: config.auto ?? true`；`:817` zod `auto: z.boolean()`；`:827` `if (this.config.auto) this._registerAutomaticCompaction()`；该包 `README.md:76` 表格 `| auto | true | Enable automatic condensation and overflow recovery; set false for manual-only operation. |` ⇒ `auto: false` = 关自动折叠与溢出恢复，**手动 `/compact` 仍可用**（`command-compact` 那行不动）。
    - **设计依据（为什么写在 preset 自己的组里，而不是依赖 profile 层那份）**：本 preset 的 `compaction-basic` / `command-compact` / `tool-result-pruner` 三行活在 `isolate: {compaction: true, toolResultPruner: true}` 的 **realm** 里、是**另一份实例**；bili 的补丁打在 **profile 层**，"同 id 能不能命中 realm 那行"从未被观测（原 §17.2 ③）⇒ 生成物直接往 preset 的 `compaction` 组里写**同键同值**：两边都生效也无行为差异（幂等），而只注入名字、不关自动压缩的后果是两套折叠各自抢阈值、压同一段历史。
    - **检验**：`tools/check-bundle-flavor.mjs` 现在**一次断言两件事** —— plain 产物 9 行全 `NONE` + `compaction-basic[auto=未写]`（exit 0）；bili 产物 9 行全 `ALL` + `compaction-basic[auto=false]`（exit 0）；两个方向交叉断言各 exit 1（各报 **10** 个 ERROR，其中一条正是 `auto` 的方向错）。**源文件侧反向守卫**：往 `preset/agent.cordis.yml` 的 `compaction-basic` 行临时手写 `config: {auto: false}` ⇒ `check-preset.mjs` **exit 1**，逐字报 `ERROR 第 322 行 compaction-basic：config.auto = false 是构建期注入的键——不要写进源文件（没挂 bili 的 profile 会因此失去唯一的自动压缩），用 node tools/gen-preset-bundle.mjs --with-billion-context 生成`；同一状态下 `gen-preset-bundle.mjs --with-billion-context` 也 **exit 1**（`… 的 compaction-basic 行已经有 \`config:\` —— \`auto: false\` 只允许由本脚本注入`），不会叠加出第二份 `config`。还原后两者都回到 exit 0。
    - **踩过的坑（登记，防重踩）**：`auto` 本来就在该插件的 `spec.allowedKeys` 里 ⇒ "未知键"那条检查**拦不住手写**，必须单加一条"这个键只许出现在产物里"的规则，否则有人手写 `false` 就会让没挂 bili 的 profile 静默失去唯一的压缩手段（那才是真正的洞）。零回归仍以第 5 条的 SHA256 为准。

### 17.2 未观测（已照 §8 登记，引用本节时不许抹平）

① 重启后**真实 `adg` 专家行**看得见、调得通那四个工具（第 1 条只覆盖通用委派路径）；② 从清单移除 `dsh-adg-token-budget` 后**冷启动无副作用**；③ **profile 层的 `- id: compaction-basic` / `config: {auto: false}` 到底有没有落到 realm 里那份实例**（第 10 条已不再依赖它 —— 生成物把同键同值写进 preset 组，但"官方那份能不能跨 lane 命中"仍未量，所以"两处都生效"这件事本身也未被观测）；④ **注入进产物的 `auto: false` 在真实 Adg 会话里确实关掉了原生自动折叠**（产物断言只证明键写对了，不证明运行期行为；第 10 条的量法：转写里找 `compress` 工具调用之外的自动折叠痕迹，与 bili 的 `/acp-cache` 台账对齐）。四条的量法都写在 §8 对应行里。

**§17.2 ① 的负向观测（2026-09-28 补）**：真机 `web`（当时链接的是 plain 落点）里，**真实 `adg` 专家子代理**调用 `compress` 得到 `unknown tool compress` ⇒"可见性由 `allow` 决定"这一半在真实专家行上被观测到；正向（换成注入版后专家看得见、调得通）仍**未观测**，见 §18。

## §18 生成物按 profile 分两种味道（2026-09-28：真机缺陷与修法）

**症状（真机实测，用户报告）**：挂着 bili 的 `web` profile 里，真实 Adg 专家子代理调用 `compress` 得到 `unknown tool compress`（子代理原话："The compress tool is not present in my available toolset (an earlier call returned "unknown tool compress")"）；同一次会话里调度者自己看得见这些工具（它是全局层）。

**根因（源码级事实 + 真机实测）**：
1. 注入与否原本**全机一票**：`install.ps1:88` 原文 `default { $useBiliTools = ($biliOnProfiles.Count -gt 0 -and $biliOffProfiles.Count -eq 0) }`，配上"生成物全机共用一份"（§17.1 第 8 条）⇒ 只要有一个目标 profile 没挂 bili，**所有** profile 都拿 plain。
2. 真机实测：`C:\Users\cenqian\.dsh\profiles\desktop\node_modules\dsh-adg-preset` 与 `C:\Users\cenqian\.dsh\profiles\web\node_modules\dsh-adg-preset` 当时都是指向 `..\..\..\bundles\dsh-adg-preset` 的 reparse point，而那份产物里 `- name: compress` 出现 **0** 次 ⇒ `web` 的 9 个专家行 `allow` 里一个 bili 工具都没有（`web` 挂着 bili、`desktop` 没挂 —— 探测 `web<TAB>1` / `desktop<TAB>0`，见 §17.1 第 7 条）。
3. "有专家行缺 `allow`"的假设**不成立**：`preset/agent.cordis.yml` 里 9 个专家行全部带 `toolFilter.allow`（id 行 / allow 行：agent-file 416/431、agent-computer 443/456、agent-app 466/479、agent-browser 489/521、agent-search 533/547、agent-researcher 553/568、agent-coder 575/589、agent-reviewer 600/614、agent-general 635/650），当时的 `node tools/check-preset.mjs` 也是 **0 错误 / 2 警告**（两处 `read_image` 条件注册，与本次无关）。缺陷在"装到 profile 里的那一份"，不在源文件。

**修法（已进仓库）**：生成物分**两种味道、两个稳定目录**，两份 `package.json` 逐字节相同、**包名都是 `dsh-adg-preset`**（所以 `dsh.profile.bundles` 那一行两种味道通用）：
- `$DSH_HOME/bundles/dsh-adg-preset` = plain（沿用旧路径）
- `$DSH_HOME/bundles/dsh-adg-preset-bili` = 注入版

`install.*` 的 `auto` 改为**逐个 profile** 用同一条探测判据决定它拿哪一份（`on` / `off` 只做整体覆盖，覆盖与探测不一致时打黄字警告）；新增第 4b-1 步用 `tools/check-bundle-flavor.mjs` 断言**该 profile 实际链接到的那一份**的味道（判据不能是"包在不在"——两份 `package.json` 相同），不一致即 exit 2。

**检验（临时 `DSH_HOME` 端到端四轮，不动真机）**：临时根 `D:\dsh\.adg-scratch\home` 造出与真机同形的混装（`web` 的 `dsh.profile.bundles` 含 `billion-context` 且装了 `dsh.bundle.patch.yml` ⇒ 探测 `web=1` / `desktop=0`；两个 profile 的 `node_modules` 用 junction 指向稳定目录），跑 `install.ps1 -SkipPackages`：
- 无 `node_modules` 时：exit 2，两份味道都生成并落到两个稳定目录（plain **85794** 字节 / bili **87818** 字节，各 18 个顶层条目）—— 4b 的 `continue`（包不在 `node_modules`）在 4b-1 之前，那一轮没跑味道断言。
- junction 就位（`desktop`→plain、`web`→bili）：exit **0**，输出 `已挂载 [web] / 未挂载 [desktop]`、`味道 -> desktop : plain`、`味道 -> web : bili`、两行 `落点味道 = plain|bili（tools\check-bundle-flavor.mjs 通过）`；4c 把 `dsh-adg-token-budget` 从 `web` 的 `dsh.profile.bundles` 移除（备份 `package.json.bak-adg-token-budget`）、`desktop` 保留。
- 再跑一次：同结果 exit 0（幂等）。
- **故意把 `web` 的 junction 改指 plain**（模拟"换味道那一步没成功"）：exit **2**，note `落点味道 ≠ bili —— 链接到的还是另一种味道…`，并原样打印报告（`agent_file[10]=NONE` … `compaction-basic[auto=未写]` + 10 个 `ERROR …bili 模式期望四个名字全有，实际 一个都没有` + `不通过：10 个错误（bili 模式 / 10 个专家行）`）⇒ 这个断言**不会假绿**。

**踩过的坑（登记，防重踩）**：安装脚本里**不能**用 `@(& node ...)` 捕获原生命令的 stdout —— 在 DSH 沙箱（workspace-write）的 pwsh 里它拿回**空串**、`$LASTEXITCODE` 还停在上一条命令的值（管道形式直接 `Program 'node.exe' failed to run: Access is denied` + `NativeCommandFailed`）。后果是探测静默变成"全都没挂 bili"、味道断言**假装通过**。两处（第 0 节探测、4b-1）都改成 `cmd /c "node ... > <log> 2>&1"` + 读文件 + **显式检查退出码与结果文件存在**。

**未观测**：① 真机 `web` 换到注入版、重启后**真实 `adg` 专家**看得见并调通 `compress` / `acp_status`（§17.2 ① 仍未闭合；本次只多了"plain 落点下专家确实报 `unknown tool`"这一负向观测）；② 同一个 dsh 进程里两个 profile 各拿各的味道（不同 profile 的会话并存）**冷启动无副作用**；③ `install.ps1` 的 4b-1 在**真机**上换味道成功那一次是否也通过（本次只在临时根里量过）。

## 19. 子代理还在跑时，"复用"会变成插话：`send_message` 恒为 steer（源码级事实，2026-09-29）

**用户报告（本次改动的来源，m00002）**：Adg 多智能体模式下子代理默认后台非阻塞、调度者随时可能收到用户的**新提问**；而 persona 规则 7 要求"同一实体的后续任务优先接给已经读过它的那个专家"⇒ 调度者会向**正在工作**的子代理再发一条消息，把新输入**插进它当前的任务**。用户的问题是：怎么让调度者知道**何时该插话、何时该新开一个**，或者论证该不该保留原规则。

**机制（源码级事实，逐条带出处；本次**没有**真机 A/B）**：
1. 模型侧 `send_message` 的能力只有一条通路：`@deepseek-ai/dsh-tool-subagent-control` 的 execute 调 `ctx.subagents.sendMessage(...)`（`lib/index.js:51-59`），**没有 delivery / queue 参数**。
2. 被调方固定用 steer：`@deepseek-ai/dsh-subagent` 的 `sendMessage()` 走 `deliverToChild(..., { delivery: "steer" })`（`lib/index.js:1762-1775`）。queue 只在宿主级 `queuePrompt`（同包 `lib/index.js:1785-1791`），模型侧拿不到。
3. 两种投递落点不同：steer → `agent.steer()` → `inbox.nextStep`（插进**当前轮的下一步**）；queue → `agent.followup()` → `inbox.nextTurn`（同包 `lib/types/inbox.js:37-45`）。对 `inactive` 的子代理，因为没有当前轮，steer 退化为开新轮（idleSteer）—— 这正是规则 7 想复用的那条路。
4. `list_agents` 只有两态、**不含进度**：渲染 `${id} [${status}] — ${label}`（`@deepseek-ai/dsh-tool-subagent-control\lib\types\list-agents.js:18-20, 102-104`）；工具 description 明写子代理结束时会**通知**你、不必轮询。
5. 结算通知是**唤醒型**投递：`@deepseek-ai/dsh-subagent\lib\index.js:1264` 的 `notifySettlement` → `sendWaking(parent, message, parent.status === "idle" ? "queue" : "steer")`。
6. `interrupt_agent` 只停当前轮，已排队的消息保持暂停直到之后再 `send_message`（同包 README `:53`）。

**为什么原规则会滑到这里**：规则 7 的复用前提是**隐式**的（原文只说"（空闲的、以及已结束但可恢复的都能接）"），**没有一句"正在工作的别用它"**；而 `send_message` 的工具描述（"A working agent receives it at its next step"）读起来无害，所以模型把"复用同一位专家"执行成了"向运行中的它发消息"。后果不只是多一条消息：新问题与原任务的收尾会合并进**同一条 closing message**，而结算通知带的正是这段合并文本，事后分不清哪半句答的是哪件事；正在做验证的那一轮还可能被带偏原验收标准。

**修法（已进仓库，**提示级**）**：`preset/agent.cordis.yml` 规则 7 补 `status` 判据 + `running` 三分支 —— `inactive` 照旧 `send_message`（steer 退化为开新轮，沿用已持久化会话）；`running` 时按**语义关系**三选一：①修正／补充**同一件事**（同一验收标准、同一交付物）→ **现在就发**（steer 的本用）；②同一实体上的**另一件事**（另一条验收标准／另一个交付物）→ **不要插进去**，结束本轮、等**结算通知**把你唤起重接给**同一个它**；③**取代在飞任务** → 先 `interrupt_agent` 再发。判据只能是语义关系，**不能**是"它快做完了"（`list_agents` 无进度）。同步位置：`preset/design.md` I13 ②、`preset/testing-guide.md` I13 N1 / N3 / **N10 / N11**、根 `README.md`（兼容段 + 手段表新增一行 + 未观测段 + "实质改动十四处" + persona 清单），以及 `agent.cordis.yml` 顶注**新增第 14 条**。代价：`prefix` 正文（不含换行）**7219 → 7736**（+517 字符）。
**不做硬拦**（理由记在 `agent.cordis.yml` 顶注「刻意**没有**做的事」）：框架没有"只允许后台"那种开关，硬拦只能加 preset 侧 `tools/pre-execute` 拦截器，而它**分不清"修正"与"另一件事"**——分支 ① 的 steer 是正当且更省的；还会引入"模型撞硬错误后重试或放弃"的新失败模式。升级方向是**只提醒、不阻断**（对齐红线 9）。

**未观测（已照 §8 登记）**：真实 Adg 会话里调度者是否照做 —— 即子代理 `running` 期间用户提出"同一实体上的另一件事"时，它会不会仍 steer 进去。量法见 `preset/testing-guide.md` I13 N11（N10 是人工 review 那半）。本节全部结论都是**源码级事实 + 用户报告**，**没有**真机 A/B，引用时不许写成"已验证行为"。

## 20. 派发拓扑：按"实体 × 性质"决定复用还是拆分（规格级判据，2026-09-29）

**来源（本次改动的起点）**：用户要求 —— 现在调度规则默认"同一实体就复用同一个子代理"，而子代理的输出 token 会到上限、几轮再派就容易满；要改成**按任务性质决定**用"复用同一个"还是"拆给不同个"。用户举了两个例子：① 调研 3 款手表是否有某功能（怕不同款上下文混在一起产生幻觉，且要求**严格定义执行边界**，不许子代理调研着就跑去调研别款）；② 阅读大型文档库回答多个问题（要么一个子代理通读并在临时目录建**文档索引**供后续复用、"文档变了要更新索引"，要么一个子代理专职回答、到上限再让新的重建上下文接续）。用户的结论是：**两个例子本质上按"是否要重复读某些实体"划分。**

**采纳并细化的判据（规格，不是实测）**：判据仍是**实体 × 性质**两维度；实体锚点 = 委派最终服务的那条需求 / 对象（不是检索路上碰到的材料）。用户那句"是否要重复读同一批材料"是本判据的**直接推论**：不重复读 → 拆开更省（各自只付自己那份读取）；要重复读 → 复用同一个它更省（省掉重读与重建），但**复用不是免费的**：被恢复的子代理沿用已持久化会话，省的是重读与步数，既有上下文仍会在余下每一步作为 cache-read 重计（§2 实测 cache-read 占提示 token **91%**）。

- **规则 6 补的第一半（异实体按实体拆 + 边界写死）**：实体不同就按实体拆，一条委派只服务一个实体。原规则只说了"同实体同性质要合并"（收的充分条件），异实体该不该拆、拆了怎么防跑偏**都没写** —— 本次补上**边界三件套**：目标里点名**唯一一个**实体；验收标准写成"只就它作答"；**本次不做**列出相邻实体并加一句「若必须拿到别的实体的数据才能作答就**停手**、作为未决问题报回来，**不要**自行扩面」。理由：不同实体混进同一个子代理，汇总时最容易张冠李戴；一个委派只服务一个实体，调度者才能按同一组方面逐条比对。
- **规则 6 补的第二半（共同结论层工件）**：当同一批结论要被多条委派共读（大型文档库 / 索引 / 公共契约），先让**一个**专家把结论层做成**可复用工件**（`path:line` 清单 / 索引，按 I14 只落平台临时根）或接进委派 prompt，后续委派只读工件与它需要的切片；**源材料变了先刷新工件**（冲突以源材料为准）。这就是用户例 2 的 A 解，且它比"一个专家专职回答"（B 解）更能绕开"单个子代理的上下文上限"。
- **规则 7 补的转向理由**：是否要重复读同一批材料 —— 要 → 接给已读过它的那个它（原规则）；不要 → 另开新专家、委派里带**交接摘要**（一条结论 + 证据位置 + 未决项，不是原文）；并把"**该停的时候**"写清：在飞任务已在同一件材料上走了很多步、或它这一轮被截断且整体上下文已厚 ⇒ 停掉它、按规则 5 另开并带交接摘要。
- **聚合成本一侧（不可忽略）**：拆分省的是子代理侧的重读，代价是**调度者**要读 N 份结论 —— 而实测调度者占账单 **59%**（§2）。所以观测口径要从"子代理个数"扩成"**子代理个数 + 调度者上下文增量**"（已记进 §8 那条未观测行）。

**未观测**：真实 Adg 会话里调度者是否真的按实体拆分、边界三件套是否写进委派、共同结论层工件是否真的复用（而不是每条委派各自全量重读）。量法见 `preset/testing-guide.md` 的 N1 / N2 / N3，观测量见 §8 那一行。**本节全部结论都是规格级判据 + 用户报告，不是真机实测**。

## 21. 输出上限截断：`max-tokens` 是正常结局，且本机已量到 6 条（源码级事实 + 只读扫描，2026-09-29）

**本机上限**：`web` profile 的 `agent-default-model` 走 `llm-pi-ai` provider `ali`（`C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml`，该 provider 段**没有** `maxTokens` / `defaultMaxTokens`）⇒ 落到适配器默认 **`DEFAULT_MAX_TOKENS = 32768`**（`@deepseek-ai/dsh-llm-pi-ai\lib\index.js:925`；`web` profile 段落无覆盖）。**这与上下文窗口（该适配器默认 `262144`）是两件事** —— 前者是单条回复的输出上限，后者是累积上下文；两类"满"要分开治理。DeepSeek 原生适配器才是 `256e3` / `1e6`（`@deepseek-ai/dsh-llm-deepseek\lib\index.js:430-431`）。**诚实边界**：`dsh-llm-pi-ai\lib\index.js:2249` 的 `capacity(...)` 若被模型目录（models.dev）抬高过就不同，该目录不在本地，**无法离线确证**。

**截断是什么**：provider 把 API 结束原因映射成规范结局 `{kind:"max-tokens"}`（`dsh-llm-deepseek\lib\index.js:1901` / `dsh-llm-pi-ai\lib\index.js:1418`），agent 循环据此**正常 return** —— `dsh-agent-loop\lib\index.js:1129-1135` 先把这一轮的 `assistant/message` 落进会话，紧接 `:1136` `if (finish.kind === "max-tokens") return { kind: "max-tokens" };`（在 tool-call 执行之前）。所以：不是超时、不是错误、**不走** `agent/request-error`（`dsh-agent-loop\lib\index.js:1103` 的重试分支只看 `error` / `aborted`）⇒ **框架没有内建重试**。副作用：`dsh-llm\lib\index.js:1053` 在 max-tokens 时 `kept = all.map((block) => block.type !== "tool-call")` ⇒ **未完成的 tool-call 块被整体丢弃**（丢的是工具调用意图，不是已写出的文本）。`turn/end` 记为 max-tokens 且不被后续 step 覆盖（`dsh-agent-loop\lib\index.js:975`）。用户看到的是客户端**合成**提示（`dsh-client-ui-chat\lib\client.js:1318-1333`、`:7123`、`:9847`），**没有**"一键继续"按钮或命令；模型上下文里**没有**"本轮还剩多少额度"的字段。`dsh-goal-round-driver\lib\index.js:261-265` 撞上限时反而 `disarm(state)`（关掉自动轮次，方向与"自动续写"相反）。

**只读扫描（本机 285 个会话档案，2026-09-29）**：`turn/end` 的 `reason.kind` 分布 = `completed` 385 / `aborted` 36 / **`max-tokens` 6** / `error` 5 / `interrupted` 2。**6 条全部落在被委派的子代理会话里**（会话头逐条 `agentPreset:"adg"` + `origin:"subagent"` + `delegationDepth:1`；4 条 v4、2 条 v3；cwd `D:\dsh` ×4、`D:\yxgit` ×2）。逐条（文件 / 记录索引 / `seq` / `turn` / 截断前最后一条 assistant 的 `step` 与字符数）：

| # | 会话文件 | 位置 | seq / turn | 截断前最后一条 |
|---|---|---|---|---|
| 1 | `sessions\--D-dsh--\a3c3df04-3ce8-440c-a345-974f75b086c5\session.v4.jsonl.zstd` | 202 / 203 | 201 / 1 | `step=19` 3398 字符（停在关于 compress 的规划里） |
| 2 | `sessions\--D-dsh--\b159f20a-5610-4bb4-b8c8-4d268416de41\session.v3.jsonl.zstd` | 149 / 150 | 148 / 1 | `step=20` 341 字符 |
| 3 | `sessions\--D-dsh--\b5f9d598-a38e-418e-8fbf-72e8cde60fae\session.v3.jsonl.zstd` | 118 / 119 | 117 / 1 | `step=12` **51233 字符**（长文断在"…审计页的查询分类不代替"半句上） |
| 4 | `sessions\--D-dsh--\eea0745c-4bd2-4963-9244-1d0ce335669b\session.v3.jsonl.zstd` | 90 / 91 | 89 / 1 | `step=8` 1423 字符（思考里写着"现在开始分段编写，目标是生成一份 1000+ 行的高质量设计文档"） |
| 5 | `sessions\--D-yxgit--\13b117ad-36da-4db2-993a-fb740840fb69\session.v4.jsonl.zstd` | 966 / 967 | 965 / 3 | `step=38` 653 字符 |
| 6 | `sessions\--D-yxgit--\d403ed62-b2f2-45f5-94d3-20cb950a694e\session.v4.jsonl.zstd` | 883 / 884 | 882 / 12 | `step=5` 2358 字符 |

形状一致：`{"type":"turn/end","seq":N,"time":<epoch ms>,"data":{"turn":T,"reason":{"kind":"max-tokens"}}}`。**这 6 个会话在截断之后记录数为 0**（`assistant/message` 0、`user/message` 0、`agent/inbox/spliced` 0；也没有 `assistant/attempt`、没有 `plugin:dsh-adg-token-budget` 消息）⇒ **"截断后就地续跑同一个子代理"在本机完全没有先例**，所以它只能写成**调度者的动作**（规则 7），不能指望运行时会接。**不可推断的部分**：不能据此断言"用户 / 调度者从未续写"（续写若发生在别处就不在这 6 个档案里）；v3 与 v4 的 header 字段差异未逐字段比对。

**读档案的坑（下次别再踩）**：`session.v*.jsonl.zstd` 是**多帧 zstd 拼接**，不是"一个压缩块"（例：某 v4 档案 574248 字节含 **155 个 zstd 帧**；`zlib.zstdDecompressSync(整个文件)` 只解出 259 字节的头部 `{"type":"session","version":4,…}`），**必须先按 magic `28 b5 2f fd` 切帧、逐帧解压再拼接**；**本机不需要外部 zstd** —— Node v26 的 `node:zlib` 自带 `zstdDecompressSync`（285 个档案全部解压成功、0 失败）。同一坑 §8 与 §15.5 各记过一次。

**对规则的意味（已落进 `preset/agent.cordis.yml`）**：① 大产出要在委派 prompt 里要求**分段交付**（规则 5 的期望产出），这是**交付形态**要求、不是产出量上限；② 子代理被截断时由调度者 `send_message` 接给**同一个它**、请它从断点续写（规则 7）—— 截断不改变可续性（`dsh-subagent\lib\index.js:1076` 的 `resume({ resumeSessionId: childId })`），同一 child session 可直接续跑；③ 工具返回会把子代理保留的部分答案附在错误里（`dsh-tool-subagent\lib\index.js:292` 的 `"subagent run hit its token limit before finishing"` + `:297-305` 的 `withDiagnosticAndPartialText`）⇒ 正确口径是"**先消费部分产出，再决定续跑还是换人**"，不要重派让它从头来。规则 10 ⑤ 只写**预防**（"输出上限不可预测 → 大产出分段交付"），**恢复动作归规则 7**。

**未观测（已照 §8 登记）**：调度者是否真的去接、接住之后产出是否完整（6 条截断里一条都没续写过）；本机 `maxTokens` 是否被模型目录抬高（离线无法确证）。
