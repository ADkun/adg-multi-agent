# AGENTS.md — preset（Adg preset 的定义）

本模块 = 一份 agent-plane 组合的定义：调度 persona（名册 + 分派规则 + 五条**编排层**规则 + 一条**输出纪律** + 一条**交接闸门**）+ 8 个专家行（其中名册最后一行 `agent-general` 是交接专用的**叶子**），外加三个交给 `tools/gen-preset-bundle.mjs` 生成 bundle 的源文件（`agent.cordis.yml` / `preset.yml` / `bundle.package.json`）。设计与不变量见 `design.md`；改动入口见 `skills/adg-add-agent/SKILL.md`。

## 命令

```sh
node tools/check-preset.mjs      # 校验仓库里的 preset/（唯一真相源；exit 0 通过 / 1 有 ERROR / 2 读不到目标文件）
node tools/gen-preset-bundle.mjs # 生成 bundle 产物（不传位置参数时落缺省 bundle/adg-preset/{cordis.patch.yml,package.json}；构建产物，在 .gitignore 里）
node tools/gen-preset-bundle.mjs --with-billion-context # 目标 profile 装了 billion-context 才用：给 8 个专家行的 allow 追加它的 4 个上下文工具，并给 compaction-basic 注入 config.auto=false（红线 10）
node tools/gen-preset-bundle.mjs --with-save-token      # 目标 profile 装了 dsh-plugin-save-token 才用：追加 save_token_expand；两个旗标可叠加（＝味道 bili+save-token）
```

