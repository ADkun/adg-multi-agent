---
title: check-preset.mjs 校验器 测试指南
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-25
---

# check-preset.mjs 测试指南

对象与不变量见 `tools/design.md`（本文件不复制它的内容，只给用例）。用例类型三档：**CLI 冒烟**（真跑命令、看退出码与 stdout 关键行）、**人工 review**（读代码或读目标文件判定，无法自动化的部分）、**未实现**（当前没有对应的自动化，条目即缺口台账）。

准备动作（下称"夹具 A"）：把 `preset/agent.cordis.yml` 复制到临时文件，只改副本，绝不改仓库里的那份。

## 1. 不变量 I1..I9 的用例

| 不变量 | 用例 | 类型 | 判据 |
|---|---|---|---|
| I1（ERROR 只留"必然抛错"） | 在夹具 A 某个专家行的 `allow` 里加 `workflow`、`ralph`、`bash`、`read_image`、`subagent_codex` | CLI 冒烟 | 各自只出现一条 `WARN`，`ERROR` 数为 0、退出码 `0` |
| I1 | 在夹具 A 某个专家行的 `allow` 里加 `not_a_tool_name` | CLI 冒烟 | 出现 `ERROR ... allow 里的 "not_a_tool_name" 不是本组合注册过的工具名`，退出码 `1` |
| I1 | 在夹具 A 某专家行 `allow` 里加另一个专家的 `agent_coder` | CLI 冒烟 | 无 `ERROR`（名册内的 `agent_*` 是"直接转交"的官方开关） |
| I2（禁止钉死取值） | 全文检索 `check-preset.mjs`，查是否存在"取值 == 期望值"的比较 | 人工 review | 只有 `FACTORY_DEFAULTS` 参与摘要打印，不参与任何 `fail()` 分支 |
| I2 | 把夹具 A 的 `compaction-basic` 显式写回 `thresholdRatio: 0.9` / `retainRatio: 0.05` | CLI 冒烟 | 无 `ERROR`；摘要里对应键标成 `（已覆盖）` |
| I3（三行结构） | 从夹具 A 删掉 `- id: tool-result-pruner` 那一行块 | CLI 冒烟 | `ERROR ... 找不到 tool-result-pruner 行`，退出码 `1` |
| I3 | 把 `- id: tool-web` 那行的 `name:` 改成 `@deepseek-ai/dsh-tool-fs` | CLI 冒烟 | `ERROR ... name 应为 @deepseek-ai/dsh-tool-web` |
| I3 | 在 `- id: tool-web` 行同级加 `disabled: true` | CLI 冒烟 | `ERROR ... 被 disabled: true 关掉了` |
| I3 | 复制一整块 `- id: tool-web` 行块（同 id 两条） | CLI 冒烟 | `ERROR ... 命中 2 条 ... 哪一行生效不可判定`，且**不再**对第一条做取值比较 |
| I4（旋钮键必须直挂 `config:`） | 把 `fetchMaxOutputChars` 提到与 `name:` 同级（写在 `- id: tool-web` 行块顶层） | CLI 冒烟 | `ERROR ... 被提到与 name: 同级` |
| I4 | 把 pruner 的 `thresholdChars` 嵌到 `config: > someBlock: > thresholdChars` 之类的更深层 | CLI 冒烟 | `ERROR ... 写在了 ...，不是直接挂在 config: 下` |
| I5（取值必须落在插件接受范围） | 夹具 A 的 `compaction-basic` 写 `thresholdRatio: 0.6` + `retainRatio: 0.7` | CLI 冒烟 | `ERROR ... retainRatio 0.7 必须小于 thresholdRatio 0.6` |
| I5 | 夹具 A 的 `compaction-basic` 写 `thresholdRatio: 1.5` | CLI 冒烟 | `ERROR ... 超出 (0,1]` |
| I5 | 夹具 A 的 pruner 写 `thresholdChars: 4096` + `headChars: 2048` + `tailChars: 1024` | CLI 冒烟 | 无 `ERROR`（2048+39+1024 = 4111 **大于** 4096，见 I7 的用例，**预期应当报错**） |
| I5 | 夹具 A 的 pruner 写 `thresholdChars: 8192` + `headChars: 4.5` | CLI 冒烟 | `ERROR ... 不是十进制正整数` |
| I5 | 夹具 A 的 `tool-web` 写 `fetchMaxOutputChars: 24000` | CLI 冒烟 | 无 `ERROR`、**无** `> 60000` 的 WARN（此例只验"正整数且 ≤ 200000"）；`> 60000` 的 WARN 另用 `65000` 单独验 |
| I5 | 夹具 A 的 `tool-web` 写 `fetchMaxOutputChars: 250000` | CLI 冒烟 | `ERROR ... 超过 200000 ... 整行挂载失败` |
| I6（未知键点名） | 夹具 A 的 `tool-web` 的 `config:` 下加 `fetchMaxOutpuChars: 1000`（拼错一个字母） | CLI 冒烟 | `ERROR 第 N 行 tool-web：config 里的 "fetchMaxOutpuChars" 不是 @deepseek-ai/dsh-tool-web 认识的键`，行号指向该键所在行 |
| I7（pruner 算式必须带 39） | 夹具 A 的 pruner 写 `thresholdChars: 4096` + `headChars: 2048` + `tailChars: 2010` | CLI 冒烟 | `ERROR ... headChars + 标记(39) + tailChars = 4097 超过 thresholdChars 4096`（只看 head+tail = 4058 < 4096 会漏报，这正是该用例的存在理由） |
| I7 | 用 `PRUNER_MARKER_CHARS = 39` 为常量，比较 `headChars: 2048` / `tailChars: 2010` 两例的摘要行 | CLI 冒烟 | 摘要里 `标记 39` 与实际算式一致；改常量必须同时改动摘要与判错 |
| I8（WARN 不是失败） | 在干净副本上只制造一条 WARN（如 `allow` 加 `bash`） | CLI 冒烟 | 退出码 `0`，末行 `通过：0 个错误，1 个警告` |
| I9（`exit 0` 的语义） | 文档与对外说明里检索"校验通过 = 已挂载"这类等价写法 | 人工 review | `tools/design.md`、`tools/AGENTS.md`、`skills/adg-add-agent/SKILL.md` 里都必须保留"不是 YAML 解析器 / 不证明挂载"的限定语 |
| I9 | 真实挂载校验（`resolve('adg')` / `standingKeyFor('adg')` / `compositionInventory()`） | 未实现 | 本文件内没有任何自动化调用它；按 `README.md`「给 AI 的安装指令」第 7 步人工执行 |

