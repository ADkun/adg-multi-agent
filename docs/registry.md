---
title: 文档索引
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
---

# 文档索引

本页**只有索引**：哪篇文档回答什么问题、什么场景读它、哪些还只是计划路径。正文一律在别处；写作规范与分层契约见 `docs/docs-guide.md`。

**为什么不建 `docs/_index.md`（写清理由，别当成漏建）**：规范是"`docs/` 目录下文档 ≤ 5 篇时不建 `_index.md`"，本目录当前 4 篇（`docs/docs-guide.md`、`docs/registry.md`、`docs/evidence.md`、`docs/changelog.md`）——**不建是正确的，不是遗漏**。**本页就是 `docs/` 的索引页**，再加一层索引只会多一份要同步的副本。

## 1. 索引表

| 文档路径 | 它回答什么问题 | 什么场景读它 |
|---|---|---|
| `AGENTS.md`（仓库根） | 这个仓库是什么、命令有哪些、关键红线、模块地图、按改动选读的路由、验收门禁 | 任何改动的**第一份**；不确定改东西前该读什么时 |
| `README.md` | 人向手册：怎么装、八个专家的分工与缺口、成本口径的由来、插件怎么开与怎么确认、全部实测数字 | 要理解某个设计为什么这样定、要引用任何实测数字时 |
| `skills/adg-add-agent/SKILL.md` | 增删一个专家智能体的硬约束与落盘要求（字段含义、名册同步、`allow` 的真实语义、改完跑什么） | 要新增/修改/删除专家时（`preset/design.md` 在其后） |
| `tools/AGENTS.md` | `tools/` 的独立命令、三个退出码、模块特有红线、跨模块路由、能力边界 | 要跑静态自检、或改 `check-preset.mjs` 之前 |
| `tools/design.md` | 校验器作为对象的设计：职责与不负责清单、依赖、三个数据模型与 I1..I9、CLI 契约、非功能红线 | 要改判错口径、要把它的结论写进别的文档之前 |
| `tools/testing-guide.md` | I1..I9 的用例、两个状态机的迁移矩阵、三条跨模块消费侧契约、它**故意不做**的检查清单 | 改校验器后要跑什么、或要判断"某个坏配置它能不能挡住"时 |
| `preset/AGENTS.md` | `preset/` 的独立命令、模块特有红线、跨模块路由、生效方式；开头写明"为什么本模块需要独立文档" | 要增删专家、或改调度 persona 的名册与分派规则之前 |
| `preset/design.md` | preset 作为对象的设计：`PresetRevision`（生命周期型）/ `ExpertRow` / `SchedulerPersona` 三个对象与不变量、专家行与调度名册的双向约束、体积旋钮三行的口径 | 要改专家行字段、`allow` 名单或旋钮口径时 |
| `preset/testing-guide.md` | preset 侧不变量→用例全表、`PresetRevision` 迁移矩阵全表、两条跨模块消费侧契约（插件消费 preset **id** 而非 `preset.yml` 的 `name`；技能消费专家行的**字段形状**）、对 `check-preset.mjs` 的能力边界断言 | 改完 preset 要跑什么、要判断某条约束被测到什么程度时 |
| `plugin/dsh-adg-token-budget/AGENTS.md` | 插件的独立命令、模块特有红线（**编号即 `design.md` 的不变量号**）、跨模块路由、生效方式 | 要改插件行为（筛选 / 计数 / 措辞 / 激活行）之前 |
| `plugin/dsh-adg-token-budget/design.md` | 插件作为对象的设计：`PluginActivation`（生命周期型）/ `ChildStepState`（句柄型）/ `ResolvedConfig` / `ConvergenceReminder` 四个对象与不变量 | 要改插件行为或引用它的运行期口径时 |
| `plugin/dsh-adg-token-budget/testing-guide.md` | 插件不变量→用例全表、三个状态机迁移矩阵（含**未覆盖格**如实登记）、跨模块消费侧契约、无破坏性路径的源码级检查、变异验证总表、观测状态对照与未观测清单 | 改插件后要跑什么、要判断某行为是否已被测试钉住时 |
| `docs/evidence.md` | 哪些数字/结论量过、到什么程度、哪些还没量：状态分层四档、证据来源（原始文件与本机路径）、步数分布与阶梯校准、成本基线、三个旋钮的实际生效值、已移除的 token 两档为什么移除、热重载边界、误判口径、惰性旧键、**未观测清单**、**§9 活证据复核快照**、§10 怎么重新测量、**§11 浏览器自动化的沙箱前提（A/B 实测）**、**§12 子代理能不能直接问用户／人工介入的可行路径（源码级事实 + 机制实测）** | 要引用任何实测数字/结论之前（**先看状态分层与未观测清单**）；怀疑某条"未观测"已被本机日志推翻时；要判断"浏览器为什么在受限策略下起不来"时；要做登录墙／验证码的人工介入时 |
| `docs/changelog.md` | 变了什么：一行一条、时间倒序，只记"变了什么"不记为什么 | 要判断某条口径/文件是何时变的、或写完改动要登记一行时 |
| `docs/docs-guide.md` | 文档分层契约、写作规范的可执行判据、状态陈述四档分层、新模块登记义务、引用真实性怎么查 | 要新写或重构任何文档时 |
| `docs/registry.md`（本页） | 有什么文档、什么场景读哪篇、哪些还只是计划、冷启动三问的答题路径 | 找不到该读哪篇时；接手一个陌生任务时 |
| `install.ps1` / `install.sh` | 装到本机 dsh 用户根的部署集合与落点、挂载行的处理、生效方式（重启 or 热重载） | 要部署、要核对部署集合、要判断脱钩时 |
| `plugin/dsh-adg-token-budget/INSTALL.md` | 插件那一层的部署/启用/确认/回滚操作清单 | 要开、要关、要回滚、要确认插件是否已武装时 |
| `plugin/dsh-adg-token-budget/README.md` | 插件自己的口径、配置键含义、安全设计、验证方式 | 要改插件行为或引用插件侧证据时 |