`check-preset.mjs` 零依赖、逐行文本扫描。exit 0 = 通过（WARN 不算失败）；exit 1 = 有 ERROR（含义只有一个：这次委派必然抛错）；exit 2 = 读不到目标文件。**已经没有"已安装的那一份文本"可以传路径了** —— 旧 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>/` 目录发现机制在 dsh 0.1.7-rc.2 被整体移除（**实测**），仓库里的 `preset/agent.cordis.yml` 就是唯一真相源；`gen-preset-bundle.mjs` 的产物每次安装都会被覆盖，**不许手改**。

## 模块特有红线

一行一条，理由与来源见 `design.md`「非功能红线」：

- `validated` 不等于 `mounted`（`design.md` I1）；未重启不得宣称生效（I2）。
- 禁止给 `compaction-basic` / `tool-result-pruner` / `tool-web` 三行写回体积覆盖值（`design.md` 红线 3）。
- 禁止给专家行的 `allow` 加 `workflow` / `ralph`（I6）；禁止给专家行写 `maxDepth`（I8）。
- 禁止加回通用 `subagent` / `subagent_fork` 行（`design.md` 红线 1）。
- 禁止给 `agent-general` 的 `allow` 加任何 `agent_*` 名册行、通用 `subagent` / `subagent_fork`、或 `workflow` / `ralph`（I16）：它是**刻意做成叶子**的交接专用全功能角色 —— 一旦能再委派，孙代理对调度者不可见、不可 steer，I13 编排层规则整段失效。同样禁止删掉它的 `send_message`（"结束本次会话并回报上级"靠它才被运行时注入）。调度 persona 里也必须留住那条**交接闸门**（规则 17：只在用户显式要求时派、派发时重申回报协议、回报后按 I13 ② 接给同一个它），并禁止把它的触发条件放宽成"任务大 / 想省上下文 / 想并行"。
- 禁止把**子代理预算**（「委派预算 / 让步数区间 / 不要轮询步数 / 结论 N 字符内」）写进调度 persona 或专家 persona（I10）。
- 禁止删掉调度 persona 的五条**编排层**规则（I13）：同一实体 + 同一性质的任务合并成一次委派（**含浏览器那半：同一份信息默认只在一个站点取** —— 2026-09-27 按用户要求追加，一轮浏览下限实测 0.8–2.0 秒，除非用户要多源 / 对比、单站点拿不到或各站数据矛盾、或交付物本身就是跨站比较）；大范围改动先让 `agent_researcher` 出 `path:line` 再让 `agent_coder` 按位改；同一实体的后续任务用 `list_agents` + `send_message` 接给已经读过它的那个专家；跨专家传递大材料走 digest；**派发前过必要性闸门**（三问任一"否"就不派）。**别拿 I10 当理由删它们** —— I10 禁止的是**子代理预算**，这几条约束的是"派给谁、派几次、材料怎么中转、要不要做"，不限制任何单个专家的读取量与产出量（边界见 `design.md` I10 / I13）。委派 prompt 的**五项必填**（含**验收标准**与**本次不做**）同样不许删 —— 没有验收标准就无法判断一条旁路该不该做。
- 禁止把未纳入本次的旁路**静默丢掉**（I13 第 ⑤ 条）：不做的旁路必须在最终交付里挂号「未纳入本次：X（可能影响 Y，未调研）」。来源是一次真实任务的旁路委派（"便携小巧的录音笔" → 为"录音合规性"单独开了一个子代理）；静默丢掉比不做这条规则更糟（省了 token 却让用户不知道有东西没查）。
- 禁止把**输出纪律**（I15：不回贴工具输出原文 / 同一结论只说一次 / 不转述中间过程 / **"未验证 / 未纳入"必填块**）改写成**字数上限、字符上限或产出量限制**，也禁止为了"简洁"省掉未验证块。来源：已撤销的那层正是"结论 N 字符内"（`docs/evidence.md` §1：输出只占账单 1%，压它只损伤质量）；而未验证块是 I13 第 ⑤ 条的诚实护栏，删它等于拿质量换 token。I15 与 I10 的边界见 `design.md`。
- 禁止把 digest 工件写进会话工作区 / 仓库，也禁止没删掉自己创建的工件就宣称"已清理干净"（I14）：工件只能落在平台临时根下、任务结束即删，`read-only` 下不造工件。
- 禁止删掉或绕过 `agent_browser` 的权限闸门，也禁止把它写成安全边界（I11）：本机沙箱（`workspace-write` / `read-only`）下浏览器**根本起不来**（A/B 实测见 `docs/evidence.md` §6），而这件事**无法从 preset 侧强制**（父智能体不能指定子智能体权限、子代理不能自己升权、权限行都在 host-plane），所以闸门只能是**提示级**的流程约束。
- 禁止把 `ask_user_question` 加进任何专家行的 `allow`，也禁止在专家 persona 里要求它「自己去问用户」（I12）：被委派的子代理调用只会拿到 `DELEGATED_CALLER`（`ask()` 带 agent 时只认 live runtime root），人工介入必须由调度者转达。
- 禁止给人工介入设**次数上限**（I12）：默认不设上限，且这条口径对**所有专家、所有任务**适用（不只浏览器 —— 登录／验证码／二次验证／切会话权限／需要用户拍板都算）。唯一例外是**用户自己**要求「不要打扰」或「只介入一轮」，那就按用户口径停手、并如实报出因此拿不到的部分。原先的「同一条路径人工介入每任务至多一轮」已于 2026-09-27 按用户要求删除：它会把「还能请用户帮忙」误判成「已经没救了」，并诱导调度者**事前**就禁掉某条路径（上一版「要求不登录」的成因之一）。
- 禁止把「请用户手动登录」写成失败路径、或让调度者在**派发前**就预先禁止专家登录（**I12 下半**）：需要登录态才能拿到目标时，人工介入就是正常入口，只有用户明确说过不想登录／不想验证时才预先禁止（也别把「不登录」写进委派 prompt 的「本次不做」）。来源：用户实测上一版调度者会给 `browser` 下「不登录」的要求 —— 把「代理不许代填密码 / 不许绕过登录墙」误读成了「不许请用户登录」。
- 有 `pwsh` 的专家必须同时给 `job_list` / `job_output` / `job_kill`（`design.md` 红线 4）。
- 禁止在除 `agent-general` 外的专家行 `allow` 里写 `skill`（**技能面口径**，`design.md` 非功能红线，2026-10-01 按用户要求）：`toolFilter` 只有 `allow` / `deny` 两种形态、preset 侧**没有**"给所有子代理默认加一个工具"的开关，而**不写 `allow`** 的专家会继承调度者整套目录（连名册行一起继承 ⇒ 违反一跳可达红线 1）；于是"让所有专家都能用技能"只能逐行写 `allow`，那正是"每加一个专家都要维护一遍仓库"。默认口径＝专家不用技能面：要用技能的工作由调度者自己做，或按 I16 派 `agent-general`；委派给别的专家时只在委派 prompt 里给技能的**绝对路径**＋「先 read 该文件再动手」，不内联、不复述技能正文（例外三种：只需一小节→原文照贴；目标专家读不了文件→只能内联；步骤须与本次事实交织改写）。判据＝`tools/check-preset.mjs` 对该情形给 **WARN**。
- **composition 里写的每个 `@deepseek-ai/*` 包名必须对着当前这台安装核对**（实例：引擎行的 `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`，2026-09-28 实测）：沿用旧名**不会**让 preset 挂载失败，而是让 registry 判**整份 preset `broken`**（`workflow-worker-thread (@deepseek-ai/dsh-workflow-worker-thread): never started`），该模式在新会话里直接不可用。来源与后果见 `design.md`「非功能红线」最后一条与 `docs/evidence.md` §9。

根 `AGENTS.md`「关键红线」里的其余各条同样适用于本模块，此处不重复。

## 跨模块路由

| 你要改什么 | 先读 |
|---|---|
| 专家名册 / 调度分派规则 | `design.md` → `skills/adg-add-agent/SKILL.md` → 改完 `node tools/check-preset.mjs` |
| 交接专用叶子 `agent_general`（触发条件 / allow 名单 / 回报协议） | `design.md` I16 → 根 `README.md` 顶部「第 8 个专家」一段 → `@deepseek-ai/dsh-subagent` 的 `withContinuableReturnGuidance`（只在子代理看得见 `send_message` 时注入） |
| 调度 persona 的编排层规则（同实体合并 / 先定位再改 / 复用既有专家 / digest 中转 / 必要性闸门 + 挂号） | `design.md` I13 / I14 → 根 `README.md`「多智能体的 token 消耗：已落地与可选手段」→ `testing-guide.md` 的 I13 / I14 用例 |
| 输出／交接纪律（分字段写 / 不回贴原文 / 不重复 / 未验证块必填） | `design.md` I15（边界：**不是**字数上限，I10 管预算）→ 根 `README.md`「多智能体的 token 消耗：已落地与可选手段」→ `testing-guide.md` 的 I15 用例（O1 / O2） |
| 承载体积旋钮的那三行 | `docs/evidence.md` §1 / §2 / §4 / §5（重测口径照抄 §5） |
| 网页交互（`agent_browser`）的权限前提 | `design.md` I11 → `docs/evidence.md` §6（A/B 实测）→ 根 `README.md`「浏览器专家需要完全权限」（三问三答与备选方案取舍） |
| 登录墙／验证码的人工介入 | `design.md` I12 → `docs/evidence.md` §7（子代理不能问用户的源码依据 + 窗口存活／CDP 重连的机制实测）→ 根 `README.md`「登录墙与验证码：人工介入协议」 |
| preset 的部署形状（生成 bundle / 落点 / 写进 `dsh.profile.bundles`） | 根 `README.md`「给 AI 的安装指令」→ `tools/gen-preset-bundle.mjs` 的头部注释（生成形状与用法）→ `design.md` 的 `PresetRevision`（含 I3c） |
| preset id（`adg`）本身 | `design.md`「跨模块改动路由」第 3 条（id 取自生成 patch 里那一行的 `config.id`，值由 `tools/gen-preset-bundle.mjs` 的 `PRESET_ID` 决定；验收判据见 `docs/registry.md`） |
| 校验口径本身 | `tools/AGENTS.md` |

## 版本区

本模块的最终文档只有三份，都在仓库 `preset/`（`AGENTS.md` / `design.md` / `testing-guide.md`）—— 进 git、互相引用、改了就原地更新，不建"最新稿"；改动入口手册是 `skills/adg-add-agent/SKILL.md`（它是技能，不是本模块的版本区文档）。过程件（changelog / handoff / pending / 工作稿 / 证据快照）一律住被 `.gitignore` 排除的 `docs-work/`，不算版本区。完整清单与各文档的职责边界见根 `AGENTS.md`「版本区（文档目录入口）」。

## 生效方式

顺序固定：`node tools/check-preset.mjs`（exit 0）→ 重新生成并重装 bundle（`install.ps1` / `install.sh` 每次安装都会重跑 `tools/gen-preset-bundle.mjs`）→ **重启 dsh**（Host 进程）→ 在 Adg 模式的**新对话**里验收。已挂载的会话不会中途换组合，重启前不要引导用户去用 Adg 模式。

**bundle 层不是只在启动时读**（2026-09-28 实测）：profile 的 `cordis.patch.yml` 或 profile 清单变动会让整份 patch 栈重读、并让声明重新注册；但**新会话才会用上新组合**，所以验收口径不变。**未观测**：不重启时新开的会话会不会直接加入重注册后的声明（不许写成会）。

**已知限制（实测）**：dsh 正在运行时 `install.*` 里的 `pnpm add link:` 会失败 —— 它想重建 `node_modules`，而文件被运行中的 dsh 占着（`os error 32` / `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`）；脚本会把这一条如实报告并继续，**包已在位就不算失败**。要真正装/换依赖，先关掉 dsh 再重跑脚本。