## 2. 状态机迁移矩阵

### 2.1 `KnobRow`：`declared → validated`

唯一入口 `readRowBlock()` + `EXPECTED_ROWS` 三个结构守卫。`declared` 只表示"命中了 `- id:`"，不代表取值已判；`validated` 不代表运行期生效。

| 迁移 | 触发条件 | 期望结果 | 类型 |
|---|---|---|---|
| （无状态）→ `declared` | `- id:` 以期望前缀命中，且命中恰好 1 条 | 行进入候选；继续读 `config:` 路径 | CLI 冒烟 |
| （无状态）→ 报错终止该行 | 命中 0 条 | `fail(EXPECTED_ROWS[i].missingRow)` | CLI 冒烟 |
| （无状态）→ 报错终止该行 | 命中 ≥ 2 条 | `fail(... 命中 N 条 ... 不可判定)`；**跳过**后续取值比较 | CLI 冒烟 |
| `declared` → `declared`（滞留） | `name:` 与期望包名不符 | `fail(... name 应为 ...，实际 ...)`；不再前进 | CLI 冒烟 |
| `declared` → `declared`（滞留） | 行内 `disabled: true` | `fail(... 被 disabled: true 关掉了 ...)` | CLI 冒烟 |
| `declared` → `validated` | 行存在、包名正确、未 disabled、id 唯一 | 做 I4/I5/I6 检查 | CLI 冒烟 |
| `validated` → `validated`（带 WARN） | 旋钮键未写回 | 摘要标 `（默认）` | CLI 冒烟 |
| `validated` → `validated`（带 WARN） | 旋钮键写回且取值合法 | 摘要标 `（已覆盖）`；`fetchMaxOutputChars > 60000` 另给 WARN | CLI 冒烟 |
| `validated` → 报错（留在 `validated`，退出码变 1） | 旋钮键写回但取值非法 / 位置不对 / 出现未知键 | `fail(...)`；退出码 `1` | CLI 冒烟 |
| 禁止的迁移 | "命中多行时取第一条继续取值比较" | 代码里不存在该路径（命中多行后直接 `continue`） | 人工 review |

