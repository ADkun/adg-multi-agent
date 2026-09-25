---
title: preset 模块设计
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
---

## 职责与边界

负责：Adg preset 这一份 agent-plane 组合的**定义** —— 调度智能体的 persona（名册与分派规则）、8 个专家行的 persona / toolName / toolFilter.allow / backgroundMode，以及「preset 侧不覆盖任何体积旋钮」这一决策本身。

不负责（逐条防越权）：

- 不拥有工具注册表与工具实现：它们由 host 组合的 `base.cordis.yml` / `web.cordis.yml` 提供；
- 不拥有沙箱与审批栈，**也不拥有它们的判定入口**：`sandbox-policy` / `permission` / `approval` 三行都在 host-plane 的 `dsh-base/cordis.patch.yml`，`dsh-tool-subagent` 没有权限字段、子代理的审批策略在委派时被钉成 `never`，所以「让 `agent_browser` 能起浏览器」这件事在 preset 侧**只能表达成提示级的流程闸门**（I11），不能表达成权限强制；
- 不拥有持久化与模型路由；
- 不做上下文压缩阈值、单条工具结果截断、抓取与检索上限 —— 承载它们的三行（`compaction-basic` / `tool-result-pruner` / `tool-web`）刻意只声明插件、不写 `config`，一律用插件出厂默认值；
- 不做运行时的步数收敛提醒 —— 那是 host-plane 插件 `dsh-adg-token-budget`（包名是历史名称，它不比较任何 token 阈值）；
- 不负责 `agent-instructions` 那一行（`@deepseek-ai/dsh-agent-instructions`，`maxBytes: 65536`）：它把仓库的 `AGENTS.md` 注入模型提示，**不是专家委派行** —— 它在 `delegation` 组**之外**、顶层缩进，没有 `toolName` / `persona` / `toolFilter.allow`，因此 `node tools/check-preset.mjs` 的专家行检查**不覆盖它**，增删它也不会改变专家名册；
- 不决定「哪些工具名已注册」—— 那是 host 组合注册结果加 `dsh-tools` 的 `restrict()` 的判定；
- 不负责安装与部署 —— 那是仓库根的 `install.ps1` / `install.sh`。

## 依赖关系

- 依赖（组合层）：host 组合提供的 `tools` / `fs` / `subagents` / `workflows` / `skills` / `goals` / `sessionProjections` 注册表，经 `cordis:group` 的 `isolate` realm 发布（`delegation` 组带 `workflowEngine: true`，`compaction` 组带 `compaction` + `toolResultPruner`，`planning` 组带 `planMode`）。无需经契约的理由：这些是宿主服务，preset 只是消费方，实例的创建与回收都不在本模块。`dsh-agent-presets` 负责 standing mount 与 generation（组合文件 stamp 变化起新 generation）。
- 依赖（同仓库）：`tools/check-preset.mjs` 是它的静态校验器；`skills/adg-add-agent/SKILL.md` 是它的修改入口手册。
- 被依赖：`plugin/dsh-adg-token-budget` 通过 `session.header.agentPreset === 'adg'` 识别自己要治理的子代理 —— **preset 是它的输入事实来源**，但插件不读这个文件，只读会话头；`install.ps1` / `install.sh` 复制并部署它；`tools/check-preset.mjs` 校验它。
- 跨模块改动路由：
  1. 改专家名册 → 先读 `preset/AGENTS.md`，再读 `skills/adg-add-agent/SKILL.md`，改完跑 `node tools/check-preset.mjs`，然后**重启 dsh**；
  2. 改承载体积旋钮的三行 → 先读 `docs/evidence.md`（§2 成本基线、§3 三个体积旋钮的实际生效值、§8 未观测清单、§10 怎么重新测量）；
  3. 改「治理哪些会话」→ 先读 `plugin/dsh-adg-token-budget/design.md`（治理面与 `presets` 配置的不变量），再读 `plugin/dsh-adg-token-budget/src/config.js` 的 `DEFAULT_CONFIG.presets`。
  4. 改 preset id（`adg`）→ 先读 `plugin/dsh-adg-token-budget/design.md` 的跨模块消费侧契约：id 取自 `.agent-presets/` 下的**目录名**（`@deepseek-ai/dsh-agent-presets` 的 `PRESET_ID = /^[a-z0-9][a-z0-9-]*$/`），改它等于改治理面，必须与插件的 `presets` 同时改。

