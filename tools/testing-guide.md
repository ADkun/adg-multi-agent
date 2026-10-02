---
title: check-preset.mjs 校验器 测试指南
owner: Adg preset 维护者
status: current
last_reviewed: 2026-10-01
---

# check-preset.mjs 测试指南

对象与不变量见 `tools/design.md`（本文件不复制它的内容，只给用例）。用例类型三档：**CLI 冒烟**（真跑命令、看退出码与 stdout 关键行）、**人工 review**（读代码或读目标文件判定，无法自动化的部分）、**未实现**（当前没有对应的自动化，条目即缺口台账）。同目录其余脚本的用例都在「`gen-preset-bundle.mjs`（同目录第二个脚本）的构建契约」一节：构建脚本 `gen-preset-bundle.mjs`（它的设计记录在自己的头部注释里）与产物自检 `check-bundle-flavor.mjs`，以及组表 `tools/flavors.mjs`、探测入口 `tools/has-bundle.mjs`、味道映射 `tools/resolve-flavor.mjs` 的调用判据（该节的「构建期注入组」一小节）。

准备动作（下称"夹具 A"）：把 `preset/agent.cordis.yml` 复制到临时文件，只改副本，绝不改仓库里的那份。**注意现在只有这一份文本**：`${DSH_HOME:-~/.dsh}/.agent-presets/<id>/` 那份已随机制移除（dsh 0.1.7-rc.2，实测），不要再去找或去传它。

## 用例总表

（本节＝原 §1「不变量 I1..I9 的用例」；别处写「§1」仍指本节。）

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
| I9 | 真实挂载校验（`agentPresets.resolve('adg')` 的 `.broken` 为空 + `agentPresets.compositionInventory()`；`standingKeyFor` 在本版 dsh 已不存在，别调它） | 未实现 | 本文件内没有任何自动化调用它；按 `README.md`「给 AI 的安装指令」第 6 步人工执行 |

## 迁移矩阵

（本节＝原 §2「状态机迁移矩阵」；下面按对象分小节。）

### `KnobRow`：`declared → validated`

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

### `ExitStatus`：`target-resolved → {passed(0) \| failed(1) \| unreadable(2)}`

| 迁移 | 触发条件 | 期望结果 | 类型 |
|---|---|---|---|
| （起点）→ `target-resolved` | `process.argv[2]` 缺省 | 目标解析为 `<repo>/preset/agent.cordis.yml` | CLI 冒烟 |
| （起点）→ `target-resolved` | `process.argv[2]` 给了绝对/相对路径 | 目标解析为该路径的绝对形式 | CLI 冒烟 |
| `target-resolved` → `unreadable(2)` | 目标不存在 | stderr 一行 `无法读取 ...`，stdout 无报告摘要，退出码 `2` | CLI 冒烟 |
| `target-resolved` → `unreadable(2)` | 目标是目录（如 `node tools/check-preset.mjs tools`） | stderr `无法读取 ...：不是普通文件`，退出码 `2`（**必须在 `readFileSync` 之前用 `statSync().isFile()` 拦下**） | CLI 冒烟 |
| `target-resolved` → `failed(1)` | 至少一条 ERROR | 逐条打印 `ERROR ...`；末行 `不通过：N 个错误`；退出码 `1` | CLI 冒烟 |
| `target-resolved` → `passed(0)` | 0 条 ERROR（WARN 任意条数） | 末行 `通过：0 个错误，N 个警告`；退出码 `0` | CLI 冒烟 |
| `passed(0)` 的收尾方式 | 报告末尾未显式 `process.exit(0)` | 靠 Node 事件循环自然退出得 `0` | 人工 review |

## 消费方契约测试

（本节＝原 §3「跨模块消费侧契约测试」；三个消费方各一小节。）

### `install.ps1` / `install.sh` 消费 preset 与部署落点

