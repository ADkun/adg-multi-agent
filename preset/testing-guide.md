---
title: preset 模块测试指南
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
---

# preset 模块测试指南

对象与不变量编号见 `design.md`（I1..I10 一一对应，本文不重复定义）。类型只有三种：**静态自检**（`tools/check-preset.mjs` 真的会拦）、**真实挂载**（重启 dsh 后按根 `README.md`「给 AI 的安装指令」第 7 步做）、**人工 review**（脚本抓不到，必须有人看）。

## 命令（可直接照抄）

```sh
node tools/check-preset.mjs                                                          # 校验仓库里的 preset/
node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"  # 校验已安装的那一份
```

零依赖（只用 `node:fs` / `node:path` / `node:url`，不引 YAML 库）。退出码：**0 = 通过**（允许 WARN，WARN 不是失败）；**1 = 不通过**（有 ERROR，其含义只有一个：这次委派必然抛错）；**2 = 读不到目标文件**（路径不存在/打不开，或存在但不是普通文件）。

## 1. 不变量 → 用例 → 类型（全表）

| 不变量 | 用例 | 类型 | 已实现？ |
|---|---|---|---|
| I1 `validated` ≠ `mounted` | A1 `node tools/check-preset.mjs` 退出码 0 后，**不得**据此宣称已挂载；必须做一次真实挂载 | 真实挂载 | 未实现（脚本无挂载能力）；人工 review 兜底 |
| I1（同上） | A2 对脚本源码提断言：它没有挂载能力——只 import `node:fs` / `node:path` / `node:url`，且不含挂载调用 | 静态自检 | 已实现（本次实测）：`Select-String -Path tools\check-preset.mjs -Pattern 'ctx\.load|agentPresets|compositionInventory'` → 0 命中；`^import` 只命中上述三个内建模块。**注意** `standingKeyFor` 在该文件第 35 行的注释里出现过（指向 README 的挂载校验步骤），因此不能拿它当「脚本会挂载」的判据 |
| I2 未重启不得宣称生效 | B1 改完只跑自检 + 不重启，然后**明确记录**此时不得引导用户进入 Adg 模式 | 人工 review | 未实现（脚本无法观测重启）。依据：`docs/evidence.md` §5「热重载边界（真机实测）」 |
| I2（同上） | B2 改完重启，在**新对话**里选择「Adg 多智能体模式」，核对模型可见的 `agent_*` 工具面等于当前名册 | 真实挂载 | 未实现（需 Host 侧调用）；人工 review 兜底 |
| I2（同上） | B3 登记未裁决的冲突：根 `README.md`「装完必须重启 dsh」一节并存两条实测陈述（一条说改 composition 后 `compositionInventory()` 仍返回旧行；另一条说文件 stamp 变了会起新 generation，并注明「新会话会不会自动加入新 generation」**没有实测**）。本模块**不选边**，操作口径取最保守的一条（必须重启 + 新对话验收）。**禁止**在文档或回复里宣称「不重启也会生效」 | 人工 review | 未实现（冲突属文档层事实，无脚本可判） |
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
| I8（同上） | H2 交付前检索专家段内是否存在 `maxDepth`；当前文件只有 codex / claude-code 两条 disabled 行带 `maxDepth: provider-managed` | 人工 review | 未实现（可作为本地检索：`Select-String -Path preset\agent.cordis.yml -Pattern 'maxDepth'`；本次实测只命中第 481、490 行，即那两条 disabled 行） |
| I9 名册 ↔ 专家行双向一致 | J1 只加专家行、不改顶部名册 → 必须 ERROR | 静态自检 | 已实现。`调度名册里没有 agent_x：专家行加了但 persona 名册没同步（调度智能体不会知道它存在）` |
| I9（同上） | J2 只在名册里写 `agent_x`、没有对应行 → 必须 ERROR | 静态自检 | 已实现。`调度名册提到 agent_x，但没有对应的专家行（名册与实现不一致）`。若连 `prefix: \|-` 块都找不到：`没找到顶部 persona 的 prefix: \|- block（调度名册应当写在这里）` |
| I9（同上） | J3 名册里的每个名字是否**语义上**对得上它那一行的 persona | 人工 review | 未实现（脚本只做文本包含判断） |
| I10 名册不得写与插件重叠的政策 | K1 检索名册块内是否出现「委派预算 / 步数区间 / 不要轮询步数 / 读取预算」类措辞 | 人工 review | 未实现（语义判断）。辅助检索：`Select-String -Path preset\agent.cordis.yml -Pattern '预算\|步数区间\|轮询步数'` —— 本次实测命中第 13、17、18 行，**全部是文件顶部的解释性注释**（说明这些政策已被删除、不要在调度 persona 里写回）；第 13 行明确写「persona 里也不再写『委派预算／成本纪律』」。命中行落在 `prefix: \|-` 块（第 62–85 行）之内才算违例 |
| I10（同上） | K2 确认专家行 persona 末行的「收敛纪律」仍在（这是**子代理侧**口径，与 I10 限制的**调度侧**政策不同，不得一起删） | 静态自检 | 未实现（脚本不查该句）；可按 I9 同类方式人工核对 8 行 |
| I11 `agent_browser` 的权限闸门不得被删掉或绕过 | L1 检索闸门的两半是否还在：调度名册块里有没有「派发 `agent_browser` 前先看当前文件策略、不是 `danger-full-access` 就先 `ask_user_question`」的规则；`agent-browser` 那一行的 persona 里有没有失败签名与「停手＋如实报出」 | 人工 review | 未实现（脚本不查语义）。辅助检索（`-Encoding UTF8` 不能省，否则中文匹配不上）：`Select-String -Path preset\agent.cordis.yml -Pattern 'danger-full-access\|platform_channel\|完全权限' -Encoding UTF8` —— 注意 PowerShell 的 `Select-String` 用正则，`\|` 是**字面竖线**，要按关键字择一匹配就得写不带反斜杠的 `|`。本次实测（用不带反斜杠的写法）命中**四组**：文件顶注的第 5/6 条改动说明、调度 persona 规则 9/10、`agent-browser` 的「权限前提」段、以及它的人工介入协议段末句（「本会话不是完全权限时有头窗口也开不出来」）。缺任一组即违例 |
| I11（同上） | L2 闸门有没有被写成**权限强制**（例如文档/注释里宣称「preset 会拦住不听话的模型」「这是安全边界」） | 人工 review | 未实现（语义判断）。判据：`design.md`「不负责」清单、`README.md`「浏览器专家需要完全权限」的「这是流程闸门，不是安全边界」一句必须与实现口径一致 |
| I11（同上） | L3 闸门是否真的被遵守（真实 Adg 会话里，派发 `agent_browser` 之前有没有先问用户） | 真实挂载 | **未实现**：闸门刚落地，还没有一次真实 Adg 会话走过它（`docs/evidence.md` §8 未观测清单已登记这条缺口与量法） |
| I12 专家行不得直接问用户，人工介入只能由调度者转达 | M1 ①任何专家行的 `toolFilter.allow` 里有没有 `ask_user_question`；②专家 persona 里有没有「请用户介入／去问用户」这类**要求它自己问**的话 | 静态自检 | ①机器可读：`node tools/check-preset.mjs` 会打印每行的 allow，本次实测 8 行**都没有** `ask_user_question`（正确：它只归调度者）。②人工 review：辅助检索 `Select-String -Path preset\agent.cordis.yml -Pattern 'ask_user_question' -Encoding UTF8` 会命中多处，**其中多数是允许的** —— 文件顶注的说明、调度 persona 规则 9/10、`plan-mode` 行的出厂人设，以及 `agent-browser` 里那句「你**不能**直接问用户（调 ask_user_question 只会拿到 DELEGATED_CALLER）」。**判违例看语义，不看是否出现这个词**：出现「把它加进 allow」或「要求专家去问用户」才算 |
| I12（同上） | M2 人工介入的分工两半是否都在：调度 persona 四分支处置（已完成／不想／仍被挡／换方式）+ `agent-browser` 的 persona「开有头窗口 → 停手 → 报四件事 → CDP 重连、不新开浏览器」 | 人工 review | 未实现（语义判断）。判据与 `docs/evidence.md` §12 的机制实测一致 |
| I12（同上） | M3 专家被重派时是否真的重连旧实例（而不是另开一个浏览器） | 真实挂载 | **未实现**：机制已实测（有头窗口跨工具调用存活 + 新进程 CDP 重连并继续驱动，见 `docs/evidence.md` §12），但**真实站点的登录／验证码流程没有端到端跑过**，所以「专家会不会照做」这一半没有证据 |