## 2. 计划路径与状态

本节的"状态"是**本页写入那一刻对文件系统的核对结果**，不是承诺：模块文档可以单独演进，**逐篇复核的那一刻才算数**——引用别人的文档之前，确认它存在、并核对你要引用的那一条是否还在（引用真实性口径见 `docs/docs-guide.md` 第 5 节）。

**当前没有任何"计划中"的文档：** 本节列出的 13 条全部已创建。以后新增计划路径时，在本表按同样格式标"计划中（尚未创建）"，并在建成后改成"已创建"。

| 路径 | 状态 | 负责人 |
|---|---|---|
| `preset/design.md` | **已创建**（他自己复核） | preset 侧撰写者 |
| `preset/AGENTS.md` | **已创建**（他自己复核） | preset 侧撰写者 |
| `preset/testing-guide.md` | **已创建**（他自己复核） | preset 侧撰写者 |
| `plugin/dsh-adg-token-budget/design.md` | **已创建**（他自己复核） | 插件侧撰写者 |
| `plugin/dsh-adg-token-budget/AGENTS.md` | **已创建**（他自己复核） | 插件侧撰写者 |
| `plugin/dsh-adg-token-budget/testing-guide.md` | **已创建**（他自己复核） | 插件侧撰写者 |
| `tools/design.md` | **已创建** | `tools/` 侧 |
| `tools/AGENTS.md` | **已创建** | `tools/` 侧 |
| `tools/testing-guide.md` | **已创建** | `tools/` 侧 |
| `docs/docs-guide.md` | **已创建** | 文档层 |
| `docs/evidence.md` | **已创建** | 事实台账撰写者 |
| `docs/registry.md`（本页） | **已创建** | 文档层 |
| `docs/changelog.md` | **已创建** | 文档层 |

上表里标"**已创建**（他自己复核）"的六篇由**不同的撰写者并行写就**：本页登记的是"文件在不在"，**没有**替他们担保内容与口径。要引用它们的具体条目，读原文核对；发现互相矛盾（例如某条口径在两篇里写法不同），**处置权在人类**——报出来，不要自己按偏好选一个。

登记义务（写新模块的人负责）：新建模块时在根 `AGENTS.md` 的 Project Map 与**本页第 1 节**各加一行；只登记一处即文档体系不完整（判断口径见 `docs/docs-guide.md` 第 4 节）。`preset/`、`plugin/dsh-adg-token-budget/`、`tools/` 三个模块**都已**登记在根 `AGENTS.md` 的 Project Map 里。

## 3. 冷启动三问的答题路径

只给"读哪几篇"，答案不写在这里。

**（1）改动入口在哪**

- 不知道自己要动哪一层：根 `AGENTS.md` 的「Project Map」+「Context Loading」，再按 `docs/evidence.md` 的**状态分层**与**未观测清单**确认你手上的前提属于哪一档（未观测的前提不许当成已成立）。
- 已经知道要动哪个目录：该目录的 `AGENTS.md`，再读它的 `design.md`（`preset/`、`plugin/dsh-adg-token-budget/`、`tools/` 三套都已就位，逐篇的存在性与内容以你自己核对为准）。
- 只是要装到本机：`README.md`「安装」与「给 AI 的安装指令」→ `install.sh` / `install.ps1`。
- 要开/关插件：`plugin/dsh-adg-token-budget/INSTALL.md`。

**（2）什么操作最危险**

- 根 `AGENTS.md`「关键红线」9 条（违反即返工）。
- 模块级红线：该目录的 `AGENTS.md`「模块特有红线」（三套都已就位）。
- 危险操作的上下文与代价：`README.md`「设计要点（为什么这么做）」「token 成本纪律（这些上限是怎么来的）」「装完必须重启 dsh」，`plugin/dsh-adg-token-budget/INSTALL.md` 的启用顺序与"代码先到、config 后到"。
- 撤销过的口径（别改回去）：`README.md`「为什么撤销 preset 侧的体积闸门」，以及 `docs/evidence.md` 的已移除 token 两档与历史证据条目。

**（3）怎么验证做对了**

- 先读 `docs/evidence.md` 的**状态分层**与**未观测清单**：把"哪些已被证据推翻、哪些根本还没观测"划出来——手册里若干"未观测"条目已被 2026-09-25 的日志复核推翻（见该文件 §9 活证据复核快照），**处置权在人类**，不要自己照旧口径下结论。
- 门禁清单：根 `AGENTS.md`「Quality Gates」。
- 逐条不变量对应的用例：该模块的 `testing-guide.md`（三套都已就位；`tools/` 那套另含"它故意不做的检查清单"）。
- 一次真实挂载的完整做法：`README.md`「给 AI 的安装指令」第 7 步。
- 证据到哪为止、哪些还没观测：`plugin/dsh-adg-token-budget/INSTALL.md` 第 4 节里那段加粗的"**哪些还没观测过 —— 说清楚：**"（它是段内小标题，不是节标题）→ `README.md`「现在的证据到哪为止」→ `plugin/dsh-adg-token-budget/testing-guide.md` 的「未观测清单（不许写成实测）」。
- 状态该怎么写（不许把未观测写成实测）：`docs/docs-guide.md` 第 3 节。