## 核心数据模型

### PresetRevision（生命周期型）

- 属性：组合文本（`preset/agent.cordis.yml`）、显示元数据（`preset/preset.yml`）、部署目标 `${DSH_HOME:-~/.dsh}/.agent-presets/adg/`、文件 stamp。
- 状态机：`drafted` → `validated` → `deployed` → `mounted` → `live`
  - `drafted`：仓库里的组合文本已改，尚未自检。**它不是**「已生效」：dsh 读的是已部署的那一份。
  - `validated`：`node tools/check-preset.mjs` 退出码 0。**它不是** YAML 可解析性的证明（自检是逐行文本扫描器），**更不是** `mounted`。
  - `deployed`：`install.ps1` / `install.sh` 已把组合拷进 `.agent-presets/adg/`。**它不是** `mounted`：拷贝不触发重新组合。
  - `mounted`：`dsh-agent-presets` 的 standing mount 为这一版 stamp 起了 generation。**它不是**「旧会话也跟着换」。
  - `live`：新对话加入该 generation。**它不是**「已有会话会跟着换组合」——预设选择在会话起步后就锁定。
  - 迁移唯一入口：`install.ps1` / `install.sh`；其后由 `dsh-agent-presets` 的 standing mount 接续。禁止绕过对象直接改状态（例如手工往 `.agent-presets/adg/` 里贴文件而后宣称已挂载）。
  - **`deployed` → `mounted` 的触发条件未裁决**：根 `README.md`「装完必须重启 dsh」一节里并存两条实测陈述 —— 一条写「preset 挂载之后把 composition 的行改掉，`compositionInventory()` 仍然返回旧行」，另一条写当前这版 `dsh-agent-presets` 的 `ensureStanding()` 会比较文件 stamp，文件变了就起新 generation（并注明「新会话会不会自动加入新 generation」没有实测）。**本模块照实登记两说并存、不选边**；因 `live` 是否自动达成尚无实测，操作口径一律取最保守的一条：改了 preset 就重启 dsh，再在**新对话**里验收。
- 不变量：
  - I1: 禁止把 `validated` 当成 `mounted`。
  - I2: 禁止在未重启 dsh 的情况下宣称新组合已对会话生效。
  - I3: 禁止改动任何成本结论而不附 `docs/evidence.md` §10 的两条前后对比数字（改动前后各跑一次）。
  - I3b: 禁止把 §2 的成本基线当作可比基线——语料是活的，跨快照直接比数字不成立。

### ExpertRow（不可变值对象）

一份 `delegation` 组里的 `- id: agent-<name>` / `@deepseek-ai/dsh-tool-subagent` 行；创建后内容冻结，修改 = 加一行或删一行。**当前 8 行（`agent-file` / `agent-computer` / `agent-app` / `agent-browser` / `agent-search` / `agent-researcher` / `agent-coder` / `agent-reviewer`）**——按 `id` 定位，**不要在本文件里写行号**（行号会被任何一次编辑改掉；需要坐标就跑 `node tools/check-preset.mjs`，它会在报告里打印每个专家行的编号）。

- 属性（只列语义关键的）：`id`（约定 `agent-<name>`）、`toolName`（`agent_<name>`，全局唯一）、`persona`、`toolFilter.allow`、`provider: spawn`、`backgroundMode: continuable`。
- 不变量：
  - I4: 禁止 `toolName` 重复，或不符合 `agent_<name>` 形状。
  - I5: 禁止 `allow` 里出现未注册的工具名。
  - I6: 禁止专家行的 `allow` 里出现 `workflow` / `ralph`。
  - I7: 禁止 `backgroundMode` 不是 `continuable`。
  - I8: 禁止给专家行写 `maxDepth`。

### SchedulerPersona（不可变值对象）

`preset/agent.cordis.yml` 顶部 `persona.prefix` 块（`persona` 行里 `prefix: |-` 起、到下一个顶层 `- id:` 之前为止）里的名册与分派规则；改 = 重写该块。