## 2. `PresetRevision` 状态机迁移矩阵（全表）

起始状态为行，事件为列。**自环**=合法但状态不变；**禁止**格标注原因。状态定义见 `design.md`「PresetRevision」。

| 起始 \ 事件 | `node tools/check-preset.mjs` 退出 0 | 退出 2 | `install.ps1` / `install.sh` → `.agent-presets/adg/` | `install.*` → 其它目录名 | `dsh-agent-presets` 首挂（stamp 变化） | 重启 dsh | 新会话加入该 generation | 重启前宣称「已生效」 |
|---|---|---|---|---|---|---|---|---|
| `drafted` | → `validated` | 自环（文件不可读，状态不变） | 禁止：未 `validated` 就部署 = 未经过校验的文本进本机 | 禁止：换目录名即换 preset id，会切断 `session.header.agentPreset === 'adg'` 的治理面 | 禁止：`drafted` 不在 `.agent-presets/` 里，无可挂载对象 | 自环（重启读的是已部署的那一份） | 禁止：没有 generation 可加入 | 禁止（I2） |
| `validated` | 自环（重复自检） | 自环 | → `deployed` | 禁止：同上，id 漂移 | 禁止：跳过了 `deployed`，本机没有新文本 | 自环（同上） | 禁止：无 generation | 禁止（I1 + I2） |
| `deployed` | 自环（此刻校验的是仓库副本还是安装副本，须在记录里写明传参） | 自环 | 自环（幂等覆盖；同一文本不产生新语义） | 禁止：id 漂移 | **触发条件未裁决**：根 `README.md`「装完必须重启 dsh」并存两说（旧行说改文件后 `compositionInventory()` 仍返回旧行；新说 stamp 变了起新 generation，但「新会话会不会自动加入新 generation」没有实测）。照实登记，不选边；操作口径取最保守的一条 → 走「重启 dsh」这一列 | 若无新 stamp：自环；若有新 stamp：按上格口径只写「已可组合」，**不得**写成「已生效」；结论仍是重启后在新对话验收 | 禁止：未 `mounted` 前没有 generation | 禁止（I1） |
| `mounted` | 自环 | 自环 | 自环：**已挂载会话不换组合**，部署一份新文本不会改动现有 generation | 禁止：id 漂移 | → `mounted`（新 generation） | 自环：重启本身不迁移状态，重启之后由新会话带来 `live` | → `live`（仅新会话） | 禁止（I2） |
| `live` | 自环 | 自环 | 自环（现有会话固定在其 generation 上） | 禁止：id 漂移 | → `mounted`（新 generation；旧 `live` 会话不受影响） | 自环：**旧会话不会跟着换组合**，别在重启后拿旧会话验收 | 自环（该 generation 已 `live`） | 禁止（I2） |

