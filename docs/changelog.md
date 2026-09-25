---
title: 变更记录
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
---

# 变更记录

一行一条，时间倒序，**只记"变了什么"**。为什么记在不变量旁的注释里就地说明（见 `docs/docs-guide.md` 第 1 节的分层契约）；决策过程不进 git。

## 2026-09-26 — 浏览器专家的权限前置闸门

- `preset/agent.cordis.yml` 调度 persona 新增规则 9：派发 `agent_browser` 前先读自己上下文里的 `Current DSH file policy:`，不是 `danger-full-access` 就先 `ask_user_question`（三选项：已切权限继续 / 降级只做 `web_fetch` 静态抓取 / 暂不做），答已切换后还要确认那行真的变了才派发。
- `preset/agent.cordis.yml` 的 `agent_browser` persona：原「实现口径」一段替换为「权限前提 + 失败签名早停 + 降级口径」，写明 `workspace-write` / `read-only` 下浏览器起不来的两条签名（Chrome 退出码 21、Edge `platform_channel.cc … 拒绝访问。(0x5)`）与「不许反复换参数重试、不许假装完成」。
- `preset/agent.cordis.yml` 文件顶注：实质改动由「四处」改「五处」，补第 5 条（权限闸门及其为什么不能从 preset 侧修），并在「刻意没有做的事」里登记未采用 `tools/pre-execute` 硬拦的理由。
- `preset/design.md`：`SchedulerPersona` 新增不变量 I11（派发 `agent_browser` 前必须有权限闸门、且闸门只能是提示级）；「不负责」清单补一条（不拥有沙箱与审批栈的**判定入口**）；非功能红线补一条（禁止删掉或绕过该闸门）。
- `preset/AGENTS.md`：模块特有红线补一条（I11）。
- `preset/testing-guide.md`：不变量全表补 I11 的两条用例（人工 review + 本地文本检索），如实标注**未实现**。
- 根 `README.md`：新增「浏览器专家需要完全权限」一节（A/B 真机实测表、三问三答的源码依据、两道闸门的口径、备选方案的取舍、「这是流程闸门不是安全边界」）；专家名册 Browser Agent 行、怎么用派发表 `agent_browser` 行、「兼容性」的实质改动清单与两条说明同步。
- `docs/evidence.md`：新增 §11「浏览器自动化的沙箱前提（真机实测 A/B）」；§8 未观测清单补两条（闸门是否真的触发、沙箱外手工拉起浏览器 + 连 CDP 端口）；证据来源表补一行沙箱探测脚本。
- 未改动：`install.ps1` / `install.sh`（部署集合没变）、`plugin/dsh-adg-token-budget/` 全部文件、`tools/` 全部文件、`skills/adg-add-agent/SKILL.md`、`preset/preset.yml`。
- 引用真实性复核（按 `docs/docs-guide.md` §5 逐条判存在），更正三处：`docs/evidence.md` 证据来源表与 §11 里那个不存在的 `probe2-*.err.txt` 改成实际文件名形状 `<变体>.out.txt` / `<变体>.err.txt`（如 `edge-dumpdom.err.txt`）；根 `AGENTS.md` 去掉手写的「`README.md`（905 行）」行数（已漂移到 986，且规范禁止手写会漂移的副本）；README 小节标题去掉括号后缀，让全仓 9 处「浏览器专家需要完全权限」引用逐字命中标题。

## 2026-09-25（晚·三）— 按对抗性审查结论修正文档

