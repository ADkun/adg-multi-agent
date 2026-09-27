---
title: preset 模块设计
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-28
---

## 职责与边界

负责：Adg preset 这一份 agent-plane 组合的**定义** —— 调度智能体的 persona（名册、分派规则、五条编排层规则、一条交接闸门）、9 个专家行的 persona / toolName / toolFilter.allow / backgroundMode，以及「preset 侧不覆盖任何体积旋钮」这一决策本身。

不负责（逐条防越权）：

- 不拥有工具注册表与工具实现：它们由 host 组合的 `base.cordis.yml` / `web.cordis.yml` 提供；
- 不拥有沙箱与审批栈，**也不拥有它们的判定入口**：`sandbox-policy` / `permission` / `approval` 三行都在 host-plane 的 `dsh-base/cordis.patch.yml`，`dsh-tool-subagent` 没有权限字段、子代理的审批策略在委派时被钉成 `never`，所以「让 `agent_browser` 能起浏览器」这件事在 preset 侧**只能表达成提示级的流程闸门**（I11），不能表达成权限强制；
- 不拥有**用户问答通道**（`ask_user_question`）：它由调度者独占使用，专家行只能把未决问题写进最终结果、由调度者转达（I12）；专家行里禁止出现「问用户」这类要求。
- 不拥有**文件写入的可用范围**：那是 host-plane 的 `dsh-fs-sandbox` 与逐会话沙箱策略。preset 只能规定"写在哪个目录、什么时候删"（I14），**保证不了写得进去** —— `read-only` 下一切写入都会被拒，所以 I14 要求直接退化成"不造工件、digest 随委派 prompt 传递"。
- 不拥有**浏览器工具链本身**：有头启动、最小 CDP 通道、profile 的规范落点（`<DSH_HOME>/browser-profile`）与实例复用规则都在 `browser/`（I1 / I3 / I8）。preset 只引用它的命令行契约 —— 所以「profile 放哪」这类事**不许**在 persona 里另立一套口径（旧口径"放工作区里一个固定目录"正是登录态随工作区清零的成因）。
- 不拥有持久化与模型路由；
- 不做上下文压缩阈值、单条工具结果截断、抓取与检索上限 —— 承载它们的三行（`compaction-basic` / `tool-result-pruner` / `tool-web`）刻意只声明插件、不写 `config`，一律用插件出厂默认值；
- 不做运行时的步数收敛提醒 —— 那是 host-plane 插件 `dsh-adg-token-budget`（包名是历史名称，它不比较任何 token 阈值）；
- 不负责 `agent-instructions` 那一行（`@deepseek-ai/dsh-agent-instructions`，`maxBytes: 65536`）：它把仓库的 `AGENTS.md` 注入模型提示，**不是专家委派行** —— 它在 `delegation` 组**之外**、顶层缩进，没有 `toolName` / `persona` / `toolFilter.allow`，因此 `node tools/check-preset.mjs` 的专家行检查**不覆盖它**，增删它也不会改变专家名册；
- 不决定「哪些工具名已注册」—— 那是 host 组合注册结果加 `dsh-tools` 的 `restrict()` 的判定；
- 不负责安装与部署 —— 那是仓库根的 `install.ps1` / `install.sh`（它调 `tools/gen-preset-bundle.mjs` 生成 bundle，再装进目标 profile）。

## 依赖关系

