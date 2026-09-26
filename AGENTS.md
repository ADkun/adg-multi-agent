# AGENTS.md — adg-multi-agent

Adg 多智能体模式：一份 DSH agent preset（**一个调度智能体 + 八个专家智能体**），外加一个给委派出去的子代理注入**步数收敛检查点**的 host-plane 插件、一个「给 Adg 加一个智能体」的用户技能、一个静态自检脚本、两个安装脚本。本文只做路由，不做百科——细节一律下沉到按需文档。

人向手册与全部实测依据：`README.md`（**改任何东西之前先读它对应的小节**）。

## 命令

零运行时依赖；只要求 Node（插件 `package.json` 声明 `engines.node >= 20`；本机实测 Node v26.9.0）。没有 `package.json`、没有 monorepo 构建、没有 lint 配置。

```sh
# preset 静态自检（零依赖，逐行文本扫描；exit 0 通过 / 1 有 ERROR / 2 读不到目标文件）
node tools/check-preset.mjs
node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"   # 校验已安装的那一份

# 插件单元测试（只依赖 node:test / node:assert，无 node_modules 也能跑）
cd plugin/dsh-adg-token-budget && node --test test
cd plugin/dsh-adg-token-budget && node --test --test-isolation=none test   # DSH 沙箱（workspace-write）里必须加这个 flag，见下

# 安装到本机 dsh 用户根（preset + 技能 + 插件 + 挂载行）
sh install.sh                                                              # macOS / Linux
powershell -ExecutionPolicy Bypass -File .\install.ps1                     # Windows
```

**本仓库没有"一条命令跑完全部"的入口**：上面三条命令彼此独立，各自覆盖一层。验收方式是这三条 + 一次真实挂载，见「Quality Gates」。

## 关键红线（违反即返工，改任何文件前先读）

1. **禁止加回通用 `subagent` / `subagent_fork` 委派行。** 子代理继承父代理的整套 composition；一旦存在通用行，专家就能绕过自己的范围再开一个不受限的子代理（已在创造模式实测复现）。
2. **`toolFilter.allow` 是真实的能力边界，不是提示。** 实测：专家可见的工具目录**恰好等于**它的 `allow` 名单（连 preset 自己注册的工具一起被裁）。因此禁止在 persona 里要求它做 `allow` 之外的事，也禁止承诺"专家之间默认能互相转交"。
3. **禁止给承载体积旋钮的三行写回覆盖值**（`compaction-basic` / `tool-result-pruner` / `tool-web`）。本 preset 一律用插件出厂默认值：截断工具结果会把工具**已经取到**的事实切掉。
4. **禁止在 persona 里写 token／读取预算**（"结论控制在 N 字符内""委派 prompt 自带读取预算"之类）。该层纪律已整体撤销。**与成本有关的只剩调度侧五条编排层规则 + 一条输出纪律**（编排层：同一实体 + 同一性质的任务合并成一次委派；大范围改动先让 `agent_researcher` 出 `path:line` 再让 `agent_coder` 按位改；同一实体的后续任务接给已经读过它的那个专家；跨专家传递大材料走 digest；派发前过**必要性闸门**并给未纳入的旁路挂号。输出纪律：不回贴工具输出原文、同一结论只说一次、不转述中间过程、**"未验证 / 未纳入"必填块不许为求简短省略**。`preset/design.md` I13 / I14 / I15）—— 它们约束"派给谁、派几次、材料怎么中转、要不要做、写下来的东西怎么组织"，不是"单个专家能读多少、能写多少"；禁止把这些改写成预算或**字数上限**（I15 明文禁止），也禁止把 digest 工件写进工作区（I14）、把未纳入的旁路静默丢掉（I13 第 ⑤ 条）。
5. **禁止给任何请求设 `maxTokens` / `agentOptions` / `reasoningEffort`。** 后者在手工声明的路由上会让每次委派直接报 `UNSUPPORTED_REASONING_EFFORT`。
6. **禁止给专家行写 `maxDepth`。** 写 `0` 会让**每一次** `agent_*` 委派以 `subagent depth 1 exceeds maxDepth 0` 失败。
7. **`allow` 里只能写已注册的工具名。** `dsh-tools` 的 `restrict()` 遇到未知名直接抛 `names unknown global tool ...`，那一次委派当场失败；合法名单见 `tools/design.md`。
8. **`install.ps1` 必须保留 UTF-8 BOM。** Windows PowerShell 5.1 没有 BOM 时会按系统 ANSI 代码页读脚本，中文乱码并直接解析失败；编辑工具会**悄悄**去掉它，改完单独确认前三个字节仍是 `EF BB BF`。
9. **插件的提醒只能是"可选提醒"，不能读成停止指令**（文本里禁止"立即停止"这类命令句）。这条由测试钉住（变异 M13）。

## 生效方式（两条链路，口径不同，别承诺错）

| 改了什么 | 怎么生效 | 怎么复核 |
|---|---|---|
| `preset/` 任何文件（含增删专家） | **重启 dsh**，然后在**新对话**里选「Adg 多智能体模式」 | 重启后按 `README.md`「给 AI 的安装指令」第 7 步做真实挂载校验 |
| 插件的 `config:`（`profiles/<profile>/cordis.patch.yml`） | **热重载，不用重启** | `logFile` 里新出现一行 `activation: …` |
| 插件的 `src/` 下的代码 | **必须重启**——热重载只重放 `config:`，不会重新 `import` 已加载的模块（Node 的 ESM registry 按文件 URL 缓存） | 激活行出现 `stepNudge=` / `stepTiers=` / `stepText=` 且**没有** `budgetTokens=` / `hardDryRun=` |