### 2.2 `ExitStatus`：`target-resolved → {passed(0) \| failed(1) \| unreadable(2)}`

| 迁移 | 触发条件 | 期望结果 | 类型 |
|---|---|---|---|
| （起点）→ `target-resolved` | `process.argv[2]` 缺省 | 目标解析为 `<repo>/preset/agent.cordis.yml` | CLI 冒烟 |
| （起点）→ `target-resolved` | `process.argv[2]` 给了绝对/相对路径 | 目标解析为该路径的绝对形式 | CLI 冒烟 |
| `target-resolved` → `unreadable(2)` | 目标不存在 | stderr 一行 `无法读取 ...`，stdout 无报告摘要，退出码 `2` | CLI 冒烟 |
| `target-resolved` → `unreadable(2)` | 目标是目录（如 `node tools/check-preset.mjs tools`） | stderr `无法读取 ...：不是普通文件`，退出码 `2`（**必须在 `readFileSync` 之前用 `statSync().isFile()` 拦下**） | CLI 冒烟 |
| `target-resolved` → `failed(1)` | 至少一条 ERROR | 逐条打印 `ERROR ...`；末行 `不通过：N 个错误`；退出码 `1` | CLI 冒烟 |
| `target-resolved` → `passed(0)` | 0 条 ERROR（WARN 任意条数） | 末行 `通过：0 个错误，N 个警告`；退出码 `0` | CLI 冒烟 |
| `passed(0)` 的收尾方式 | 报告末尾未显式 `process.exit(0)` | 靠 Node 事件循环自然退出得 `0` | 人工 review |

## 3. 跨模块消费侧契约测试

### 3.1 `install.ps1` / `install.sh` 消费 preset 与插件部署集合

两个脚本消费的事实：preset 的**两个**文件路径（`preset/preset.yml`、`preset/agent.cordis.yml`）、技能路径、插件的**五项**部署集合（`package.json` / `src` / `README.md` / `examples` / `LICENSE`）、`profiles/node_modules/dsh-adg-token-budget` 与 `profiles/web/cordis.patch.yml` 两个落点。

| 用例 | 类型 | 判据 |
|---|---|---|
| 另建一个工作副本，删掉 `preset/preset.yml`，再跑安装后的 `node tools/check-preset.mjs` | CLI 冒烟 | 校验器**不会**报警（它只看 `agent.cordis.yml`）——这正是脱钩不会被它发现的原因，必须由下面的漂移用例兜住 |
| 在 `install.ps1` / `install.sh` 中检索它们引用的仓库内路径，逐个 `Test-Path` | 人工 review | 每条被引用的仓库内路径都存在；任一条不存在即为**脱钩**（脚本里写的是 `preset/preset.yml`、`preset/agent.cordis.yml`、`skills/adg-add-agent/SKILL.md`、`plugin/dsh-adg-token-budget` 四项） |
| 在脚本里检索插件项清单 `'package.json', 'src', 'README.md', 'examples', 'LICENSE'`，与 `plugin/dsh-adg-token-budget/` 下的实际条目对比 | 人工 review | 五项都在；新增部署项（或新增不该进部署的目录）时两个脚本必须同时改，只改一个即脱钩 |
| 在插件目录下新增一个 `CHANGELOG.md`，不加入任何脚本的部署清单 | 人工 review | 判定为"新增文件不进部署"是**有意的**还是**漏的**——两种脚本的注释与 `INSTALL.md` 必须给出同一个答案，否则脱钩 |
| 比对 `install.ps1` 与 `install.sh` 的部署集合 | 未实现 | 现在没有自动化比对；两个脚本的清单必须逐项一致（本仓库声明"行为等价"） |