迁移唯一入口：`install.ps1` / `install.sh`（`preset → deployed`），其后由 `dsh-agent-presets` 的 standing mount 接续。禁止绕过对象直接改状态。

## 3. 跨模块消费侧契约测试

### 3.1 `dsh-adg-token-budget` 消费的是 preset **id**，不是 `preset.yml` 的 `name`

事实链（源码级，已核对）：

- 插件默认配置 `presets: Object.freeze(['adg'])` —— `plugin/dsh-adg-token-budget/src/config.js:43`；
- 判定 `presets.includes(session.header.agentPreset)` —— `plugin/dsh-adg-token-budget/src/budget.js:66-69`；
- 装上时的挂载行由 `install.ps1` 写入，值为 `presets: ['adg']`；
- preset id **取自目录名**，不是文件里的字段 —— `@deepseek-ai/dsh-agent-presets`：id = 目录名（须匹配 `^[a-z0-9][a-z0-9-]*$`），而 `preset.yml` 只提供显示元数据 `name` / `description` / `order`。

因此三条断言：

1. 改 `preset/preset.yml` 的 `name`（模式选择器里的显示名）**不会**改 preset id，**不影响**治理面 —— 改动这类文案不需要重新审视插件；
2. 真正会漂移的是 preset id：把 `.agent-presets/adg/` 改名，或让 `install.*` 部署到别的目录名 —— 此时插件不再治理该模式（按 `budget.js` 的 fail-open 契约，未命中即不干预，**静默**）。
3. 复核口径：`presets` 的值与安装目录名必须同时为 `adg`。任一不是，即契约已漂移。

漂移检测（人工 review）：改任何与 preset 标识相关的路径或挂载行后，重新核对上面两条源码位置，并确认 `install.ps1` 里的 `$presetDest = Join-Path $root '.agent-presets\adg'` 与插件挂载行的 `presets: ['adg']` 仍然一致。

### 3.2 `skills/adg-add-agent/SKILL.md` 消费的是专家行的**字段形状**

该技能断言专家行有 `id` / `config.toolName` / `config.persona` / `config.toolFilter.allow` / `config.backgroundMode` 五个字段，且名册为 8 行。字段形状一变（例如把 `persona` 挪出 `config`、给允许集换名、改 `backgroundMode` 的合法取值），技能的落盘步骤与硬约束就会指向不存在的形状。

过期检测（人工 review）：改动专家行的字段名后，用 `Select-String -Path skills\adg-add-agent\SKILL.md -Pattern 'config\.'` 取出技能里出现的字段路径（本次实测命中第 15–18 行，即字段表里的 `config.toolName` / `config.persona` / `config.toolFilter.allow` / `config.backgroundMode` 四行），逐个对照 `preset/agent.cordis.yml` 的专家段实际形状；任何对不上的字段即技能已过期。行数断言同样要复核：技能写明「当前名册 8 行」。

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
| `preset/preset.yml` 的任何问题（含 `name` 与名册不一致、目录 id 不是 `adg`） | 它只读 `agent.cordis.yml`（或显式传入的那一份），完全不看 `preset.yml` |

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
node tools/check-preset.mjs                                                            # 仓库副本：须 exit 0
node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"  # 安装副本：须 exit 0
```

其后必须做一次真实挂载（根 `README.md`「给 AI 的安装指令」第 7 步；`skills/adg-add-agent/SKILL.md`「校验与生效」记录了 `standingKeyFor('adg')` 的口径），再做一次重启 + 新对话验收。静态自检通过 ≠ 生效。

当前仓库实测基线（本次复核）：`node tools/check-preset.mjs` → `通过：0 个错误，1 个警告`（WARN 是 `agent-file` 的 `read_image` 属条件性注册），退出码 **0**；传不存在的路径与传目录均退出 **2**。