- 依赖（组合层）：host 组合提供的 `tools` / `fs` / `subagents` / `workflows` / `skills` / `goals` / `sessionProjections` 注册表，经 `cordis:group` 的 `isolate` realm 发布（`delegation` 组带 `workflowEngine: true`，`compaction` 组带 `compaction` + `toolResultPruner`，`planning` 组带 `planMode`）。无需经契约的理由：这些是宿主服务，preset 只是消费方，实例的创建与回收都不在本模块。注册与组合由声明行插件 `@deepseek-ai/dsh-agent-preset`（`config.id` 就是 preset 身份）与 `@deepseek-ai/dsh-agent-preset-registry`（`agentPresets` 服务）承担，可用判据只有一个：`agentPresets.resolve('adg')` 的 `broken` 为空（**真机实测** 2026-09-28，见根 `README.md`「给 AI 的安装指令」第 8 步）。旧的 `${DSH_HOME}/.agent-presets/<id>/` 目录发现机制与 `@deepseek-ai/dsh-agent-presets`（复数）包已随 dsh 0.1.7-rc.2 移除，**没有任何组件会读那个目录**（**真机实测**，`docs/evidence.md` §14）。I13 的「恢复既有专家」依赖 `subagents` 的 continuable 语义（`@deepseek-ai/dsh-subagent` 的 `coldResume` 从已持久化会话重建），同样是消费方。
- 依赖（同仓库）：`tools/check-preset.mjs` 是它的静态校验器；`tools/gen-preset-bundle.mjs` 把 `preset/preset.yml`（显示元数据）+ `preset/agent.cordis.yml`（整个条目列表，**原样**）+ `preset/bundle.package.json`（包清单模板）生成成 bundle（**生成物 `bundle/adg-preset/` 是构建产物，不手改**）；`skills/adg-add-agent/SKILL.md` 是它的修改入口手册。
- 被依赖：`plugin/dsh-adg-token-budget` 通过 `session.header.agentPreset === 'adg'` 识别自己要治理的子代理 —— **preset 是它的输入事实来源**，但插件不读这个文件，只读会话头；`install.ps1` / `install.sh` 生成并部署它的 bundle（生成物落到 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-preset/`、`link:` 进每个能装 preset 的 profile、并把 `dsh-adg-preset` 写进该 profile 的 `dsh.profile.bundles`）；`tools/check-preset.mjs` 校验它；`browser/` 是 `agent_browser` persona 所消费的**命令行契约**（persona 只写命令名、`KEY=value` 输出行与纪律，不复制选项表 —— 唯一的真相源是 `browser/cli.mjs` 的 `USAGE`）。
- 跨模块改动路由：
  1. 改专家名册 → 先读 `preset/AGENTS.md`，再读 `skills/adg-add-agent/SKILL.md`，改完跑 `node tools/check-preset.mjs`，重新生成并重装 bundle（`install.*` 每次安装都会重跑 `tools/gen-preset-bundle.mjs`），然后**重启 dsh**，在**新对话**里验收；
  1b. 改调度 persona 的分派规则或派发拓扑规则（I13）→ 先读 `preset/testing-guide.md` 的 I10 / I13 用例，再读根 `README.md`「多智能体的 token 消耗：已落地与可选手段」（成本口径与量法）；
  2. 改承载体积旋钮的三行 → 先读 `docs/evidence.md`（§2 成本基线、§3 三个体积旋钮的实际生效值、§8 未观测清单、§10 怎么重新测量）；
  3. 改「治理哪些会话」→ 先读 `plugin/dsh-adg-token-budget/design.md`（治理面与 `presets` 配置的不变量），再读 `plugin/dsh-adg-token-budget/src/config.js` 的 `DEFAULT_CONFIG.presets`。
  4. 改 preset id（`adg`）→ 先读 `plugin/dsh-adg-token-budget/design.md` 的跨模块消费侧契约：id **取自生成 patch 里那一行声明行的 `config.id`**（值由 `tools/gen-preset-bundle.mjs` 的 `PRESET_ID` 决定，**不再是目录名**；`preset/preset.yml` 只提供显示元数据 `name` / `description` / `order`，改它不影响治理面），改 id 等于改治理面，必须与插件的 `presets` 同时改。
  5. 改 `agent_browser` 的浏览器那一段（工具链命令 / profile 口径 / 人工介入措辞）→ 先读 `browser/AGENTS.md` 与 `browser/design.md`（被消费的命令行契约），再读本模块的 I11 / I12、根 `README.md`「浏览器工具链与登录态资产」与 `docs/evidence.md` §13。

## 核心数据模型

### PresetRevision（生命周期型）

- 属性：组合文本（`preset/agent.cordis.yml`）、显示元数据（`preset/preset.yml`）、包清单模板（`preset/bundle.package.json`）、生成物（`bundle/adg-preset/`，在 `.gitignore` 里）、bundle 稳定落点 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-preset/`、目标 profile 的 `dsh.profile.bundles` 与 `node_modules`（`link:`）。
- 状态机：`drafted` → `validated` → `deployed` → `mounted` → `live`
  - `drafted`：仓库里的源文本已改，尚未自检。**它不是**「已生效」：dsh 读的是 profile 里注册的那一行声明，而它来自上一次生成的 bundle。
  - `validated`：`node tools/check-preset.mjs` 退出码 0。**它不是** YAML 可解析性的证明（自检是逐行文本扫描器），**也不是** bundle 已重新生成，**更不是** `mounted`。
  - `deployed`：`install.ps1` / `install.sh` 已生成 bundle（`node tools/gen-preset-bundle.mjs`）、把它放到 `$DSH_HOME/bundles/dsh-adg-preset/`、`link:` 进 profile，并把 `dsh-adg-preset` 写进该 profile 的 `dsh.profile.bundles`。**它不是** `mounted`：包在位不触发组合，声明行还要被 registry 读到。**同一个 profile 里 `preset-adg` 只能有一个"家"** —— bundle 或 profile patch 二者之一，两份同 id 的 `insert:` 行是危险形状（**实测**，`docs/evidence.md` §14.3；当时那条临时 profile-patch 行已撤掉）。
  - `mounted`：声明行已被 registry 注册且真的挂载。判据只有一个：`agentPresets.resolve('adg')` 的 `.broken` 为空（**真机实测** 2026-09-28：`broken` 为空、35 行 / 32 行启用 / 3 行关闭、9 条 `@deepseek-ai/dsh-tool-subagent` 专家行启用、0 条 fork、32 行 `fiberState === 2`）。**它不是**「旧会话也跟着换」。
  - `live`：新对话加入该组合。**它不是**「已有会话会跟着换组合」——预设选择在会话起步后就锁定。
  - 迁移唯一入口：`install.ps1` / `install.sh`；其后由 registry 的注册与组合接续。禁止绕过对象直接改状态（例如手工往 `$DSH_HOME/bundles/` 里贴文件、或手改 `bundle/adg-preset/` 的生成物而后宣称已挂载）。
  - **`deployed` → `mounted` 的触发（2026-09-28 实测）**：bundle 层**不是**只在启动时读 —— profile 的 `cordis.patch.yml` 或 profile 清单变动会让整份 patch 栈重读（`dsh-hmr` 的 `refresh()` 走 `readProfilePatches`），重读后声明会重新注册。**但「已挂载的会话不会中途换组合」这条不变**，所以验收口径仍是**重启 dsh + 新对话**。**未观测**：不重启时新开的会话会不会直接加入重注册后的声明（没有实测，不许写成会）。
