---
title: 变更记录
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
---

# 变更记录

一行一条，时间倒序，**只记"变了什么"**。为什么记在不变量旁的注释里就地说明（见 `docs/docs-guide.md` 第 1 节的分层契约）；决策过程不进 git。

## 2026-09-26（晚·三）— 编排层再落地三条：压缩浏览器细则、digest 中转、先定位再改

- `preset/agent.cordis.yml` 调度 persona **压缩规则 11 / 12**（只动措辞、不动语义）：删掉与 `agent_browser` persona 重复的失败签名与根因复述（退出码 21 / `platform_channel` / `--no-sandbox` 无效那一段），保留 `danger-full-access` 判定、`ask_user_question` 三选项、四分支处置、「同一条路径每任务至多一轮」。两条合计 **1281 → 812 字符**（占 prefix 块 35.6% → 20.0%）。
- `preset/agent.cordis.yml` 新增**规则 13**：大范围改动先派只读的 `agent_researcher` 出 `path:line` 清单，再让 `agent_coder` 按位改（规则 6 的"性质不同"正例；仓库小或改动点已明确时不加这一跳）。
- `preset/agent.cordis.yml` 新增**规则 14**（digest 中转 + 清理口径）：跨专家传递大材料默认塞进委派 prompt（零文件）；长了才落成文件工件，**只写平台临时根**下的 `adg-digest`、**绝不写进工作区 / 仓库**、后续只传绝对路径、**任务结束即删并如实报告删除结果**、`read-only` 下不造工件；digest 必须被标注为派生材料（冲突以源材料为准）。调度者开场那行"不直接碰文件"补上这个唯一例外。
- `preset/agent.cordis.yml` 顶注：实质改动「七处」→「八处」，新增第 8 条说明（规则 13/14 + 压缩 11/12 的量化）；净体积 prefix 块 3598 → **4050 字符**（+452：规则 13+14 加 868，压缩减 469）。
- `preset/design.md`：I13 由「两条派发拓扑规则」扩展为**四条编排层规则**（补入先定位再改、digest 中转）；新增 **I14**（digest 工件的位置、生命周期、`read-only` 退化与"派生材料"标注，依据 `@deepseek-ai/dsh-fs-sandbox` 包文档「围栏行为」）；非功能红线补一条（禁止写进工作区、禁止未删就宣称已清理），「10 条」→「11 条」；「不负责」补「不拥有文件写入的可用范围」（preset 只能规定写哪、何时删，保证不了写得进去）。
- 根 `README.md`：「多智能体的 token 消耗」三行状态由**建议**改**已落地**并更新量化（压缩 −36.6%、digest 的清理口径、规则 13 与规则 6 的校准关系），补"这一轮的净体积"段；「省 token 的口径」「怎么用」第 3 条、「兼容性」（七处 → 八处）同步。
- `preset/testing-guide.md`：不变量全表 `I1..I13` → `I1..I14`；I13 的 N1/N2/N3 三条改写为"四条规则"；新增 **N4 / N5**（digest 落位与清理，N5 含包文档级机制前提，状态如实标**未观测**）；I11 L1 补一句分工说明（调度那组靠 `danger-full-access` / `完全权限` 命中，搜不到 `platform_channel` 是压缩后的预期形状）。
- `preset/AGENTS.md`、根 `AGENTS.md`：编排层红线由两条扩为四条、新增 digest 落位红线；跨模块路由与 Context Loading 的 I13 引用改为 I13 / I14。
- `skills/adg-add-agent/SKILL.md`：第 3 步的"不要动规则 6 / 规则 7"扩为"不要动编排层与闸门那几条（6 / 7 / 13 / 14 / 11 / 12）"；硬约束的唯一例外由两条改四条。
- 未改动：`install.ps1` / `install.sh`、`plugin/dsh-adg-token-budget/` 全部文件、`tools/` 全部文件、`preset/preset.yml`、`docs/registry.md`、`docs/evidence.md`。

## 2026-09-26（晚·二）— 派发拓扑：同实体合并 + 复用既有专家；去掉无关产品提示词