**怎么发现脱钩（口径）**：脱钩的表现是"脚本复制成功、但目标侧少了一样东西"，而 `check-preset.mjs` 只看 composition 的文本，**天生看不见脱钩**。所以发现手段只有两条——上面那条"逐条 `Test-Path` 核对脚本内引用的仓库路径"（人工 review，改脚本后必做），以及安装后核对目标目录的实际条目数。前者是当前唯一的第一道防线。

### 3.2 `skills/adg-add-agent/SKILL.md` 消费三行旋钮的存在与"不覆盖"口径

技能消费的事实：三行旋钮（`compaction-basic` / `tool-result-pruner` / `tool-web`）必须存在、本 preset 不覆盖它们的键、自检会打印两行摘要。

| 用例 | 类型 | 判据 |
|---|---|---|
| 检索技能正文里的三行 `id` 与两个摘要行字样 | 人工 review | 与 `EXPECTED_ROWS` 的三个 `idPrefix`、与脚本实际打印的摘要前缀（`体积旋钮（生效值）` / `裁剪后实际吐出（按生效配置算）`）一致 |
| 把脚本的摘要前缀改掉，不改技能 | CLI 冒烟 | 技能里描述的输出与脚本实际输出不再一致——即"技能过期"；表现是 AI 按技能指引去找一行不存在的输出，用户看到"没打印出来" |
| 在 composition 里给三行之一写回合法覆盖值，跑自检 | CLI 冒烟 | 摘要出现 `（已覆盖）`；技能若仍写"本 preset 一律不覆盖"，即口径漂移（技能必须写清"覆盖是有意为之才允许"） |
| 检索技能里是否出现"钉死取值"式表述 | 人工 review | 不得出现；取值口径只有"出厂默认值"与"落在插件接受范围内"两种 |

**技能过期时的表现**：（a）指引里提到的输出/行号与脚本实际不符，照做的人找不到证据；（b）技能说"不覆盖"而 composition 已覆盖（或反之），AI 会按过期口径劝阻或放行错误的改动。两种都表现为"照文档做，结果对不上"。

### 3.3 `preset/agent.cordis.yml` 的 tool 行 ↔ `KNOWN_TOOLS` 双向一致性

契约：**改 composition 的 tool 行必须同时改 `KNOWN_TOOLS`**。方向不同，失效模式不同：

| 漂移方向 | 失效模式 |
|---|---|
| composition 里注册了工具 X，`KNOWN_TOOLS` 里没有 X | **误报**：任何专家把 X 写进 `allow` 都会被判成 `ERROR ... 不是本组合注册过的工具名`，而它其实合法 → 合法配置被拦下 |
| `KNOWN_TOOLS` 里有工具 Y，composition 里已经不再注册 Y | **漏报**：专家把 Y 写进 `allow` 得到 `exit 0`，而运行期 `restrict()` 会抛 `names unknown global tool ...` → 坏配置被放过 |

怎么测（两个方向各一条，都可照抄）：

