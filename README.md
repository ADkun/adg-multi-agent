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

配套插件 **`dsh-adg-token-budget`**（第二层）：给委派出去的子代理加**步数收敛检查点**（默认阶梯
**4 / 8 / 12 / 18 / 24 / 32 / 42 / 55 / 72 / 95 / 125 / 165 / 215 / 280** 步，早期的密集、之后逐渐
拉开；注入的是一条**可选提醒**，让子代理自己选"收敛汇报"还是"继续做完必需的工作"）和一条
**累计 token 预算** —— 软档提醒它收尾，硬档直接取消并把它已经查到的结论交回调度者，默认
**300 万/子代理**。
安装时先挂 `enabled: false`（不动作）；只校准用 `dryRun: true`（只记录、不动作）；
**推荐的稳态是 `dryRun: false` + `hardDryRun: true`** —— 提醒真的注入，`agent.cancel` 仍只记账。
见
[第二层：子代理的步数检查点与 token 兜底](#第二层子代理的步数检查点与-token-兜底插件-dsh-adg-token-budget)。

## 安装

装到三个位置（`${DSH_HOME:-~/.dsh}` 是你的 dsh 用户根）：

| 仓库里的路径 | 安装到 |
|---|---|
| `preset/`（两个文件） | `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` |
| `skills/adg-add-agent/SKILL.md` | `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md` |
| `plugin/dsh-adg-token-budget/` 的 `package.json` / `src/` / `README.md` / `examples/` / `LICENSE` | `${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`（**真拷贝**，`test/` 与 `INSTALL.md` 不进部署） |

安装脚本还会往 `${DSH_HOME:-~/.dsh}/profiles/web/cordis.patch.yml` 补一行挂载（默认
`enabled: false`，先备份成 `cordis.patch.yml.bak-adg-token-budget`）—— 插件那一层是什么、
怎么开、怎么确认已武装见 [第二层：子代理的步数检查点与 token 兜底](#第二层子代理的步数检查点与-token-兜底插件-dsh-adg-token-budget)。

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

**预设改动按"重启"来验收，别赌热重载。** 旧版本文档里写过"已实测：preset 挂载之后把 composition
的行改掉，`compositionInventory()` 仍然返回旧行"，所以安装完必须重启 dsh，重启后在新建对话里选择
「Adg 多智能体模式」。（在重启之前，Adg 模式用旧组合运行，不要拿它做验证。）

不过 2026-09-25 这次实测看到的是**另一套机制**：当前这版 `dsh-agent-presets` 的
`ensureStanding()` 会比较 composition 文件的 stamp，文件变了就**起一个新的 generation**
（源码注释原话："a changed file starts the next generation here, for this and later sessions"）。
这次交付把改好的文件**部署到 `.agent-presets/adg/` 之后**重跑了挂载校验（第一次跑早了一步、
校验的是还没替换的旧文件，所以又跑了一次）：`resolve('adg')` 的 `broken` 为空、
`standingKeyFor('adg')` 返回 mounted OK、`compositionInventory()` 报 34 行、
**8 行启用的专家行**、`tool-subagent-fork` 0 行（`tool-subagent` 模块名出现 10 次，
因为 `tool-subagent-codex` / `tool-subagent-claude-code` 两行是 `enabled: false` 的）——
也就是**新文件确实能组合**。但"新会话会不会自动加入新 generation"没有实测（要有真实的 Adg 会话来观测
新 persona 文本），所以结论仍然写成：**preset 改动后重启 dsh**，并通过上面的挂载校验确认它可组合；
只有在重启代价很高时，才值得去测"不重启会不会也能生效"。

**token 预算插件那一行不受这条约束，但要分清改的是哪一种：**
它挂在 `profiles/web/cordis.patch.yml` 这个**热重载**层上，改 `config:` 立即生效、不用重启；
**改 `src/` 下的代码则必须重启** —— 已实测：热重载会重新 `apply` 这一行，但不会重新 `import`
已经加载过的模块（Node 的 ESM registry 按文件 URL 缓存，而 URL 没变），激活行仍然是旧形状。
所以**先部署代码 + 重启 + 确认激活行出现新字段，再改 `config:`** ——
在旧代码还活着的时候写 `dryRun: false`，会把旧代码里那个不认 `hardDryRun` 的硬档**真武装**。
`enabled: false` 时它不注册任何监听器、不写决策日志，但**会写一行加载期的激活行**
（`activation: inactive (enabled: false) …`），所以"装上了"这件事看得见 ——
见 [怎么确认它已经武装](#怎么确认它已经武装)。

**本次交付就是按这个顺序做的，三步都有日志为证**：01:37:18 重启后宿主重新加载了包，激活行出现
`stepNudge=true stepTiers=[12, 24, 40] … hardDryRun=true`（新代码在跑）；01:38:47 只改了
`dryRun: false`，**没有重启**，新的激活行就生效了（config 热重载）。反过来那次"同时改代码和 config"
在 17:10:28 短暂真武装过旧硬档两分钟，日志显示窗口内 `hard stage: cancel` 计数没有增加。

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

**策略因此只有两条：压上下文体积 + 压步数。** 前者是本 preset 的 5 个旋钮，
后者是第二层插件的**步数收敛检查点**（见
[第二层](#第二层子代理的步数检查点与-token-兜底插件-dsh-adg-token-budget)）——
这两条都要记住：只压体积不压步数，一个 300 步的子代理照样能把体积压出来的收益全部吃掉
（真机实测里就有这样一个：4899 万 token，`would cancel` 记了 297 行）。

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
  还有一条**收敛纪律**：委派 prompt 里要写明这个专家大致该在多少步内收敛（检索与阅读类 10–15 步、
  实现与审查类 15–25 步），并要求它每到检查点先判断"剩余工作是不是交付必需"；**同时不要自己去轮询
  专家的步数** —— 运行期已经替它注入了那条提醒（见
  [步数检查点](#步数检查点压步数的那一半)），而调度者自己轮询会把本会话最大的那段上下文反复重发。
- **八个专家**：每条 persona 末尾都追加了一行成本纪律 —— 先 `grep` 定位再按需 `read`；用 `offset/limit`
  分段读，禁止整读大文件；同一文件（或同一 URL）不重复读/抓；工具结果被截断时收窄查询而不是重复重取；
  证据足够即停止探查；**回给调度者的结论控制在 2000 字符内**（附 `path:line` 或 URL 证据），不要回贴
  原始工具输出或正文。`agent_search` / `agent_browser` 是联网向的措辞（"优先用搜索摘要定位，只对确需的
  URL 取正文；同一 URL 不重复抓取"），因为它们没有 `grep`。这一行末尾还各补了一句**检查点纪律**：
  "到达步数检查点时先判断剩余工作是否为交付必需：不是就立刻汇报，是就只做那一步然后汇报" ——
  persona 里写的是**政策**，真正把提醒推进上下文的是插件，两者用同一句话，子代理才不会有"这是谁在说话"的歧义。

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

## 第二层：子代理的步数检查点与 token 兜底（插件 `dsh-adg-token-budget`）

上一节的 5 个旋钮压的是**上下文体积与单条结果的体积**，它们管不到**步数**，也管不到「一个子代理
一共烧了多少」。这一层补上两半：**压步数**的"步数收敛检查点"，和**压总量**的软/硬两档预算。
两半都由同一个 **host-plane 的 cordis 插件**实现，挂在 `agent/pre-step` 上。

> **先说状态，分三段说：**
>
> **① 硬档：真机实测过。** 插件部署在 `${DSH_HOME}/profiles/node_modules/dsh-adg-token-budget`、
> 挂在 `${DSH_HOME}/profiles/web/cordis.patch.yml` 上，被运行中的 dsh 加载，留下三行日志：
>
> ```
> 2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
> 2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
> 2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
> ```
>
> 所以「行能被加载、`agent/pre-step` 走到了这个监听器、`tokenUsage` 读出了真实累计值、`agent.cancel`
> 被调到」四件事**已经是实测**。后来那一行被切成 `dryRun: true`，用户自己的真实委派又走了几百行 dry-run
> 判定，**一行 `agent.cancel` 都没发** —— 这既证明比较逻辑按真实账单在跑，也证明 `dryRun` 真的不动作。
>
> **② 步数检查点：代码与测试齐全，2026-09-25 01:37 重启后已确认新代码真的加载、01:38:47 已武装；
> 但还没有在真机上注入过一条，而且阶梯与措辞在当天被换过一次（见下）。**
> 71 个单元测试（mock 的 cordis 上下文与假 agent）、17 个针对性变异全部被测试抓住、
> 包与 preset 已部署到真机路径并与仓库逐字节一致。
> 2026-09-25 武装之后发生了**三次真实检查点注入**（插件日志行 + 子代理转写里的那条消息，
> 毫秒级对齐）：两次用的是旧措辞（`fdd55c65` / `12bf2213`，第 12 步、当时只花了 10–12 万 token），
> 一次用的是**新的选择式措辞**（`41c07ec8`，第 12 步、14.3 万 token）。
> 子代理随后的第一条消息分别是：*"I'm at step 12. I should converge."*、
> *"I have enough evidence. Let me 收敛 and report."*、以及
> *"Remaining必需工作: … Let me do 2 more fetches … then converge. I'll say I'm continuing briefly."*
> —— 收到命令式措辞的两个都表示要收敛；收到选择式措辞的那个**选了"继续"并说明理由**，
> 没有偷偷缩减计划。这正是新措辞两个分支的设计行为（`n=1`/种，是例证不是效果测量）。
> `settled: released session state …` 也在 17:55:33 第一次观测到（那个子代理收敛后 29 秒释放状态）。
>
> **同日阶梯从 `[12, 24, 40]` 换成 `[4, 8, …, 280]`。** 依据是重跑审计后的真实分布（中位数 39、
> p10 只有 6：按均值放检查点等于不问），而不是"多数子代理不需要那么多步"这个直觉本身 ——
> 直觉解释了动机，分布决定了数字。代价与风险都写在
> [步数检查点](#步数检查点压步数的那一半) 一节里：覆盖从 30/37 提到 34/37、注入从 71 条增到 214 条
> （约占总账单 0.25%），换来"首次检查点之后还剩 92.6% 的步数"这个可干预面。
> 这次是**代码改动**，做法是：先重启、确认激活行出现 `stepText=`，再改 `stepTiers` ——
> 18:25:14 的激活行就是这么来的，**没有第二次重启**。
> **仍然未观测**：第一个 tier 之外的任何一档、新阶梯下的任何一次注入、以及"提醒是否让子代理更快收敛"。
>
> **③ 真实账单侧的 dry-run 观测（这是最有价值的一段）。** 快照时 `logFile` 里已经有 5 个真实
> `adg` 子代理走过判定（**5 个全部** ≥ 300 万，最大 **48,992,135**），
> `would cancel` 437 行、`would nudge` 36 行，而 `soft stage: nudged` 与 `settled:` 都是 **0 行**。
> 这是**旧代码**的校准数据，也正是"默认 300 万落在正常分布内部、不能按它武装硬档"的直接证据
> （见 [默认预算 300 万是怎么定的](#默认预算-300-万是怎么定的)）。
> 确认方式与证据边界见 [怎么确认它已经武装](#怎么确认它已经武装)
> 与 [现在的证据到哪为止](#现在的证据到哪为止)。
>
> **④ 步数与"请求数"是同一个单位**（阶梯校准的前提）：审计对 `f7ee3039-…` 数出 **329** 个模型请求，
> 插件对同一个 id 数出约 **297** 步超预算 —— 两个基于不同事件的独立计数互相吻合。

### 步数检查点（压步数的那一半）

调度者能提醒子代理，但**它自己不能轮询**：审计里调度者会话占 adg 账单的 **59%**，而它每轮一次
就要把本会话最大的那段上下文重发一遍 —— 轮询比提醒省下的还贵。所以政策写在 persona 里
（委派 prompt 写明大致的收敛规模，并说明那是参考而不是硬要求），而**提醒由这个插件以调度者的
名义、按下面的阶梯注入**：

| 观测 | 值 |
|---|---|
| 每个子代理的**模型请求数**（= 步数） | min 1 / p10 6 / **p25 14** / 中位数 **39** / 平均 51.7 / p75 61 / p90 103 / max **329**（37 个子代理） |
| 默认检查点阶梯 | **4 / 8 / 12 / 18 / 24 / 32 / 42 / 55 / 72 / 95 / 125 / 165 / 215 / 280 步**（各一次）：前 24 步里每 4–6 步一次，之后按约 ×1.3 拉开 |
| 覆盖面 | 37 个子代理里 **34 个**至少收到一次；中位数那个收到 6 次；329 步那个收到全部 14 次 |
| 提醒自己的成本 | 全部 214 条消息合计约 **0.5M token 等量**（每条约 180 字符，之后每一步跟着重发一次），对比同一批子代理花的约 205M ≈ **0.25%** |
| 每一步注入几条消息 | **最多 1 条**；同一步同时命中检查点和 token 软档时，token 收尾指令优先 |

**为什么锚点是分布、不是均值**：原来的 `[12, 24, 40]` 是照"平均 23.4 步"放的，而重跑审计
（`audit-steps.mjs`，同一份日志、另写一个报告文件）之后，37 个子代理的**中位数是 39、p10 只有 6、
四分之一在 14 步内结束**。按均值放等于对大量本来早就该问一句的委派一句话都不问。所以阶梯提前、
加密；作为对比：

| 阶梯 | 覆盖到 | 注入条数 | 首次检查点之后的步数占比 | 最后一个 tier 之后的步数 |
|---|---|---|---|---|
| `[12, 24, 40]` | 30/37 | 71 | 79.5% | 872 |
| `[4, 8, …, 280]` | 34/37 | 214 | 92.6% | 49 |

注入的文本是**一条可选提醒**（署调度者的名），形如：

```
【收敛检查点 1／14】调度代理提醒：这是你的第 4 步。

这是一条**可选**提醒，不是停止指令。请你自己判断，二选一：
- **收敛**：如果现有产出已经能回答委派目标，就收尾汇报——交付了什么、还有哪些部分没有验证。
- **继续**：如果确实还有必须做完的工作，就继续做，**直接无视这条提醒**，不要为了回应它而缩减或改写计划。
选哪个由任务本身决定，不是由这条提醒决定。请在下一条消息开头用一句话说明你的选择，然后按你的选择继续。
```

**为什么必须写成"可选"**：阶梯提前、加密之后，检查点会落到大量**本来就不算长**的委派上（中位数
那个会收到 6 条）。如果它是一条"立刻停止探索"的指令，密集的早期检查点就会把正常的长任务也压扁 ——
那是拿结果换 token，是这个功能唯一不被允许做的交易。所以三道性质写死在文本里、由测试钉住：
① 明说可选、**可以无视**；② 两个分支对称列出，"选哪个由任务本身决定"；③ 收敛分支仍要写明
**哪些没验证**。另外还有一条反向断言：文本里不许出现"立即停止"这类命令句。
变异 **M13** 专门把那句"可以无视"反过来写（"不要无视"），被测试抓住 —— 它正是"命令披着选择的外衣"
这个失效模式。只有**最后一个 tier** 多一句（提醒到此为止；若继续请说明预计还要多少步、完成标准
是什么），且**各档正文完全一致、不递进**（密阶梯 + 逐次加压＝强制机器，测试会比较各档正文是否相同）。
计数只算**真正进入的步**（下游 reject 掉的那一步不算），每个子代理独立计数、`subagent/end` 时释放，
恢复后进入新的驻留期可以从头再提醒。

措辞是**可配置**的：`stepText` 覆盖内置正文（整段替换），而 `config:` 是热重载的 ——
所以以后调措辞不需要新包、也不需要重启 dsh。激活行会写 `stepText=builtin` 或 `stepText=custom`，
敲错键名不会静默。

### 三档

| 档 | 触发 | 动作 |
|---|---|---|
| **步数** | 子代理**进入**第 `stepTiers` 里的某一步（默认 **4 / 8 / 12 / … / 280**） | 这一步照常放行（先调 `next()`），然后追加一条 `【收敛检查点 n／N】` 消息：**可选**提醒，让子代理自己选"收敛汇报"还是"继续做完必需的工作"，并说明选择 |
| **软** | 累计用量 ≥ `budgetTokens × softRatio`（默认 **210 万** = 300 万 × 0.7） | 这一步照常放行（先调 `next()`），然后追加一条收尾指令：立刻停止探索、不要再开新的调查线、用已有证据汇报结论，并**明说哪些还没验证** |
| **硬** | 累计用量 ≥ `budgetTokens`（默认 **300 万**） | `agent.cancel({ kind: 'parent' })` **并且**返回 `{ kind: 'reject' }`（**不调 `next()`**）。子代理以「取消」收场，但**它的部分结论会回到调度者** —— 委派工具会把结果附成 `Partial output before the run ended: …`；被硬停丢掉的是它没做完的计划，不是它已经查到的结论 |

阈值都是**闭区间**（正好等于阈值就触发）。每条提醒**每个子代理会话的每个"驻留期"（residency epoch）
最多一次**（步数档是**每个 tier 各一次**）：标记在 `subagent/end` 时释放，而子代理层**每个驻留期发一次**
这个事件，所以一个可续跑的子代理被恢复后会进入新的驻留期、**可以被再次提醒**。这是有意的
（恢复后的子代理有新的计划、也有新的跑飞机会），代价只是"同一段驻留期内不重复提醒"这条保证。
**同一步最多注入一条消息**：token 软档的收尾指令优先于步数检查点（它更紧急），被折叠的那次
只写一行日志，不占 tier 标记。

`dryRun: true` 时三档都只算不做：**不注入消息、不 `agent.cancel`，步数档只记日志
（`dry-run step stage: would nudge …`）、硬档也照常放行 `next()`**，而且**不消耗任何"只提醒一次"
的标记、不建任何会话状态** —— 所以校准完再把 `dryRun` 关掉，第一次软档和第一个检查点仍然会提醒。
（**但步数本身照常计数**：校准期也要看得见"第几步会开始提醒"，否则这个开关校准不出东西来。）
这是"先按自己的流量校准、再武装"的那把开关（见
[默认预算 300 万是怎么定的](#默认预算-300-万是怎么定的)）。

**`hardDryRun: true` 是给"只武装软手段"用的**：它只在 `dryRun: false` 时有意义 —— 提醒
（步数检查点 + token 软档）**真的注入**，而 `agent.cancel` 仍然只写
`dry-run hard stage: would cancel …`。这是本机采纳的稳态：软手段最多让子代理早点收敛，
硬手段会截断一个正常委派，两件事代价不同，就不该共用一个开关。

累计口径（插件自己算，不依赖 provider 报的账单字段）：

```
未缓存输入 + 输出 + cacheRead × cacheReadWeight + cacheWrite
```

读的是 `ctx.get('sessionProjections')` 的 `stateOf(session, 'tokenUsage')`，其 `totals` 是**整个会话日志**的累计值。

只对**被委派的子代理**且 preset 命中的会话生效，三个条件按顺序判：

1. `enabled` 为真；
2. `delegationDepthOf(agent) > 0` —— 取 `session.header.delegationDepth` 与运行时 `subagentDepth` 的较大值，
   但**两侧都先过 `Number.isSafeInteger(value) && value >= 0`**：`'1'`（字符串）算**深度 0**、
   不是 1，因为 `'1' > 0` 在 JS 里为真，一个被 YAML/JSON 往返成字符串的数字若被强转，
   就会让一个写错的 header **真的砍掉一个子代理**；`1.5` 不截断、`-1` 不夹到 0、`2 ** 53` 越界也不认
   （裸 `Number.isInteger` 会放它过去），`NaN`/`Infinity`/`true`/`null` 一律算"没有深度"。
   （**header 是权威且单调的**：被恢复的子代理带着全新的 options 回来，只看 `subagentDepth` 会让它当成顶层会话）。
   顶层会话（深度 0）**永远不动**，尤其不会动调度智能体；
3. `session.header.agentPreset` 命中 `presets`。**header 里没有 `agentPreset` 的子代理也不动** ——
   这里**故意 fail-open**：猜错会砍掉它本来没被指向的会话。

投影服务缺失、或 `tokenUsage` 读不出可用值时，**token 那两档**这一步原样放行（这件事最多记一次日志）。
**「没有预算数据」不等于「没有预算」。** 但**步数检查点不依赖投影**：它只数 `agent/pre-step` 被进入了
几次，所以在拿不到 token 数据的会话里仍然照常提醒 —— 这也是它有独立开关 `stepNudge` 的原因。

### 默认预算 300 万是怎么定的

对着 [token 成本纪律](#token-成本纪律这些上限是怎么来的) 那套审计口径看（同一份 `audit-report.txt` 快照，
32 个 Adg 会话 / 983 次请求）：

| 观测量 | 实测值 |
|---|---|
| 每个子代理会话平均 | ≈**1.73M**（`avg tokens per subagent adg session: total(input+output+cache)=1734486`） |
| 22 个子代理会话合计 | **38.2M**（`subInput` 2,729,782 + `subOut` 351,534 + `subCache` 35,077,376） |
| 快照里最贵的单个子代理会话 | **5.22M**（`in` 228,433 + `out` 42,094 + `cache` 4,947,456 = 5,217,983） |
| **实测到的最重一次「实现型委派」** | **7.65M**（`usage=7651807`，就是上面那次真机硬停；同一个子代理越过了 300 万，被 `agent.cancel` 停掉） |
| 快照里 **≥ 300 万** 的子代理会话 | **22 个里的 5 个** |
| 最贵的调度者会话（对照） | 38.4M（3,686,879 + 364,731 + 34,336,896） |

那 5 个越过默认预算的子代理会话，按总量降序是：
**5,217,983 · 4,455,097 · 4,070,916 · 3,904,800 · 3,236,397**；第 6 名是 2,204,189。
也就是说边界**不在**"差一点点"的地方 —— 300 万这条线正好落在这批分布的中段。

**所以口径要说准：300 万不是"谁都不会被砍"，它落在分布内部，一定会砍掉正常工作量。**
平均每个子代理 1.73M、22 个里已经有 5 个（约四分之一）超过 300 万、实测最重的一次是预算的 2.5 倍。
它防的是**尾部**（一次跑飞能顶掉一整天的额度），但只在**更高的数字**上才只防尾部；
想让"正常委派"基本不被砍，得把这条线抬到**高于你自己流量主体**的位置，而不是抬到"平均值之上"。

两个让这份分布**偏悲观**的原因，读数字时要一起记住：

- **preset 侧那 5 个旋钮（见 [三组预算旋钮](#三组预算旋钮共-5-个键)）要重启 dsh 才生效**，
  而上面这份语料是在它们生效**之前**产生的 —— 它量的是旧的、更胖的流量。
- **语料是活的、还在长。** 这次改文档时重读了一遍同一份会话目录，已经是 32 个子代理会话、
  最大 **17,022,627**、平均 **3,942,185** —— 上面每个数字都是**下界**。

**真机 dry-run 快照（2026-09-25T01:1x+08:00，比审计语料更狠）：**`logFile` 里已经有 **5 个真实
`adg` 子代理**走过判定，**5 个全部越过了 300 万**，其中 2 个 ≥ 600 万，最大一个 **48,992,135**
（≈预算的 16 倍），`would cancel` 共 437 行、`would nudge` 共 36 行，`soft stage: nudged`
与 `settled:` 都是 **0 行**。逐个子代理的峰值：

| 子代理 | `would cancel` 行数 | 第一次越过 300 万 | 峰值累计用量 |
|---|---|---|---|
| `adg/f7ee3039-…` | **297** | 3,121,660 | **48,992,135** |
| `adg/973aca1b-…` | 92 | 3,065,764 | 16,607,867 |
| `adg/7cfa95ae-…` | 27 | 3,018,602 | 6,745,603 |
| `adg/2ec8cfe5-…` | 18 | 3,014,252 | 6,230,057 |
| `adg/5bee9ec3-…` | 3 | 3,083,933 | 3,361,608 |

两个可以直接读出来的结论：**① 300 万落在你自己流量的主体里**（5/5 都越过去了），
所以按它武装硬档一定会截断正常委派；**② 步数才是那个真正的杠杆** —— 最大的那个子代理贡献了
297 行 `would cancel`，也就是它在 300 万之上又走了约 **300 步**（而重跑的 37 个子代理里，
中位数是 39 步、最大 329 步）。给它 14 次收敛检查点相对于 4899 万 token 是零成本
（全部 214 条提醒合起来约占总账单 0.25%），这正是这一层要做的事。

**先看再武装：`dryRun: true` 就是为这件事准备的。** 打开它（`enabled: true` + `dryRun: true`）
之后，插件会把每一次三档判定按原样写进 `logFile`，但**不注入、不 cancel**，
于是这个文件就变成"按我自己的流量，这个预算会砍掉多少、第几步会开始提醒"的实测。
看着能接受了再武装，而且**建议分两步武装**：先
`dryRun: false` + `hardDryRun: true`（提醒真的注入，`agent.cancel` 继续只记账），
等 `would cancel` 那些行与真实节省都看明白了，再讨论要不要动硬档。

实测发现正常委派被误砍时，先调 `budgetTokens`：`cacheReadWeight` 是唯一能改变「同一份账单算出的累计值」的键，
`softRatio` 只决定软档在哪提醒。

（口径注：报告里那张 top 15 表按 `in+out` 排序、只列出 13 个子代理会话，
所以「最贵 5.22M」与「5 个越过 300 万」都是这次**重读全部 22 个子代理会话**算出来的，不是从那张表读出来的；
另外 `cacheWriteTokens` 在全部 1183 个 usage 对象里都不存在，累计口径里的 cache-write 恒为 0 ——
这是「provider 没上报」，不是「没有 cache 写入」，真实账单只会更高。）

### 全部配置键与默认值

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true`（**本仓库装进去的那一行是 `false`**） | 总开关。`false` 时 `apply` 在注册任何监听器之前返回：**不注册监听器、不写决策日志**（但仍写一行加载期激活行，见下） |
| `presets` | `['adg']` | 管哪些 preset 的子代理。裸字符串 `presets: adg`（YAML 标量的读法）等于单元素列表 |
| `budgetTokens` | `3000000` | 每个子代理会话的累计预算。非正数或不可用值**回落到默认**（「停掉每个子代理的第一步」绝不是打错值的意思） |
| `softRatio` | `0.7` | 软阈值占预算的比例，夹到 `[0, 1]`；`1` 等于关掉软档 |
| `cacheReadWeight` | `1` | 乘在 `cacheReadTokens` 上的权重，夹到 `[0, 100]`，小数保留原样。`1` = 缓存读取按整份计（最严）；`0` = 完全不计 |
| `softNudge` | `true` | **两种提醒的总开关**：`false` 时步数检查点与 token 软档都只记日志、不注入消息，**硬档照旧**；这一条日志本身就是"一次性动作"，所以会消耗对应的标记 |
| `stepNudge` | `true` | 步数检查点的开关。`false` 时**连步数都不计**（回到旧行为：这一档完全不参与，一步都不分配状态） |
| `stepTiers` | `[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]` | 在第几步注入检查点。裸数字（`stepTiers: 12`）等于单元素列表；非法项丢弃、去重、升序、上限 16 个；清洗后为空则**回落到默认**。取值依据见 [步数检查点](#步数检查点压步数的那一半)：**提前、加密**，因为真实分布的中位数（39）远低于均值，而 p10 只有 6 |
| `stepText` | `null` | 可选：自定义检查点正文，**整段替换**内置正文（含内置只在最后一档追加的那句）。空值/非字符串回落到内置正文（不会让提醒变成空话）；超过 4000 字符截断。存在的理由：**调措辞是热重载的 `config:` 改动，不需要新包、也不需要重启 dsh**。激活行写 `stepText=builtin` / `stepText=custom`，敲错键名不会静默 |
| `dryRun` | `false` | 校准开关。三档都只算不做：不注入、不 `agent.cancel`、硬档也照常 `next()`；**不消耗任何"只提醒一次"的标记、不建会话状态** —— 但**步数照常计数**（否则校准不出"第几步会提醒"） |
| `hardDryRun` | `false` | 只在 `dryRun: false` 时有意义：**只让硬档保持 dry**，步数检查点与 token 软档**真的注入**。这是"只武装软手段"的开关，也是本机采纳的稳态 |
| `logFile` | `null` | 绝对路径；设了就追加**加载期激活行 + 每个决策事件一行**。**普通放行（PASS）一步什么都不写**（所以文件不会膨胀）。**相对路径会被关掉文件日志并告警** |

`logFile` 里会出现的行只有这几类：`activation: active|inactive …`（每次 `apply` 一行，**包括 `enabled: false`**）、
注册提示（`registration skipped: …` / `warning: N registration(s) are already active …`）、
步数档（`step stage: nudged tier=n/N step=S …` / `step stage: folded into the token wrap-up …` /
`step stage (no nudge configured) …` / `step stage (no nudge injected: …) …`）、
软档（`soft stage: nudged …` / `soft stage (no nudge configured) …` / `soft stage (no nudge injected: …) …`）、
硬档（`hard stage: cancel …`）、dry-run（`dry-run step stage: …` / `dry-run soft stage: …` /
`dry-run hard stage: would cancel …`）、
`settled: released session state label=…`、以及至多一次的 `no budget data: passing through the token stages …`。
第一条决策行还会以 `dsh-adg-token-budget: first decision: …` 的形式**同时**进一次宿主日志。

插件**不导出 cordis `Config` schema**：它自己手写归一化，所以打错的值回落到默认，而不是让 profile 加载失败。
默认值也在 `plugin/dsh-adg-token-budget/examples/cordis.patch.yml` 里以注释形式列了一遍
（`enabled: false` 那一行是**取消注释**的，所以照抄这个例子直接贴进 patch 层就是"挂上但不动作"）。

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
        dryRun: true       # ← 建议先只开到这一步：只记录、不动作
```

改完**立即生效、不用重启**（这个文件是 `patchReload: live`）：宿主会重新 `apply` 这一行并写下一行
`activation: active …`。**前提是包里 `src/` 的代码没变过** —— 热重载不会重新 `import` 已经加载过的
模块（见 [装完必须重启 dsh](#装完必须重启-dsh)）。本机已经这样跑过（见下）。想小范围试：把
`budgetTokens` 调到 `20000`、`softRatio` 调到 `0.05`，token 那两档在一两次委派里就能撞到；
步数检查点把 `stepTiers` 调到 `[1, 2]` 就会在子代理的头两步各出现一次。

**推荐的上线顺序是四步而不是三步：** 先 `enabled: false` 挂上（照抄例子文件就是关着的）→
`enabled: true` + `dryRun: true` 拿自己的流量校准 → `dryRun: false` + `hardDryRun: true`
只武装软提醒（**这是推荐的稳态**，`agent.cancel` 仍只记账）→ 等 `would cancel` 的行看明白了、
`budgetTokens` 抬到高于自己流量主体，再 `hardDryRun: false` 把硬档也武装。

### 怎么关

三种，按「关得有多彻底」排：

1. **`enabled: false`** —— 插件自己的开关，`apply` 在注册任何监听器之前返回：不注册监听器、不写决策日志。
   **推荐**，这也正是安装脚本写进去的值。
2. **`disabled: true`**（loader 层字段，写在 `- id: adg-token-budget` 那一行同级）或**整行删掉**：连包都不 import。
3. **还原备份** `…/profiles/web/cordis.patch.yml.bak-adg-token-budget`（安装脚本改文件前会写这份）。

部署出来的插件目录本身不影响启动（没有行指向它就不会被 import）；想清干净就删
`${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`。

### 怎么确认它已经武装

**加载期有一行激活行，`enabled: false` 时也写。** 这一行是"宿主确实加载过这个插件、用的是这份配置"的证据：

- **`logFile` = 安装脚本写进去的 `${DSH_HOME:-~/.dsh}/adg-token-budget.log`**（插件自己的默认值是
  `null`，即完全不写文件）。每次 `apply` 先追加一行 ISO-8601 时间戳开头的激活行：

  ```
  2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
  2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
  2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
  ```

  第 1 行是"宿主加载了、但开关是关的"，第 2 行是"已武装、`createUserMessage` 由 running profile 的
  fallback 目录解析"（`profile-fallback:web`），第 3 行是**真机的一次硬停**。
  **新版本的激活行更长**，`softNudge=` 之后还会出现 `stepNudge=`、`stepTiers=[…]`、`hardDryRun=` ——
  上面这两行是旧版本留下的，所以**这一行同时也是"运行中的宿主到底加载了哪一版代码"的判据**：
  你部署了新代码却发现激活行没有新字段，就是"热重载重放了 config、但没有重新 import 模块"，
  需要重启 dsh（见 [装完必须重启 dsh](#装完必须重启-dsh)）。
- **除激活行之外，`logFile` 只记决策事件**：步数检查点、软档、硬档、dry-run 判定、
  `settled: released session state …`、至多一次的 `no budget data: passing through the token stages …`。
  **普通放行（PASS）一步什么都不写**，所以 `enabled: true` 之后文件不会因为"步子多"而膨胀。
  注意 dry-run 下**每一步**都会写一行（`dry-run hard stage: would cancel …` 会重复出现），
  所以那个行数是"超预算的**步数**"，不是"子代理个数" —— 本机的实测例子：437 行
  `would cancel` 只来自 **5 个**子代理，其中最大的那一个自己就贡献了 **297 行**（≈300 步）。
- **宿主日志**里同一行带前缀 `dsh-adg-token-budget: `；第一条决策行还会额外以
  `dsh-adg-token-budget: first decision: …` 进一次宿主日志。**看到**
  `dsh-adg-token-budget: apply failed (…); the token budget is inactive` **就是坏消息**：
  插件降级成 no-op（profile 照常启动，这正是「永不抛」的设计）；同理
  `context has no event API; the token budget is inactive`。
- **真实触发行为**：`hard stage: cancel` 已经在真机观测到（上面第 3 行）；**步数检查点的真机注入也已经
  观测到**（三次，且拿到了子代理转写里的原文与它的回应）；`dryRun: true` 期间
  硬档与软档的判定行也在真机观测到过（`dry-run soft stage: would nudge …` /
  `dry-run hard stage: would cancel …`，且没有发出任何 cancel）；**真软档的注入还没有**。
  见 [现在的证据到哪为止](#现在的证据到哪为止)。

**当前这一行是武装状态**（`enabled: true`、`dryRun: false`、`hardDryRun: true`、
`stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]`），
加载与注入都已是实测：18:18:22 的激活行出现 `stepText=builtin`（只有新代码会写这个字段），
18:25:14 的激活行把阶梯换成 14 档且**没有重启**（config 热重载）。所以接下来日志里每出现一行
`step stage: nudged …`，都是这条链路上的一次真实注入。

**最容易误判的一点：**校准期的"第一个检查点"在日志里长得像
`dry-run step stage: would nudge tier=1/14 step=4 usage=… label=…` ——
**它证明的是计数到了、不是消息发出去了**。要区分"提醒真的注入"和"只是记账"，
看行首那三个词：`step stage: nudged …` / `soft stage: nudged …` 是真的注入了，
带 `dry-run` 前缀的都是没注入的。武装之后这条判断仍然适用：只有 `nudged` 那一种算注入。

### 现在的证据到哪为止

哪些是实测、哪些是设计意图，与上一节一个口径 —— 不写没量过的结论：

| 事项 | 证据 |
|---|---|
| 决策逻辑（配置归一化、步数档 + 两档判定、筛选条件、状态释放、同一步只注入一条） | **单元测试 71 个**：`cd plugin/dsh-adg-token-budget && node --test test`，只依赖 `node:test` / `node:assert`（checkout 里没有 `node_modules` 也能跑）；另做过**变异验证**：旧的 15 个关键行为逐个打断，11 个被测试抓住、4 个没抓住并且写明；**步数档又单独做了 17 个变异（M1..M17，含自定义措辞路径），全部被抓住**（详见插件 README 的「Mutation verification」） |
| `package.json` 形状、ESM 可 import | 从**模拟的部署位置**（`…/profiles/node_modules/dsh-adg-token-budget/src/plugin.js`）import 起来验过 |
| `createUserMessage` 的五个解析锚点都解析到同一份模块 | **实测**（详见插件自己的 README） |
| 行能被 dsh 加载、不报 fatal | **实测**：`activation: inactive (enabled: false)` 就是宿主加载成功后写的 |
| `agent/pre-step` 真的走到这个监听器 | **实测**：真机 `hard stage: cancel …`，以及几百行 dry-run 判定 |
| `sessionProjections.stateOf(…, 'tokenUsage')` 在真实子代理上返回预期的 `totals` | **实测**：`usage=7651807`、`usage=9824410`、`usage=48992135` 都是真实累计值 |
| 两档阈值的比较按真实账单在跑 | **实测**：`would nudge` 最早出现在 2,128,454（软阈值 2,100,000）、`would cancel` 最早出现在 3,014,252（硬阈值 3,000,000） |
| `dryRun` 真的不动作 | **实测**：437 行 `would cancel` + 36 行 `would nudge`，**0 次** dry-run 期发出的 `agent.cancel` |
| `agent.cancel({kind:'parent'})` 会被调用 | **实测**（`hard stage: cancel` 那一支）；**调度者怎么渲染部分输出未观测** |
| **真软档**（`soft stage: nudged`）在真机上发生 | **未观测** —— 所有软档行都是 dry-run 的，消息从未真正注入 |
| **步数检查点**（`step stage: nudged`）在真机上发生 | **已实测**：三次注入（17:45:49 / 17:55:04 / 18:22:13，都在 `tier=1/3 step=12`），且能在对应子代理的 `session.v3.jsonl.zstd` 里找到那条消息本身（`role: user`、`source: {kind:'plugin', plugin:'dsh-adg-token-budget'}`），毫秒级对齐。**未覆盖**：第一个 tier 之外的档、新阶梯下的注入、与 token 软档同一步发生的折叠路径、`dry-run step stage` |
| 注入的提醒被子代理读到并回应 | **已实测（3 例）**：两个收到命令式措辞的表示要收敛；收到选择式措辞的那个明确选择"继续"并列出剩余必需工作、没有缩减计划。`settled: released session state …` 也在 17:55:33 首次观测到 |
| **更早更密的阶梯 + 选择式措辞到底有没有用** | **未观测，而且是这个功能的核心问题**：分布（37 个子代理，中位数 39、p10 6）、成本（214 条约占 0.25%）、以及"第 12 步时只花了 10–14 万 token"都是实测的；"收到 14 条检查点的子代理是否比不收到时更早收敛"没有任何证据。量法写在插件 README 里：`audit-steps.mjs` 前后各跑一次，比分位数 |
| 注入的收尾指令被循环接受并出现在子代理的转写里 | **步数检查点的注入已实测**（见上一行）；**token 软档的收尾指令仍未观测**（所有软档行都是 dry-run 的） |
| `settled: released session state …` / 恢复的子代理被再次提醒 | `settled:` **已实测**（17:55:33，收敛后 29 秒）；**恢复的子代理被再次提醒仍未观测** |
| `adg` preset 改动后能组合 | **实测**（把改好的文件部署到 `.agent-presets/adg/` 之后重跑的那一次）：`resolve('adg')` → `broken` 为空、`standingKeyFor('adg')` → mounted OK、`compositionInventory()` → 34 行 / 10 个 `tool-subagent` 模块行里 **8 行启用** / `tool-subagent-fork` 0 行（行数不变是预期的：这次改的是 persona 文本与政策，不是行的增删） |

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
- **状态有界**：每会话状态放在按 `agent.id` 索引的 `Map` 里，条目只记三个计数器
  （`steps` / `nudged` / `firedTiers`，都是小数字），**只有真的要动作时才建条目**：
  步数档只在**要注入检查点**或**要烧掉一个 tier 标记**时建，软档只在真的注入了收尾指令
  （或 `softNudge: false` 时写了那一条日志）时建；普通放行、硬档、没送达的提醒都不建条目 ——
  唯一的例外是 `dryRun` 且 `stepNudge` 打开时，计数本身需要一条状态（校准要看步数），
  但它只在新代码里存在，且同样在 `subagent/end` 释放、`ctx.effect` 的 disposer 再整体清一次。

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
  dsh-adg-token-budget/ # host-plane 插件：子代理的步数收敛检查点 + 累计 token 的两档硬兜底
    package.json        # 部署单元：ESM 包，无运行期依赖
    src/                # config.js（归一化）/ budget.js（纯判定）/ plugin.js（注册监听器）
    examples/
      cordis.patch.yml  # 可直接贴进 profile patch 层的挂载行（默认值都注释在里，enabled: false 是显式的）
    LICENSE             # MIT（package.json 的 files 里列了它，必须真的存在）
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

- 从 DSH 出厂 preset `standard`（标准模式）复制而来，实质改动是四处：
  `persona` 增加调度名册、分派规则与委派预算（含收敛目标与"不要轮询步数"）；
  `delegation` 组由通用委派行换成专家行；八个专家的成本纪律末尾各补一句检查点纪律；
  `compaction` / `tool-web` 三行加上 token 预算（出厂值见 [token 成本纪律](#token-成本纪律这些上限是怎么来的)）。
- 依赖标准模式本来就有的出厂包（`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-persona`、
  `@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-subagent-control` 等）。
- 新增/删除/修改智能体后需要重启 dsh 才生效，这是 preset 挂载机制决定的，不是缺陷。
- **token 预算插件是另一条链路**：它是 host-plane 的单半边行（没有浏览器半边），挂在 `web` profile 的
  patch 层上，`config:` 改动热重载、不用重启（**改 `src/` 里的代码则要重启** —— 热重载不重新 import
  已加载的模块）；部署出来的是 `profiles/node_modules/` 下的**真拷贝**，
  所以仓库被删/被挪都不影响已经装好的 dsh。它依赖宿主本来就有的 `sessionProjections` 与 `agent/pre-step`，
  这两样缺失时它自己降级成 no-op（见 [安全设计](#安全设计为什么它坏了也拖不垮-gui)）。
- **`install.ps1` 带 UTF-8 BOM，是有意的，不要去掉。** Windows PowerShell 5.1 在没有 BOM 时
  会按系统 ANSI 代码页读取脚本，中文会变成乱码并直接解析失败（本仓库已实测复现并修复）。
  这条同样适用于任何新写的、含中文的 `.ps1`。
  **而且编辑工具会悄悄把它去掉**：本次交付里一次普通的文本替换就删掉了 BOM
  （前三个字节从 `EF BB BF` 变成 `23 20 E5`），补回来之后 `Parser::ParseFile` 才重新 0 错误。
  **改完这个文件请单独确认前三个字节仍是 `EF BB BF`** —— `git diff` 在"两边都有 BOM"时看不出差别，
  但一次丢 BOM 的提交会让安装脚本在 5.1 上直接解析失败，而 diff 里只会看到几行注释改动。

## 给 AI 的安装指令

（人类可忽略；把仓库地址交给 AI 时让它照此执行。）

1. `git clone <repo-url> <tempdir>`
2. 复制 `<tempdir>/preset/preset.yml` 与 `<tempdir>/preset/agent.cordis.yml`
   → `${DSH_HOME:-~/.dsh}/.agent-presets/adg/`
3. 复制 `<tempdir>/skills/adg-add-agent/SKILL.md`
   → `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md`
4. **部署 token 预算插件**：把 `<tempdir>/plugin/dsh-adg-token-budget/` 里的
   `package.json`、`src/`、`README.md`、`examples/`、`LICENSE` 复制到
   `${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`。
   **`test/` 与 `INSTALL.md` 不要拷**；**先删目标目录再拷**（重复执行要干净覆盖）；**真拷贝，不要建 junction/symlink**
   （部署出来的插件必须独立于仓库，否则仓库一删/一挪 dsh 就启动失败）。
   目标目录是**所有 profile 共享的模块解析根**，理由见
   [为什么装在 `profiles/node_modules`](#为什么装在-profilesnode_modules而不是链到仓库)。
5. **补挂载行**：目标 `<dshHome>/profiles/web/cordis.patch.yml`（`<dshHome>` = `${DSH_HOME:-~/.dsh}`）。
   - 先备份成 `cordis.patch.yml.bak-adg-token-budget`，并**在输出里说明**；
   - 文件里**已经出现 `dsh-adg-token-budget`** → 什么都别改，只报告「挂载行已存在」（第 4 步的复制照做）；
   - 末行**不是恰好 `[]`** → **不要猜**：放弃这次编辑，明确告诉用户「请手工把
     `plugin/dsh-adg-token-budget/examples/cordis.patch.yml` 里的行贴进去」，第 4 步的复制照旧完成；
   - 否则：保留原有注释头，把 `[]` 这一行换成一条 `insert:` 行（形状照 `examples/cordis.patch.yml`，
     那份例子里的 `enabled: false` 已经是**取消注释**的，所以照抄就是"挂上但不动作"），
     `logFile` 写成 `<dshHome>` 的**真实绝对路径**拼 `/adg-token-budget.log`（写成单引号 YAML 字符串）。
     写文件用**不带 BOM 的 UTF-8**。
   - 最后告诉用户：**这一行热重载，改 `config:` 不用重启**（但**改了包里的代码就要重启**：
     热重载只重放 config，不会重新 `import` 已经加载过的模块 —— 见
     [装完必须重启 dsh](#装完必须重启-dsh)）；`enabled: false` 时插件不写决策日志，
     但**会写一行 `activation: inactive (enabled: false) …`**，所以"装上了"这件事在 `logFile` 里看得见。
     **建议的上线顺序是四步**：`enabled: false` → `enabled: true` + `dryRun: true` 校准 →
     `dryRun: false` + `hardDryRun: true`（只武装软提醒，**推荐稳态**）→ 最后才考虑 `hardDryRun: false`。
     **不要在"代码还是旧版"的状态下把 `dryRun` 关掉**：旧代码不认识 `hardDryRun`，会把硬档真武装。
6. 目标目录通常在工作区之外，写入会被沙箱拒绝一次；按提示用 `sandbox_permissions`
   升级重试同一条命令（用户会在界面上批准）。
7. 校验：挂一个注入 `agentPresets` 的临时插件（见技能 `editing-cordis-compositions`），
   - `await resolve('adg')` 的 `broken` 必须为空；
   - `await standingKeyFor('adg')` 走一次真实挂载（能报出包解析不到、配置非法、行未激活、
     服务发布到全局 realm 四类错误）；
   - `await compositionInventory()` 里 `adg` 必须出现 **8 行启用的专家行**：`agent-file`、`agent-computer`、
     `agent-app`、`agent-browser`、`agent-search`、`agent-researcher`、`agent-coder`、
     `agent-reviewer`，且**没有** `tool-subagent-fork` 行。注意判据要写准：`compositionInventory()`
     报的是**模块名**，所以 `@deepseek-ai/dsh-tool-subagent` 会出现 **10 次**（上面 8 行 +
     `tool-subagent-codex` / `tool-subagent-claude-code` 这两行 `enabled: false` 的），
     按"模块名出现 8 次"去断言会误报失败 —— 本机实测就是这个 10/8/0 的形状。
   - 也可以直接 `node tools/check-preset.mjs` 做静态自检（零依赖，exit 0 表示通过）；
     校验已安装的那一份时传路径：`node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"`。
     注意它只是**文本扫描器**：exit 0 不等于"文件能解析、插件已挂载"，
     所以上面两条真实挂载的检查不能省（`resolve` / `standingKeyFor` 才是运行期证据）。
   - 插件那半边它**完全没覆盖**：插件能不能 import、行有没有激活，只能按
     [怎么确认它已经武装](#怎么确认它已经武装) 看宿主日志与 `logFile`。
8. 明确告诉用户：**preset 改动要重启 dsh 验收**，之后在新建对话里选择「Adg 多智能体模式」。
   （插件那一行不用等重启 —— **但只有 `config:` 是这样**。这次交付的插件**代码是新的**
   （多了步数检查点与 `hardDryRun`），所以：部署代码 → 重启 dsh → 确认 `logFile` 里新的激活行
   出现了 `stepNudge=` / `stepTiers=` / `hardDryRun=` 三个字段 → 这时才把 `dryRun` 改成 `false`。
   别把"装了"说成"三档都验过了"：截至这次交付，**真软档与步数检查点都还没有在真机上注入过一条**。）
9. 如果用户还需要在**创造模式**里说「给 Adg 加一个智能体」被识别，确认第 3 步的技能已就位——
   `<dshHome>/skills` 是 `dsh-skill-filesystem` 的用户技能根（rank 400），两种模式都会扫描且热加载。
