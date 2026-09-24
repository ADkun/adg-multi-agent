# Adg 多智能体模式（DSH agent preset）

一个 DSH 自建 agent preset：**一个调度智能体 + 八个专家智能体名册**。
任务由调度智能体判断范围后分派给对应专家；专家之间不能直接互相转交，越界时由调度智能体再派发下一步。

八个专家各一行职责：

- `agent_file`｜文件管家：文件与文档的检索定位、阅读理解与问答、批量整理归类、格式转换与文档生成
- `agent_computer`｜系统运维专员：系统与硬件信息查询、系统设置修改、优化清理、故障排查、进程与服务控制
- `agent_app`｜应用操作专家：桌面软件启停/安装卸载与命令行接口调用、Android 模拟器上的手机 App、微信小程序
- `agent_browser`｜网页交互专员：需要登录、多步表单、点击选择、多页跳转抓取的网页操作
- `agent_search`｜全网搜索专员：多轮联网检索与多源资料综述，结论带来源链接；只联网，不碰本地文件与系统
- `agent_researcher`｜代码与仓库事实检索员：在本仓库/本机文件里定位实现、配置与出处，只读、必须带行号
- `agent_coder`｜实现工程师：按已确定的方案改动工作区代码，并运行验证证明改动有效
- `agent_reviewer`｜审查验证员：对已有改动做对抗性审查，只报告不修改

配套技能 **`adg-add-agent`**：让你在**任何模式**（包括创造模式）下说一句「给 Adg 加一个智能体」就能新增专家。