1. **发现误报（composition 有、清单无）**：从 `preset/agent.cordis.yml` 里逐行取注册工具名的来源（`- id: tool-*` / `- id: present` / `- id: skill-filesystem` 等行，以及各插件注册的模型可见工具名），与 `KNOWN_TOOLS` 逐个比对，列出"在 composition 侧存在、清单里缺失"的名字。
2. **发现漏报（清单有、composition 无）**：反向列出"清单里有、composition 侧找不到注册来源"的名字。
3. **结果化验证**：把上一步列出的任一个名字临时加进某个专家行的 `allow`，跑 `node tools/check-preset.mjs`——**期望 ERROR 而实际 exit 0 = 漏报；期望 WARN/通过而实际 ERROR = 误报**。

| 用例 | 类型 | 判据 |
|---|---|---|
| 用 `KNOWN_TOOLS` 的 23 个名字逐个构造"临时 allow" | 未实现（有替代路径） | 逐个改夹具 A 跑一次即可得到完整矩阵；当前没有一条命令跑完的自动化 |
| `pwsh` 在 Windows 上、`bash` 在非 Windows 上 | CLI 冒烟 | `pwsh` 是常驻名（本机配置 `tool-pwsh` 未被关），`bash` 只给 WARN |
| `subagent` / `subagent_fork` | CLI 冒烟 | 这两个名字**不在** `KNOWN_TOOLS` 里；出现在专家 `allow` 里必须 `ERROR`，且 composition 里不得存在 `toolName: subagent` / `toolName: subagent_fork` 行 |

## 4. 本校验器**故意不做**的检查清单

每一条都写清由谁兜底；"未覆盖"表示当前没有任何一道防线，属于已知缺口台账。

| 故意不做的检查 | 为什么不做 | 由谁兜底 |
|---|---|---|
| 整份文件能否被 YAML 解析（缩进错位、括号不配、`key:` 后面重复） | 它是逐行正则扫描器，不引入 YAML 库 | **真实挂载**：`standingKeyFor('adg')` 会报"配置非法"；人工 review |
| 锚点 `&a` / 别名 `*a` | 逐行扫描看到的只是一个标量字符串 | **真实挂载**（解析期展开后才知道指向什么）；人工 review |
| flow 风格（`{a: 1}`、`[]`、行内两个键） | 只处理 block 风格的 `key: value` | **真实挂载**；人工 review |
| 制表符缩进 | 缩进只用空格数计算，tab 不会报错 | **真实挂载**（YAML 规范禁止 tab 缩进）；人工 review |
| **专家行不在 4 空格缩进上** | 脚本的行匹配器写死 `^ {4}- id: (agent-…)`：缩进一变，**整段专家行检查静默跳过、脚本照旧报"通过"**。当前 `delegation` 是带 `isolate` 的 `cordis:group`、其条目恰好 4 空格 | **改 `delegation` 结构后必须人工确认**：跑 `node tools/check-preset.mjs`，报告里必须出现"专家行 8 个"；没有这一行就说明一个都没匹配上 |
| 同一行里写两个键 | 一行的正则只取第一个 `key: value` | **真实挂载**；人工 review |
| 运行期是否真的挂载（包解析、行被条件表达式关掉、服务发布到全局 realm） | 静态扫描拿不到运行期信息 | **真实挂载**：`resolve('adg')` / `standingKeyFor('adg')` / `compositionInventory()`（按 `README.md`「给 AI 的安装指令」第 7 步） |
| `plugin/dsh-adg-token-budget` 那一层（能否 import、行是否激活、`stepNudge` / `stepTiers` 生效值） | 本模块完全没覆盖它 | **宿主日志与 `logFile` 的激活行**；插件自己的 `node --test test` |
| `install.ps1` / `install.sh` 的部署集合与落点 | 与本模块职责无关 | 人工 review（见 3.1） |
| `KNOWN_TOOLS` 之外的名字是否在当前这台机器上注册 | 条件性注册求值不了 | **未覆盖**：`bash` / `read_image` / codex / claude-code 四类只在缺条件的部署上以"那一次委派抛错"暴露 |
