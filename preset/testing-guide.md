---
title: preset 模块测试指南
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-28
---

# preset 模块测试指南

对象与不变量编号见 `design.md`（I1..I17 一一对应，本文不重复定义）。类型只有四种：**静态自检**（`tools/check-preset.mjs` 真的会拦）、**构建**（`tools/gen-preset-bundle.mjs` 真的会拦：`preset/preset.yml` 没有可用的 `name`、或 `preset/agent.cordis.yml` 顶层不是条目列表时 exit 1）、**真实挂载**（重启 dsh 后按根 `README.md`「给 AI 的安装指令」第 8 步做：`agentPresets.resolve('adg')` 的 `.broken` 为空 + `compositionInventory()`）、**人工 review**（脚本抓不到，必须有人看）。

## 命令（可直接照抄）

```sh
node tools/check-preset.mjs        # 校验仓库里的 preset/（**唯一真相源**；没有"已安装的第二份文本"可传了）
node tools/gen-preset-bundle.mjs   # 生成 bundle/adg-preset/{cordis.patch.yml,package.json}（构建产物，不手改）
```

零依赖（只用 `node:fs` / `node:path` / `node:url`，不引 YAML 库）。退出码：**0 = 通过**（允许 WARN，WARN 不是失败）；**1 = 不通过**（有 ERROR，其含义只有一个：这次委派必然抛错）；**2 = 读不到目标文件**（路径不存在/打不开，或存在但不是普通文件）。路径参数仍在（可校验任意一份文本），但**没有第二份"已安装的文本"了** —— 旧的 `${DSH_HOME}/.agent-presets/<id>/` 发现机制在 dsh 0.1.7-rc.2 已被移除，`preset/agent.cordis.yml` 是唯一真相源；安装侧的真相是 profile 里注册的那一行声明（由 `bundle/adg-preset/cordis.patch.yml` 生成物提供）。

## 1. 不变量 → 用例 → 类型（全表）

