# AGENTS.md — preset（Adg preset 的定义）

本模块 = 一份 agent-plane 组合的定义：调度 persona（名册 + 分派规则 + 五条**编排层**规则）+ 8 个专家行。设计与不变量见 `design.md`；改动入口见 `skills/adg-add-agent/SKILL.md`。

## 独立命令

```sh
node tools/check-preset.mjs                                                          # 校验仓库里的 preset/
node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"  # 校验已安装的那一份
```

零依赖、逐行文本扫描。exit 0 = 通过（WARN 不算失败）；exit 1 = 有 ERROR（含义只有一个：这次委派必然抛错）；exit 2 = 读不到目标文件。改的是已安装的那一份就必须传路径，否则你校验的是仓库副本。

## 模块特有红线

一行一条，理由与来源见 `design.md`「非功能红线」：

- `validated` 不等于 `mounted`（`design.md` I1）；未重启不得宣称生效（I2）。
- 禁止给 `compaction-basic` / `tool-result-pruner` / `tool-web` 三行写回体积覆盖值（`design.md` 红线 3）。
- 禁止给专家行的 `allow` 加 `workflow` / `ralph`（I6）；禁止给专家行写 `maxDepth`（I8）。
- 禁止加回通用 `subagent` / `subagent_fork` 行（`design.md` 红线 1）。
- 禁止把**子代理预算**（「委派预算 / 让步数区间 / 不要轮询步数 / 结论 N 字符内」）写进调度 persona 或专家 persona（I10）。
- 禁止删掉调度 persona 的五条**编排层**规则（I13）：同一实体 + 同一性质的任务合并成一次委派；大范围改动先让 `agent_researcher` 出 `path:line` 再让 `agent_coder` 按位改；同一实体的后续任务用 `list_agents` + `send_message` 接给已经读过它的那个专家；跨专家传递大材料走 digest；**派发前过必要性闸门**（三问任一"否"就不派）。**别拿 I10 当理由删它们** —— I10 禁止的是**子代理预算**，这几条约束的是"派给谁、派几次、材料怎么中转、要不要做"，不限制任何单个专家的读取量与产出量（边界见 `design.md` I10 / I13）。委派 prompt 的**五项必填**（含**验收标准**与**本次不做**）同样不许删 —— 没有验收标准就无法判断一条旁路该不该做。
- 禁止把未纳入本次的旁路**静默丢掉**（I13 第 ⑤ 条）：不做的旁路必须在最终交付里挂号「未纳入本次：X（可能影响 Y，未调研）」。来源是一次真实任务的旁路委派（"便携小巧的录音笔" → 为"录音合规性"单独开了一个子代理）；静默丢掉比不做这条规则更糟（省了 token 却让用户不知道有东西没查）。
- 禁止把 digest 工件写进会话工作区 / 仓库，也禁止没删掉自己创建的工件就宣称"已清理干净"（I14）：工件只能落在平台临时根下、任务结束即删，`read-only` 下不造工件。
- 禁止删掉或绕过 `agent_browser` 的权限闸门，也禁止把它写成安全边界（I11）：本机沙箱（`workspace-write` / `read-only`）下浏览器**根本起不来**（A/B 实测见 `docs/evidence.md` §11），而这件事**无法从 preset 侧强制**（父智能体不能指定子智能体权限、子代理不能自己升权、权限行都在 host-plane），所以闸门只能是**提示级**的流程约束。
- 禁止把 `ask_user_question` 加进任何专家行的 `allow`，也禁止在专家 persona 里要求它「自己去问用户」（I12）：被委派的子代理调用只会拿到 `DELEGATED_CALLER`（`ask()` 带 agent 时只认 live runtime root），人工介入必须由调度者转达，且**同一条路径的人工介入每任务至多一轮**。
- 有 `pwsh` 的专家必须同时给 `job_list` / `job_output` / `job_kill`（`design.md` 红线 4）。

根 `AGENTS.md`「关键红线」里的其余各条同样适用于本模块，此处不重复。

## 跨模块路由

| 你要改什么 | 先读 |
|---|---|
| 专家名册 / 调度分派规则 | `design.md` → `skills/adg-add-agent/SKILL.md` → 改完 `node tools/check-preset.mjs` |
| 调度 persona 的编排层规则（同实体合并 / 先定位再改 / 复用既有专家 / digest 中转 / 必要性闸门 + 挂号） | `design.md` I13 / I14 → 根 `README.md`「多智能体的 token 消耗：已落地与可选手段」→ `testing-guide.md` 的 I13 / I14 用例 |
| 承载体积旋钮的那三行 | `docs/evidence.md` §2 / §3 / §8 / §10（重测口径照抄 §10） |
| 网页交互（`agent_browser`）的权限前提 | `design.md` I11 → `docs/evidence.md` §11（A/B 实测）→ 根 `README.md`「浏览器专家需要完全权限」（三问三答与备选方案取舍） |
| 登录墙／验证码的人工介入 | `design.md` I12 → `docs/evidence.md` §12（子代理不能问用户的源码依据 + 窗口存活／CDP 重连的机制实测）→ 根 `README.md`「登录墙与验证码：人工介入协议」 |
| 「治理哪些会话」这件事 | `plugin/dsh-adg-token-budget/design.md`（`presets` 配置 × `session.header.agentPreset` 的乘积） |
| 校验口径本身 | `tools/AGENTS.md` |

## 生效方式

改完必须重启 dsh（Host 进程），并在 Adg 模式的**新对话**里验收 —— 已挂载的会话不会中途换组合，重启前不要引导用户去用 Adg 模式。
