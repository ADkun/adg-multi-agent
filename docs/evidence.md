---
title: 实测证据台账
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
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
| 活行 | `C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml` | 当前插件挂载行（`enabled: true` + `dryRun: false`，另带 5 个惰性旧键，见下） |
| 子代理转写 | `C:\Users\cenqian\.dsh\sessions\…\session.v3.jsonl.zstd` | 注入消息的原文与子代理的回应，与日志行毫秒级对齐 |
| 审计脚本 | `D:\dsh\.dsh-token-audit\audit-run.mjs`（成本）/ `audit-steps.mjs`（步数分布） | 从会话目录重算；报告写到同目录的 `audit-report.txt` / `audit-report.steps.txt`。`audit-steps.mjs` 打印 `children=… min=… p10=… p25=… p50=… p75=… p90=… max=… mean=…`、排序表、直方图，以及"每个候选 tier 会命中谁" |
| 变异验证 | `D:\dsh\.adg-step-mutations\run-mutations.ps1` | 每个变异一个独立目录，跑完把原始 `node --test` 输出留在旁边。**不属于任何交付包** |
| 沙箱探测（§11） | `D:\dsh\_archive\2026-09-26-sandbox-probes\probe1.js` / `probe2.js`（输出 `probe1.log` / `probe2.log`，外加按变体命名的 `<变体>.out.txt` / `<变体>.err.txt`，如 `edge-dumpdom.err.txt`） | 在受限会话里逐条探测管道 stdio 与浏览器启动。**不属于任何交付包** |
| 人工介入探测（§12） | `D:\dsh\_archive\2026-09-26-sandbox-probes\probe3-launch.js`（分离启动有头浏览器）/ `probe3-attach.js`（另一次调用重连它）/ `probe4-cookie.js`（cookie 是否落盘） | 验证「用户手动登录后专家接着用」的**机制**：窗口存活 + 跨调用 CDP 重连。**不属于任何交付包** |
| 静态自检 | `node tools/check-preset.mjs` | 见 `tools/testing-guide.md` |

## 1. 步数分布与阶梯校准（真机实测）

来源：`audit-steps.mjs` 跑同一份会话目录，37 个受委派的 `adg` 会话。
分布（`README.md`「第二层」的行文是 `min 1 / p10 6 / p25 14 / 中位数 39 / 平均 51.7 / p75 61 / p90 103 / max 329`，脚本按 `p50` 打印中位数）：
`min 1 / p10 6 / p25 14 / p50 39 / p75 61 / p90 103 / max 329 / mean 51.7`。
校准结论：阶梯锚在**分布**而不是均值（按均值放，第一个检查点会在四分之一人口已经结束后才问）。

| 阶梯 | 覆盖到 | 注入条数 | 首次检查点之后的步数占比 | 最后一个 tier 之后的步数 |
|---|---|---|---|---|
| `[12, 24, 40]` | 30/37 | 71 | 79.5% | 872 |
| `[4, 8, …, 280]`（当前默认） | 34/37 | 214 | 92.6% | 49 |

成本：全部 214 条消息约 **0.5M token 等量**，对比同一批子代理约 205M ≈ **0.25%**。
（每条约 180 字符，且会随之后每一步重发——这是"一步最多注入一条"的原因。）

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

活行里仍带着 `budgetTokens: 1000000000000000`、`softRatio: 1`、`cacheReadWeight: 1`、
`softNudge: true`、`hardDryRun: true`。这**不是配置意图**：重启前进程里跑的可能还是旧代码，
少了 `hardDryRun` 旧代码会按默认值把已删除的硬档**真武装**；把 `budgetTokens` 抬到 10^15 且 `softRatio: 1` 让旧软档也永不触发。
新代码对这五个键**静默忽略**，重启加载新代码后可以整段删掉。

## 8. 未观测清单（引用本仓库任何结论前先看这里）