两个脚本消费的事实：preset 的**三个源文件**（`preset/preset.yml`、`preset/agent.cordis.yml`、`preset/bundle.package.json`，经 `tools/gen-preset-bundle.mjs` 生成 bundle）、技能路径，以及落点：preset bundle 的**四种味道、四个稳定落点** `$DSH_HOME/bundles/dsh-adg-preset/`（plain）/ `…-bili/` / `…-save-token/` / `…-bili-save-token/`（`auto` 下**逐个注入组**探测、按该 profile 自己的结果选一份 —— 探测入口 `tools/has-bundle.mjs`、键→目录→旗标 `tools/resolve-flavor.mjs`，见根 `AGENTS.md` 红线 10 与该节的「构建期注入组」一小节）、目标 profile 的 `node_modules`（`link:` 进来）与 `dsh.profile.bundles`。preset bundle 靠**写进该 profile 的 `dsh.profile.bundles`** 选中。

| 用例 | 类型 | 判据 |
|---|---|---|
| 另建一个工作副本，删掉 `preset/preset.yml`，分别跑 `node tools/check-preset.mjs` 与 `node tools/gen-preset-bundle.mjs` | CLI 冒烟 | 校验器**不会**报警（它只看 `agent.cordis.yml`），而生成器会 **exit 1** 并报 `preset/preset.yml 里没有可用的 name:` —— 这条脱钩的兜底从"没有防线"变成了**构建层拦截** |
| 在 `install.ps1` / `install.sh` 中检索它们引用的仓库内路径，逐个 `Test-Path` | 人工 review | 每条被引用的仓库内路径都存在；任一条不存在即为**脱钩**（脚本里写的是 `preset/preset.yml`、`preset/agent.cordis.yml`、`preset/bundle.package.json`、`skills/adg-add-agent/SKILL.md` 四项） |
| 把一个包从目标 profile 的 `node_modules` 里挪走，重跑 `install.*` | CLI 冒烟 | 脚本必须**只报告、不写** `dsh.profile.bundles`（"写进列表"与"包装上了"必须同时成立，否则该 profile 会报未安装的 bundle）；对 profile 层遗留的旧 `- insert:` 挂载行同样**只报告、不代删**（脚本不猜用户手改过的文件，2026-09-28 起） |
| **dsh 正在运行时**重跑 `install.*`（有变更需要重装依赖时） | CLI 冒烟 | `pnpm add link:` 失败（`os error 32` / `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`），脚本**如实报告并继续**；包已在位**不算失败**。判据：包不在位即被上一条挡住 |
| 比对 `install.ps1` 与 `install.sh` 的部署集合 | 未实现 | 现在没有自动化比对；两个脚本的清单必须逐项一致（本仓库声明"行为等价"） |

**怎么发现脱钩（口径）**：脱钩的表现是"脚本复制成功、但目标侧少了一样东西"，而 `check-preset.mjs` 只看 composition 的文本，**天生看不见脱钩**。所以发现手段只有两条——上面那条"逐条 `Test-Path` 核对脚本内引用的仓库路径"（人工 review，改脚本后必做），以及安装后核对目标目录的实际条目数。前者是当前唯一的第一道防线。

### `skills/adg-add-agent/SKILL.md` 消费三行旋钮的存在与"不覆盖"口径

技能消费的事实：三行旋钮（`compaction-basic` / `tool-result-pruner` / `tool-web`）必须存在、本 preset 不覆盖它们的键、自检会打印两行摘要。

| 用例 | 类型 | 判据 |
|---|---|---|
| 检索技能正文里的三行 `id` 与两个摘要行字样 | 人工 review | 与 `EXPECTED_ROWS` 的三个 `idPrefix`、与脚本实际打印的摘要前缀（`体积旋钮（生效值）` / `裁剪后实际吐出（按生效配置算）`）一致 |
| 把脚本的摘要前缀改掉，不改技能 | CLI 冒烟 | 技能里描述的输出与脚本实际输出不再一致——即"技能过期"；表现是 AI 按技能指引去找一行不存在的输出，用户看到"没打印出来" |
| 在 composition 里给三行之一写回合法覆盖值，跑自检 | CLI 冒烟 | 摘要出现 `（已覆盖）`；技能若仍写"本 preset 一律不覆盖"，即口径漂移（技能必须写清"覆盖是有意为之才允许"） |
| 检索技能里是否出现"钉死取值"式表述 | 人工 review | 不得出现；取值口径只有"出厂默认值"与"落在插件接受范围内"两种 |

