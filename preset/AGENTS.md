# AGENTS.md — preset（Adg preset 的定义）

本模块 = 一份 agent-plane 组合的定义：调度 persona（名册 + 分派规则）+ 8 个专家行。设计与不变量见 `design.md`；改动入口见 `skills/adg-add-agent/SKILL.md`。

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
- 禁止把「委派预算 / 让步数区间 / 不要轮询步数」写进调度 persona（I10）。
- 禁止删掉或绕过 `agent_browser` 的权限闸门，也禁止把它写成安全边界（I11）：本机沙箱（`workspace-write` / `read-only`）下浏览器**根本起不来**（A/B 实测见 `docs/evidence.md` §11），而这件事**无法从 preset 侧强制**（父智能体不能指定子智能体权限、子代理不能自己升权、权限行都在 host-plane），所以闸门只能是**提示级**的流程约束。
- 有 `pwsh` 的专家必须同时给 `job_list` / `job_output` / `job_kill`（`design.md` 红线 4）。

根 `AGENTS.md`「关键红线」里的其余各条同样适用于本模块，此处不重复。

## 跨模块路由

| 你要改什么 | 先读 |
|---|---|
| 专家名册 / 调度分派规则 | `design.md` → `skills/adg-add-agent/SKILL.md` → 改完 `node tools/check-preset.mjs` |
| 承载体积旋钮的那三行 | `docs/evidence.md` §2 / §3 / §8 / §10（重测口径照抄 §10） |
| 网页交互（`agent_browser`）的权限前提 | `design.md` I11 → `docs/evidence.md` §11（A/B 实测）→ 根 `README.md`「浏览器专家需要完全权限」（三问三答与备选方案取舍） |
| 「治理哪些会话」这件事 | `plugin/dsh-adg-token-budget/design.md`（`presets` 配置 × `session.header.agentPreset` 的乘积） |
| 校验口径本身 | `tools/AGENTS.md` |

## 生效方式

改完必须重启 dsh（Host 进程），并在 Adg 模式的**新对话**里验收 —— 已挂载的会话不会中途换组合，重启前不要引导用户去用 Adg 模式。