- 删除 `preset/design.md` 里指向不存在文件的契约引用（`docs/contracts/roster.md`），改为直接指向 `preset/agent.cordis.yml` 的 `delegation` 组并注明是唯一真相源。
- 去掉文档里所有手写行数：`docs/docs-guide.md` 与本文对根 `AGENTS.md` 记的"58 行"是过期值（实测 81 行），一律改成不写当前行数；`preset/design.md` 里 8 个专家行的具体行号（280/307/…）改为按 `id` 定位（行号会被任何一次编辑改掉，需要坐标就跑自检脚本）。
- 纠正"恢复的子代理被再次提醒"的结论：由"已被推翻"改为**机制已观测、事实仍未观测**——日志证明驻留期重置在跑，但 `subagent/end` 对"结束"与"被恢复"发同一事件，无从判定"该子代理确实被恢复"，故既有文档的"未观测"**依然成立**（`docs/evidence.md` §8/§9、`plugin/dsh-adg-token-budget/testing-guide.md`、根 `AGENTS.md` Gate 6 四处统一口径）。
- `docs/evidence.md` §9 补**快照指纹**（`sha256` + 字节数 + 行数 + mtime + UTC/本地双时间戳），并说明"同一命令隔一秒再跑低档计数各 +1"是文件在长、不是口径差；§8 未观测清单补"注入消息转写原文未独立复核（本机无 zstd 解压能力）"。
- 对象形态判错修正：`tools/design.md` 的 `KnobRow` 由"受控操作对象"改判为**不可变值对象**（只读投影，无批准接口、无特权操作封装），`ExitStatus` 删掉状态机、改为**返回契约 + 不变量**。
- 无条件化不变量：`preset/design.md` I3 由带"在…情况下"的条件式拆成两条无条件式（禁止不附前后对比数字就改成本结论 / 禁止把 §2 基线当可比基线）。
- 消除手抄副本：`tools/design.md` 不再复述三个插件的出厂默认值数字，改为指向 `check-preset.mjs` 的 `FACTORY_DEFAULTS`。
- 补登记一条能力边界：`tools/testing-guide.md` 记下自检脚本的行匹配器写死 4 空格缩进，缩进一变整段专家行检查会**静默跳过并仍报通过**。
- `preset/design.md` 补登记 `agent-instructions` 那一行**不是专家委派行**（位于 `delegation` 组之外，自检的专家行检查不覆盖它）。
- 体例统一：状态分层的第二档统一为"单元 / 静态检验 / 变异验证"；`plugin/.../AGENTS.md` 补"必须在模块目录里跑"；`plugin/.../design.md` 的历史包名一句补回连接词。

## 2026-09-25（晚·二）— 作废并重算 `docs/evidence.md` §9 的第一版计数

- §9 第一版用 `Select-String | ForEach-Object | Group-Object` 管道统计，得出 `nudged` 370 行 / 83 个子代理 / 逐 tier 84,83,73,44,30,19,15,10,5,4,1，并把 88 行带 `usage=` 的过渡格式行**整体误判为"旧三档阶梯历史"**（该格式只是过渡期没精简字段，其中 85 行已经是 14 档阶梯）。该口径已作废。
- 重算口径改为**逐行文本匹配、不做管道分组**；当前值：`nudged` 合计 390（当前格式 302 + 过渡格式 88，其中旧三档仅 3 行）、逐 tier 87,86,75,47,33,22,17,10,5,4,1、有 `nudged` 的不同子代理 86（当前格式 64）、`settled:` 90。
- §9 标题时间戳改为实测时刻并附 `sha256` 指纹，新增"该日志一直在被追加，引用必须同时给时间戳与哈希"的强提示；插件 `testing-guide.md` 的引用同步更新。

## 2026-09-25（晚·一）— 活证据复核（本次交付的附带发现）

- 复核 `C:\Users\cenqian\.dsh\adg-token-budget.log` 的逐行文本匹配，登记进 `docs/evidence.md` §9：新 14 档阶梯下 `step stage: nudged` 覆盖 tier 1/14–11/14。
- 登记一条与既有文档冲突的观测：根 `README.md`「现在的证据到哪为止」与插件 `README.md`「What has still never been observed live」把"新阶梯下的注入"记为未观测，而日志显示它已发生（tier 1/14–11/14 都真的注入过）——处置权留人类。
- 登记两条口径差异（`soft stage: nudged` 5 vs 0、`dry-run hard stage: would cancel` 481 vs 437），来源待复核；**未改**既有文档的叙述。
- 修正文档层里对沙箱测试口径的描述：DSH 沙箱（`workspace-write`）下 `node --test test` 必因 piped-stdio 子进程被拒而报 `spawn EPERM`，必须用 `node --test --test-isolation=none test`；PowerShell 管道 `|` 另被拒为 `Access is denied`，重定向到文件允许。

## 2026-09-25（早）— 新增文档层（本次交付）

- 新增根 `AGENTS.md`：项目一句话、命令、关键红线 9 条、生效方式两条链路、模块地图、Context Loading 路由、Quality Gates、能力边界。
- 新增 `preset/design.md`（I1–I10）/ `preset/AGENTS.md` / `preset/testing-guide.md`。
- 新增 `plugin/dsh-adg-token-budget/design.md`（I1–I16）/ `AGENTS.md` / `testing-guide.md`。
- 新增 `tools/design.md`（I1–I9）/ `AGENTS.md` / `testing-guide.md`。
- 新增 `docs/docs-guide.md`（写作规范与文档分层契约）、`docs/registry.md`（索引与冷启动三问的答题路径）、`docs/evidence.md`（实测证据台账）。
- `docs/` 下不建 `_index.md`（当前 4 篇；`docs/registry.md` 即该目录的索引页）。
- 既有文件一律未改：`README.md`、`preset/*.yml`、`tools/check-preset.mjs`、`skills/adg-add-agent/SKILL.md`、`install.ps1` / `install.sh`、插件目录下全部文件。