**技能过期时的表现**：（a）指引里提到的输出/行号与脚本实际不符，照做的人找不到证据；（b）技能说"不覆盖"而 composition 已覆盖（或反之），AI 会按过期口径劝阻或放行错误的改动。两种都表现为"照文档做，结果对不上"。

### `preset/agent.cordis.yml` 的 tool 行 ↔ `KNOWN_TOOLS` 双向一致性

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

## 人工 review 项

（本节＝原 §4「本校验器**故意不做**的检查清单」：每一条都写清由谁兜底；末列"人工 review"就是本节要兜的那部分，"未覆盖"＝当前没有任何防线，属已知缺口台账。）

每一条都写清由谁兜底；"未覆盖"表示当前没有任何一道防线，属于已知缺口台账。

| 故意不做的检查 | 为什么不做 | 由谁兜底 |
|---|---|---|
| 整份文件能否被 YAML 解析（缩进错位、括号不配、`key:` 后面重复） | 它是逐行正则扫描器，不引入 YAML 库 | **真实挂载**：声明行起不来时 `agentPresets.resolve('adg')` 的 `.broken` 报出具体是哪一行（**实测**：`workflow-ptc (@deepseek-ai/dsh-workflow-ptc): never started`）；YAML 语法错误具体在哪一步炸**未观测**。人工 review |
| 锚点 `&a` / 别名 `*a` | 逐行扫描看到的只是一个标量字符串 | **真实挂载**（解析期展开后才知道指向什么）；人工 review |
| flow 风格（`{a: 1}`、`[]`、行内两个键） | 只处理 block 风格的 `key: value` | **真实挂载**；人工 review |
| 制表符缩进 | 缩进只用空格数计算，tab 不会报错 | **真实挂载**（YAML 规范禁止 tab 缩进）；人工 review |
| **专家行不在 4 空格缩进上** | 脚本的行匹配器写死 `^ {4}- id: (agent-…)`：缩进一变，**整段专家行检查静默跳过、脚本照旧报"通过"**。当前 `delegation` 是带 `isolate` 的 `cordis:group`、其条目恰好 4 空格 | **改 `delegation` 结构后必须人工确认**：跑 `node tools/check-preset.mjs`，报告里"专家行清单"那一行必须**非空、且条数等于 `preset/agent.cordis.yml` 里 `- id: agent-` 开头的行数**（2026-10-02 读数是 8 个——**读数，不是判据**，名册一改就变）；这一行缺失或为 0 就说明一个专家行都没匹配上 |
| 同一行里写两个键 | 一行的正则只取第一个 `key: value` | **真实挂载**；人工 review |
| 运行期是否真的挂载（包解析、行被条件表达式关掉、服务发布到全局 realm） | 静态扫描拿不到运行期信息 | **真实挂载**：`agentPresets.resolve('adg')`（`.broken` 为空）/ `agentPresets.list()` / `agentPresets.compositionInventory()`（按 `README.md`「给 AI 的安装指令」第 6 步；`standingKeyFor` 在本版 dsh 已不存在，别调它） |
| `install.ps1` / `install.sh` 的部署集合与落点 | 与本模块职责无关 | 人工 review（见「`install.ps1` / `install.sh` 消费 preset 与部署落点」一小节） |
| `KNOWN_TOOLS` 之外的名字是否在当前这台机器上注册 | 条件性注册求值不了 | **未覆盖**：`bash` / `read_image` / codex / claude-code 四类只在缺条件的部署上以"那一次委派抛错"暴露 |

## `gen-preset-bundle.mjs`（同目录第二个脚本）的构建契约