## Project Map

| 模块 | 一句话职责 | 规则见 |
|---|---|---|
| `preset/` | Adg preset 的定义：调度 persona（名册 + 分派规则）与 8 个专家行 | `preset/AGENTS.md` |
| `plugin/dsh-adg-token-budget/` | host-plane 插件：受管子代理的步数收敛检查点（包名是历史名称，**不比较任何 token 阈值**） | `plugin/dsh-adg-token-budget/AGENTS.md` |
| `tools/` | `check-preset.mjs`：preset 的零依赖静态校验器 | `tools/AGENTS.md` |

不在模块地图里、也不需要模块 `AGENTS.md` 的（三样信号都没有，建了就是噪音）：`skills/adg-add-agent/SKILL.md`（用户技能文档，位于 `${DSH_HOME:-~/.dsh}/skills/`，无独立命令）、`install.ps1` / `install.sh`（部署脚本，无模块红线）、仓库根 `README.md`。`docs/` 是文档层而非模块：`docs/evidence.md`（实测证据台账 / 未观测清单）、`docs/docs-guide.md`（写作规范与文档分层契约）、`docs/registry.md`（索引与冷启动三问的答题路径）。

**新模块登记义务**：新建模块时在本表与 `docs/registry.md` 各加一行，缺登记即文档体系不完整。

## Context Loading（按你手上的改动读）

| 你要做什么 | 先读 | 再读 |
|---|---|---|
| 新增 / 修改 / 删除一个专家智能体 | `preset/AGENTS.md` | `skills/adg-add-agent/SKILL.md` → `preset/design.md` → 改完 `node tools/check-preset.mjs` |
| 改调度 persona 的名册或分派规则 | `preset/design.md` | `preset/testing-guide.md`（名册与专家行的双向一致性约束）；改**编排层规则**（I13 / I14，含必要性闸门与挂号）或**输出纪律**（I15）再读 `README.md`「多智能体的 token 消耗：已落地与可选手段」 |
| 改插件行为（筛选 / 计数 / 措辞 / 激活行） | `plugin/dsh-adg-token-budget/AGENTS.md` → `design.md` | `plugin/dsh-adg-token-budget/testing-guide.md`（先看该行为是否已被测试钉住） |
| 改插件的挂载位置、部署集合或上线顺序 | `plugin/dsh-adg-token-budget/INSTALL.md` | `plugin/dsh-adg-token-budget/design.md` |
| 改 `check-preset.mjs` 的判错口径，或改 composition 的 tool 行 | `tools/design.md` | `preset/design.md`（体积旋钮与 `allow` 的约束） |
| 想知道某个数字/结论"量过没有" | `docs/evidence.md` | `README.md` 对应小节（`README.md` 是实测原始依据） |
| 只是想装到本机 | `README.md`「安装」 | `install.sh` / `install.ps1` |
| 搞不清文档体系的写法与分层 | `docs/docs-guide.md` | `docs/registry.md`（索引与冷启动三问的答题路径） |

## Quality Gates

1. `node tools/check-preset.mjs` → **exit 0**（允许 WARN；WARN 不是失败，ERROR 的含义只有一个：**这次委派必然抛错**）。本仓库当前实测：**0 错误 / 1 警告**（`agent-file` 的 `read_image` 是条件性注册）。
2. `cd plugin/dsh-adg-token-budget && node --test test` → 全绿（本仓库实测 **50 个测试全通过**）。**在 DSH 沙箱（`workspace-write`）里这条命令必然失败**，失败形态是测试文件本身报 `Error: spawn EPERM`（不是断言失败）：`node --test` 默认每个测试文件起一个 piped-stdio 子进程，沙箱拒绝 pipe。加 `--test-isolation=none` 即走同一条测试路径且不需要子进程，实测全绿；另外 `| Select-String / Select-Object` 这类 PowerShell 管道在沙箱里也会被拒（`Access is denied`），重定向到文件则正常。
3. 改了 preset → 按 `README.md`「给 AI 的安装指令」第 7 步做**真实挂载**（静态自检证明不了挂载）。
4. 改了插件的 `src/` → 重启后复核激活行形状（见上表）。
5. 交付前逐条对照 `docs/docs-guide.md` 的写作规范与附件规范的「质量红线清单」。
6. 引用任何实测数字前先读 `docs/evidence.md` 的**未观测清单**与**活证据复核快照**：人向手册里若干"未观测"条目的**依据**已被本机日志更新（新阶梯下的注入确已发生，见 `docs/evidence.md` 第 9 节），处置权在人类。**但有一条不是冲突、不许读成冲突**：「恢复的子代理被再次提醒」仍是未观测——日志证明的是**驻留期重置机制**在跑，"那个子代理是被恢复的"无从判定（`subagent/end` 对"结束"与"被恢复"发同一事件）。

**能力的边界（不许越界宣称）**：`tools/check-preset.mjs` 是**逐行文本扫描器，不是 YAML 解析器**；它证明不了文件能被 YAML 解析，也证明不了插件真的挂载，**更完全不覆盖插件那一层**。`README.md` 与 `docs/evidence.md` 里的实测都带状态分层（源码级事实 / 检验 / 真机实测 / 未观测）——引用时必须保留该分层，**未观测的结论不许写成实测**。
