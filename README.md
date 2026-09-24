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

## 安装

装到两个位置（`${DSH_HOME:-~/.dsh}` 是你的 dsh 用户根）：

| 仓库里的路径 | 安装到 |
|---|---|
| `preset/`（两个文件） | `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` |
| `skills/adg-add-agent/SKILL.md` | `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md` |

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

## 目录结构

```
preset/
  preset.yml            # 在模式选择器里显示的名称与简介
  agent.cordis.yml      # 调度智能体 persona + 八个专家智能体行
skills/
  adg-add-agent/
    SKILL.md            # 「给 Adg 加一个智能体」的操作手册
tools/
  check-preset.mjs      # 静态自检：专家行字段、toolName 唯一、allow 合法性、
                        # 通用委派行、调度名册与专家行双向一致
install.ps1             # Windows 安装脚本
install.sh              # macOS / Linux 安装脚本
```

## 兼容性

- 从 DSH 出厂 preset `standard`（标准模式）复制而来，只有两处实质改动：
  `persona` 增加调度名册与分派规则；`delegation` 组由通用委派行换成专家行。
- 依赖标准模式本来就有的出厂包（`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-persona`、
  `@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-subagent-control` 等）。
- 新增/删除/修改智能体后需要重启 dsh 才生效，这是 preset 挂载机制决定的，不是缺陷。
- **`install.ps1` 带 UTF-8 BOM，是有意的，不要去掉。** Windows PowerShell 5.1 在没有 BOM 时
  会按系统 ANSI 代码页读取脚本，中文会变成乱码并直接解析失败（本仓库已实测复现并修复）。

## 给 AI 的安装指令

（人类可忽略；把仓库地址交给 AI 时让它照此执行。）

1. `git clone <repo-url> <tempdir>`
2. 复制 `<tempdir>/preset/preset.yml` 与 `<tempdir>/preset/agent.cordis.yml`
   → `${DSH_HOME:-~/.dsh}/.agent-presets/adg/`
3. 复制 `<tempdir>/skills/adg-add-agent/SKILL.md`
   → `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md`
4. 目标目录通常在工作区之外，写入会被沙箱拒绝一次；按提示用 `sandbox_permissions`
   升级重试同一条命令（用户会在界面上批准）。
5. 校验：挂一个注入 `agentPresets` 的临时插件（见技能 `editing-cordis-compositions`），
   - `await resolve('adg')` 的 `broken` 必须为空；
   - `await standingKeyFor('adg')` 走一次真实挂载（能报出包解析不到、配置非法、行未激活、
     服务发布到全局 realm 四类错误）；
   - `await compositionInventory()` 里 `adg` 必须出现 8 行专家：`agent-file`、`agent-computer`、
     `agent-app`、`agent-browser`、`agent-search`、`agent-researcher`、`agent-coder`、
     `agent-reviewer`，且**没有** `tool-subagent`、`tool-subagent-fork` 行。
   - 也可以直接 `node tools/check-preset.mjs` 做静态自检（零依赖，exit 0 表示通过）；
     校验已安装的那一份时传路径：`node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"`。
6. 明确告诉用户：**必须重启 dsh**，之后在新建对话里选择「Adg 多智能体模式」。
7. 如果用户还需要在**创造模式**里说「给 Adg 加一个智能体」被识别，确认第 3 步的技能已就位——
   `<dshHome>/skills` 是 `dsh-skill-filesystem` 的用户技能根（rank 400），两种模式都会扫描且热加载。