| 事项 | 状态 |
|---|---|
| **更密的阶梯 + 选择式措辞到底有没有用**（收到检查点的子代理是否更早收敛） | **未观测，而且这是本功能的核心问题。** 量法：`audit-steps.mjs` 前后各跑一次，**比分位数，不比均值**。注意 §9 只量到"注入确实发生"，**证不了效果** |
| 提醒是否改变子代理行为（作为**效果**） | **仍然未观测**：只有个例（3 例、3 个不同任务）证明"消息被读到并当成决策输入"，不足以证明"让它更快收敛"。§9 量到的是**注入条数与分布**，不是效果——两件事不要混读 |
| 校准期（`dryRun: true`）在本机的 `dry-run step stage` 行 | 本机是从"没有这个 stage"直接到"已武装"，**从未停留在校准态**；`dry-run step stage` 命中 0 行（§9 复核仍为 0） |
| 包被替换后，**改名目录 / 先删行再加行**能不能强制重新 import | 未尝试。安全结论就是"重启" |
| 第一个 tier 之外的档（新阶梯下的注入） | **§9 复核：已被观测**（tier 1/14–11/14 都真的注入过）——下表既有文档记为"未观测"的说法已过期，处置权在人类 |
| 恢复的子代理被再次提醒 | **仍未观测（原记载成立）**：§9 观测到的是**驻留期重置机制**在跑（同一 `label` 在 `settled:` 后从 tier 1/14 重新计数）；**"该子代理确实是被恢复的"无从判定**（`subagent/end` 对"结束"与"被恢复"发同一事件） |
| **注入消息在会话转写里的原文**（`session.v3.jsonl.zstd`，§1/§6 引用的"毫秒级对齐"） | **本台账未独立复核**：本机没有 zstd 解压能力。日志侧的行存在是确认的；转写侧需要一台能解压的机器按 §9 的 `label` 比对 |
| **调度者的权限闸门是否真的每次都触发**（派发 `agent_browser` 前是否先问用户） | **未观测**：闸门于 2026-09-26 落地，还没有一次真实 Adg 会话走过它。量法：Adg 会话转写里查 `ask_user_question` 的调用是否出现在 `agent_browser` 之前，以及本会话文件策略那一行当时是不是 `danger-full-access` |
| **在沙箱外手工拉起浏览器、专家只连 CDP 端口** | **未实测**：`workspace-write` 下网络不受限、受限进程自建监听与本地 `fetch` 都通（§11），所以**设计上可能可行**；但没有人真的做过，不许写成可行。量法：用户在自己的（非沙箱）终端里起一个 `--remote-debugging-port=…` 的浏览器，再让 Adg 会话里的专家只调用 CDP HTTP/WebSocket |
| **真实站点的登录／验证码端到端流程**（用户手动登录 → 专家接着抓登录后的内容） | **未观测**：§12 只验了**机制**（有头窗口跨工具调用存活 + 新进程 CDP 重连并继续驱动），没有一次真的走完「人工登录 → 继续」。量法：按 §12 的 `probe3-*` 起实例，请人在窗口里登录一个真实站点，再由另一个进程重连并断言登录后的页面元素存在 |
| **关掉浏览器之后再靠 profile 复用登录态** | **未观测**：§12 的 `probe4-cookie.js` 往 profile 写了 cookie，live store 立即可见，但 30 秒内磁盘上没有 cookie 库（Chrome 惰性刷盘）。量法：同一 profile 优雅关掉浏览器后再启动，看 `Network.getCookies` 还在不在 |
| **调度者是否真的每次都转达人工介入**（收到「需要用户介入」报告后是否真的先问用户） | **未观测**：与上面那条闸门同源 —— 提示级协议，没有真实 Adg 会话走过它。量法：Adg 转写里 `agent_browser` 返回「需要用户介入」之后，紧跟的应当是一次 `ask_user_question`，而不是第二次同路径派发 |
| **五条编排层规则是否真的被遵守**（同实体合并 / 优先恢复既有专家 / 先定位再改 / digest 中转 / 必要性闸门） | **未观测**：五条规则于 2026-09-26 落地，尚无真实 Adg 会话带着它们跑过（`preset/testing-guide.md` 的 N3 / N5 / N7 同此结论）。四个观测量：① **子代理个数**（主指标 —— "同一份材料买 N 次"的乘数就是它）② 子代理步数 **p50 / p90**（**比分位数不比均值**：已实测中位数 39 步、p10 仅 6、四分之一 ≤14 步，分布很偏）③ 审计脚本按 preset 分组的 `requests`（同口径重跑同一批会话，不许拿单次绝对值比）④ **挂号抽查**（人工，见下一行） |
| **旁路是否被"记录而非被做"**（必要性闸门 + 强制挂号） | **未观测**。**来源（这是这条规则的依据，不是结论）**：一次真实任务的旁路委派 —— 用户要"便携小巧的录音笔"，调度者为"录音合规性"单独开了一个子代理，而那次调研只服务同一条选购需求（同实体同性质）、且不在验收标准里。判据：抽 3–5 个含旁路诱因的任务，最终答复里**有**挂号句「未纳入本次：X（可能影响 Y，未调研）」且转录里**没有**对应委派 = 遵守；挂号句缺失 = 旁路被**静默丢掉**（省了 token 却让用户不知道有东西没查，比不做这条规则更糟）；出现委派 = 闸门未生效 |

## 9. 活证据复核快照（2026-09-25T13:46:37Z / 21:46:37+08:00）

**快照指纹（第三方据以判断"是快照不同还是口径不同"的唯一依据）**：
`sha256 = 796f30c4df270e905dbdd514df186520a321f7f538be8fa6c79ecf0c85e5a660`、`129,579 字节`、`1025 行`、`mtime 2026-09-25T21:46:37+08:00`。
下表每个数字都对应这一份指纹；**引用时必须同时给时间戳与哈希**，否则无法与别人的读数对齐。

抽取方式：对 `C:\Users\cenqian\.dsh\adg-token-budget.log` 做**逐行文本匹配**（`Get-Content` + `-match`，不做管道分组；管道分组在本沙箱里会被拒，且用错分组口径会数出错误结果）。
**该文件仍在被追加，下面每个数字都是某一刻的下界，不是常量。**

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