它只做一件事：把 `preset/preset.yml`（顶层 `key: value` 标量）+ `preset/agent.cordis.yml`（**原样**缩进进 `config.plugins`）+ `preset/bundle.package.json`（原样拷贝）写成 `<outDir>/{cordis.patch.yml,package.json}`（**安装脚本按味道各传一个位置参数**：`bundle/adg-plain/` / `adg-bili/` / `adg-save-token/` / `adg-bili-save-token/`；不传位置参数时的缺省出海目录是 `bundle/adg-preset/`，在 `.gitignore` 里）。设计记录在脚本头部注释，用例只覆盖它的**输入守卫**与**形状**：

| 用例 | 类型 | 判据 |
|---|---|---|
| `node tools/gen-preset-bundle.mjs`（干净仓库） | CLI 冒烟 | exit `0`；stdout 报输出目录 + `cordis.patch.yml <字节数> 字节 / N 个顶层子插件条目（preset id=adg, order=…）`，末行是"下一步：装进 profile"的提示；产物两份文件都在 |
| 连跑两次 | CLI 冒烟 | 产物逐字节相同（只读源、只写这两个文件，无随机性） |
| 临时副本里删掉 `preset/preset.yml` 的 `name:` 行 | CLI 冒烟 | exit `1`，stderr 报 `preset/preset.yml 里没有可用的 name: <显示名>` |
| `preset/preset.yml` 写 `order: abc` | CLI 冒烟 | exit `1`，stderr 报 `order 不是数字` |
| 把 `preset/agent.cordis.yml` 的第一条有效行改成不是 `- ` 开头 | CLI 冒烟 | exit `1`，stderr 报"第一条有效行不是 `- ` 开头的数组项" |
| 往 `preset/agent.cordis.yml` 里塞一个制表符 / 一个 CR 行尾 | CLI 冒烟 | exit `1`（YAML 缩进不允许 tab；CR 会让缩进块带上 `\r`） |
| 生成物形状 | 人工 review | 一行 `insert:` → Loader 行 `id: preset-adg` / `name: '@deepseek-ai/dsh-agent-preset'` / `config:` 里 `id: adg` + `name` + `description`（有才写）+ `order` + `plugins:`；条目缩进 = 10 空格；标量一律双引号（JSON 转义是合法 YAML） |
| **手改过生成物**（改 `bundle/adg-plain/` / `adg-bili/` / `adg-save-token/` / `adg-bili-save-token/` / 缺省 `bundle/adg-preset/`，或 `$DSH_HOME/bundles/` 下四个稳定目录 `dsh-adg-preset` / `-bili` / `-save-token` / `-bili-save-token` 里的文件） | CLI 冒烟 | 重跑生成器 / 重跑 `install.*` 即被覆盖 —— 这就是"生成物不许手改"的兜底；判违例看语义：有人拿它们当源文件 |
| 生成物的**运行期**效果（dsh 会不会挂载它） | 未实现 | 生成器只保证形状。要真实挂载：装进 profile（`plugin_manager` 的 `install_bundle`，或 `install.*`）后看 `agentPresets.resolve('adg').broken` 与 `compositionInventory()` 里的 `fiberState` |
| 生成器与校验器的分工是否被混用 | 人工 review | `check-preset.mjs` 管 `agent.cordis.yml` 的**语义硬约束**；生成器管**形状与嵌缩进**。谁都不覆盖对方，别用其一代替其二

### 构建期注入组：四种味道的生成、断言、负例与探针（2026-09-30 实测）

**组表与味道键的单一事实来源是 `tools/flavors.mjs`**：两个注入组（`billion-context`、`save-token`）、`GROUP_ORDER = ['billion-context','save-token']`（决定 `allow` 追加顺序）、味道键 `plain` / `bili` / `save-token` / `bili+save-token`、稳定目录名由 `dirNameFor(key)` 拼。**改了 `tools/flavors.mjs`、`tools/gen-preset-bundle.mjs` 或 `preset/agent.cordis.yml` 就必须四条全跑**（根 `AGENTS.md` 质量门 1b）：