- 属性和名册的对应关系：名册项 ↔ 专家行的 `toolName`。
- 不变量：
  - I9: 每个启用专家行的 `toolName` 必须出现在名册里；名册提到的每个 `agent_*` 必须有对应行（双向）。
  - I10: 名册里禁止出现「委派预算 / 让步数区间 / 不要轮询步数」这类与插件职责重叠的政策措辞。
  - I11: 禁止删掉或绕过 `agent_browser` 的**权限闸门**，且该闸门禁止被表述成权限强制。闸门的两半：调度 persona 里必须有一条「派发 `agent_browser` 前先读上下文里的当前文件策略，不是 `danger-full-access` 就先 `ask_user_question`」的规则；`agent_browser` 的 persona 里必须写明受限策略下的失败签名与「命中就停手、如实报出」。**它只能是提示级的**：preset 侧没有权限判定入口（见「不负责」），所以禁止在它的文档或注释里把它写成安全边界。

## 对外接口

- 调度 persona 与专家名册的**实现**：`preset/agent.cordis.yml`
- 模式选择器里的名称与简介：`preset/preset.yml`
- 委派工具面（模型看到的 `agent_*` 工具）：`preset/agent.cordis.yml` 的 `delegation` 组（**唯一真相源，不另建契约副本**）

## 非功能红线

- 禁止加回通用 `subagent` / `subagent_fork` 行（子代理继承父代理整套组合，通用行会让专家绕过自己的范围）。来源：实测，`skills/adg-add-agent/SKILL.md`「硬约束」（已在创造模式实测复现）。
- `toolFilter.allow` 是**真实**能力边界，persona 只是补充说明。来源：实测，`skills/adg-add-agent/SKILL.md`「硬约束」（给 `agent_coder` 委派，它可见的工具目录恰好等于 allow 名单；连 preset 自己注册的工具也一起被裁）。推论：禁止在 persona 里要求它做 `allow` 之外的事，也禁止承诺「专家之间默认能互相转交」。
- 禁止给 `compaction-basic` / `tool-result-pruner` / `tool-web` 三行写回体积覆盖值。来源：实测，根 `README.md`「为什么撤销 preset 侧的体积闸门」与 `docs/evidence.md` §2（成本基线）、§3（三个体积旋钮的实际生效值）、§4（已移除的 token 两档）（截断把工具已取到的事实切掉；提前压缩让上下文不可逆失真）。
- 有 `pwsh` 的专家必须同时给 `job_list` / `job_output` / `job_kill`。来源：`skills/adg-add-agent/SKILL.md`「硬约束」（只给 pwsh 会让后台跑起来的任务取不回来）。
- 禁止设 `maxTokens` / `agentOptions` / `reasoningEffort`（后者在手工声明的路由上会让每次委派 `UNSUPPORTED_REASONING_EFFORT`）。来源：`skills/adg-add-agent/SKILL.md`「硬约束」。
- persona 里禁止写 token／读取预算。来源：根 `README.md`「persona 层保留的政策：只剩专家侧的收敛纪律」与 `docs/evidence.md` §2（该层纪律已整体撤销；预算提示把注意力从「把事情做对」挪到「别写太多」）。
- 要改体积旋钮却没拿得出前后对比数字时，禁止改动。来源：`docs/evidence.md` §10「怎么重新测量」（两条审计命令必须改动前后各跑一次）。
- 禁止删掉或绕过 `agent_browser` 的权限闸门（I11），也禁止把它写成安全边界。来源：真机实测 A/B，`docs/evidence.md` §11（`workspace-write` 下 Chrome 退出码 21、Edge Mojo `拒绝访问 (0x5)`；`danger-full-access` 下同一批命令全部退出码 0 且 CDP 真驱动成功），以及源码级事实三问（父智能体不能指定子智能体权限 / preset 不能改会话模式 / 子代理不能自己升权）。

## For Agents

动手前先读：`preset/AGENTS.md` → `preset/design.md` → 视改动再读 `skills/adg-add-agent/SKILL.md`。

绝不能做：上面 8 条非功能红线；把 `validated` 当 `mounted`（I1）；未重启就宣称生效（I2）。

停止并升级人类：要推翻既有语义；红线之间冲突；需求超出本对象边界；要改体积旋钮却拿不出前后对比数字。

## 测试与验证

见 `preset/testing-guide.md`。