- `preset/agent.cordis.yml` 调度 persona 新增规则 6 / 规则 7：① **同一实体 + 同一性质**的任务合并成一次委派（判据只有"实体 × 性质"两个维度；同一实体的多个方面列进同一条委派，由一个专家一次通读、按方面分节产出）；② 同一实体的**后续**任务先 `list_agents` 找到既有子代理、再 `send_message` 接给已经读过它的那个专家，不重新开一个。原规则 6–10 顺延为 8–12（权限闸门与人工介入两条现为规则 11 / 12）。
- `preset/agent.cordis.yml` 调度 persona 规则 1 补一句：一两次抓取就能答完的已知 URL 定点核对由调度者自己 `web_fetch`，不为此派子代理。
- `preset/agent.cordis.yml` 去掉全部无关产品提示词：删除文件顶注里的名册出处段（腾讯 Marvis 及其专项 Agent 划分）、五个专家 persona 开头的「参考 Marvis 的 X Agent」、`agent_app` 里对 Marvis GUI 路线的对照，以及名册段的「Marvis 参考组」小标题 —— 能力口径与缺口一字未改，只去掉产品名。
- 根 `README.md`：「专家名册与 Marvis 对应关系」改为「专家名册」（三列 8 行，去掉 Marvis 列与「无对应」标注）；`agent_browser` 行的登录墙口径改为指向人工介入协议；新增「多智能体的 token 消耗：已落地与可选手段」一节（8 条手段 + 状态 + 量法 + 1 条未观测）；「persona 层保留的政策」改为「…专家侧的收敛纪律与调度侧的派发拓扑」，写明它与已撤销那层的边界；顶部「省 token 的口径」、「怎么用」、「兼容性」（六处改七处）同步。
- `preset/design.md`：`SchedulerPersona` 新增不变量 I13（两条派发拓扑规则、判据是"实体 × 性质"、禁止改写成预算）；I10 收窄为只管**子代理预算**并写明与 I13 的边界；非功能红线补一条（禁止删掉这两条规则）；For Agents 的「9 条」改「10 条」；负责清单、依赖关系、跨模块路由同步。
- `preset/AGENTS.md`：模块红线把 I10 一条改写为「子代理预算」并补 I13 一条；跨模块路由补「派发拓扑规则」一行。
- `preset/testing-guide.md`：不变量全表补 I13 三条用例（N1 规则在位 / N2 未写成预算 / N3 真实合并与恢复，如实标**未观测**）；I10 K1、I11 L1、I12 M1 的规则编号与判据同步，并去掉几处会漂移的行号坐标。
- `skills/adg-add-agent/SKILL.md`：落盘步骤第 3 步补「不要动规则 6 / 规则 7」；硬约束里那条"不要写 token／读取预算"补上唯一例外（编排层两条规则）；"旧 allow 6 个工具"改成不写会漂移的数量。
- 根 `AGENTS.md`：关键红线第 4 条补上唯一例外（编排层两条派发拓扑规则约束的是"派给谁、派几次"，不是"单个专家能读多少"）；Context Loading 的调度 persona 一行补 I13 的读法。
- 未改动：`install.ps1` / `install.sh`（部署集合没变）、`plugin/dsh-adg-token-budget/` 全部文件、`tools/` 全部文件、`preset/preset.yml`、`docs/registry.md`、`docs/evidence.md`。

## 2026-09-26（晚）— 登录墙／验证码的人工介入协议

- `preset/agent.cordis.yml` 调度 persona 新增规则 10：浏览器专家报「需要用户人工介入」时**由调度者去问用户**（专家问不了，见下），四分支处置 —— 「我去手动登录／过验证，已完成」→ 重新派发同一个 `agent_browser` 并带上端口/profile，要求它 **CDP 重连旧实例**；「不想登录或验证」→ 停手如实汇总；「试过了还是被挡」→ 停手换方案、同一条路径的人工介入每任务至多一轮；「换种方式」→ 走降级路径或改派。并注明不是完全权限时人工介入同样走不通。
- `preset/agent.cordis.yml` 的 `agent_browser` persona：新增「人工介入协议」一段（有头浏览器 + 固定 `--user-data-dir`/`--remote-debugging-port` + 分离启动 → 报四件事 → 停手，**不在工具调用里等用户**；重派时 CDP 重连旧实例、靠端口/profile 而非 pid 定位；三条用户反馈对应的停手口径），并把原「边界与协作」里那句「立刻停止并请用户介入」改成指向该协议。
- `preset/agent.cordis.yml` 文件顶注：实质改动由「五处」改「六处」，补第 6 条（人工介入为什么只能由调度者转达：`ask_user_question` 按 preset 注册且 `ask()` 只认 live runtime root，子代理拿 `DELEGATED_CALLER`）。
- `preset/design.md`：`SchedulerPersona` 新增不变量 I12（专家行不得直接问用户、不得把 `ask_user_question` 加进 `allow`、同一条路径人工介入至多一轮）；「不负责」补一条（不拥有用户问答通道）；非功能红线补一条；For Agents 的「8 条」改「9 条」。
- `preset/AGENTS.md`：模块红线补 I12；跨模块路由补「登录墙／验证码的人工介入」一行。
- `preset/testing-guide.md`：不变量全表补 I12 的三条用例（M1 allow 机器可读 + 语义判读、M2 分工两半、M3 真实重连，如实标**未实现**）；I11 的 L1 用例按实测把命中位置由「三处」更正为「四组」（新协议段末句也命中权限关键字）。
- 根 `README.md`：在浏览器那节新增「登录墙与验证码：人工介入协议」一小节（四分支处置表、为什么专家问不了、窗口怎么开的三条机制实测、两条未观测）；「兼容性」的实质改动清单由五处改六处并补一条「人工介入也只能由调度者转达」。
- `docs/evidence.md`：新增 §12「子代理能不能直接问用户？人工介入的可行路径」（四条源码级事实表 + 有头窗口存活／跨调用 CDP 重连的五条机制实测 + 三条未观测 + 重测口径）；证据来源表补一行人工介入探测脚本；§8 未观测清单补三条（真实站点端到端、关掉浏览器后靠 profile 复用登录态、调度者是否真的转达）。
- `docs/registry.md`：`docs/evidence.md` 行的索引补 §12。
- 未改动：`install.ps1` / `install.sh`、`plugin/dsh-adg-token-budget/` 全部文件、`tools/` 全部文件、`skills/adg-add-agent/SKILL.md`、`preset/preset.yml`。

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