```sh
node tools/gen-preset-bundle.mjs bundle/adg-plain && node tools/check-bundle-flavor.mjs bundle/adg-plain/cordis.patch.yml plain
node tools/gen-preset-bundle.mjs --with-billion-context bundle/adg-bili && node tools/check-bundle-flavor.mjs bundle/adg-bili/cordis.patch.yml bili
node tools/gen-preset-bundle.mjs --with-save-token bundle/adg-save-token && node tools/check-bundle-flavor.mjs bundle/adg-save-token/cordis.patch.yml save-token
node tools/gen-preset-bundle.mjs --with-billion-context --with-save-token bundle/adg-bili-save-token && node tools/check-bundle-flavor.mjs bundle/adg-bili-save-token/cordis.patch.yml bili+save-token
```

| 用例 | 类型 | 判据（2026-10-03 本机实测值） |
|---|---|---|
| 上面那四条生成 + 四条断言 | CLI 冒烟 | 八条命令全 exit `0`；生成物字节数 `62917` / `64784` / `64356` / `66223`（各 18 个顶层子插件条目、8 个专家行；**2026-10-03 提示词重构后**从 `117292` / `119159` / `118731` / `120598` 变成现值、每份约 −55 kB —— 顶注整块下沉 + 调度／专家 persona 重写；字节数随 persona 正文改动而变，别当判据，历次刷新链见 `docs/evidence.md` §15）；断言末行逐字 `通过：9 行报告，plain 味道断言成立（注入组：无）` / `…bili 味道断言成立（注入组：billion-context）` / `…save-token 味道断言成立（注入组：save-token）` / `…bili+save-token 味道断言成立（注入组：billion-context + save-token）` |
| 专家行报告行（`<toolName>[<项数>]=<组>:<ALL\|NONE\|PARTIAL\|LEAK>`） | CLI 冒烟 | `allow` 计数 plain `10/7/11/2/5/9/9/16`；bili `14/11/15/6/9/13/13/20`（每行 +4）；save-token `11/8/12/3/6/10/10/17`（每行 +1）；两旗标 `15/12/16/7/10/14/14/21`（每行 +5） |
| `compaction-basic` 那一行 | CLI 冒烟 | plain / save-token 报 `compaction-basic[auto=未写]`；bili / bili+save-token 报 `auto=false`（这个键只在 bili 组激活时注入） |
| **负例 1：错味道**（拿 bili 产物按 `plain` 判） | CLI 冒烟 | exit `1`、末行 `不通过：9 个错误（plain 味道 / 9 行报告）`；8 条 `ERROR agent-<id>（agent_<id>）：味道 plain 不含 billion-context 组，不该出现 compress / decompress / search_context / acp_status` + `ERROR compaction-basic：味道 plain 不该有 config.auto（没挂 bili 时它是唯一的压缩手段），实际 auto: false`；报告行全 `billion-context:LEAK` |
| **负例 2：漏注入**（拿 plain 产物按 `save-token` 判） | CLI 冒烟 | exit `1`、末行 `不通过：8 个错误（save-token 味道 / 9 行报告）`；8 条 `ERROR agent-<id>（agent_<id>）：味道 save-token 要求 save-token 组的 save_token_expand 全有，实际 一个都没有`；报告行全 `save-token:NONE` |
| **负例 3：未知味道键**（`… bundle/adg-plain/cordis.patch.yml nope`） | CLI 冒烟 | exit `2`，stderr `未知的味道键：nope（可用：plain / bili / save-token / bili+save-token）` |
| `acp_cache`（`notInjected`）出现在任何味道里 | 人工 review（读脚本源码，本轮未单独造产物） | `NEVER_INJECTED = notInjectedFor(GROUP_ORDER)` ⇒ `ERROR …：acp_cache 不在任何注入清单里（gen 脚本与 tools/flavors.mjs 的清单需对齐）` |
| **手写注入名字进源文件**（夹具 A 的某个专家行 `allow:` 块末尾插一行） | CLI 冒烟 | 三条都 exit `1`、末行 `不通过：1 个错误，3 个警告`：插 `save_token_expand` ⇒ `ERROR 第 N 行 agent-file：allow 里的 "save_token_expand" 是构建期注入的名字（save-token 的取回工具，只在挂了该 bundle 的 profile 里存在）——不要手写进源文件，用 node tools/gen-preset-bundle.mjs --with-save-token 生成`（`N` = 校验器报的坐标；它随夹具与源文件的行数变，不是判据 —— 判据是那三行报错文本与 exit `1`）；插 `acp_cache` ⇒ 同一形状，括注里多一句 `（注意：gen 的注入清单里**没有**这个，需要它请改 tools/flavors.mjs 里 billion-context 组的 tools）`；插 `compress` ⇒ 与 bili 组同形、指回 `--with-billion-context`。名字清单由校验器从 `tools/flavors.mjs` **推导**、不另抄一份 |
| 探针做法本身（怎么造夹具） | 人工 review | 复制 `preset/agent.cordis.yml` 到临时文件 → 在某个专家行的 `allow:` 块末尾插一行 → `node tools/check-preset.mjs <临时文件>`。**别用 Windows PowerShell 的 `Get-Content` / `Set-Content` 读写这些文件**（UTF-8 **无 BOM**，会被按 ANSI 误读成乱码并改变行数，本轮踩过）；用 UTF-8 感知的读写（node 的 `fs.readFileSync(p,'utf8')`，或本仓库的 read 工具） |