- 不变量：
  - I1: 禁止把 `validated` 当成 `mounted`。
  - I2: 禁止在未重启 dsh 的情况下宣称新组合已对会话生效。
  - I3: 禁止改动任何成本结论而不附 `docs/evidence.md` §10 的两条前后对比数字（改动前后各跑一次）。
  - I3b: 禁止把 §2 的成本基线当作可比基线——语料是活的，跨快照直接比数字不成立。
  - I3c: 禁止手改 `bundle/adg-preset/` 下的生成物，也禁止把 `$DSH_HOME/bundles/dsh-adg-preset/` 当真相源——要改就改 `preset/` 的源文件再重新生成（生成物每次安装都被覆盖）。

### ExpertRow（不可变值对象）

一份 `delegation` 组里的 `- id: agent-<name>` / `@deepseek-ai/dsh-tool-subagent` 行；创建后内容冻结，修改 = 加一行或删一行。**当前 9 行（`agent-file` / `agent-computer` / `agent-app` / `agent-browser` / `agent-search` / `agent-researcher` / `agent-coder` / `agent-reviewer` / `agent-general`）**——按 `id` 定位，**不要在本文件里写行号**（行号会被任何一次编辑改掉；需要坐标就跑 `node tools/check-preset.mjs`，它会在报告里打印每个专家行的编号）。前 8 行是按能力范围路由的专项专家，第 9 行 `agent-general` 不同：它**只在用户显式要求时**派发、用途是**上下文隔离**、而且是**叶子**（见 I16）。

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
  - I10: 名册里禁止出现「委派预算 / 让步数区间 / 不要轮询步数」这类与插件职责重叠的**子代理预算**措辞。与成本有关的编排层规则只有 I13 那五条，且禁止把 I13 改写成对单个专家的读取量 / 产出量限制（那正是被撤销的那一层，理由见非功能红线）。
  - I11: 禁止删掉或绕过 `agent_browser` 的**权限闸门**，且该闸门禁止被表述成权限强制。闸门的两半：调度 persona 里必须有一条「派发 `agent_browser` 前先读上下文里的当前文件策略，不是 `danger-full-access` 就先 `ask_user_question`」的规则；`agent_browser` 的 persona 里必须写明受限策略下的失败签名与「命中就停手、如实报出」。**它只能是提示级的**：preset 侧没有权限判定入口（见「不负责」），所以禁止在它的文档或注释里把它写成安全边界。
  - I12: 禁止任何专家行（被委派的子代理）直接调用 `ask_user_question`，也禁止把它加进任何专家行的 `allow`。人工介入（登录墙／验证码／二次验证）只能走「专家停手并把未决问题写进最终结果 → 调度者用 `ask_user_question` 转达 → 按用户回答重派／换方式／收手」。**2026-09-27 修订（按用户要求）：删除原先的「同一条路径的人工介入每任务至多一轮」** —— 人工介入**默认不设次数上限**，且这条口径对**所有专家、所有任务**都适用（不限于浏览器：登录／验证码／二次验证／切换会话权限／需要用户拍板的选择／需要用户在本机某处操作）。理由：次数上限会让智能体把「还能请用户帮忙」误判成「已经没救了」，从而过早放弃、或干脆**事前**就禁掉某条路径（上一版调度者「要求不登录」正是这么来的）。**唯一的例外是用户自己要求的**：「不要打扰我 / 别问我」→ 需要介入时直接如实报「因为没有打扰你，X 拿不到」，不许换路径偷试；「只介入一轮」→ 该任务最多请他介入一次，之后停手如实报；两种情形都要在交付里写明这是**用户的要求**、不是调度者替他做的决定。真正该收手的判据只有两个：**用户说不想做**，或**他自己试过仍被挡**。**下半（2026-09-27 补）：请用户手动登录是这条路径的正常入口，不是失败** —— 需要登录态才能拿到目标时，调度者照常派发且**禁止在委派里预先禁止登录**（把「不登录」写进「本次不做」是明确反例），也禁止为了回避登录先降级成静态抓取；只有用户**明确说过**不想登录／不想验证时才预先禁止。**判据**：「登录由人在有头窗口里完成」约束的是**代理不许自己代填密码、不许绕过登录墙**，不是「不许请用户登录」；这两件事被混为一谈正是本半条的来源（用户实测：上一版调度者会要求 `agent_browser` 不登录）。依据：`@deepseek-ai/dsh-tool-ask-user` 按 preset 注册（不在全局工具层），`@deepseek-ai/dsh-user-questions` 的 `ask()` 只认 live runtime root（`agents.roots()`），子代理拿 `DELEGATED_CALLER`，其错误文本自己就规定「include the unresolved question or decision in the child agent's final result」。
  - I13: 调度 persona 必须保留五条**编排层**规则，且它们只能是编排层的：① 同一实体 + 同一性质的任务合并成一次委派（不为同一个代码库 / 文档库 / 站点并发多个"各看一个方面"的同类专家，而是把方面列进同一条委派让一个专家一次通读、按方面分节产出；**浏览器专属追加（2026-09-27，用户要求）：同一份信息默认只在一个站点取** —— 一轮浏览的**下限**实测 0.8–2.0 秒（工具侧，`docs/evidence.md` §13），多站点取同一份信息基本等于把同一份材料买 N 次；除非用户明确要多源 / 对比 / 交叉验证、那个站点拿不到或各站数据互相矛盾、或交付物本身就是跨站点比较的结果（比价、同款选型），否则不许要求同一份信息在两个以上站点各取一遍，也不许为"更全一点"替同一个问题派两个站点，真要多源就让**一个** `agent_browser` 在一条委派里串行跑完并合并）；② 同一实体的**后续**任务优先用 `list_agents` + `send_message` 接给**已经读过它**的那个专家，而不是新建委派；③ 大范围改动先派只读的 `agent_researcher` 出 `path:line` 清单，再让 `agent_coder` 按位改（定位与改动性质不同，本来就该分两步）；④ 跨专家传递大材料走 digest（见 I14）；⑤ **必要性闸门 + 强制挂号** —— 每条拟派发任务先问三问（"答案会改变交付物吗 / 是验收标准的一部分吗 / 需要专家的能力闭环吗"），任一"否"就不派：一两次工具调用能答完的由调度者自己答，其余的**只在最终交付里挂号**「未纳入本次：X（可能影响 Y，未调研）」而**不许静默丢掉**，确定要做的旁路并进同实体同性质的那条委派、禁止为它单独开子代理。委派 prompt 必须**五项必填**：目标 / **验收标准** / **本次不做** / 已知事实 / 期望产出（没有验收标准的委派不许发出）。判据固定为**实体 × 性质**两个维度：实体不同或性质不同才拆（"先只读调研、再写入改动"是性质不同，仍分两步）；**"实体"的锚点是"委派最终服务的那条需求 / 那个对象"**（要改的代码库、要选购的那个产品、要答的那个问题），**不是检索路上碰到的材料**。依据：成本结构的直接观测量是**子代理个数**（实测 cache-read 占提示 token 的 91%，N 个同类委派等于把同一份材料买 N 次），恢复机制是 `@deepseek-ai/dsh-subagent` 的 `coldResume` 从已持久化的子代理会话重建（源码注释：`no subagent provider is dispatched`）；第 ⑤ 条的来源是一次真实任务的旁路委派 —— 用户要"便携小巧的录音笔"，调度者为"录音合规性"单独开了一个子代理，而那次调研的答案只服务同一条选购需求（同实体同性质）、且并未写进验收标准。取反方向由 I10 守住。
  - I14: digest 工件**禁止写进会话工作区或仓库**，只能落在**平台临时根**（`os.tmpdir()` / `$TEMP` / `/tmp`）下本任务自己的子目录里；后续委派只传**绝对路径**并要求专家用 `read` 取；**任务结束时必须删掉本任务自己创建的工件，删不掉要如实报告**；调用会话的策略是 `read-only` 时**禁止造工件**（改走"digest 随委派 prompt 传递"的默认档）。依据：`@deepseek-ai/dsh-fs-sandbox` 的包文档「围栏行为」—— 读取在三种模式下都不受围栏限制，而 `workspace-write` 只允许目标位于会话工作区或平台临时区域之下、`read-only` 拒绝一切变更；写进工作区的散落中间文件会被误提交。digest 必须是**派生材料**：委派 prompt 里要写明"与源材料冲突时以源材料为准、冲突要报出来"，禁止把 digest 当成结论或交付物。
  - I15: **输出 / 交接件的去冗余纪律**（与 I13 正交：I13 管"派给谁、要不要做"，本条规定"写下来的东西怎么组织"）。四条**禁止式**判据：① 禁止回贴工具输出原文（给位置就够）；② 同一结论在同一会话里只说一次，后文用"见上 / 第 N 条"引用、禁止重述；③ 禁止把专家的中间过程转述进交付物；④ **"未验证 / 未纳入"是必填块，禁止为求简短省略**（第 ④ 条优先于前三条：与它冲突时宁可长也不删）。委派 prompt 必须**分字段写**（目标 / 验收标准 / 本次不做 / 已知事实 / 期望产出），并在**期望产出**里写明返回结构（结论 / 证据位置 / 未验证或未纳入）。**禁止把本条写成任何字数上限、字符上限或产出量限制** —— 那会精确退化成已撤销的那层（见非功能红线里关于子代理预算的那条）。依据：实测成本结构（`docs/evidence.md` §2）—— 输出只占总花费 **1%**（0.9M / 94.1M），但**写下的每个字都会在后续每一步作为 cache-read 重发**（cache-read 85.1M = 90.4%），所以被乘数最大的是两件**交接件**：委派 prompt（专家每一步都读）与专家返回结果（调度者余下每一步都读、并成为最终答复的素材）；反过来，最终答复的措辞后面没有更多步，省不到钱，只影响可读性。**这条依据是由聚合数字算出的推算，不是新实测**（状态分层：推算）。形态依据：`doc-engineer` 的两条红线 —— 约束必须可执行化、禁止无据形容词，所以本条只写禁止式判据而不写"要简洁"。
  - I16: **`agent_general`（第 9 个专家行）是"交接专用"的叶子，且只在用户显式要求时派发。** 三半：① 它的 `allow` 是本 preset 里最全的**叶子**工具集（read / read_image / write / edit / glob / grep / pwsh / job_list / job_output / job_kill / web_search / web_fetch / skill / todo_write / send_message / present），但**禁止出现任何 `agent_*` 名册行、通用 `subagent` / `subagent_fork`、以及 `workflow` / `ralph`** —— 它不能再往下委派（这是一次刻意的能力裁剪，不是能力缺失：子代理会 `composeFrom` 继承父代理整套组合，把名册行写进 `allow` 就生效，深度上限由该行的 `maxDepth` 决定、`dsh-tool-subagent` 默认 3）；② 调度 persona 里必须有一条规则把它的触发条件钉成**用户的显式要求**（"交给子代理 / 另开一个上下文 / 换个智能体接手"），禁止因为"任务看起来很大 / 想省自己的上下文 / 想并行"自行改派，并写明它**不过 I13 第 ⑤ 条的必要性三问**、过的是用户显式要求这道闸门（两者不冲突：I13 管"该不该做这件事 / 该不该为旁路开子代理"，本条管"用户点名要交接的这件事由谁做"）；③ 派发时必须在委派 prompt 里重申"完成、或用户让你结束时先用 `send_message` 回报上级再收尾"，且它回报/结束之后按 I13 ② 接给**同一个**它（`list_agents` + `send_message`）。**依据**：一跳可达才有可追踪的链路 —— 调度者的 `list_agents` 只列直接子级、`send_message` 只到直接父/子，**孙代理对它不可见、不可 steer**（源码级事实）；I13 的四条编排层规则只作用于调度者自己那一次委派，一旦它再委派就整段失效；成本结构实测（cache-read 占提示 token 的 91%）说明每多一层就是把同一份材料再买一次。**补偿机制由运行时自带**：`@deepseek-ai/dsh-subagent` 的 `withContinuableReturnGuidance` 只在子代理**看得见 `send_message`** 时给它的任务末尾追加「Your parent agent id is …，结束前用 `send_message` 把结果回报给它」——所以 `send_message` 必须留在它的 `allow` 里（少了它，"结束本次会话并回报上级"就只剩结算通知里的 closing message 一半）；`ask_user_question`（I12）、`create_goal` / `get_goal` / `update_goal`（只认 live runtime root 的直连人类回合）、`exit_plan_mode`（需 plan mode 且要 userQuestions 通道）则**禁止**写进任何专家行的 `allow`。**未观测**：真实委派下"它的可见目录恰好等于 allow 名单""调度者只在用户显式要求时才派发它"都尚无真机证据（机制与 `agent_coder` 的已实测同源：可见目录 = allow 名单）。