| 不变量 | 用例 | 类型 | 已实现？ |
|---|---|---|---|
| I1 `validated` ≠ `mounted` | A1 `node tools/check-preset.mjs` 退出码 0 后，**不得**据此宣称已挂载；必须做一次真实挂载（判据：`agentPresets.resolve('adg')` 的 `.broken` 为空） | 真实挂载 | 未实现（脚本无挂载能力）；人工 review 兜底 |
| I1（同上） | A2 对脚本源码提断言：它没有挂载能力——只 import `node:fs` / `node:path` / `node:url`，且不含挂载调用 | 静态自检 | 已实现（本次实测）：`Select-String -Path tools\check-preset.mjs -Pattern 'ctx\.load\|agentPresets\|compositionInventory'` → 0 命中；`^import` 只命中上述三个内建模块。**注意**：该文件的注释里提到过 `standingKeyFor`（说明它在本版 dsh 里**已不存在**、别调），那不是挂载判据，本身也只是注释层 —— 2026-09-28 已把它同步成"按 README 第 8 步 + `agentPresets.resolve('adg')` 的 `.broken` 为空"（见「过期检测」） |
| I3c 生成物不许手改、也不许当真相源 | A3 `node tools/gen-preset-bundle.mjs` 重跑一次后：`bundle/adg-preset/cordis.patch.yml` 的 `plugins:` 段必须与 `preset/agent.cordis.yml` 逐行一致（只差一层缩进），且两个稳定落点 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-preset/`（plain）与 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-preset-bili/`（注入版）下的那两份**分别**与 `bundle/adg-plain/`、`bundle/adg-preset/` 逐字节一致 | 构建 | 已实现（重跑即覆盖，手改必被抹掉）。**判违例看语义**：有人拿 `$DSH_HOME/bundles/` 或 `bundle/` 下的文件当"源文件"改 |
| I2 未重启不得宣称生效 | B1 改完只跑自检 + 不重启，然后**明确记录**此时不得引导用户进入 Adg 模式 | 人工 review | 未实现（脚本无法观测重启）。依据：`docs/evidence.md` §5「热重载边界（真机实测）」 |
| I2（同上） | B2 改完重启，在**新对话**里选择「Adg 多智能体模式」，核对模型可见的 `agent_*` 工具面等于当前名册 | 真实挂载 | 未实现（需 Host 侧调用）；人工 review 兜底 |
| I2（同上） | B3 登记新的触发口径（2026-09-28 实测）：profile 的 `cordis.patch.yml` 或 profile 清单变动会让整份 patch 栈重读（`dsh-hmr` 的 `refresh()` 走 `readProfilePatches`），重读后声明会重新注册；**但「已挂载的会话不会中途换组合」不变**，所以操作口径仍是"重启 dsh + 新对话验收"。**禁止**在文档或回复里宣称「不重启也会生效」；**未观测**的是：不重启时新开的会话会不会直接加入重注册后的声明（没有实测，不许写成会） | 人工 review | 未实现（冲突属文档层事实，无脚本可判） |
| I3 成本结论须有实测数字 | C1 任何「改 `stepTiers` 相关口径以外的成本结论」的改动，必须附前后对比数字（重测口径照抄 `docs/evidence.md` §10）；拿不出就不许改 | 人工 review | 未实现（凭据由人持有） |
| I4 `toolName` 唯一且形如 `agent_<name>` | D1 制造重复 `toolName`（同文件出现两次 `toolName: agent_coder`）→ 必须 ERROR | 静态自检 | 已实现。`toolName "X" 重复（第 N 行与第 M 行）：每个委派工具名必须全局唯一` |
| I4（同上） | D2 形状不合法（如 `toolName: coder`）→ 必须 ERROR | 静态自检 | 已实现。`第 N 行 agent-coder：toolName "coder" 不符合 agent_<name> 约定`（正则为 `^agent_[a-z0-9_]+$`） |
| I4（同上） | D3 缺 `toolName` → 必须 ERROR | 静态自检 | 已实现。`第 N 行 agent-coder：缺少 toolName` |
| I5 `allow` 只写已注册工具名 | E1 写一个未注册名（如 `allow: [sqlite]`）→ 必须 ERROR | 静态自检 | 已实现。`第 N 行 agent-x：allow 里的 "sqlite" 不是本组合注册过的工具名——restrict() 会抛 "names unknown global tool"`。合法集来自脚本内 `KNOWN_TOOLS`；`CONDITIONAL_TOOLS`（`bash` / `read_image` / `subagent_codex` / `subagent_claude_code`）与 `SCHEDULER_ONLY`（`workflow` / `ralph`）只给 WARN |
| I5（同上） | E2 把某个专家的 `agent_*` 名字写进另一个专家的 `allow` —— 这是官方允许的「允许直接转交」开关，**不得**报 ERROR | 静态自检 | 已实现（脚本对该情形放行） |
| I5（同上） | E3 新增了一个已注册工具却忘了同步脚本里的 `KNOWN_TOOLS` → 会误报 ERROR；反向漏报需人工比对 composition 的 tool 行与 `KNOWN_TOOLS` | 人工 review | 未实现（脚本不会自校验清单） |
| I6 专家 `allow` 不得含 `workflow` / `ralph` | F1 给专家行加 `- workflow` → 必须 WARN（不是 ERROR：`restrict()` 会接受它） | 静态自检 | 已实现。`第 N 行 agent-x：allow 里的 "workflow" 是策略越界——它只留给调度智能体（restrict() 会接受它、不会让委派失败，但专家拿到就能绕开名册开任意代理）` |
| I7 `backgroundMode` 必须 `continuable` | G1 改成 `one-shot` → 必须 WARN | 静态自检 | 已实现。`第 N 行 agent-x：backgroundMode 不是 continuable（专家默认后台接续）`。注意它是 WARN 而非 ERROR：脚本注释写明「判错只留给『这次委派必然抛错』的情形」 |
| I8 专家行不得写 `maxDepth` | H1 给专家行加 `maxDepth: 0` → 脚本**不报错**（它不检查该键） | 静态自检 | **未实现**；靠人工 review 兜底（依据：`skills/adg-add-agent/SKILL.md` 记载写 `0` 会让每一次 `agent_*` 委派以 `subagent depth 1 exceeds maxDepth 0` 失败） |
| I8（同上） | H2 交付前检索专家段内是否存在 `maxDepth`；当前文件只有 codex / claude-code 两条 disabled 行带 `maxDepth: provider-managed` | 人工 review | 未实现（可作为本地检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'maxDepth'`；本次实测只命中那两条 disabled 行） |
| I9 名册 ↔ 专家行双向一致 | J1 只加专家行、不改顶部名册 → 必须 ERROR | 静态自检 | 已实现。`调度名册里没有 agent_x：专家行加了但 persona 名册没同步（调度智能体不会知道它存在）` |
| I9（同上） | J2 只在名册里写 `agent_x`、没有对应行 → 必须 ERROR | 静态自检 | 已实现。`调度名册提到 agent_x，但没有对应的专家行（名册与实现不一致）`。若连 `prefix: \|-` 块都找不到：`没找到顶部 persona 的 prefix: \|- block（调度名册应当写在这里）` |
| I9（同上） | J3 名册里的每个名字是否**语义上**对得上它那一行的 persona | 人工 review | 未实现（脚本只做文本包含判断） |
| I10 名册不得写与插件重叠的政策 | K1 检索名册块内是否出现**子代理预算**类措辞（「委派预算 / 步数区间 / 不要轮询步数 / 读取预算 / 结论 N 字符内」） | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '预算\|步数区间\|轮询步数'` —— 命中的多数是文件顶部的解释性注释（说明这些政策已被删除、不要在调度 persona 里写回）。**判据**：命中行落在 `prefix: \|-` 块内、且语义上是"限制**单个专家**怎么读、怎么写"才算违例；I13 那五条**编排层**规则（连同它们的成本理由、必要性闸门与 digest 中转口径）以及 I15 的输出／交接去冗余纪律**不算**违例（I15 明文禁止被改写成字数上限），见 I13 / I14 / I15 |
| I10（同上） | K2 确认专家行 persona 末行的「收敛纪律」仍在（这是**子代理侧**口径，与 I10 限制的**调度侧**政策不同，不得一起删） | 静态自检 | 未实现（脚本不查该句）；可按 I9 同类方式人工核对 9 行 |
| I11 `agent_browser` 的权限闸门不得被删掉或绕过 | L1 检索闸门的两半是否还在：调度名册块里有没有「派发 `agent_browser` 前先看当前文件策略、不是 `danger-full-access` 就先 `ask_user_question`」的规则；`agent-browser` 那一行的 persona 里有没有失败签名与「停手＋如实报出」 | 人工 review | 未实现（脚本不查语义）。辅助检索（`-Encoding UTF8` 不能省，否则中文匹配不上）：`Select-String -Path preset\agent.cordis.yml -Pattern 'danger-full-access\|platform_channel\|完全权限' -Encoding UTF8` —— 注意 PowerShell 的 `Select-String` 用正则，`\|` 是**字面竖线**，要按关键字择一匹配就得写不带反斜杠的 `\|`。本次实测（用不带反斜杠的写法）命中**四组**：文件顶注的第 5/6 条改动说明、调度 persona 规则 11/12、`agent-browser` 的「权限前提」段、以及它的人工介入协议段末句（「本会话不是完全权限时有头窗口也开不出来」）。缺任一组即违例。**注意分工**：规则 11/12 只保留**决策**（判定、三选项、四分支；原先一并保留的「至多一轮」已于 2026-09-27 按用户要求删除），失败签名与根因（退出码 21、`platform_channel`）只住在 `agent-browser` 的 persona 与 README —— 所以检索时调度那组是靠 `danger-full-access` / `完全权限` 命中的，别因为那里搜不到 `platform_channel` 就判违例（那正是压缩后的预期形状） |
| I11（同上） | L2 闸门有没有被写成**权限强制**（例如文档/注释里宣称「preset 会拦住不听话的模型」「这是安全边界」） | 人工 review | 未实现（语义判断）。判据：`design.md`「不负责」清单、`README.md`「浏览器专家需要完全权限」的「这是流程闸门，不是安全边界」一句必须与实现口径一致 |
| I11（同上） | L3 闸门是否真的被遵守（真实 Adg 会话里，派发 `agent_browser` 之前有没有先问用户） | 真实挂载 | **未实现**：闸门刚落地，还没有一次真实 Adg 会话走过它（`docs/evidence.md` §8 未观测清单已登记这条缺口与量法） |
| I11（同上） | L4 `agent_browser` 的 persona 里那条**工具链路径与命令**是否还指向真实存在的东西：`$DSH_HOME/browser/cli.mjs` 的落点（与 `install.ps1` / `install.sh` 的 `browser/` → `${DSH_HOME}/browser/` 一致）、以及 persona 里出现的命令名（`profile` / `launch` / `status` / `text` / `eval` / `shot` / `close`）与 `STATE=` / `PORT=` / `PROFILE=` 输出行是否都在 `cli.mjs` 的 `USAGE` 与实现里 | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'cli\.mjs\|STATE=\|PROFILE=' -Encoding UTF8` 取出命令与输出行，逐个对照 `node "$env:DSH_HOME\browser\cli.mjs" help`（唯一真相源）。判违例看**能不能真的跑起来**：命令名对不上、或路径与安装脚本落点不一致即违例（那会让专家每一步都撞一个不存在的命令） |
| I12 专家行不得直接问用户，人工介入只能由调度者转达 | M1 ①任何专家行的 `toolFilter.allow` 里有没有 `ask_user_question`；②专家 persona 里有没有「请用户介入／去问用户」这类**要求它自己问**的话 | 静态自检 | ①机器可读：`node tools/check-preset.mjs` 会打印每行的 allow，本次实测 9 行**都没有** `ask_user_question`（正确：它只归调度者）。②人工 review：辅助检索 `Select-String -Path preset\agent.cordis.yml -Pattern 'ask_user_question' -Encoding UTF8` 会命中多处，**其中多数是允许的** —— 文件顶注的说明、调度 persona 规则 11/12、`plan-mode` 行的出厂人设，以及 `agent-browser` 里那句「你**不能**直接问用户（调 ask_user_question 只会拿到 DELEGATED_CALLER）」。**判违例看语义，不看是否出现这个词**：出现「把它加进 allow」或「要求专家去问用户」才算 |
| I12（同上） | M2 人工介入的分工两半是否都在：调度 persona 四分支处置（已完成／不想／仍被挡／换方式）+ `agent-browser` 的 persona「`launch` 开有头窗口 → 停手 → 报四件事 → 被重派时再 `launch` 走幂等复用、不新开浏览器」 | 人工 review | 未实现（语义判断）。判据与 `docs/evidence.md` §12 的机制实测一致；「重连旧实例」现在固化在 `browser/` 的工具链里（`launch` 幂等，见 `browser/design.md` I3），persona 只需写"再 `launch`" |
| I12（同上） | M3 专家被重派时是否真的重连旧实例（而不是另开一个浏览器） | 真实挂载 | **未实现**：机制已实测（有头窗口跨工具调用存活 + 新进程 CDP 重连并继续驱动，见 `docs/evidence.md` §12；`launch` 幂等与 cookie 跨重启存活见 §13），但**真实站点的登录／验证码流程没有端到端跑过**，所以「专家会不会照做」这一半没有证据 |
| I12（同上） | M4 persona 里禁止代填密码 / 禁止读取 profile 的 cookie 库 / 禁止验证码识别与指纹伪装这三条边界是否还在（它们同时是 `browser/` 的非功能红线） | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '不得尝试绕过验证码' -Encoding UTF8`，再核对 `agent-browser` persona 里"登录态是资产"那一段没有出现"让专家代填账号密码"这类要求；判据与 `browser/design.md`「非功能红线」逐条对齐 |
| I12（同上，**事前半条**） | M5 调度 persona 里有没有这半条：①「请用户手动登录是本模式的正常路径，不是失败」②「**不要**在委派 prompt 里预先禁止它登录（尤其别把「不登录」写进「本次不做」）」③「也不要为了回避登录就先降级成静态抓取」④「只有在你明确知道用户不想登录 / 不想验证时才预先禁止」⑤把红线解释清楚：「登录由人在有头窗口里完成」约束的是**代理不许自己代填密码、不许绕过登录墙**，不是「不许请你登录」 | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '正常路径\|预先禁止\|不许请你登录' -Encoding UTF8` —— **照抄即可**（表格里的 `\|` 渲染出来就是竖线；`-Pattern` 里带反斜杠的竖线是**字面竖线**，那样一行都搜不到，实测命中 0 行）。**按此口径实测命中 2 行**：文件顶注第 6 条的新增段、调度 persona 规则 12。**判违例看语义**：规则 12 只剩事后四分支、或出现「不登录」「不要登录」被写成对专家的要求，即违例（正是这条的来源） |
| I12（同上，事前半条） | M6 调度者是否真的**不再**要求专家不登录（真实 Adg 会话里，需要登录态的任务，委派 prompt 里有没有出现"不登录 / 不要登录 / 本次不做：登录"） | 真实挂载 | **有反例（用户实测，2026-09-27 报告）**：上一版调度者会给 `agent_browser` 下「不登录」的要求，而用户其实可以手动登录。改动后的行为**未观测**。量法：造一个必须登录才拿得到内容的任务，看①委派 prompt 里有没有禁止登录的措辞②调度者有没有按规则 12 转达 `ask_user_question`③最终答复有没有如实写「未登录 → 拿不到 X」而不是"静态抓取已足够" |
| I12（同上，**无次数上限**） | M7 调度 persona 里不得再有「每任务至多一轮」这类人工介入**次数上限**，且规则 16 在位：①默认不设上限②对**所有专家、所有任务**适用（不只浏览器）③唯一例外是**用户自己**要求「不要打扰」或「只介入一轮」④两种例外都要在交付里写明是用户的要求⑤收手判据只有"用户说不想做"与"他自己试过仍被挡" | 人工 review | 未实现（脚本不查语义）。辅助检索：`Select-String -Path preset\agent.cordis.yml,preset\design.md,preset\AGENTS.md -Pattern '至多一轮\|只问一次\|次数上限\|不要打扰' -Encoding UTF8`（表格里的 `\|` 渲染成竖线，照抄即可）—— **正常形状**：命中只出现在规则 16 / I12 / 模块红线（"默认不设上限 + 用户要求才算例外"）与顶注那句「某条上限已于 2026-09-27 删除」的历史说明里。`README.md` 与 `docs/changelog.md` 的**历史条目**（记录当时压缩"保留了什么"）不算违例 —— 变更记录不许回改。**判违例看语义**：任何地方仍写着"默认每任务至多一轮""不要再让他试第二次"即违例 |
| I13 编排层规则必须在位，且只能是编排层 | N1 调度名册块里是否留着五条规则：① 同一实体 + 同一性质的任务合并成一次委派（含**浏览器站点成本**那半：同一份信息默认只在一个站点取，2026-09-27 追加）；② 同一实体的**后续**任务用 `list_agents` + `send_message` 接给已经读过它的那个专家（**2026-09-29 起还须含 status 判据**：先看 `list_agents` 的 `running` / `inactive`；`running` 时三分支 = 修正／补充同一件事就现在发 ／ 同一实体上的另一件事不插进去、等结算通知唤起后再接给同一个它 ／ 取代在飞任务先 `interrupt_agent`）；③ 大范围改动先派 `agent_researcher` 出 `path:line`、再让 `agent_coder` 按位改；④ 跨专家传递大材料走 digest；⑤ **必要性闸门 + 强制挂号**；委派 prompt 是否写着**五项必填**（含**验收标准**与**本次不做**） | 人工 review | 未实现（脚本不查语义）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '同一实体\|path:line\|digest\|验收标准\|必要性闸门' -Encoding UTF8` —— 本次实测命中文件顶注第 7 / 8 / 9 条与调度 persona 规则 5 / 6 / 7 / 13 / 14 / 15；**只有落在 `prefix: \|-` 块内的才算出在 persona 里**，顶注命中不算 |
| I13（同上） | N2 这五条有没有被写成**子代理预算**（"结论 N 字符内""每次最多读几个文件"） | 人工 review | 未实现（语义判断）。判据：规则文本只出现"实体 / 性质 / 合并 / 恢复 / 接给 / 定位再改 / 中转 / 必要性 / 验收标准 / 挂号"这类**编排**措辞，不出现对单个专家的读取量、产出量限制 —— 后者是 I10 禁止的东西 |
| I13（同上） | N3 调度者是否真的**合并**同类委派、按规则 7 恢复既有专家、按规则 13 先定位再改、按规则 14 用 digest（而不是每次新建委派 / 让 coder 盲搜 / 把大材料反复塞进 prompt） | 真实挂载 | **未观测**：到本次改动为止，还没有真实 Adg 会话带着这五条规则跑过。量法：在新会话里让同一个代码库做**两轮**探索，数①产生的子代理条数（同类任务应为 1 个）②`list_agents` / `send_message` 的调用次数；口径见根 `README.md`「多智能体的 token 消耗：已落地与可选手段」。「子代理还在 `running` 时不得把它 steer 进去」这半的判据另见 N10 / N11 |
| I13 第 ⑤ 条（必要性闸门 + 强制挂号） | N6 规则 15 的三问、以及"不做的旁路不许静默丢掉、必须在最终交付里挂号、确定要做时并进同实体同性质的那条委派"是否都在调度 persona 里 | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '必要性闸门\|未纳入本次' -Encoding UTF8` —— 命中顶注第 9 条与规则 15；判违例看语义：出现"可以静默省略""不必告诉用户"才算 |
| I13 第 ⑤ 条（同上） | N7 旁路型任务里，调度者是否**没有**为旁路单独开子代理，并且在最终交付里挂了号 | 真实挂载 | **未观测**：尚无真实会话走过这条闸门。量法（**四个观测量**，口径见根 `README.md`「多智能体的 token 消耗：已落地与可选手段」）：① **子代理个数**（主指标：制造一个含旁路诱因的任务，例如"便携小巧的录音笔"，旁路调研不应产生独立子代理）② 步数 **p50 / p90**（长尾应下降）③ 审计脚本按 preset 分组的 `requests` ④ **挂号抽查**（人工抽 3–5 个含旁路诱因的任务：最终答复里**有**挂号句、转录里**没有**以该旁路为主题的委派 = 遵守；挂号句缺失 = 旁路被静默丢掉，比不做规则更糟；出现委派 = 闸门未生效） |
| I13 ①（**浏览器站点成本**，2026-09-27 追加） | N8 调度 persona 里有没有这半条：①同一份信息**默认只在一个站点取**②三个例外（用户明确要多源 / 对比 / 交叉验证；那个站点拿不到或各站数据互相矛盾；交付物本身就是跨站点比较的结果，如比价、同款选型）③真要多源就让**一个** `agent_browser` 在一条委派里串行跑完并合并④不许为"更全一点"替同一个问题派两个站点 | 人工 review | 未实现（脚本不查语义）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '只在一个站点' -Encoding UTF8` —— **只应命中 1 行**：调度 persona 规则 6（末尾那半）。**别拿 `多源` 当判据**：它是常用词，实测在名册的 `agent_search` 行、规则 1 / 4、以及 `agent-search` 自己的 persona 里都会命中（5 行，全部无关）。**判违例看语义**：委派里出现"再去 X 站核对同一信息""两个站点各查一遍"而三个例外都不成立，即违例 |
| I13 ①（同上） | N9 真实会话里，同一份信息是否真的**没有**被要求在两个以上站点重复取 | 真实挂载 | **未观测**：尚无真实 Adg 会话走过这条。量法：制造一个**单站点即可答完**的信息需求（例如"某酒店某晚的房价"），数 `agent_browser` 委派里点名的站点数（同一份信息应为 **1 个**；不在三个例外内却出现 ≥2 个即违例），并对照同任务 `TABS` 的净增长（应与委派条数同向下降） |
| I13 ②（**`running` 不得插话**，2026-09-29 追加） | N10 规则 7 里是否三件都在：①复用前要求先看 `list_agents` 的 status ②写明 `send_message` 对 `running` 的子代理是 **steer**（会插进它**当前轮的下一步**）③`running` 的三分支（修正／补充同一件事 → 现在发；同一实体上的另一件事 → **不插进去**、结束本轮等**结算通知**唤起后再接给同一个它；取代在飞任务 → 先 `interrupt_agent` 停当前轮再发） | 人工 review | 未实现（脚本不查语义）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'steer\|interrupt_agent\|结算通知' -Encoding UTF8` —— **正常形状**：命中文件顶注第 14 条与调度 persona 规则 7 / 8 / 17（`steer` 只应出现在顶注第 14 条与规则 7；任何专家行的 `allow` 里**不应**出现 `interrupt_agent`，它只在调度者侧）。**判违例看语义**：规则 7 只写"先看 status"却没写 `running` 怎么处置、或把判据写成"它快做完了"（`list_agents` **不含进度**，那种判据根本不可观测）才算 |
| I13 ②（同上） | N11 真实会话里调度者是否**不再**向正在工作的子代理插话：子代理 `running` 期间用户再提问时，它不会把"同一实体上的另一件事"steer 进去 | 真实挂载 | **未观测**：改动刚落地，尚无真实 Adg 会话走过。量法：造一个长任务派给某个专家，在它 `running` 时对调度者提一个**同一实体但不同交付物**的问题 —— 判据是①转录里**没有**指向该 `running` 子代理的 `send_message` ②调度者要么自己答、要么结束本轮等结算通知 ③结算后那件新事确实被接给**同一个**子代理（`list_agents` + `send_message`）；若它当场 steer 进去即违例。机制依据（源码级事实，**不是**实测）见 `docs/evidence.md` §19 |
| I14 digest 工件只能落在平台临时根、任务结束即清理 | N4 调度 persona 里有没有"只写平台临时根 / 绝不写工作区 / 任务结束即删 / 删不掉要说 / `read-only` 下不造工件"这五件事；有没有在任何专家 persona 里被改写成"把中间文件写进项目" | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'adg-digest\|临时根\|绝不' -Encoding UTF8` —— 命中文件顶注第 8 条与调度 persona 规则 14 即正常；**判违例看语义**：出现"写进工作区/仓库"或"不用删"才算 |
| I14（同上） | N5 调度者是否真的把 digest 落在**平台临时根**（而不是工作区）、并在交付前删掉自己创建的工件 | 真实挂载 | **未观测**：尚无真实 Adg 会话走过 digest 路径。量法：制造一个"多性质专家看同一份大材料"的任务，交付后检查①工作区 `git status` 干净（没有 digest 残留）②平台临时根下 `adg-digest` 无本次任务残留。**机制前提**（源码/包文档级事实，非真机实测）：`@deepseek-ai/dsh-fs-sandbox` 的「围栏行为」写明读取不受围栏限制、`workspace-write` 允许目标位于工作区或平台临时区域、`read-only` 拒绝一切变更 |
| I15 输出／交接件的去冗余纪律（禁止回贴原文 / 禁止重复 / 禁止转述过程 / 未验证块必填） | O1 调度 persona 里有没有这四条禁止式判据、规则 5 有没有"五项分字段写 + 期望产出里写明返回结构"、以及**有没有被写成任何字数上限** | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '去冗余\|回贴\|未验证 / 未纳入\|分字段' -Encoding UTF8` —— 命中顶注第 10 条与规则 5 / 10 即正常；**判违例看语义**：出现"N 字符内""不超过 N 字""结论控制在"才算（那正是已撤销的那层）。`design.md` I10 / I15 的边界写明：本条管"写下来的东西怎么组织"，不是产出量限制 |
| I15（同上） | O2 真实会话里，子代理返回结果与调度者的最终答复是否真的**不重复、不回贴工具输出原文**，且**"未验证 / 未纳入"块仍然齐全** | 真实挂载 | **未观测**：尚无真实 Adg 会话带着 I15 跑过。量法（五条，最后一条最重要）：① 审计脚本 `adg` 行的 `output`（总量 0.9M 那一栏）② 同一批会话重跑后的 **cache-read 增速**（去冗余的真实杠杆 —— 写下的字会在后续每一步作为 cache-read 重发）③ 结果里有没有大段与工具输出原文重合（可半自动：与工具结果做重合检测）④ 相邻 assistant 消息的重复率 ⑤ **反向检查："未验证 / 未纳入"块是否仍齐全** —— 它比前四条重要，防止"求简洁"把诚实护栏删掉。**依据状态分层**：`docs/evidence.md` §2 的 94.1M / 0.9M / 85.1M 是实测；"写下的字会被重发约 (剩余步数) 次"是由聚合数字算出的**推算**，不是新实测 |
| I16 `agent-general` 是交接专用的**叶子**，且只在用户显式要求时派发（2026-09-28 新增） | P1 三个半条是否都在：①`agent-general` 那一行的 `allow` 里**没有**任何 `agent_*` 名册行、没有通用 `subagent` / `subagent_fork`、没有 `workflow` / `ralph`，且**有** `send_message`；②调度 persona 里有一条规则把触发条件钉成**用户的显式要求**（"交给子代理 / 另开一个上下文 / 换个智能体接手"）、并写明它**不过**必要性三问、过的是"用户显式要求"这道闸门；③那条规则里写明了"完成或用户让你结束时先用 `send_message` 回报上级再收尾"与"回报后按规则 7 接给**同一个**它" | 静态自检 + 人工 review | ①机器可读：`node tools/check-preset.mjs` 会打印每行的 allow，本次实测 `agent_general[16]`、名单里**没有** `agent_*` / `subagent` / `workflow` / `ralph`、**有** `send_message`。**脚本拦不住"给它加 `agent_*`"**（那在文本上合法、`restrict()` 也接受），所以这一半靠人工 review —— 判违例看语义：`allow` 或 persona 里出现"再派一个子代理/专家"即违例。②③辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'agent_general\|显式要求' -Encoding UTF8`，正常形状是命中顶注第 12 条 + 名册行 + 规则 17 |
| I16（同上） | P2 真实会话里：①用户**没提**"交接"时调度者不派 `agent_general`；②用户明确要求后它被派发，且它的任务末尾被追加了 "Your parent agent id is …、结束前用 send_message 回报"那段指引；③它收尾时真的用 `send_message` 回报，调度者侧能用 `list_agents` 看到它、并用 `send_message` 接给**同一个**它 | 真实挂载 | **未观测**：尚无真实 Adg 会话走过这条。机制是**源码级事实**（`@deepseek-ai/dsh-subagent` 的 `withContinuableReturnGuidance` 只在子代理**看得见 `send_message`** 时注入；`list_agents` 只列直接子级、`send_message` 只到直接父/子）—— 见 `preset/design.md` I16。量法：新会话里先说一句普通需求（转录里**不应**出现 `agent_general`），再说一句"把这件事交给子代理做"（**应**出现），然后数它那一轮 ①`send_message` 调用次数 ②最终答复是不是给调度者看的**交接回执**（结论 / 证据 / 未验证 / 需要上级做的下一步四字段）而不是对用户的寒暄 |
| I17 委派默认走后台，阻塞会把这一次降级成一次性（2026-09-28 新增） | Q1 规则 8 里是否四件都在：①「委派一律用后台方式发出」（不设 `run_in_background: false`）②写明**代价**（阻塞 → 一次性 → 不进 `list_agents`、`send_message` 报 `NOT_RESUMABLE`、规则 6 / 7 省下的"重读"白付）③写明"后台不等于不管结果"（结算时会连同结果通知你）④**没有任何阻塞例外** —— 规则里要写明"后台派出后直接结束本轮，结算通知会把你重新唤起"，且**没有**"用户显式要求才允许阻塞"这类门槛、**也没有**"同一轮下一步就要用结果就可以阻塞"这条（2026-09-28 按用户指出的机制删掉，见 I17） | 人工 review | 未实现（脚本不查语义）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'run_in_background' -Encoding UTF8` —— **正常形状：只命中规则 8 与顶注第 13 条**（**不应**出现在任何专家行的 `config` 里；专家行只写 `backgroundMode: continuable`）。**判违例看语义**：出现"允许阻塞 / 默认前台 / 阻塞也没关系"，或例外被放宽成"想省自己的上下文 / 想并行"即违例 |
| I17（同上） | Q2 真实会话里有没有出现 `run_in_background: false`，以及被阻塞的那一次是不是真的接不回来 | 真实挂载 | **未观测**：改动后还没有真实 Adg 会话走过。量法：造一个需要 2 个以上专家的任务，数 `agent_*` 调用里 `run_in_background: false` 的次数（应为 **0**）；对照组观测量是**同一次委派**在 `list_agents` 里是否出现、`send_message` 能否接上（阻塞的那一次应**看不到、接不上** —— 这正是规则的立论依据，用来确认代价描述没写反） |

## 2. `PresetRevision` 状态机迁移矩阵（全表）

起始状态为行，事件为列。**自环**=合法但状态不变；**禁止**格标注原因。状态定义见 `design.md`「PresetRevision」。

| 起始 \ 事件 | `node tools/check-preset.mjs` 退出 0 | 退出 2 | `install.*`：生成 bundle + 落到 `$DSH_HOME/bundles/dsh-adg-preset/` + `link:` 进 profile + 写进 `dsh.profile.bundles` | 改声明行的 `config.id`（换 preset id） | registry 读到声明行（profile patch / 清单变动触发整栈重读） | 重启 dsh | 新会话加入该组合 | 重启前宣称「已生效」 |
|---|---|---|---|---|---|---|---|---|
| `drafted` | → `validated` | 自环（文件不可读，状态不变） | 禁止：未 `validated` 就部署 = 未经过校验的文本进本机 | 禁止：换 id 即切断 `session.header.agentPreset === 'adg'` 的治理面 | 禁止：本机没有这一行声明可读 | 自环（重启读的是已注册的那一行声明） | 禁止：没有组合可加入 | 禁止（I2） |
| `validated` | 自环（重复自检） | 自环 | → `deployed` | 禁止：同上，id 漂移 | 禁止：跳过了 `deployed`，本机没有新文本 | 自环（同上） | 禁止：无组合 | 禁止（I1 + I2） |
| `deployed` | 自环（校验的永远是仓库那份源文本——**没有第二份"已安装的文本"可传**） | 自环 | 自环（幂等覆盖；同一文本不产生新语义） | 禁止：id 漂移 | **→ `mounted`**：声明被重新注册（2026-09-28 实测，触发条件是 profile patch / 清单变动）；**但已挂载的会话不换组合** | → `mounted`（重启必然重读整份 patch 栈并重新注册） | **未观测**：不重启时新开的会话会不会直接加入重注册后的声明。保守口径：只写「声明已重新注册」，**不得**写成「已在会话里生效」 | 禁止（I1） |
| `mounted` | 自环 | 自环 | 自环：**已挂载会话不换组合**，部署一份新文本不会改动现有会话的组合 | 禁止：id 漂移 | 自环（同一版声明重复注册） | 自环：重启本身不迁移状态，重启之后由新会话带来 `live` | → `live`（仅新会话） | 禁止（I2） |
| `live` | 自环 | 自环 | 自环（现有会话固定在它起步时的组合上） | 禁止：id 漂移 | 自环（旧 `live` 会话不受影响；新声明留给下一个新会话） | 自环：**旧会话不会跟着换组合**，别在重启后拿旧会话验收 | 自环（该组合已有会话在用） | 禁止（I2） |

迁移唯一入口：`install.ps1` / `install.sh`（`validated → deployed`），其后由 registry 的注册与组合接续（`deployed → mounted`）。禁止绕过对象直接改状态（手工往 `$DSH_HOME/bundles/` 贴文件、或手改 `bundle/adg-preset/` 的生成物都算绕过）。

## 3. 跨模块消费侧契约测试

### 3.1 `dsh-adg-token-budget` 消费的是 preset **id**，不是 `preset.yml` 的 `name`

事实链（源码级，已核对）：

- 插件默认配置 `presets: Object.freeze(['adg'])` —— `plugin/dsh-adg-token-budget/src/config.js:43`；
- 判定 `presets.includes(session.header.agentPreset)` —— `plugin/dsh-adg-token-budget/src/budget.js:66-69`；
- 挂载行的 `presets: ['adg']` 现在写在**插件包自己的 bundle 层** `plugin/dsh-adg-token-budget/cordis.patch.yml`（2026-09-28 起；旧形状是 `install.ps1` 把同一行手贴进 profile 的 `cordis.patch.yml`）；
- preset id **取自生成 patch 里那一行声明行的 `config.id`**（不再是目录名）—— 值由 `tools/gen-preset-bundle.mjs` 的 `PRESET_ID` 决定，`preset/preset.yml` 只提供显示元数据 `name` / `description` / `order`（缺 `order` 时生成器用它的 `DEFAULT_ORDER`）。**源码级事实**：旧口径（id = 目录名，须匹配 `^[a-z0-9][a-z0-9-]*$`）随 `@deepseek-ai/dsh-agent-presets`（复数）一起消失（**实测**，dsh 0.1.7-rc.2）。

因此三条断言：

1. 改 `preset/preset.yml` 的 `name`（模式选择器里的显示名）**不会**改 preset id，**不影响**治理面 —— 改动这类文案不需要重新审视插件；
2. 真正会漂移的是 preset id：改 `tools/gen-preset-bundle.mjs` 的 `PRESET_ID`（或手工改生成物里声明行的 `config.id`）—— 此时插件不再治理该模式（按 `budget.js` 的 fail-open 契约，未命中即不干预，**静默**）。
3. 复核口径：插件挂载行的 `presets` 值、生成物声明行的 `config.id`、以及 `session.header.agentPreset` 三者必须同时为 `adg`。任一不是，即契约已漂移。

漂移检测（人工 review）：改任何与 preset 标识相关的源或挂载行后，重新核对上面两条源码位置，并确认生成物声明行里的 `id: adg`（`bundle/adg-preset/cordis.patch.yml`）与插件挂载行的 `presets: ['adg']` 仍然一致。

### 3.2 `skills/adg-add-agent/SKILL.md` 消费的是专家行的**字段形状**

该技能断言专家行有 `id` / `config.toolName` / `config.persona` / `config.toolFilter.allow` / `config.backgroundMode` 五个字段，且名册为 9 行。字段形状一变（例如把 `persona` 挪出 `config`、给允许集换名、改 `backgroundMode` 的合法取值），技能的落盘步骤与硬约束就会指向不存在的形状。技能还断言了第 9 行 `agent-general` 的**特殊性**（I16 的叶子约束）—— 该断言过期同样算技能过期。

过期检测（人工 review）：改动专家行的字段名后，用 `Select-String -Path skills\adg-add-agent\SKILL.md -Pattern 'config\.'` 取出技能里出现的字段路径（本次实测命中第 15–18 行，即字段表里的 `config.toolName` / `config.persona` / `config.toolFilter.allow` / `config.backgroundMode` 四行），逐个对照 `preset/agent.cordis.yml` 的专家段实际形状；任何对不上的字段即技能已过期。行数断言同样要复核：技能写明「当前名册 9 行」。

## 4. `tools/check-preset.mjs` 的能力边界断言

它是**逐行文本扫描器，不是 YAML 解析器**（脚本头部注释自述；根 `README.md`「自检到底静态挡住了什么（别把它的覆盖范围想大）」）。抓不到的"坏"至少有：

| 坏在哪 | 它为什么抓不到 |
|---|---|
| 同一行写两个键（`toolName: agent_x provider: spawn`） | 正则只取第一个 `key:` 之后到行尾作为值，第二个键被当值吞掉 |
| 锚点 / 别名（`&` / `*`）与 merge key | 没有任何 YAML 结构概念 |
| flow 风格（`allow: [read, write]`） | `allow` 只认块序列（`- item` 行） |
| 制表符缩进 | 缩进按空格数计算，Tab 会让所有 `key: value` 正则静默失效 |
| 多文档流（`---`） | 全文只当一份文档扫 |
| 语义越界：`persona` 内容与 `allow` 不匹配 | 只查 persona 存在与长度（< 60 字仅 WARN） |
| 同名 `id` 出现在不是「4 空格 + `- id: agent-`」的位置 | 专家行识别依赖固定缩进前缀 `^ {4}- id: (agent-[a-z0-9-]+)$` |
| 专家行内部空行之后的内容 | 扫描遇到空行会跳过，块结束判定也可能提前 |
| `preset/preset.yml` 的任何问题（含 `name` 与名册不一致、`order` 不是数字） | 它只读 `agent.cordis.yml`（或显式传入的那一份），完全不看 `preset.yml`；**兜底在构建层**：`node tools/gen-preset-bundle.mjs` 会以 exit 1 报「preset/preset.yml 里没有可用的 `name:`」或「order 不是数字」 |

因此**不许**由它单独支撑的结论（一律改用真实挂载或人工 review）：

- 「文件能被 YAML 解析」；
- 「插件真的挂载成功 / 行没被 `disabled` 或条件表达式关掉 / 服务发布到了 entry-local realm 而非全局 realm」；
- 「改完的 preset 已经在会话里生效」；
- 「`allow` 名单与运行期工具注册表一致」——`KNOWN_TOOLS` 是手抄清单，不是注册表的真值；
- 「插件出厂默认值仍是脚本里 `FACTORY_DEFAULTS` 写的那些数」——那张表抄自已安装包的源码，换插件版本时会漂移，脚本只把它当对照；
- 「调度规则、persona 措辞、职责边界在语义上正确」。

它**能**支撑的结论只有一条：这些硬约束在文本上没被破坏（退出码 0），以及报告里那三行摘要（专家行清单、体积旋钮生效值、裁剪后实际吐出）与「已覆盖」标注。

## 5. 交付前的最小闭环

```sh
node tools/check-preset.mjs        # 源文本：须 exit 0
node tools/gen-preset-bundle.mjs   # 生成/刷新 bundle：须 exit 0（产物不许手改）
```

其后必须做一次真实挂载（根 `README.md`「给 AI 的安装指令」第 8 步：`agentPresets.resolve('adg')` 的 `.broken` 为空 + `compositionInventory()` 的形状），再做一次重启 + 新对话验收。静态自检通过 ≠ 生效；生成物形状正确也 ≠ 挂载。

当前仓库实测基线（2026-09-28 复核）：`node tools/check-preset.mjs` → `通过：0 个错误，2 个警告`（两条 WARN 都是 `read_image` 属条件性注册：`agent-file` 与 `agent-general`），退出码 **0**；传不存在的路径与传目录均退出 **2**。

## 6. 过期检测（踩坑登记）

| 会过期的东西 | 症状 | 怎么发现（可照抄） |
|---|---|---|
| composition 里写的 `@deepseek-ai/*` 包名。**2026-09-28 真踩过**：引擎行的 `@deepseek-ai/dsh-workflow-worker-thread` 已从安装里消失，取而代之是 `@deepseek-ai/dsh-workflow-ptc`（行 id `workflow-ptc`、`config: {provider: spawn}`） | **不是**挂载失败，而是 registry 判**整份 preset `broken`**：`workflow-worker-thread (@deepseek-ai/dsh-workflow-worker-thread): never started` —— Adg 模式在新会话里直接不可用 | 真实挂载校验：`agentPresets.resolve('adg')` 的 `.broken` 必须为空；它按行报出起不来的包名。**dsh 每次升级后都要做**，别等"模式从选择列表里消失了"再查（`docs/evidence.md` §14） |
| `tools/check-preset.mjs` 注释里的挂载校验指引 | 注释若写着 `standingKeyFor('adg')`，就指向一个在本版 dsh 里**已不存在**的 API；照它写的校验步骤会直接失败 | 人工 review（脚本行为不受影响，是注释层过期）。**2026-09-28 已同步**：那份注释现在写的是「按 README 第 8 步 + `agentPresets.resolve('adg')` 的 `.broken` 为空」，并顺带说明"没有第二份已安装的文本"。改动 `tools/check-preset.mjs` 的头部注释时要连这一条一起看 |
| 文档里的 README 步骤号 | 旧文写「按第 7 步做真实挂载」，而现在的第 8 步才是真实挂载（第 7 步是沙箱提权） | 引用 README 步骤前先核对根 `README.md`「给 AI 的安装指令」的当前编号 |