配套插件 **`dsh-adg-token-budget`**（第二层）：给委派出去的子代理加一条**累计 token 的硬上限** ——
软档提醒它收尾，硬档直接取消并把它已经查到的结论交回调度者。默认 **300 万/子代理**，
安装时先挂 `enabled: false`（不动作），确认无误再改成 `true`。见
[第二层：子代理 token 预算的硬兜底](#第二层子代理-token-预算的硬兜底插件-dsh-adg-token-budget)。

## 安装

装到三个位置（`${DSH_HOME:-~/.dsh}` 是你的 dsh 用户根）：

| 仓库里的路径 | 安装到 |
|---|---|
| `preset/`（两个文件） | `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` |
| `skills/adg-add-agent/SKILL.md` | `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md` |
| `plugin/dsh-adg-token-budget/` 的 `package.json` / `src/` / `README.md` / `examples/` | `${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`（**真拷贝**，`test/` 不进部署） |

安装脚本还会往 `${DSH_HOME:-~/.dsh}/profiles/web/cordis.patch.yml` 补一行挂载（默认
`enabled: false`，先备份成 `cordis.patch.yml.bak-adg-token-budget`）—— 插件那一层是什么、
怎么开、怎么确认已武装见 [第二层：子代理 token 预算的硬兜底](#第二层子代理-token-预算的硬兜底插件-dsh-adg-token-budget)。

### 方式 A：把仓库地址交给 AI（推荐）

把这个仓库的地址发给 dsh 里的 AI，说一句「按仓库 README 装到本机」即可 ——
下面的 [给 AI 的安装指令](#给-ai-的安装指令) 一节就是写给它看的。

### 方式 B：手动

```sh
git clone <repo-url> ~/adg-multi-agent
sh ~/adg-multi-agent/install.sh                     # macOS / Linux
```

```powershell
git clone <repo-url> $HOME\adg-multi-agent
powershell -ExecutionPolicy Bypass -File $HOME\adg-multi-agent\install.ps1   # Windows
```

### 装完必须重启 dsh

**已挂载的 preset 不会因为 composition 文件变化而重新组合。** 已实测：preset 挂载之后把
composition 的行改掉，`compositionInventory()` 仍然返回旧行。所以安装完必须重启 dsh，
重启后在新建对话里选择「Adg 多智能体模式」。
（在重启之前，Adg 模式会用旧组合运行，不要拿它做验证。）

**token 预算插件那一行不受这条约束**：它挂在 `profiles/web/cordis.patch.yml` 这个**热重载**的
层上，改它的 `config:` 立即生效、不用重启（这是 preset 挂载机制与 patch 层的区别，不是例外）。
但要注意 `enabled: false` 时插件**什么都不注册、什么都不写**，"装上了"这件事在日志里看不见 ——
见 [怎么确认它已经武装](#怎么确认它已经武装)。

## 专家名册与 Marvis 对应关系

名册分两组：前五个参考腾讯 Marvis 的专项 Agent 划分（PM + File / Computer / App / Browser /
Search Agent），后三个是 Adg 原有的代码向专家。缺口一栏写的是本环境的**真实**实现口径，
不是宣传语：

| Marvis 的 Agent | Adg 专家（toolName） | 覆盖的能力 | 本环境的实现口径 / 缺口 |
|---|---|---|---|
| File Agent | `agent_file` | 文件与文档的检索定位、深入阅读与问答、复制/移动/重命名/批量归类、格式转换与文档生成 | 图片内容理解走 `read_image`（把图片交给模型看，需要模型路由支持图像输入，调用报错就如实说明）；文本类文档（PDF/Word/Excel/PPT）用 `pwsh` 调本机已有工具提文本。OCR（图片里的文字）、人像/场景检索、跨设备传输**取决于本机工具链**（Python 库、Office、同步盘目录等）：persona 要求先用 `pwsh` 探测可用工具，缺什么就直说「本机缺少 X，无法完成」并给替代方案，不允许假装完成 |
| Computer Agent | `agent_computer` | 系统与硬件信息查询、系统设置修改、优化清理、故障排查、窗口与桌面管理、进程/服务/计划任务控制 | 不依赖模拟点击的 **Windows API 路线可用**（PowerShell / CIM / P-Invoke）。会改变系统状态的操作要先说明影响与回退；不可逆或高风险操作必须先停下、写明「需要用户确认后才能执行」 |
| App Agent | `agent_app` | 桌面软件启停/安装卸载与内部功能调用、Android 模拟器上的 App、微信小程序 | Marvis 的 GUI 视觉识别 + 模拟点击在 DSH **没有对应工具**：只能走 CLI / adb / winget / 软件自带接口。凡是「看界面点按钮」类需求**必须明说不具备**，并给出替代（应用 CLI、adb 命令、官方 API、或请用户手动完成） |
| Browser Agent | `agent_browser` | 登录态下的站点操作、多步表单、点击与下拉选择、多页跳转抓取 | 优先 Playwright / Puppeteer / Edge CDP（用 `pwsh` 调 node 脚本）；没有可用自动化运行时就**降级**成 `web_fetch` 单次抓取（只能取静态内容、**不能交互**），并在回答里说明是降级执行。遇到登录墙 / 验证码 / 二次验证必须立刻停止并请用户介入，不得绕过 |
| Search Agent | `agent_search` | 多轮联网检索与多源资料综述、关键信息引用溯源 | **只联网**：`allow` 里只有 `web_search` / `web_fetch`，本地文件与系统级请求被硬性排除（这不是偏好）。天气、汇率、股价这类简单事实查询由调度智能体**直接回答**，不派给它 |
| （Marvis 无对应） | `agent_researcher` | 在本仓库/本机文件里定位实现、配置与出处，只读、带行号 | Adg 原有：**硬只读** —— `allow` 里没有 `write` / `edit` / `pwsh`，真的改不动东西；公网发现式调研归 `agent_search`，它自己的 `web_search` / `web_fetch` 只用于已知 URL 的定点核对 |
| （Marvis 无对应） | `agent_coder` | 按已确定的方案改工作区代码，并运行编译/测试自证 | Adg 原有：只在当前工作区内改动文件；不做需求解读、方案设计与系统级运维 |
| （Marvis 无对应） | `agent_reviewer` | 对已有改动做对抗性审查，尽量用只读命令或测试验证 | Adg 原有：只报告不修改；每条结论给路径与行号或命令依据 |

## 怎么用

1. 新对话选择 **Adg 多智能体模式**，直接说需求。
2. 调度智能体自己负责意图理解、任务拆解、调度与汇总，先判断范围再按 8 个专家的范围派发：

| 需求范围 | 派给 |
|---|---|
| 文件与文档（检索、整理、转换、生成） | `agent_file` |
| 系统 / 硬件 / 设置 / 清理 / 故障排查 | `agent_computer` |
| 软件与 App 操作（CLI、adb、winget、小程序） | `agent_app` |
| 网页登录 / 填表 / 点击 / 多页抓取 | `agent_browser` |
| 全网检索与综述（只搜不点） | `agent_search` |
| 在本地代码库与文件里定位事实与出处 | `agent_researcher` |
| 改工作区代码并自证 | `agent_coder` |
| 审查已有改动 | `agent_reviewer` |

3. 需要多个专家时，它在同一条回复里并行启动多个委派，不串行等待。
4. 专家越界时会回一句「超出能力范围，需要 agent_X」；调度智能体据此再派发下一步，链路可追踪。
   **专家之间不能直接互相转交** —— 它们看不到 `agent_*` 名册行（见「设计要点」）。
5. 专家的返回值只是给调度智能体汇总用的中间材料，不是给你的最终答复；最终交付由调度智能体整理后给出。

## 怎么加一个智能体

在**任何模式**里说，例如：

> 给 Adg 加一个智能体：文档员，负责把内部笔记改写成对外口径，只能读不能改文件，需要改动时报告需要 agent_coder。

AI 会加载技能 `adg-add-agent`，一次问清岗位 / 能力范围 / 越界时报告需要谁，然后改两处
（新增专家行 + 顶部调度名册）。改完在仓库里跑一次自检：

```sh
node tools/check-preset.mjs
```

通过（exit 0）之后重启 dsh 即可生效。

自检还会核对三组 token 预算旋钮（共 5 个键）的取值与约束（`compaction-basic` 的两个 ratio、
`tool-result-pruner` 的三段字符数、`tool-web` 的 `fetchMaxOutputChars` / `searchMaxResults` /
`searchMaxQueries`），并且会打印一行摘要：

```
预算：compaction 0.6/0.12 | pruner 4096/2048/768 | fetchMaxOutputChars 24000/5/3
裁剪后实际吐出：head 2048 + 标记 39 + tail 768 = 2855，threshold 4096
```

依据与实测数字见 [token 成本纪律](#token-成本纪律这些上限是怎么来的)。

## 设计要点（为什么这么做）

- **刻意删掉了通用的 `subagent` / `subagent_fork` 行。** 子代理会继承父代理的整套
  composition；一旦存在通用委派行，专家就能绕过自己的范围再开一个"什么都能干"的子代理
  （已在创造模式实测复现）。删掉之后，「每个智能体只负责有限范围」才真正成立。
  注意这现在是**双重保险**：`allow` 名单本身也会把未列出的工具裁掉，通用委派行与专家
  名册行都进不了专家的工具目录。
- **`toolFilter.allow` 是真实的能力边界，不是提示级约束。** 已实测：给 `agent_coder`
  委派任务，它报告的可见工具目录**恰好等于它的 allow 名单**，`agent_*` 名册行与通用
  `subagent` 都不在其中 —— preset 自己注册的工具也一起被裁。persona 只是补充说明。
- **因此专家之间不能直接互相转交。** 专家越界的正确做法是回一句「超出能力范围，需要
  agent_X」，由调度智能体据此再派发下一步（链路可追踪）。如果确实想让某个专家能直接
  转交，把对应的 `agent_*` 名字加进它的 `allow` 即可。
- **能力边界不是安全沙箱。** `allow` 给出的是工具面上的真实限制（专家的工具目录确实被裁），
  但 `pwsh` 这类通用执行工具本身能做很多事 —— 例如 `agent_reviewer` 的 `allow` 里有 `pwsh`，
  机制上它完全能改文件，靠的是 persona 里"只报告不修改"这条提示级约束。要的是**分工清晰、
  越界会被报出来**，不是权限隔离。按工具面看，**硬边界**（`toolFilter` 强制、越界直接调不动）
  是 `agent_researcher`（无 write/edit/pwsh）、`agent_search`（只有联网工具）、`agent_reviewer`
  （无 write/edit）；`agent_file` 与 `agent_coder`（只差一个 `read_image`）、`agent_computer` 与
  `agent_app`（完全相同）的工具面几乎一样，它们的边界靠 persona 与调度规则维持。
- **`allow` 里只能写已注册的工具名。** `dsh-tools` 的 `restrict()` 遇到未知名会直接抛
  `names unknown global tool ...`。改 composition 的 tool 行时要同步
  `tools/check-preset.mjs` 里的 `KNOWN_TOOLS`，并用它提前拦下拼错的名字。条件性注册的名字
  （`bash` 在 Windows 上被 `disabled` 关掉、`read_image` 依赖 `attachments` 服务）与策略越界
  的名字（`workflow` / `ralph` 只留给调度智能体）都只给「提示」—— 所以看到 `1 个警告` 仍是
  通过（exit 0）。自检里 **ERROR 的含义只有一个：这次委派必然抛错**（名字没注册）。
- **有 `pwsh` 的专家一律同时给 `job_list` / `job_output` / `job_kill`。** 工具的指导段落
  会讲后台任务，只给 `pwsh` 不给收集工具会让"后台跑了但取不回来"。

## token 成本纪律（这些上限是怎么来的）

这一节的每个数字都是**实测**的，不是估算。测量基线：32 个 Adg 会话、983 次模型请求。

| 观测量 | 实测值 |
|---|---|
| 总 token | **94.1M** = 未缓存输入 8.0M + 输出 0.9M + cache-read **85.1M**（**下界**：见下） |
| cache-read 占提示 token | **91%** |
| 输出占总花费 | **1%** |
| 调度智能体 / 专家 | **55.9M（59%）/ 38.2M（41%）**，22 个子代理 |
| 每个子代理 | ≈**1.73M** token |
| 子代理内部工具结果 | `web_fetch` **3.5M 字符 / 369 次**（平均 9,477，被截在 50,000 附近）；`read` 1.68M 字符 / 321 次（平均 5,222）；`grep` 705k 字符 / 171 次 |

**这三个数字的口径要一起看，否则会读错：**

- **94.1M 是下界，不是全量。** `cacheWriteTokens` 在**全部 1183 个**已记录的 usage 对象里
  **都不存在**，所以 cache-write 只能记成 0 —— 它的含义是「provider 没上报」，**不是**「没有
  cache 写入」。真实账单只会比 94.1M 更高。
- **语料是活的。** 审计脚本跑的同时会话日志还在增长，报告里的计数是**某一刻的快照**，
  两次跑出来的数字不会完全一致；对比时看比例与量级，别抠绝对值。
- **报告内部有约 20,000 token（0.02%）的口径差。** `=== sessions by preset ===` 里 `adg`
  那一行的**分组总计**，与 `main + sub`（`origin` 为 `user` / `subagent`）**拆分之和**对不齐：
  有少数行既不是 `user` 也不是 `subagent` 来源，拆分口径没有覆盖它们。量级可忽略，
  但引用数字时要说明用的是哪个口径。

**成本驱动因素是「上下文体积 × 步数」**：每一步都要把整段上下文重发一遍，所以 91% 的提示 token
是 cache-read —— 便宜的单价换不来小体积，体积本身就是账单。

**策略因此只有两条：压上下文体积 + 压步数。**

**刻意没有做的事：**不给任何请求设 `maxTokens`，也不设 `reasoningEffort`。理由是输出只占账单的
**1%**，压它对账单几乎无影响，却会直接损伤回答质量（被截断、推理不足导致返工，反而增加步数）。
在这份 composition 里这两类键一律不出现 —— 改预设的人不要"顺手补上"。

刻意没做的第二件事：**没有**在本 preset 里再加一行 `spill-policy`。`spill-policy` 是**宿主plane**
的行（`dsh-base\cordis.patch.yml`，`maxInlineBytes: 50000`），而 web 组合并没有把它 disabled
（web-app 的 patch 里 `spill` 零命中），所以它**本来就对 Adg 会话生效**。它注册的是一个
`{ prepend: true }` 的 `tools/post-execute` 监听器，再加一行就是同一条瀑布上叠第二个监听器 ——
重复施加没有验证过，id 按树唯一、也不会报错，只会**静默叠加**。而真正的大头 `web_fetch` 已经被
`tool-web.fetchMaxOutputChars` 直接压住了，所以这一行没有净收益。（另注：`spill-policy` 的
model-facing 那一路**显式跳过 `read`**，所以它本来也管不到 `read` 那 1.68M 字符。）

### 三组预算旋钮（共 5 个键）

| 旋钮 | 旧值 | 新值 | 为什么 |
|---|---|---|---|
| `compaction-basic.thresholdRatio` | 未设（插件默认 **0.8**） | **0.6** | 窗口用到 60% 就压缩，而不是等到 80%；早压一次，后面每一步都少发一大截 |
| `compaction-basic.retainRatio` | 未设（插件默认 **0.16**） | **0.12** | 逐字保留的最近上下文从 16% 降到 12%，把省下的额度让给摘要 |
| `tool-result-pruner.thresholdChars` / `headChars` / `tailChars` | **8192 / 4096 / 1024** | **4096 / 2048 / 768** | 单条工具结果超过 4096 字符就砍中间（留头 2048 + 尾 768）。工具结果里 grep/read 的平均值都在 5k 上下，8192 的阈值等于几乎不裁 |
| `tool-web.fetchMaxOutputChars` | 未设（插件默认 **200000**） | **24000** | 一次 `web_fetch` 的模型可见正文上限压到 24k；`web_fetch` 是子代理里最大的单一上下文来源（3.5M 字符 / 369 次） |
| `tool-web.searchMaxResults` / `searchMaxQueries` | 未设（插件默认 **8 / 4**） | **5 / 3** | 一次检索返回的条数与接受的查询数都收窄，减少"搜一堆再逐个读"的冲动 |

约束（写错了插件会在挂载时直接抛错，不是静默生效）：

- 两个 ratio 必须在 `(0, 1]`，且 `retainRatio < thresholdRatio`；
- pruner 要满足 `headChars + 标记 + tailChars ≤ thresholdChars` —— 标记就是
  `@deepseek-ai/dsh-compaction-tool-result-pruner` 里的 `PRUNE_MARKER`
  （`"\n\n[... tool result middle pruned ...]\n\n"`），长度正是 **39 字符**
  （自检里的常量 `PRUNER_MARKER_CHARS = 39`）；只看 `head + tail` 会漏掉这 39 个字符；
- `fetchMaxOutputChars` / `searchMaxResults` / `searchMaxQueries` 都必须是**正整数**
  （`tool-web` 用同一个 `assertPositiveInteger` 校验 `searchMaxResults`、`searchMaxQueries`、
  `fetchTimeoutMs`、`searchTimeoutMs`、`fetchMaxOutputChars` 五个键），
  且 `fetchMaxOutputChars` 不得超过插件默认上限 200000；它同时截断"转换的源字符数"和
  "返回文本"，被截断时会附加一行可见的 `(Content truncated. ...)` 脚注，所以这不是静默丢内容。

**这 5 个键的取值本身也是约束：**自检把它们**逐个钉住**（`tools/check-preset.mjs` 顶部的
`EXPECTED_BUDGET`），任何偏差 —— 包括"改回插件默认值 0.8/0.16、8192/4096/1024、200000/8/4"
和"挪到一个我觉得还行、但不是本口径的中间值" —— 都会 ERROR。要改就在同一个提交里改
`EXPECTED_BUDGET` 并重跑 token 审计。

### 自检到底静态挡住了什么（别把它的覆盖范围想大）

`tools/check-preset.mjs` 静态挡住的是这几类（运行它的方式见「怎么加一个智能体」与
「给 AI 的安装指令」第 7 步）：

- 两个 ratio 的**取值区间** `(0,1]` 与**先后次序** `retainRatio < thresholdRatio`；
- pruner 的**带标记算术** `headChars + 39 + tailChars ≤ thresholdChars`，以及三个数都是正整数；
- `fetchMaxOutputChars` / `searchMaxResults` / `searchMaxQueries` 都是正整数；
- **取值被钉住**（`EXPECTED_BUDGET`，含 `fetchMaxOutputChars > 60000` 的额外 WARN）；
- 预算行的**结构**：`name:` 必须是那个包名、不能 `disabled: true`、同一个 id 不能出现两次、
  每个预算键必须**直挂**在该行的 `config:` 下（不能嵌更深、也不能提到与 `name:` 同级）、
  `config:` 里不能有插件不认识的键（插件自己的 `validateKeys` 遇到未知名会直接抛错）。

**但要说清它的边界：这个自检是逐行文本扫描器，不是 YAML 解析器。** 它证明不了整份文件能被
YAML 解析（例如同一行里写两个键、锚点/别名、flow 风格 `{a: 1}`、制表符缩进等，它都看不出来），
也证明不了插件**真的挂载**：包能不能解析、行有没有被 `disabled`/条件表达式关掉、服务有没有发布
到全局 realm，这些只有重启后按「给 AI 的安装指令」里那套 `resolve('adg')` /
`standingKeyFor('adg')` / `compositionInventory()` 做一次**真实挂载**才能证明。
换句话说：自检通过 = "这些硬约束在文本上没被破坏"，**不等于** "运行期一定按这个口径生效"。

### persona 层的读写/汇报纪律

旋钮只能压单条结果的体积，压不住"读了一堆不需要的东西"和"把整页正文贴回来"。这部分靠 persona：

- **调度智能体**（`persona.prefix` 的「委派预算」一节）：派发前先估算能不能自己答完；同一目标只派一个
  专家，真正独立才并行且**一次最多 2 个**；委派 prompt 必须自带**读取预算**（可读哪些路径、最多读几个
  文件、优先 `grep` 定位而非整读、需要片段用 `offset/limit`、同一文件不读第二遍、证据足够立即停止探查）；
  要求专家交付**有界结论**（结论 + 证据 + 未解决项），不要原始工具输出；不要让两个专家重复核同一件事；
  够了就直接交付，不要为"确认"再派一个专家；长任务一次派发让专家自己收敛，不要多轮往返。
  （关键是第 3 条：**专家看不到调度者的上下文，读取预算只能写在 prompt 里。**）
- **八个专家**：每条 persona 末尾都追加了一行成本纪律 —— 先 `grep` 定位再按需 `read`；用 `offset/limit`
  分段读，禁止整读大文件；同一文件（或同一 URL）不重复读/抓；工具结果被截断时收窄查询而不是重复重取；
  证据足够即停止探查；**回给调度者的结论控制在 2000 字符内**（附 `path:line` 或 URL 证据），不要回贴
  原始工具输出或正文。`agent_search` / `agent_browser` 是联网向的措辞（"优先用搜索摘要定位，只对确需的
  URL 取正文；同一 URL 不重复抓取"），因为它们没有 `grep`。

### 怎么重新测量

改动前后都要量，否则无法判断旋钮是帮忙还是添乱：

```powershell
node D:\dsh\.dsh-token-audit\audit-run.mjs "C:\Users\cenqian\.dsh\sessions"
```

它会把报告写到同目录的 `audit-report.txt`（覆盖上一次）。重点看 `=== sessions by preset ===` 里
`adg` 那一行的 `input` / `cache` / `output` / `requests`，以及每个子代理的 `toolChars`。

> 为什么有 `audit-run.mjs` 这个副本：原始的 `audit.js` 在 ESM 作用域里用了 `require`，直接跑会报错；
> `.mjs` 那份是改好的可执行版本。

**测完对比时注意：**上面的基线是**改动之前**的 32 个会话。新值生效后要重新跑一次，用同一口径
（同样按 preset 分组的 `input + output + cache`）对比，不要拿单次会话的绝对值下结论。

**改这些数字不会立即生效 —— 必须重启 dsh**（见「装完必须重启 dsh」）。

## 第二层：子代理 token 预算的硬兜底（插件 `dsh-adg-token-budget`）

上一节的 5 个旋钮压的是**上下文体积与单条结果的体积**，它们管不到「一个子代理一共烧了多少」。
这一层补上那个总量上限：一个 **host-plane 的 cordis 插件**，挂在 `agent/pre-step` 上，
按**子代理会话的累计用量**判两档。

> **先说状态：这个插件的运行期行为还没有在真实 dsh 里观测过。**
> 目前只有两类证据：36 个单元测试（跑在 mock 的 cordis 上下文与假 agent 上），以及从
> **模拟的部署位置**把它 import 起来（模块解析、`package.json` 形状、`createUserMessage` 的四个解析锚点）。
> **它没被观察过跑在一个真正启动的 dsh 里** —— 行有没有被加载、`agent/pre-step` 会不会真的走到这个监听器、
> 子代理被硬停时调度者拿到什么，都还是**设计意图**，不是实测。确认方式与证据边界见
> [怎么确认它已经武装](#怎么确认它已经武装) 与 [现在的证据到哪为止](#现在的证据到哪为止)。

### 两档

| 档 | 触发（累计用量） | 动作 |
|---|---|---|
| **软** | ≥ `budgetTokens × softRatio`（默认 **210 万** = 300 万 × 0.7） | 这一步照常放行（先调 `next()`），然后往这一步的消息里**追加一条收尾指令**：立刻停止探索、不要再开新的调查线、用已有证据汇报结论，并**明说哪些还没验证** |
| **硬** | ≥ `budgetTokens`（默认 **300 万**） | `agent.cancel({ kind: 'parent' })` **并且**返回 `{ kind: 'reject' }`（**不调 `next()`**）。子代理以「取消」收场，但**它的部分结论会回到调度者** —— 委派工具会把结果附成 `Partial output before the run ended: …`；被硬停丢掉的是它没做完的计划，不是它已经查到的结论 |

两个阈值都是**闭区间**（正好等于阈值就触发）。软提醒**每个子代理会话最多一次**。

累计口径（插件自己算，不依赖 provider 报的账单字段）：

```
未缓存输入 + 输出 + cacheRead × cacheReadWeight + cacheWrite
```

读的是 `ctx.get('sessionProjections')` 的 `stateOf(session, 'tokenUsage')`，其 `totals` 是**整个会话日志**的累计值。

只对**被委派的子代理**且 preset 命中的会话生效，三个条件按顺序判：

1. `enabled` 为真；
2. `delegationDepthOf(agent) > 0` —— 取 `session.header.delegationDepth` 与运行时 `subagentDepth` 的较大值
   （**header 是权威且单调的**：被恢复的子代理带着全新的 options 回来，只看 `subagentDepth` 会让它当成顶层会话）。
   顶层会话（深度 0）**永远不动**，尤其不会动调度智能体；
3. `session.header.agentPreset` 命中 `presets`。**header 里没有 `agentPreset` 的子代理也不动** ——
   这里**故意 fail-open**：猜错会砍掉它本来没被指向的会话。

投影服务缺失、或 `tokenUsage` 读不出可用值时，这一步**原样放行**（这件事最多记一次日志）。
**「没有预算数据」不等于「没有预算」。**

### 默认预算 300 万是怎么定的

对着 [token 成本纪律](#token-成本纪律这些上限是怎么来的) 那套审计口径看（同一份 `audit-report.txt` 快照，
32 个 Adg 会话 / 983 次请求）：

| 观测量 | 实测值 |
|---|---|
| 每个子代理会话平均 | ≈**1.73M**（`avg tokens per subagent adg session: total(input+output+cache)=1734486`） |
| 22 个子代理会话合计 | **38.2M**（`subInput` 2,729,782 + `subOut` 351,534 + `subCache` 35,077,376） |
| 快照里最贵的单个子代理会话 | **5.22M**（`in` 228,433 + `out` 42,094 + `cache` 4,947,456 = 5,217,983） |
| 最贵的调度者会话（对照） | 38.4M（3,686,879 + 364,731 + 34,336,896） |

**300 万落在「平均值 1.73M」与「最贵的一个 5.22M」之间**：正常的一次委派烧不到它，
但快照里最贵的那一类委派**会被它砍掉**。也就是说这一层防的是**尾部**（一次跑飞能顶掉一整天的额度），
不是「谁都不会被砍」—— 想只提醒不砍，就把 `budgetTokens` 抬高。
（报告里那张 top 15 表按 `in+out` 排序、只列了 13 个子代理会话，所以「最贵 5.22M」是**下界**；
另外 `cacheWriteTokens` 在全部 1183 个 usage 对象里都不存在，累计口径里的 cache-write 恒为 0 ——
这是「provider 没上报」，不是「没有 cache 写入」。）
实测发现正常委派被误砍时，先调 `budgetTokens`：`cacheReadWeight` 是唯一能改变「同一份账单算出的累计值」的键，
`softRatio` 只决定软档在哪提醒。

### 全部配置键与默认值

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true`（**本仓库装进去的那一行是 `false`**） | 总开关。`false` 时 `apply` 直接返回：**一个监听器都不注册、一行日志都不写** |
| `presets` | `['adg']` | 管哪些 preset 的子代理。裸字符串 `presets: adg`（YAML 标量的读法）等于单元素列表 |
| `budgetTokens` | `3000000` | 每个子代理会话的累计预算。非正数或不可用值**回落到默认**（「停掉每个子代理的第一步」绝不是打错值的意思） |
| `softRatio` | `0.7` | 软阈值占预算的比例，夹到 `[0, 1]`；`1` 等于关掉软档 |
| `cacheReadWeight` | `1` | 乘在 `cacheReadTokens` 上的权重，夹到 `[0, 100]`，小数保留原样。`1` = 缓存读取按整份计（最严）；`0` = 完全不计 |
| `softNudge` | `true` | `false` 时软档只记日志、不注入收尾指令，**硬档照旧** |
| `logFile` | `null` | 绝对路径；设了就每条决策追加一行。**相对路径会被关掉文件日志并告警** |

插件**不导出 cordis `Config` schema**：它自己手写归一化，所以打错的值回落到默认，而不是让 profile 加载失败。
默认值也在 `plugin/dsh-adg-token-budget/examples/cordis.patch.yml` 里以注释形式列了一遍。

### 挂载行放在哪、为什么不放机器级

安装脚本写的是 `${DSH_HOME:-~/.dsh}/profiles/web/cordis.patch.yml` —— **web profile 自己的 patch 层**，
不是机器级的 `${DSH_HOME:-~/.dsh}/cordis.patch.yml`。两条理由：

- 机器级那一层（`dsh-windows-notifier` 就住在那里）**套在本机每一个 profile 上**：web、headless、sdk、
  自建 profile 都会去 import 这个包。而插件只对 `adg` preset 的**子代理**生效，装到机器级等于让每个
  profile 都多背一个包；装到 `web` 则爆炸半径就是你现在正在用、随时能重启的那一个 profile。
- `web` 是 `patchReload: live`，所以**改 config 立即生效、不用重启** —— 这正是「先挂 `enabled: false`、
  确认无误再改 `true`」这种两步操作能成立的前提（机器级那层同样热重载，但它的爆炸半径是全部 profile）。

要改成全机生效：把同一行（`examples/cordis.patch.yml`）搬进 `${DSH_HOME:-~/.dsh}/cordis.patch.yml`。

### 为什么装在 `profiles/node_modules`（而不是链到仓库）

部署目标是 `${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`，即**所有 profile 共享的模块解析根**
（本机的 `dsh-windows-notifier` 也在同一位置）。这不是「看起来方便」，是 dsh 自己的解析机制：

- 启动时 `ctx.baseUrl` 被设成**启动配置所在目录**（`@deepseek-ai/dsh-app-boot/lib/index.js:1529`），
  web profile 的配置文件就在 `profiles/web/`（同目录还有 `cordis.patch.yml` / `package.json`）；
- patch 行里的裸包名从这个 base 走 Node 的常规 `node_modules` 父级上溯
  （`dsh-app-boot/lib/index.js:1322-1332` 的 `import()`），所以从 `profiles/web/` 上溯正好经过
  `profiles/node_modules/`；
- 同一份文件里写着这个共享根的作用：`$DSH_HOME/profiles/node_modules` 通过**「Node 的常规父级上溯」**
  提供安装依赖闭包（`dsh-app-boot/lib/index.js:305-308`、`645-660`），一份拷贝服务所有 profile。
- **真拷贝，不是 junction/symlink。** 部署后的插件独立于仓库：删掉、挪走、重命名这个仓库都不会让 dsh
  启动失败（链过去就会）。而且 dsh 启动时的 fallback 修复只把**符号链接**当成自己拥有的条目
  （`ownedPackageNames`，`dsh-app-boot/lib/index.js:460-466`），所以 `profiles/node_modules/` 下的普通目录
  **不会被那次修复清掉** —— `dsh-windows-notifier` 就是实录：它在那里是普通目录，不是 junction。

安装脚本**先删目标目录再拷**，所以重复执行是干净覆盖，不会留下上一个版本的残留文件。

### 怎么开

```yaml
# ${DSH_HOME:-~/.dsh}/profiles/web/cordis.patch.yml
      config:
        enabled: true      # ← 只改这一行
```

改完**立即生效、不用重启**（这个文件是 `patchReload: live`）。但插件模块只在行被激活时才 import，
所以「生效」的下一条证据在日志里（见下）。想小范围试：把 `budgetTokens` 调到 `20000`、
`softRatio` 调到 `0.05`，两档都能在一两次委派里撞到。

### 怎么关

三种，按「关得有多彻底」排：

1. **`enabled: false`** —— 插件自己的开关，`apply` 直接返回：不注册监听器、不写日志。**推荐**，
   这也正是安装脚本写进去的默认值。
2. **`disabled: true`**（loader 层字段，写在 `- id: adg-token-budget` 那一行同级）或**整行删掉**：连包都不 import。
3. **还原备份** `…/profiles/web/cordis.patch.yml.bak-adg-token-budget`（安装脚本改文件前会写这份）。

部署出来的插件目录本身不影响启动（没有行指向它就不会被 import）；想清干净就删
`${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`。

### 怎么确认它已经武装

**插件不写「已加载」行。** 这一点必须先说清，否则会拿一个空日志当「没生效」：

- **`enabled: false` 时**：`apply` 在注册任何东西之前就返回，**不注册监听器、不写任何日志**
  （宿主日志与 `logFile` 都是空的）。「装上了」这件事本身**看不见**。
- **`enabled: true` 时**，加载期能看到的证据是**宿主日志里的告警**（不是 `logFile`）：
  - 正常：`dsh-adg-token-budget: createUserMessage resolved via the "…" anchor` —— 只说明消息构造走通了；
  - `apply` 里抛了：`dsh-adg-token-budget: apply failed (…); the token budget is inactive`
    —— **看到这句就是坏消息**：插件降级成 no-op（profile 照常启动，这正是「永不抛」的设计）；
  - 上下文没有事件 API：`dsh-adg-token-budget: context has no event API; the token budget is inactive`。
- **`logFile`**（安装脚本写进去的是 `${DSH_HOME:-~/.dsh}/adg-token-budget.log`；插件自己的默认值是
  `null`，即完全不写文件）**只记决策行**，一行一条，ISO-8601 时间戳开头：

  ```
  2026-09-24T13:10:56.025Z soft stage: nudged usage=750 budget=1000 label=adg/child-1
  2026-09-24T13:12:04.881Z hard stage: cancel usage=3120448 budget=3000000 label=adg/child-7
  2026-09-24T13:12:05.002Z settled: released session state label=child-7
  ```

  也就是说：**`enabled: true` 之后这个文件仍然是空的，直到某个受管子代理真的越过软阈值**才出现第一行
  （软提醒每个子代理会话最多一次，所以这文件不会膨胀）。第一行决策出现时，同一条内容也会以
  `… token budget active (nudge via …); first decision: …` 的形式进一次宿主日志。
- **真实触发行为得用一次「超过预算的委派」来观察**：把 `budgetTokens` 临时调小（例如 `20000`），让一个专家
  正常干活，然后看 (a) `logFile` 里出现 `soft stage: nudged`，(b) 调度者收到的那份结果是不是以
  `Partial output before the run ended: …` 结尾。**单元测试只覆盖决策逻辑本身**，换不来这一条证据。

> **待办：**给 `enabled: true` 补一行**加载时的激活日志**（让「已武装」在 `logFile` 里直接可见）
> 是紧随其后的一步改动，做完会更新本节。在那之前，上面那几条宿主告警就是加载期的全部信号。

### 现在的证据到哪为止

哪些是实测、哪些是设计意图，与上一节一个口径 —— 不写没量过的结论：

| 事项 | 证据 |
|---|---|
| 决策逻辑（配置归一化、两档判定、筛选条件、状态释放） | **单元测试 36 个**：`cd plugin/dsh-adg-token-budget && node --test test`，只依赖 `node:test` / `node:assert`（checkout 里没有 `node_modules` 也能跑） |
| `package.json` 形状、ESM 可 import | 从**模拟的部署位置**（`…/profiles/node_modules/dsh-adg-token-budget/src/plugin.js`）import 起来验过 |
| `createUserMessage` 的四个解析锚点都解析到同一份模块 | **实测**（详见插件自己的 README） |
| 行能被 dsh 加载、不报 fatal | **未观测**（要装 + 重启一次才知道） |
| `agent/pre-step` 真的走到这个监听器 | **未观测**（监听器注册成 `{global: true}` 就是为了不让 scope 过滤把它丢掉，但没在真机上看过） |
| `sessionProjections.stateOf(…, 'tokenUsage')` 在真实子代理上返回预期的 `totals` | **未观测** |
| `agent.cancel({kind:'parent'})` 落到哪里、调度者怎么渲染部分输出 | **未观测** |
| 注入的收尾指令被循环接受并出现在子代理的转写里 | **未观测** |

### 安全设计（为什么它坏了也拖不垮 GUI）

这不是代码风格偏好，是 cordis 的硬约束：**`apply` 抛出去、又没有声明 schema，就是 fiber 失败，
dsh 把加载失败的行报成 fatal 启动错误**；更糟的是对一个**没挂载的服务**写死 `static inject`，
那条 entry 会永远停在 `pending`，同样是 fatal。所以这个插件的写法是：

- **`apply` 永不抛。** 整个函数体包在 try 里，任何失败都走 `ctx.logger?.warn` 并降级成 no-op。
- **每个事件处理器都包了 try。** 预算逻辑里的 bug 只会被抓住、记一次日志、然后 `return next()` ——
  它没法中断谁的回合。
- **没有 `static inject`。** `ctx.get('sessionProjections')` 在处理器里**惰性**读；服务不在就原样放行。
- **没有静态 import 任何 `@deepseek-ai/*`。** 插件是以普通目录部署在 `profiles/node_modules/` 下的，
  需要什么就在**调用时**用 `createRequire` 解析，解析失败也都可存活（必要时回落到本地构造函数）。
- **没有顶层副作用**，没有 `process.exit`，没有网络，除了配置的 `logFile` 不写任何文件。
- **状态有界**：每会话状态放在按 `agent.id` 索引的 `Map` 里，只在软档真的提醒过时才建条目，
  `subagent/end` 时释放，`ctx.effect` 的 disposer 再整体清一次。

**不导出 `Config` schema** 也是安全设计的一部分（理由见本节开头那段 cordis 约束）：有 schema 的话，
一个打错的值就会让整个 profile 加载失败。

## 目录结构

```
preset/
  preset.yml            # 在模式选择器里显示的名称与简介
  agent.cordis.yml      # 调度智能体 persona + 八个专家智能体行
skills/
  adg-add-agent/
    SKILL.md            # 「给 Adg 加一个智能体」的操作手册
plugin/
  dsh-adg-token-budget/ # host-plane 插件：子代理累计 token 的两档硬兜底
    package.json        # 部署单元：ESM 包，无运行期依赖
    src/                # config.js（归一化）/ budget.js（纯判定）/ plugin.js（注册监听器）
    examples/
      cordis.patch.yml  # 可直接贴进 profile patch 层的挂载行（默认值都注释在里）
    README.md           # 插件自己的说明：口径、筛选、安全设计、验证方式
    INSTALL.md          # 部署/启用/确认/回滚的操作清单（仓库文档，不进部署）
    test/               # 单元测试（node --test），**不进部署**
tools/
  check-preset.mjs      # 静态自检：专家行字段、toolName 唯一、allow 合法性、
                        # 通用委派行、调度名册与专家行双向一致，以及三组
                        # token 预算旋钮（共 5 个键）的取值、结构与约束
install.ps1             # Windows 安装脚本（preset + 技能 + 插件 + 挂载行）
install.sh              # macOS / Linux 安装脚本（同上，行为等价）
```

## 兼容性

- 从 DSH 出厂 preset `standard`（标准模式）复制而来，实质改动是三处：
  `persona` 增加调度名册、分派规则与委派预算；`delegation` 组由通用委派行换成专家行；
  `compaction` / `tool-web` 三行加上 token 预算（出厂值见 [token 成本纪律](#token-成本纪律这些上限是怎么来的)）。
- 依赖标准模式本来就有的出厂包（`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-persona`、
  `@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-subagent-control` 等）。
- 新增/删除/修改智能体后需要重启 dsh 才生效，这是 preset 挂载机制决定的，不是缺陷。
- **token 预算插件是另一条链路**：它是 host-plane 的单半边行（没有浏览器半边），挂在 `web` profile 的
  patch 层上，`config:` 改动热重载、不用重启；部署出来的是 `profiles/node_modules/` 下的**真拷贝**，
  所以仓库被删/被挪都不影响已经装好的 dsh。它依赖宿主本来就有的 `sessionProjections` 与 `agent/pre-step`，
  这两样缺失时它自己降级成 no-op（见 [安全设计](#安全设计为什么它坏了也拖不垮-gui)）。
- **`install.ps1` 带 UTF-8 BOM，是有意的，不要去掉。** Windows PowerShell 5.1 在没有 BOM 时
  会按系统 ANSI 代码页读取脚本，中文会变成乱码并直接解析失败（本仓库已实测复现并修复）。
  这条同样适用于任何新写的、含中文的 `.ps1`。

## 给 AI 的安装指令

（人类可忽略；把仓库地址交给 AI 时让它照此执行。）

1. `git clone <repo-url> <tempdir>`
2. 复制 `<tempdir>/preset/preset.yml` 与 `<tempdir>/preset/agent.cordis.yml`
   → `${DSH_HOME:-~/.dsh}/.agent-presets/adg/`
3. 复制 `<tempdir>/skills/adg-add-agent/SKILL.md`
   → `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md`
4. **部署 token 预算插件**：把 `<tempdir>/plugin/dsh-adg-token-budget/` 里的
   `package.json`、`src/`、`README.md`、`examples/` 复制到
   `${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`。
   **`test/` 不要拷**；**先删目标目录再拷**（重复执行要干净覆盖）；**真拷贝，不要建 junction/symlink**
   （部署出来的插件必须独立于仓库，否则仓库一删/一挪 dsh 就启动失败）。
   目标目录是**所有 profile 共享的模块解析根**，理由见
   [为什么装在 `profiles/node_modules`](#为什么装在-profilesnode_modules而不是链到仓库)。
5. **补挂载行**：目标 `<dshHome>/profiles/web/cordis.patch.yml`（`<dshHome>` = `${DSH_HOME:-~/.dsh}`）。
   - 先备份成 `cordis.patch.yml.bak-adg-token-budget`，并**在输出里说明**；
   - 文件里**已经出现 `dsh-adg-token-budget`** → 什么都别改，只报告「挂载行已存在」（第 4 步的复制照做）；
   - 末行**不是恰好 `[]`** → **不要猜**：放弃这次编辑，明确告诉用户「请手工把
     `plugin/dsh-adg-token-budget/examples/cordis.patch.yml` 里的行贴进去」，第 4 步的复制照旧完成；
   - 否则：保留原有注释头，把 `[]` 这一行换成一条 `insert:` 行（形状照 `examples/cordis.patch.yml`），
     **`enabled: false`**（先挂上不动作，确认无误再改 `true`），`logFile` 写成 `<dshHome>` 的
     **真实绝对路径**拼 `/adg-token-budget.log`（写成单引号 YAML 字符串）。写文件用**不带 BOM 的 UTF-8**。
   - 最后告诉用户：**这一行热重载，改 `config:` 不用重启；但 `enabled: false` 时插件什么日志都不写。**
6. 目标目录通常在工作区之外，写入会被沙箱拒绝一次；按提示用 `sandbox_permissions`
   升级重试同一条命令（用户会在界面上批准）。
7. 校验：挂一个注入 `agentPresets` 的临时插件（见技能 `editing-cordis-compositions`），
   - `await resolve('adg')` 的 `broken` 必须为空；
   - `await standingKeyFor('adg')` 走一次真实挂载（能报出包解析不到、配置非法、行未激活、
     服务发布到全局 realm 四类错误）；
   - `await compositionInventory()` 里 `adg` 必须出现 8 行专家：`agent-file`、`agent-computer`、
     `agent-app`、`agent-browser`、`agent-search`、`agent-researcher`、`agent-coder`、
     `agent-reviewer`，且**没有** `tool-subagent`、`tool-subagent-fork` 行。
   - 也可以直接 `node tools/check-preset.mjs` 做静态自检（零依赖，exit 0 表示通过）；
     校验已安装的那一份时传路径：`node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"`。
     注意它只是**文本扫描器**：exit 0 不等于"文件能解析、插件已挂载"，
     所以上面两条真实挂载的检查不能省（`resolve` / `standingKeyFor` 才是运行期证据）。
   - 插件那半边它**完全没覆盖**：插件能不能 import、行有没有激活，只能按
     [怎么确认它已经武装](#怎么确认它已经武装) 看宿主日志与 `logFile`。
8. 明确告诉用户：**必须重启 dsh**，之后在新建对话里选择「Adg 多智能体模式」。
   （插件那一行不用等重启，但它的运行期行为**还没被观测过**，所以别把"装了"说成"已经生效"。）
9. 如果用户还需要在**创造模式**里说「给 Adg 加一个智能体」被识别，确认第 3 步的技能已就位——
   `<dshHome>/skills` 是 `dsh-skill-filesystem` 的用户技能根（rank 400），两种模式都会扫描且热加载。