## 对外接口

- 调度 persona 与专家名册的**实现**：`preset/agent.cordis.yml`
- 模式选择器里的名称与简介：`preset/preset.yml`
- bundle 的生成入口与形状：`node tools/gen-preset-bundle.mjs` 读 `preset/preset.yml` / `preset/agent.cordis.yml` / `preset/bundle.package.json`，写 `bundle/adg-preset/{cordis.patch.yml,package.json}`（**生成物，不手改**）；patch 的内容是一行 `insert:`，里面是 Loader 声明行 `id: preset-adg`、`name: '@deepseek-ai/dsh-agent-preset'`、`config: {id: adg, name: 显示名, description, order: 20, plugins: [...原样...]}`；稳定落点 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-preset/`
- 委派工具面（模型看到的 `agent_*` 工具）：`preset/agent.cordis.yml` 的 `delegation` 组（**唯一真相源，不另建契约副本**）

## 非功能红线

- 禁止加回通用 `subagent` / `subagent_fork` 行（子代理继承父代理整套组合，通用行会让专家绕过自己的范围）。来源：实测，`skills/adg-add-agent/SKILL.md`「硬约束」（已在创造模式实测复现）。
- `toolFilter.allow` 是**真实**能力边界，persona 只是补充说明。来源：实测，`skills/adg-add-agent/SKILL.md`「硬约束」（给 `agent_coder` 委派，它可见的工具目录恰好等于 allow 名单；连 preset 自己注册的工具也一起被裁）。推论：禁止在 persona 里要求它做 `allow` 之外的事，也禁止承诺「专家之间默认能互相转交」。
- 禁止给 `compaction-basic` / `tool-result-pruner` / `tool-web` 三行写回体积覆盖值。来源：实测，根 `README.md`「为什么撤销 preset 侧的体积闸门」与 `docs/evidence.md` §2（成本基线）、§3（三个体积旋钮的实际生效值）、§4（已移除的 token 两档）（截断把工具已取到的事实切掉；提前压缩让上下文不可逆失真）。
- 有 `pwsh` 的专家必须同时给 `job_list` / `job_output` / `job_kill`。来源：`skills/adg-add-agent/SKILL.md`「硬约束」（只给 pwsh 会让后台跑起来的任务取不回来）。
- 禁止设 `maxTokens` / `agentOptions` / `reasoningEffort`（后者在手工声明的路由上会让每次委派 `UNSUPPORTED_REASONING_EFFORT`）。来源：`skills/adg-add-agent/SKILL.md`「硬约束」。
- persona 里禁止写**子代理预算**（"结论控制在 N 字符内""委派 prompt 自带读取预算"之类）。来源：根 `README.md`「persona 层保留的政策：专家侧的收敛纪律与调度侧的编排层规则」与 `docs/evidence.md` §2（该层纪律已整体撤销；预算提示把注意力从「把事情做对」挪到「别写太多」）。**边界**：编排层的五条规则（I13）、digest 工件口径（I14）与输出／交接去冗余纪律（I15）都不属于本条禁止的范围 —— 它们约束"派给谁、派几次、材料怎么中转、写下来的东西怎么组织"，不限制任何单个专家的读取量与产出量（I15 明确禁止被改写成字数上限）。
- 禁止把输出／交接纪律（I15）写成**字数上限、字符上限或产出量限制**，也禁止为了"简洁"省掉 **"未验证 / 未纳入"** 这一块。来源：前者是已撤销那一层的精确退化形态（`docs/evidence.md` §2：输出只占 1%，压它只损伤质量）；后者会删掉 I13 第 ⑤ 条建立的诚实护栏 —— 本仓库的成本规则一律**不许拿质量换**（根 `README.md`「为什么撤销 preset 侧的体积闸门」）。
- 禁止删掉调度 persona 的编排层规则（I13），也禁止把「同一实体合并委派」改写成子代理读取／汇报预算。来源：成本结构实测（根 `README.md`「多智能体的 token 消耗：已落地与可选手段」：cache-read 占 91%、调度者 59% / 子代理 41%、每个子代理 ≈1.73M）+ `@deepseek-ai/dsh-subagent` 的 `coldResume` 源码事实。
- 禁止把未纳入本次的旁路**静默丢掉**：不做的旁路必须在最终交付里挂号「未纳入本次：X（可能影响 Y，未调研）」（I13 第 ⑤ 条）。来源：一次真实任务的旁路委派（"便携小巧的录音笔" → 为"录音合规性"单独开了一个子代理）。**理由**：静默丢掉比不做这条规则更糟 —— 它省了 token 却让用户无从知道有东西没查；挂号让"省钱"与"不隐瞒"同时成立，也让这条规则可抽查（最终答复里有挂号句、转录里没有对应委派）。
- 禁止把 digest 工件写进会话工作区 / 仓库，也禁止在没删掉自己创建的工件时宣称"已清理干净"（I14）。来源：`@deepseek-ai/dsh-fs-sandbox` 的包文档「围栏行为」（可写集合 = 工作区 + 平台临时区域；读取不受限）+ 工作区里散落的中间文件会被误提交。
- 要改体积旋钮却没拿得出前后对比数字时，禁止改动。来源：`docs/evidence.md` §10「怎么重新测量」（两条审计命令必须改动前后各跑一次）。
- 禁止删掉或绕过 `agent_browser` 的权限闸门（I11），也禁止把它写成安全边界。来源：真机实测 A/B，`docs/evidence.md` §11（`workspace-write` 下 Chrome 退出码 21、Edge Mojo `拒绝访问 (0x5)`；`danger-full-access` 下同一批命令全部退出码 0 且 CDP 真驱动成功），以及源码级事实三问（父智能体不能指定子智能体权限 / preset 不能改会话模式 / 子代理不能自己升权）。
- 禁止把 `ask_user_question` 加进任何专家行的 `allow`，也禁止在专家 persona 里要求它「请用户介入／问用户」（I12）：被委派的子代理调用只会拿到 `DELEGATED_CALLER`。来源：源码级事实，`@deepseek-ai/dsh-user-questions` 的 `ask()`（带 agent 时只认 `agents.roots()`）与 `@deepseek-ai/dsh-tool-ask-user` 的 `execute`（把 `exec.agent` 传下去）；转达机制见 `docs/evidence.md` §12。
- 禁止把「请用户手动登录」写成失败路径、或让调度者在派发前预先禁止专家登录（I12 下半）：需要登录态才能拿到目标时，人工介入就是正常路径。来源：用户实测反馈 —— 上一版调度者会给 `agent_browser` 下「不登录」的要求（多是把「代理不许代填密码 / 不许绕过登录墙」误读成「不许请用户登录」，或为省下人工介入的次数而事前就禁掉登录 —— 原先那条「每任务至多一轮」的上限已按用户要求删除，见 I12）；复核见 `docs/evidence.md` §12。**反过来说**：用户明确说过不想登录／不想验证时，禁止再劝、禁止换路径偷试。
- 禁止给 `agent-general` 的 `allow` 加任何 `agent_*` 名册行、通用 `subagent` / `subagent_fork`、或 `workflow` / `ralph`（I16）：它是**刻意做成叶子**的全功能角色，一旦能再委派，孙代理就对调度者不可见、不可 steer，I13 的四条编排层规则也整段失效。同样禁止把 `send_message` 从它的 `allow` 里删掉 —— "结束本次会话并回报上级"这条协议正是靠它才被运行时注入（`withContinuableReturnGuidance` 的触发条件就是子代理看得见 `send_message`）。来源：源码级事实（`applyChildComposition` 的 `composeFrom` + `tools.restrict` 取交集；`list_agents` 只列直接子级、`send_message` 只到直接父/子；`withContinuableReturnGuidance` 的注入条件）+ 成本结构实测（cache-read 占 91%）。
- composition 里出现的每个 `@deepseek-ai/*` 包名，必须是**当前这台安装里存在**的那个。来源：真机实测 2026-09-28（dsh 0.1.7-rc.2）—— 引擎行的包名在这一版被改过：旧的 `@deepseek-ai/dsh-workflow-worker-thread` 已从安装里消失，取而代之的是 `@deepseek-ai/dsh-workflow-ptc`（行 id `workflow-ptc`、`config: {provider: spawn}`，与出厂 `presets/standard.patch.yml` 一致）。**沿用旧名不会让 preset 挂载失败，而是让 registry 判整份 preset `broken`**：报 `workflow-worker-thread (@deepseek-ai/dsh-workflow-worker-thread): never started`，于是该模式在新会话里直接不可用。**教训：插件包名会随 dsh 升级改名，写进 composition 的名字要对着当前安装核对。**台账见 `docs/evidence.md` §14。

## For Agents

动手前先读：`preset/AGENTS.md` → `preset/design.md` → 视改动再读 `skills/adg-add-agent/SKILL.md`。

绝不能做：上面逐条列出的非功能红线（**不写条数** —— 条数会被每一次新增改动改掉）；把 `validated` 当 `mounted`（I1）；未重启就宣称生效（I2）；手改 `bundle/adg-preset/` 的生成物（I3c）。

停止并升级人类：要推翻既有语义；红线之间冲突；需求超出本对象边界；要改体积旋钮却拿不出前后对比数字。

## 测试与验证

见 `preset/testing-guide.md`。