**探测与味道映射（安装侧的判据，两个独立入口）**：

```sh
node tools/has-bundle.mjs "$env:USERPROFILE\.dsh\profiles" desktop headless web      # 缺省探测 billion-context
node tools/has-bundle.mjs "$env:USERPROFILE\.dsh\profiles" web --package=dsh-plugin-save-token
node tools/resolve-flavor.mjs --billion-context --save-token
```

| 用例 | 类型 | 判据（2026-09-30 本机） |
|---|---|---|
| `has-bundle.mjs` 逐组探测 | CLI 冒烟 | 每 profile 一行 `<name>\t<0\|1>`、**退出码恒 0**；本机缺省探测 `desktop 0` / `headless 0` / `web 1`，`--package=dsh-plugin-save-token` 同形；缺参数 exit `2` |
| `resolve-flavor.mjs` 键 → 目录 → 旗标 | CLI 冒烟 | `plain\tdsh-adg-preset\t`（第三列为空）/ `bili\tdsh-adg-preset-bili\t--with-billion-context` / `bili+save-token\tdsh-adg-preset-bili-save-token\t--with-billion-context --with-save-token`；三条都 exit `0` |
| **把 gen 的旗标传给 `resolve-flavor.mjs`**（`--with-save-token`） | CLI 冒烟 | exit `2`，stderr `不认识的旗标 --with-save-token（可用：--billion-context --save-token；味道键共 plain / bili / save-token / bili+save-token）` ⇒ 两个入口的旗标**不是一套**（前者表示"装着该组"，后者表示"生成时带上该组"） |
| 补丁文件名不是历史名（`dsh-plugin-save-token` 用 `./cordis.patch.yml`） | 人工 review | 判据在 `tools/flavors.mjs` 的 `probeBundle`：从包自己的 `package.json` 的 `dsh.bundle.patch` 读，读不到才退回 `dsh.bundle.patch.yml`；判据可照抄 `node -p "require('$env:USERPROFILE/.dsh/profiles/web/node_modules/dsh-plugin-save-token/package.json').dsh.bundle.patch"` 应得 `./cordis.patch.yml`（写死历史名会把装了它的 profile 判成"没装"）。**位置按环境变量读、账户名以本机为准**：`$env:USERPROFILE`（或 `${DSH_HOME}`）指到本机用户根即可 —— 这个 profile 下当前没有 `node_modules/dsh-plugin-save-token`，所以它是人工 review 项、不是自动化用例 | |
