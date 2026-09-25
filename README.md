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
拉开）。子代理**进入**命中阶梯的第 N 步时，插件先放行这一步（`next()`），再追加**恰好一条**它自己
署名的用户消息（`【收敛检查点 n／N】…`），每个 tier 在每个驻留期最多一次；消息本身是一条
**可选提醒**，让子代理自己选"收敛汇报"还是"继续做完必需的工作"，**不是停止指令**。
**本次改动把另一半整体移除了**：插件原先还有一条**累计 token 预算**（软档收尾提醒 + 硬档
`agent.cancel`，默认 300 万/子代理），现在**一行都没有了** —— 设计理由与旧数据见
[第二层](#第二层子代理的步数收敛检查点插件-dsh-adg-token-budget)。
**上线顺序是三步**：先挂 `enabled: false`（装上了、但不动作）→ `enabled: true` + `dryRun: true`
（按自己的流量校准，只记录、不注入）→ `enabled: true` + `dryRun: false`（提醒真的注入）。
见
[第二层：子代理的步数收敛检查点](#第二层子代理的步数收敛检查点插件-dsh-adg-token-budget)。

**省 token 的口径（重要）：**preset 侧**不压低任何体积旋钮** —— 上下文压缩阈值、单条工具结果的
截断长度、`web_fetch` / 检索的上限一律用插件**出厂默认值**，persona 里也不写读取/汇报预算。
成本控制集中在上面这个插件的**步数收敛检查点**上：它不牺牲单条结果的完整度，也**不截断任何产出**。
理由与实测见 [token 成本纪律](#token-成本纪律这些上限是怎么来的)。

## 安装

装到三个位置（`${DSH_HOME:-~/.dsh}` 是你的 dsh 用户根）：

| 仓库里的路径 | 安装到 |
|---|---|
| `preset/`（两个文件） | `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` |
| `skills/adg-add-agent/SKILL.md` | `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md` |
| `plugin/dsh-adg-token-budget/` 的 `package.json` / `src/` / `README.md` / `examples/` / `LICENSE` | `${DSH_HOME:-~/.dsh}/profiles/node_modules/dsh-adg-token-budget/`（**真拷贝**，`test/` 与 `INSTALL.md` 不进部署） |

安装脚本还会往 `${DSH_HOME:-~/.dsh}/profiles/web/cordis.patch.yml` 补一行挂载（默认
`enabled: false`，先备份成 `cordis.patch.yml.bak-adg-token-budget`）—— 插件那一层是什么、
怎么开、怎么确认已武装见 [第二层：子代理的步数收敛检查点](#第二层子代理的步数收敛检查点插件-dsh-adg-token-budget)。

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

**插件那一行不受这条约束，但要分清改的是哪一种：**
它挂在 `profiles/web/cordis.patch.yml` 这个**热重载**层上，改 `config:` 立即生效、不用重启；
**改 `src/` 下的代码则必须重启** —— 已实测：热重载会重新 `apply` 这一行，但不会重新 `import`
已经加载过的模块（Node 的 ESM registry 按文件 URL 缓存，而 URL 没变），激活行仍然是旧形状。
所以**先部署代码 + 重启 + 确认激活行出现新字段，再改 `config:`** ——
在旧代码还活着的时候写 `dryRun: false`，会把旧代码里那条**已移除的硬档真武装**（旧代码不认
新字段，缺省的 `budgetTokens` 就是 300 万）。
`enabled: false` 时它不注册任何监听器、不写决策日志，但**会写一行加载期的激活行**
（`activation: inactive (enabled: false) …`），所以"装上了"这件事看得见 ——
见 [怎么确认它已经武装](#怎么确认它已经武装)。

**本次改动之前的那次交付就是按这个顺序做的，两个时间点都有日志为证**：01:37:18 重启后宿主重新
加载了包，激活行出现 `stepNudge=true stepTiers=[12, 24, 40] stepText=builtin dryRun=false`
（新代码在跑；阶梯当时是 `[12, 24, 40]`，后来换成现在的 14 档）；01:38:47 只改了
`dryRun: false`，**没有重启**，新的激活行就生效了（config 热重载）。反过来那次"同时改代码和 config"
在 17:10:28 把**旧代码里那条已移除的硬档**短暂真武装了两分钟，日志显示窗口内 `hard stage: cancel`
计数没有增加 —— 这也是"代码必须先到、config 后到"这条顺序的由来。

## 专家名册与 Marvis 对应关系

名册分两组：前五个参考腾讯 Marvis 的专项 Agent 划分（PM + File / Computer / App / Browser /
Search Agent），后三个是 Adg 原有的代码向专家。缺口一栏写的是本环境的**真实**实现口径，
不是宣传语：

| Marvis 的 Agent | Adg 专家（toolName） | 覆盖的能力 | 本环境的实现口径 / 缺口 |
|---|---|---|---|
| File Agent | `agent_file` | 文件与文档的检索定位、深入阅读与问答、复制/移动/重命名/批量归类、格式转换与文档生成 | 图片内容理解走 `read_image`（把图片交给模型看，需要模型路由支持图像输入，调用报错就如实说明）；文本类文档（PDF/Word/Excel/PPT）用 `pwsh` 调本机已有工具提文本。OCR（图片里的文字）、人像/场景检索、跨设备传输**取决于本机工具链**（Python 库、Office、同步盘目录等）：persona 要求先用 `pwsh` 探测可用工具，缺什么就直说「本机缺少 X，无法完成」并给替代方案，不允许假装完成 |
| Computer Agent | `agent_computer` | 系统与硬件信息查询、系统设置修改、优化清理、故障排查、窗口与桌面管理、进程/服务/计划任务控制 | 不依赖模拟点击的 **Windows API 路线可用**（PowerShell / CIM / P-Invoke）。会改变系统状态的操作要先说明影响与回退；不可逆或高风险操作必须先停下、写明「需要用户确认后才能执行」 |
| App Agent | `agent_app` | 桌面软件启停/安装卸载与内部功能调用、Android 模拟器上的 App、微信小程序 | Marvis 的 GUI 视觉识别 + 模拟点击在 DSH **没有对应工具**：只能走 CLI / adb / winget / 软件自带接口。凡是「看界面点按钮」类需求**必须明说不具备**，并给出替代（应用 CLI、adb 命令、官方 API、或请用户手动完成） |
| Browser Agent | `agent_browser` | 登录态下的站点操作、多步表单、点击与下拉选择、多页跳转抓取 | **本会话必须是「完全权限」（`danger-full-access`）—— 硬约束，理由与源码依据见下一节「浏览器专家需要完全权限」**：在 `workspace-write` / `read-only` 下本机 Chrome / Edge **根本起不来**（受限令牌禁止创建 Chromium 内部 IPC 必需的有名管道），所以调度者会先停下来问用户。能跑起来时：优先 Playwright / Puppeteer / Edge CDP（用 `pwsh` 调 node 脚本）；没有可用自动化运行时就**降级**成 `web_fetch` 单次抓取（只能取静态内容、**不能交互**），并在回答里说明是降级执行。遇到登录墙 / 验证码 / 二次验证必须立刻停止并请用户介入，不得绕过 |
| Search Agent | `agent_search` | 多轮联网检索与多源资料综述、关键信息引用溯源 | **只联网**：`allow` 里只有 `web_search` / `web_fetch`，本地文件与系统级请求被硬性排除（这不是偏好）。天气、汇率、股价这类简单事实查询由调度智能体**直接回答**，不派给它 |
| （Marvis 无对应） | `agent_researcher` | 在本仓库/本机文件里定位实现、配置与出处，只读、带行号 | Adg 原有：**硬只读** —— `allow` 里没有 `write` / `edit` / `pwsh`，真的改不动东西；公网发现式调研归 `agent_search`，它自己的 `web_search` / `web_fetch` 只用于已知 URL 的定点核对 |
| （Marvis 无对应） | `agent_coder` | 按已确定的方案改工作区代码，并运行编译/测试自证 | Adg 原有：只在当前工作区内改动文件；不做需求解读、方案设计与系统级运维 |
| （Marvis 无对应） | `agent_reviewer` | 对已有改动做对抗性审查，尽量用只读命令或测试验证 | Adg 原有：只报告不修改；每条结论给路径与行号或命令依据 |

## 浏览器专家需要完全权限

本节写三件事：**硬约束**（为什么必须切权限）、**根因**（实测到哪一层）、**处置**（preset 侧唯一能做的两道闸门）。

**结论先说：**`agent_browser` 要做真正的浏览器自动化，**必须**让本会话处于 `danger-full-access`
（界面 Permissions 选择器里 id 为 `danger-full-access` 的那一项，或 `/permission danger-full-access`）。
在 `workspace-write` / `read-only` 下，本机的 Chrome 与 Edge **根本起不来** —— 这不是配置问题，
也不是 persona 能绕过去的偏好，是 Windows 沙箱后端的机制。这条约束**无法从 preset 侧修掉**
（下一节逐条给源码依据），所以本 preset 的处置是把它做成**调度侧的前置闸门**：派发 `agent_browser` 之前，
调度智能体先读自己上下文里那行 `Current DSH file policy:`，不是 `danger-full-access` 就先
`ask_user_question` 问一次，再按回答决定。

### 根因：受限令牌禁止创建浏览器内部 IPC 必需的有名管道

沙箱在 Windows 上用 `WRITE_RESTRICTED` 受限令牌运行子进程（`@deepseek-ai/dsh-sandbox-windows-acl`）。
这个后端自己的 README 把该边界写在「已知限制」里：**受限孙进程的管道 stdio 捕获不可用** ——
libuv 的管道 stdio 用有名管道，其 client 端打开所请求的写访问没有任何 restricting SID 被授予，
所以受限进程内 `spawn(..., { stdio: 'pipe' })` 以 **EPERM** 失败。Chromium 的 Mojo IPC 同样走有名管道，
于是浏览器在**进程初始化阶段**就死掉。2026-09-26 在本机做了一次 A/B：同一台机器、同一个 `node`、
同一批浏览器二进制，**只改会话文件策略**（复现脚本与原始输出见 `docs/evidence.md` §11）：

| 探测 | `workspace-write` | `danger-full-access` |
|---|---|---|
| `spawn('cmd.exe', …, { stdio: 'pipe' })` | **`spawn THREW EPERM`** —— 后端的文档边界，实测复现 | 退出码 0 |
| 同一条命令改用 `stdio: 'ignore'` / `'inherit'` | 退出码 0 —— 换 stdio 能让**别的**程序跑起来 | 退出码 0 |
| `chrome.exe --version` | 退出码 0 —— 二进制本身没问题 | 退出码 0 |
| `chrome.exe --headless=new --no-sandbox --remote-debugging-port=…` | **退出码 21**，CDP 端口从未起来 | **退出码 0，CDP 起来（`Chrome/152.0.7977.76`），导航 + 取回页面文本成功** |
| `msedge.exe` 同一组参数 | **`FATAL:mojo\public\cpp\platform\platform_channel.cc:183] Check failed: . : 拒绝访问。(0x5)`** | 退出码 0 |

也就是说：**换 stdio 救不了浏览器**（它要的是进程内部 IPC，不是它自己的 stdout），
`--no-sandbox` / `--single-process` / `--no-zygote`、profile 放工作区或临时目录**都试过，全部无效**；
**同一批命令在 `danger-full-access` 下全部转绿**。本机没装 Firefox（只装了 Chrome 与 Edge），
**其它浏览器未测试**；全访问那一列只有 Chrome 做了完整的「启动 → 连 CDP → 导航 → 取回文本」，
Edge 只做到 `--dump-dom` 退出码 0。

### 为什么不能从 preset 侧修（三个问题的答案）

| 问题 | 结论 | 源码依据（**源码级事实**） |
|---|---|---|
| 父智能体能否给子智能体指定权限范围？ | **不能** | `dsh-tool-subagent` 的实例配置只有 `provider` / `toolName` / `modelSelectionSettings` / `enableRunInBackground` / `backgroundMode` / `agentOptions` / `persona` / `toolFilter` / `maxDepth`；它的 `lib/index.js` 里 **`sandbox` 零命中**，模型可见 schema 也只多 `provider` / `model` / `reasoning_effort` / `run_in_background` |
| 能否用 preset 文件改默认权限范围？ | **不能** | `sandbox-policy`（部署默认 `mode`）、`permission`（预设表）、`approval` 三行都在 **host-plane** 的 `@deepseek-ai/dsh-base/cordis.patch.yml` 里；模式解析是 `request.mode ?? 会话的 sandbox/mode 事件 ?? 部署默认`（`dsh-sandbox-policy/lib/index.js` 的 `resolve()` / `overrideOf()`），**没有 preset 侧入口**能改一个会话的模式。`dsh-permission-presets` 自己的「已知限制」第一条就写着：预设只组合沙箱模式与审批策略这两个机制级旋钮，agent / profile 选择尚未纳入 |
| 子代理能否自己升权（`sandbox_permissions` + 用户批准）？ | **不能** | 委派时子会话的审批策略被**钉成 `never`**（`dsh-subagent/lib/index.js` 的 `captureDelegatedPolicyOverrides()`，注释原话 "the approval policy is pinned to `'never'` regardless of the parent's own policy"）；`dsh-user-approval` 对 `never` 直接 `return "rejected"`、**不弹窗**。所以专家侧的升权重试是失败关闭，不是弹出审批 |

**唯一能把子代理送进完全权限的路径是：用户在会话里把权限切到 `danger-full-access`。**
子会话只继承父会话的**显式**覆盖值 —— `captureDelegatedPolicyOverrides()` 取的是
`parent.ctx.get('sandboxPolicy')?.overrideOf(parent.session)`，也就是那条 `sandbox/mode` 事件，
而切换权限正是写入这条事件的动作（**部署默认值不会被继承**）。

### 现在的处置：调度侧两道闸门（提示级，不是权限强制）

1. **派发前**（调度 persona 规则 9）：不是 `danger-full-access` 就先 `ask_user_question`，
   选项是「已切到完全权限，继续派发」／「改用降级方案：只做 `web_fetch` 静态抓取（不能交互）」／
   「暂不做这项网页操作」。用户答已切换后，**先确认上下文那行真的变了**再派发；没变就如实说没切成功。
2. **失败时**（`agent_browser` persona）：命中上面那张表的任一签名就**立刻停手**，如实报
   「本会话不是完全权限，浏览器自动化不可用」+ 报错原文，不许反复换参数重试、不许假装完成。

**这是流程闸门，不是安全边界**：它靠 persona 被遵守，机制上拦不住一个不听话的模型 ——
与「`allow` 是真实边界、persona 只是补充说明」那套口径一致（见「设计要点」）。

**刻意没做的事（备选方案与取舍）：** 可以用一个 preset 侧的 `tools/pre-execute` 监听器把这条闸门做成
**确定性拒绝** —— 那个瀑布是真实存在的（`dsh-tools` 的 `waterfall(carrier, 'tools/pre-execute', exec, …)`，
非 `allow` 的判定会带着 `reason` 变成一次 `Error:` 工具结果），而 `ctx.get('sandboxPolicy').resolve({ session })`
能算出**含部署默认**的有效模式。没有这么做，是因为它会把一条「流程提醒」升级成硬拦（连用户想降级执行也会被一并挡掉），
而要做对就得再起一个包、一条部署路径与一套测试；收益（拦住不听话的模型）与体积不成比例。
真要做时，它应当拒绝 `agent_browser` 调用、并回一条指向 `ask_user_question` 的说明，
**而不是**自己去改沙箱模式 —— 绕过用户批准改沙箱模式，正是这套系统刻意不提供的口子。

### 证据档位与未观测

- **真机实测**（2026-09-26，同一台机器上的 A/B，只改会话文件策略）：上面那张两列探测表；
  原始输出与复现脚本见 `docs/evidence.md` §11。「全访问下浏览器确实可用」是**实测**（Chrome 走完了
  启动 → 连 CDP → 导航 → 取回页面文本），不再是用户报告。
- **源码级事实**：三个问题的结论，以及两处「子代理被钉死」的位置（路径见上表）。
- **未观测**：「调度者是否真的每次都先问」**没有实测** —— 闸门刚落地，还没有一次真实 Adg 会话走过它；
  「用户在沙箱外自己拉起带 `--remote-debugging-port` 的浏览器、专家只连那个 CDP 端口」这条路
  **设计上可能可行**（受限策略下网络不受限，受限进程自建监听与本地 `fetch` 都通）但
  **本仓库未实测**，不许写成可行 —— 而且既然全访问下浏览器本来就能用，这条路只在「用户不愿切权限」时才有意义。

## 怎么用

1. 新对话选择 **Adg 多智能体模式**，直接说需求。
2. 调度智能体自己负责意图理解、任务拆解、调度与汇总，先判断范围再按 8 个专家的范围派发：

| 需求范围 | 派给 |
|---|---|
| 文件与文档（检索、整理、转换、生成） | `agent_file` |
| 系统 / 硬件 / 设置 / 清理 / 故障排查 | `agent_computer` |
| 软件与 App 操作（CLI、adb、winget、小程序） | `agent_app` |
| 网页登录 / 填表 / 点击 / 多页抓取 | `agent_browser`（**需本会话为完全权限**；不是的话调度者会先停下来问你 —— 见「浏览器专家需要完全权限」） |
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

自检还会核对承载三组体积旋钮的那三行（`compaction-basic` / `tool-result-pruner` /
`tool-web`）是否完好 —— 行在、包名对、没被 `disabled` 关掉、`config:` 里没有插件不认识的键 ——
并且会**报告生效值**：本 preset 刻意不覆盖任何旋钮，所以打印出来的是插件出厂默认值：

```
体积旋钮（生效值）：compaction 0.8（默认）/0.16（默认） | pruner 8192（默认）/4096（默认）/1024（默认） | tool-web 200000（默认）/8（默认）/4（默认）
裁剪后实际吐出（按生效配置算）：head 4096 + 标记 39 + tail 1024 = 5159，threshold 8192
```

它**不再钉死这些取值**：万一有人把某个键写回去，自检只检查该值在不在插件会接受的范围内
（写错会在挂载时抛错），并在摘要里把它标成「已覆盖」。依据与取舍见
[token 成本纪律](#token-成本纪律这些上限是怎么来的)。

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
（**当前口径**：preset 侧不设任何体积上限 —— 下面的数字是"为什么会有第二层插件"的依据，
也是撤销那些闸门时的对比基线。）

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

**策略只剩一条：压步数。** 体积那一侧本 preset **不再手动压低** —— 早先版本压过三组旋钮，
并在 persona 里写了「读取预算 / 只读几个文件 / 结论 2000 字符内」，后来整体撤销（理由见
[为什么撤销 preset 侧的体积闸门](#为什么撤销-preset-侧的体积闸门)）。
现在压步数的是第二层插件的**步数收敛检查点**（见
[第二层](#第二层子代理的步数收敛检查点插件-dsh-adg-token-budget)）。
这条分工有真机依据：实测里有一个子代理烧掉 **48,992,135** token（**历史证据，来自已移除的 token
两档**，不代表当前行为），越过当年那条 300 万预算线后又走了约 **300 步** —— 那种跑飞只有拦在
步数上才有效，而砍单条结果的体积只会同时砍掉结论质量。

**刻意没有做的事：**不给任何请求设 `maxTokens`，也不设 `reasoningEffort`。理由是输出只占账单的
**1%**，压它对账单几乎无影响，却会直接损伤回答质量（被截断、推理不足导致返工，反而增加步数）。
在这份 composition 里这两类键一律不出现 —— 改预设的人不要"顺手补上"。

刻意没做的第二件事：**没有**在本 preset 里再加一行 `spill-policy`。`spill-policy` 是**宿主plane**
的行（`dsh-base\cordis.patch.yml`，`maxInlineBytes: 50000`），而 web 组合并没有把它 disabled
（web-app 的 patch 里 `spill` 零命中），所以它**本来就对 Adg 会话生效**。它注册的是一个
`{ prepend: true }` 的 `tools/post-execute` 监听器，再加一行就是同一条瀑布上叠第二个监听器 ——
重复施加没有验证过，id 按树唯一、也不会报错，只会**静默叠加**。宿主那一行已经在做同样的
溢出处理，而 preset 侧那三个压低上限的键又已经撤销、回到出厂默认值，所以这里再加一行没有净收益。
（另注：`spill-policy` 的 model-facing 那一路**显式跳过 `read`**，所以它本来也管不到 `read`
那 1.68M 字符。）

### 三组体积旋钮：已回归出厂默认

本 preset **不覆盖**任何体积旋钮，那三行只声明插件本身（`compaction-basic` /
`tool-result-pruner` / `tool-web`）。生效值就是出厂默认：

| 键 | 生效值（出厂默认） | 曾经的覆盖值 | 现在为什么不再覆盖 |
|---|---|---|---|
| `compaction-basic.thresholdRatio` | **0.8** | 0.6 | 0.6 会让窗口用到 60% 就压缩；摘要一旦生成，细节只剩摘要里那一份，对要精确路径/行号的委派尤其不利 |
| `compaction-basic.retainRatio` | **0.16** | 0.12 | 逐字保留的最近上下文从 16% 缩到 12%，省下的额度买不到等价的摘要质量 |
| `tool-result-pruner.thresholdChars` / `headChars` / `tailChars` | **8192 / 4096 / 1024** | 4096 / 2048 / 768 | 单条工具结果超 4096 字符就被掏空中间段。信息少了，模型不是收敛，而是重取、换查询或拿残缺证据下结论 |
| `tool-web.fetchMaxOutputChars` | **200000** | 24000 | 一次 `web_fetch` 只留 24k 会把调研型委派唯一需要的东西切掉；`web_fetch` 是子代理里最大的单一上下文来源（3.5M 字符 / 369 次），但"大"不等于"该砍" |
| `tool-web.searchMaxResults` / `searchMaxQueries` | **8 / 4** | 5 / 3 | 收窄检索面只会让同一件事被检索更多轮，而步数才是账单里的乘数 |

### 为什么撤销 preset 侧的体积闸门

那一轮压低是**实测之后**加上去的（基线见本节开头），撤销同样有实测理由：

- **截断工具输出会把事实切掉。** 被裁掉的是工具已经取到的原文；模型看到残缺结果只有三条路：
  重取（更贵）、换个查询再试（还是更贵）、或者拿残缺证据下结论（更差）。
- **提前压缩会让上下文失真。** 压缩不可逆：过了压缩点，一切只能基于摘要。
- **写在 persona 里的预算提示会压低输出质量。** 「委派 prompt 必须自带读取预算」「结论控制在
  2000 字符内」「一次派发不往返」这类纪律把专家的注意力从"把事情做对"挪到"别写太多 / 别多读"，
  漏项与返工本身就是新的成本。
- **真正压住成本的是 `dsh-adg-token-budget`。** 它按**步数**干预（子代理进入命中阶梯的某一步时
  注入一条可选提醒，让子代理自己判断要不要收敛），不牺牲单条结果的完整度，也**不截断产出**。
  两层的分工因此变成：**插件管步数，preset 不再管单条结果的体积。**

约束（**只在有人把某个键写回去时**才相关；写错不是静默生效，而是挂载时抛错）：

- 两个 ratio 必须在 `(0, 1]`，且 `retainRatio < thresholdRatio`；
- pruner 要满足 `headChars + 标记 + tailChars ≤ thresholdChars` —— 标记就是
  `@deepseek-ai/dsh-compaction-tool-result-pruner` 里的 `PRUNE_MARKER`
  （`"\n\n[... tool result middle pruned ...]\n\n"`），长度正是 **39 字符**
  （自检里的常量 `PRUNER_MARKER_CHARS = 39`）；只看 `head + tail` 会漏掉这 39 个字符；
- `fetchMaxOutputChars` / `searchMaxResults` / `searchMaxQueries` 都必须是**正整数**
  （`tool-web` 用同一个 `assertPositiveInteger` 校验 `searchMaxResults`、`searchMaxQueries`、
  `fetchTimeoutMs`、`searchTimeoutMs`、`fetchMaxOutputChars` 五个键），
  且 `fetchMaxOutputChars` 不得超过插件默认上限 200000。

**自检的口径也随之改了：**它**不再钉死**这些键的取值（原先顶部的 `EXPECTED_BUDGET` 已删除）。
现在只做两件事：确认三行结构完好（行在、包名对、没被 `disabled` 关掉、同一个 id 不重复），
以及"万一某个键被写回"时该值落在插件会接受的范围内；摘要行会明确标出哪些键「已覆盖」。

### 自检到底静态挡住了什么（别把它的覆盖范围想大）

`tools/check-preset.mjs` 静态挡住的是这几类（运行它的方式见「怎么加一个智能体」与
「给 AI 的安装指令」第 7 步）：

- 三个旋钮行的**结构**：行必须在、`name:` 必须是那个包名、不能 `disabled: true`、同一个 id 不能出现两次；
- 万一某个旋钮键被**写回**：它必须**直挂**在该行的 `config:` 下（不能嵌更深、也不能提到与
  `name:` 同级 —— 那两种写法运行期都会静默用默认值，而写的人以为它生效了），并且取值必须落在
  插件会接受的范围内 —— 两个 ratio 的**区间** `(0,1]` 与**先后次序** `retainRatio < thresholdRatio`；
  pruner 的**带标记算术** `headChars + 39 + tailChars ≤ thresholdChars` 且三个数都是正整数；
  `fetchMaxOutputChars` / `searchMaxResults` / `searchMaxQueries` 都是正整数、且
  `fetchMaxOutputChars ≤ 200000`（`> 60000` 另给一条 WARN）；
- `config:` 里不能有插件不认识的键（插件自己的 `validateKeys` 遇到未知名会直接抛错）；
- **不检查"取值等于某个数"** —— 那正是被撤销的口径（顶部的 `EXPECTED_BUDGET` 已删除）。
  现在它只报告生效值，并把显式写回的键标成「已覆盖」。

**但要说清它的边界：这个自检是逐行文本扫描器，不是 YAML 解析器。** 它证明不了整份文件能被
YAML 解析（例如同一行里写两个键、锚点/别名、flow 风格 `{a: 1}`、制表符缩进等，它都看不出来），
也证明不了插件**真的挂载**：包能不能解析、行有没有被 `disabled`/条件表达式关掉、服务有没有发布
到全局 realm，这些只有重启后按「给 AI 的安装指令」里那套 `resolve('adg')` /
`standingKeyFor('adg')` / `compositionInventory()` 做一次**真实挂载**才能证明。
换句话说：自检通过 = "这些硬约束在文本上没被破坏"，**不等于** "运行期一定按这个口径生效"。

### persona 层保留的政策：只剩专家侧的收敛纪律

旋钮撤销之后，persona 里**不再有任何 token／读取预算类的文字**。早先版本在调度者 persona 里写了
一整段「委派预算」，八个专家每条 persona 末尾也各有一行「成本纪律」（先 `grep` 定位再按需 `read`、
`offset/limit` 分段读、同一文件不重复读、工具结果被截断时收窄查询、**结论控制在 2000 字符内**、
不要回贴原始工具输出或正文）；这些**已全部删除**，理由见
[为什么撤销 preset 侧的体积闸门](#为什么撤销-preset-侧的体积闸门)。

调度者 persona 里与 `dsh-adg-token-budget` 配套的那段**步数收敛政策也已删除**（原先两条：
① 委派 prompt 写明大致收敛规模——检索与阅读类 10–15 步、实现与审查类 15–25 步；② 不要自己
轮询专家步数）。删除的理由是这两条都不是"只有 persona 才能说"的话：

- **注入的那条消息是自足的**：`stepNudgeText()` 把它渲染成"【收敛检查点 n／N】调度代理提醒：
  这是你的第 N 步"+ 二选一，子代理不需要委派 prompt 先放一个步数区间才有对照物。
- **那两个数字是第二套真相，而且必然脱钩**：阶梯是 `[4, 8, …, 280]`、从第 4 步就开始提醒，
  persona 里却写"检索类 10–15 步"。改阶梯是热重载的 `config:` 改动，改 persona 要重启 dsh ——
  两边不会同时被想起。
- **"不要轮询"在更底层已经说过一次**：出厂的 `job_output` / `subagent` 工具说明就写着
  settle 时会收到通知、不要忙轮询。

仍然保留的是**八个专家 persona 末尾各一句「收敛纪律」**——"收到步数检查点提醒时按提醒里的二选一
自己判断：产出够用就收敛汇报，确实还有必需工作就继续做并说明理由 —— 不要为了回应提醒而砍掉
必需的工作"。插件只把提醒推进上下文，**不管子代理怎么反应**，所以这句仍归 persona；它写的是
**自己该怎么应对**，与注入方同一套措辞，子代理才不会有"这是谁在说话"的歧义。

（证据要求仍在各自那条「输出要求」里：结论要带 `path:line` 或 URL 证据、未核实的推断显式标注 ——
那不是预算，是可信度要求，所以没有跟着删。）

### 怎么重新测量

改动前后都要量，否则无法判断一次改动是帮忙还是添乱（插件侧的改动用同一套口径看）：

```powershell
node D:\dsh\.dsh-token-audit\audit-run.mjs "C:\Users\cenqian\.dsh\sessions"
```

它会把报告写到同目录的 `audit-report.txt`（覆盖上一次）。重点看 `=== sessions by preset ===` 里
`adg` 那一行的 `input` / `cache` / `output` / `requests`，以及每个子代理的 `toolChars`。

> 为什么有 `audit-run.mjs` 这个副本：原始的 `audit.js` 在 ESM 作用域里用了 `require`，直接跑会报错；
> `.mjs` 那份是改好的可执行版本。

**测完对比时注意：**上面的基线是**改动之前**的 32 个会话。改动生效后要重新跑一次，用同一口径
（同样按 preset 分组的 `input + output + cache`）对比，不要拿单次会话的绝对值下结论。

**preset 的改动不会立即生效 —— 必须重启 dsh**（见「装完必须重启 dsh」）。

## 第二层：子代理的步数收敛检查点（插件 `dsh-adg-token-budget`）

上一节那三组旋钮（现已回归出厂默认）压的是**单条结果的体积**，它们管不到**步数**。
这一层补的正是**步数**：一个 **host-plane 的 cordis 插件**挂在 `agent/pre-step` 瀑布上，
在子代理**进入**命中阶梯的某一步时，替调度者注入一条**可选**的收敛提醒。
preset 侧撤销体积闸门之后，**成本纪律就集中在这一层**。

**本轮改动把另一半整个移除了。** 插件原先还有一条**累计 token 预算**：软档
（`budgetTokens × softRatio`，默认 210 万）注入收尾指令、硬档（默认 300 万）调
`agent.cancel({ kind: 'parent' })` 并返回 `{ kind: 'reject' }`。这两档、以及配置它们的
`budgetTokens` / `softRatio` / `cacheReadWeight` / `softNudge` / `hardDryRun` 五个键**已全部移除**：
插件现在**从不调用 `agent.cancel`、从不 reject 一步、从不读 `ctx.get('sessionProjections')`**，
没有任何破坏性档位。

**为什么移除（设计理由）：**输出型任务（写文档、生成报告、消化长语料）本身就需要那么多 token，
按累计 token 阈值介入只会截断产出，省不下有意义的东西；累计量大本身不是"跑飞了"的证据。
**步数**才是真正会出问题的信号（子代理反复探索不收敛），而且它的提醒是"二选一、可以直接无视"，
不是停止指令。所以 preset 的成本纪律现在只剩"步数收敛检查点"这一层。

> **包名与行 id 是历史名称。** `dsh-adg-token-budget` / `adg-token-budget` 里已经**没有 token
> 预算**了：一行阈值都不再比较。名字保留下来，是为了让**部署路径**
> （`${DSH_HOME}/profiles/node_modules/dsh-adg-token-budget`）、**挂载行 id** 和**热重载身份**
> 都不变 —— 改名会让已经装好的机器需要重新部署、重新挂行。按名字找"预算"的读者请以上面这段为准。

> **先说状态，分三段说：**
>
> **① 步数检查点在真机上真的注入过。** 插件部署在
> `${DSH_HOME}/profiles/node_modules/dsh-adg-token-budget`、挂在
> `${DSH_HOME}/profiles/web/cordis.patch.yml` 上，被运行中的 dsh 加载。
> 2026-09-25 01:37 重启后确认新代码真的加载、01:38:47 武装；此后观测到**三次真实检查点注入**
> （插件日志行 + 子代理转写里的那条消息，毫秒级对齐）：两次用的是旧措辞
> （`fdd55c65` / `12bf2213`，第 12 步、当时只花了 10–12 万 token），一次用的是**新的选择式措辞**
> （`41c07ec8`，第 12 步、14.3 万 token）。子代理随后的第一条消息分别是：
> *"I'm at step 12. I should converge."*、*"I have enough evidence. Let me 收敛 and report."*、
> 以及 *"Remaining必需工作: … Let me do 2 more fetches … then converge. I'll say I'm continuing briefly."*
> —— 收到命令式措辞的两个都表示要收敛；收到选择式措辞的那个**选了"继续"并说明理由**，
> 没有偷偷缩减计划。这正是新措辞两个分支的设计行为（`n=1`/种，是例证不是效果测量）。
> `settled: released session state …` 也在 17:55:33 第一次观测到（那个子代理收敛后 29 秒释放状态）。
>
> **同日阶梯从 `[12, 24, 40]` 换成 `[4, 8, …, 280]`。** 依据是重跑审计后的真实分布（中位数 39、
> p10 只有 6：按均值放检查点等于不问），而不是"多数子代理不需要那么多步"这个直觉本身 ——
> 直觉解释了动机，分布决定了数字。代价与风险都写在
> [步数收敛检查点](#步数收敛检查点) 一节里：覆盖从 30/37 提到 34/37、注入从 71 条增到 214 条
> （约占总账单 0.25%），换来"首次检查点之后还剩 92.6% 的步数"这个可干预面。
> 这次是**代码改动**，做法是：先重启、确认激活行出现 `stepText=`，再改 `stepTiers` ——
> 18:25:14 的激活行就是这么来的，**没有第二次重启**。
> **仍然未观测**：第一个 tier 之外的任何一档、新阶梯下的任何一次注入、以及"提醒是否让子代理更快收敛"。
>
> **② 已移除的 token 两档：当年实测（历史证据，不代表当前行为）。** 快照时 `logFile` 里已经有
> 5 个真实 `adg` 子代理走过**旧代码的 token 判定**（**5 个全部** ≥ 300 万，最大 **48,992,135**），
> `would cancel` 437 行、`would nudge` 36 行，而 `soft stage: nudged` 与 `settled:` 都是 **0 行**。
> 这在当时是"默认 300 万落在正常分布内部、不能按它武装硬档"的直接证据，也是这次移除这两档的
> 理由之一；今天读它**不能**当成插件的当前行为。完整数字见
> [已移除的 token 两档](#已移除的-token-两档当年的实测证据)。
>
> **③ 步数与"请求数"是同一个单位**（阶梯校准的前提）：审计对 `f7ee3039-…` 数出 **329** 个模型请求，
> 插件对同一个 id 数出约 **297** 步（当年那个口径是"超预算的步数"，逻辑与今天的步数计数一致）——
> 两个基于不同事件的独立计数互相吻合。

### 步数收敛检查点

调度者**不该自己轮询**子代理：审计里调度者会话占 adg 账单的 **59%**，而它每轮一次
就要把本会话最大的那段上下文重发一遍 —— 轮询比提醒省下的还贵。而"谁提醒、提醒什么、
第几步提醒"**全部归这个插件**：调度者 persona 里原先那段配套政策（委派 prompt 写明大致
收敛规模、不要自己轮询步数）已删除，理由见
[persona 层保留的政策](#persona-层保留的政策只剩专家侧的收敛纪律)。提醒以调度者的名义、
按下面的阶梯注入：

| 观测 | 值 |
|---|---|
| 每个子代理的**模型请求数**（= 步数） | min 1 / p10 6 / **p25 14** / 中位数 **39** / 平均 51.7 / p75 61 / p90 103 / max **329**（37 个子代理） |
| 默认检查点阶梯 | **4 / 8 / 12 / 18 / 24 / 32 / 42 / 55 / 72 / 95 / 125 / 165 / 215 / 280 步**（各一次）：前 24 步里每 4–6 步一次，之后按约 ×1.3 拉开 |
| 覆盖面 | 37 个子代理里 **34 个**至少收到一次；中位数那个收到 6 次；329 步那个收到全部 14 次 |
| 提醒自己的成本 | 全部 214 条消息合计约 **0.5M token 等量**（每条约 180 字符，之后每一步跟着重发一次），对比同一批子代理花的约 205M ≈ **0.25%** |
| 每一步注入几条消息 | **最多 1 条**：插件一步只评一个触发；即使多个 tier 同时到期，也只发最靠前的那个，下一个到期的 tier 会在下一步补上 |

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

### 触发与动作（只剩一档）

| 档 | 触发 | 动作 |
|---|---|---|
| **步数检查点** | 子代理**进入**第 `stepTiers` 里的某一步（默认 **4 / 8 / 12 / … / 280**） | 这一步照常放行（先调 `next()`），然后追加一条 `【收敛检查点 n／N】` 消息：**可选**提醒，让子代理自己选"收敛汇报"还是"继续做完必需的工作"，并说明选择。每个 tier 在每个驻留期最多一次 |
| ~~token 软档 / 硬档~~ | — | **已移除**：不再有累计 token 阈值、不再注入收尾指令、不再 `agent.cancel` / `reject`。历史口径见 [已移除的 token 两档](#已移除的-token-两档当年的实测证据) |

触发是**闭区间**（正好等于某个 tier 就触发）。每条提醒**每个子代理会话的每个"驻留期"（residency
epoch）每个 tier 最多一次**：标记在 `subagent/end` 时释放，而子代理层**每个驻留期发一次**这个事件，
所以一个可续跑的子代理被恢复后会进入新的驻留期、**可以被再次提醒**。这是有意的
（恢复后的子代理有新的计划、也有新的跑飞机会），代价只是"同一段驻留期内不重复提醒"这条保证。
**同一步最多注入一条消息**：插件一步只评一个触发，即使多个 tier 同时到期也只发最靠前的那个，
下一个到期的 tier 在下一步补上 —— 这正是 `dueStepTier` 逐个返回的设计。

`dryRun: true` 时只算不做：**不注入消息**，到期的检查点只写一行日志
（`dry-run step stage: would nudge …`），**不消耗任何 tier 标记**，而且**步数照常计数** ——
所以校准完再把 `dryRun` 关掉，第一个检查点仍然会提醒，而"第几步会开始提醒"在校准期也看得见。
代价是**会为计数建会话状态**（`{ steps, firedTiers }`）；要"连计数都不要"就用 `stepNudge: false`。
这是"先按自己的流量校准、再武装"的那把开关（见
[推荐的上线顺序](#推荐的上线顺序三步)）。

插件**不再计算任何累计用量**：没有阈值、没有权重、也不读 provider 报的账单字段。
它数的是 `agent/pre-step` 被**真正进入**了几次 —— 这是它自己看见的事实，不依赖任何服务。
（历史口径：累计值是 `未缓存输入 + 输出 + cacheRead × cacheReadWeight + cacheWrite`，
读 `ctx.get('sessionProjections')` 的 `stateOf(session, 'tokenUsage')` —— 这套已随两档一起移除。）

只对**被委派的子代理**且 preset 命中的会话生效，条件按顺序判：

1. `enabled` 为真；
2. `delegationDepthOf(agent) > 0` —— 取 `session.header.delegationDepth` 与运行时 `subagentDepth` 的较大值，
   但**两侧都先过 `Number.isSafeInteger(value) && value >= 0`**：`'1'`（字符串）算**深度 0**、
   不是 1，因为 `'1' > 0` 在 JS 里为真，一个被 YAML/JSON 往返成字符串的数字若被强转，
   就会让一个写错的 header **被当成子代理**（旧代码里那会真的砍掉一个子代理）；`1.5` 不截断、
   `-1` 不夹到 0、`2 ** 53` 越界也不认（裸 `Number.isInteger` 会放它过去），
   `NaN`/`Infinity`/`true`/`null` 一律算"没有深度"。
   （**header 是权威且单调的**：被恢复的子代理带着全新的 options 回来，只看 `subagentDepth` 会让它当成顶层会话）。
   顶层会话（深度 0）**永远不动**，尤其不会动调度智能体；
3. `session.header.agentPreset` 命中 `presets`。**header 里没有 `agentPreset` 的子代理也不动** ——
   这里**故意 fail-open**：猜错会给它本来没被指向的会话注入提醒；
4. `stepNudge` 为真 —— 为假时整层关掉：不计数、不建状态、一步原样放行（见配置表）。

步数检查点不依赖任何投影或服务，所以拿不到 token 数据的会话里它**照常提醒** ——
这也正是它有独立开关 `stepNudge` 的原因。

### 已移除的 token 两档：当年的实测证据

> **这一整节是历史。** 下面的数字全部来自**已移除**的 token 软/硬两档，
> 它们证明的是"当年那条路为什么走不通"，**不代表当前插件的任何行为**。当前插件只做步数检查点。

对着 [token 成本纪律](#token-成本纪律这些上限是怎么来的) 那套审计口径看（同一份 `audit-report.txt` 快照，
32 个 Adg 会话 / 983 次请求）：

| 观测量 | 实测值 |
|---|---|
| 每个子代理会话平均 | ≈**1.73M**（`avg tokens per subagent adg session: total(input+output+cache)=1734486`） |
| 22 个子代理会话合计 | **38.2M**（`subInput` 2,729,782 + `subOut` 351,534 + `subCache` 35,077,376） |
| 快照里最贵的单个子代理会话 | **5.22M**（`in` 228,433 + `out` 42,094 + `cache` 4,947,456 = 5,217,983） |
| **当年实测到的最重一次「实现型委派」** | **7.65M**（`usage=7651807`，就是当年那次真机硬停；同一个子代理越过了 300 万，被 `agent.cancel` 停掉） |
| 快照里 **≥ 300 万** 的子代理会话 | **22 个里的 5 个** |
| 最贵的调度者会话（对照） | 38.4M（3,686,879 + 364,731 + 34,336,896） |

那 5 个越过当年默认预算的子代理会话，按总量降序是：
**5,217,983 · 4,455,097 · 4,070,916 · 3,904,800 · 3,236,397**；第 6 名是 2,204,189。
也就是说边界**不在**"差一点点"的地方 —— 300 万这条线正好落在这批分布的中段。

**所以当年的口径是：300 万不是"谁都不会被砍"，它落在分布内部，一定会砍掉正常工作量。**
平均每个子代理 1.73M、22 个里已经有 5 个（约四分之一）超过 300 万、当年最重的一次是预算的 2.5 倍。
它防的是**尾部**（一次跑飞能顶掉一整天的额度），但"正常委派"照样会被波及 ——
这正是这次把两档整体移除的直接动机。

两个让这份分布**偏悲观**的原因，读数字时要一起记住：

- **preset 侧的体积旋钮当时也已经撤销**（见 [三组体积旋钮](#三组体积旋钮已回归出厂默认)），
  所以上面这份语料量到的正是"不压低体积"的流量 —— 它对当下这个版本是**同口径**的，
  只是当时插件还没有武装，所以步数那一侧还没被干预。
- **语料是活的、还在长。** 这次改文档时重读了一遍同一份会话目录，已经是 32 个子代理会话、
  最大 **17,022,627**、平均 **3,942,185** —— 上面每个数字都是**下界**。

**真机 dry-run 快照（2026-09-25T01:1x+08:00，旧代码的 token 判定，比审计语料更狠）：**`logFile` 里
已经有 **5 个真实 `adg` 子代理**走过旧判定，**5 个全部越过了 300 万**，其中 2 个 ≥ 600 万，
最大一个 **48,992,135**（≈预算的 16 倍），`would cancel` 共 437 行、`would nudge` 共 36 行，
`soft stage: nudged` 与 `settled:` 都是 **0 行**。逐个子代理的峰值：

| 子代理 | `would cancel` 行数 | 第一次越过 300 万 | 峰值累计用量 |
|---|---|---|---|
| `adg/f7ee3039-…` | **297** | 3,121,660 | **48,992,135** |
| `adg/973aca1b-…` | 92 | 3,065,764 | 16,607,867 |
| `adg/7cfa95ae-…` | 27 | 3,018,602 | 6,745,603 |
| `adg/2ec8cfe5-…` | 18 | 3,014,252 | 6,230,057 |
| `adg/5bee9ec3-…` | 3 | 3,083,933 | 3,361,608 |

两个可以直接读出来的结论：**① 300 万落在真实流量的主体里**（5/5 都越过去了），
所以按它武装硬档一定会截断正常委派 —— 这条路因此被放弃；**② 步数才是那个真正的杠杆** ——
最大的那个子代理贡献了 297 行 `would cancel`，也就是它在 300 万之上又走了约 **300 步**
（而重跑的 37 个子代理里，中位数是 39 步、最大 329 步）。给它 14 次收敛检查点相对于 4899 万 token
是零成本（全部 214 条提醒合起来约占总账单 0.25%），这正是**现在这一层**要做的事。

**`dryRun: true` 的来历也在这段历史里。** 当年打开它（`enabled: true` + `dryRun: true`）之后，
插件把**旧代码的每一次判定**按原样写进 `logFile`，但**不注入、不 cancel**，于是这个文件就变成
"按我自己的流量，当年那个预算会砍掉多少、第几步会开始提醒"的实测 —— 看清楚了才有上面那两个结论。
今天 `dryRun` 仍然是同一把开关，只是它校准的对象只剩步数检查点。

（口径注：报告里那张 top 15 表按 `in+out` 排序、只列出 13 个子代理会话，
所以「最贵 5.22M」与「5 个越过 300 万」都是这次**重读全部 22 个子代理会话**算出来的，不是从那张表读出来的；
另外 `cacheWriteTokens` 在全部 1183 个 usage 对象里都不存在，当年累计口径里的 cache-write 恒为 0 ——
这是「provider 没上报」，不是「没有 cache 写入」，真实账单只会更高。这一节里的 `soft` / `hard` / `would`
行都只可能出现在**旧代码**的 `logFile` 里。）

### 全部配置键与默认值

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true`（**本仓库装进去的那一行初始是 `false`**；本机实跑的那一行现在是 `true`） | 总开关。`false` 时 `apply` 在注册任何监听器之前返回：**不注册监听器、不写决策日志**（但仍写一行加载期激活行，见下） |
| `presets` | `['adg']` | 管哪些 preset 的子代理。裸字符串 `presets: adg`（YAML 标量的读法）等于单元素列表 |
| `stepNudge` | `true` | **步数收敛检查点的总开关**。`false` = 整个功能关掉：**连步数都不计**，不建任何会话状态，一步原样放行（等于插件不参与）。要"只校准、不注入"请用 `dryRun`，不要用这个键 |
| `stepTiers` | `[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]` | 在第几步注入检查点。裸数字（`stepTiers: 12`）等于单元素列表；非法项丢弃、去重、升序、上限 16 个；清洗后为空则**回落到默认**。取值依据见 [步数收敛检查点](#步数收敛检查点)：**提前、加密**，因为真实分布的中位数（39）远低于均值，而 p10 只有 6 |
| `stepText` | `null` | 可选：自定义检查点正文，**整段替换**内置正文（含内置只在最后一档追加的那句）。空值/非字符串回落到内置正文（不会让提醒变成空话）；超过 4000 字符截断。存在的理由：**调措辞是热重载的 `config:` 改动，不需要新包、也不需要重启 dsh**。激活行写 `stepText=builtin` / `stepText=custom`，敲错键名不会静默 |
| `dryRun` | `false` | 校准开关。到期的检查点**只记一行日志、不注入消息**，也**不消耗 tier 标记**（所以之后武装仍然会送达那一次）；**步数照常计数**（否则校准不出"第几步会提醒"），因此会为计数建会话状态 |
| `logFile` | `null` | 绝对路径；设了就追加**加载期激活行 + 每个决策事件一行**。**没有检查点到期的普通一步什么都不写**（所以文件不会膨胀）。**相对路径会被关掉文件日志并告警** |

**已移除的五个键：**`budgetTokens` / `softRatio` / `cacheReadWeight` / `softNudge` / `hardDryRun`。
`normalizeConfig` 对**不认识的键一律忽略**，所以一条还带着这五个键的**旧组合行仍然能加载**，
只是它们不再有任何作用 —— 插件读都不读。本机那一行现在还留着这五个键，但取的是**刻意的惰性值**
（`budgetTokens: 1000000000000000`、`softRatio: 1`、`hardDryRun: true`）：只是为了在**重启前那段窗口**
里挡住还在内存中的旧代码（缺了 `hardDryRun` 它会把硬档真武装），重启加载新代码后可以整段删掉 ——
见[怎么确认它已经武装](#怎么确认它已经武装)里"切换窗口里还留着 5 个惰性旧键"那一段。
这也是"插件从不导出 `Config` schema"的另一个好处：旧键既不会让 profile 加载失败，也不会静默改变行为。

`logFile` 里会出现的行只有这几类：`activation: active|inactive …`（每次 `apply` 一行，**包括 `enabled: false`**）、
注册提示（`registration skipped: …` / `warning: N registration(s) are already active …`）、
步数检查点（`step stage: nudged tier=n/N step=S label=…` /
`step stage (no nudge injected: decision kind=…) …` / `step stage (no nudge injected: nudge construction failed) …`）、
dry-run（`dry-run step stage: would nudge …` / `dry-run step stage: would not nudge (decision kind=…) …`）、
以及 `settled: released session state label=…`。
**旧代码**留下的 `soft stage: …` / `hard stage: cancel …` / `dry-run hard stage: would cancel …` /
`no budget data: …` 这几类**不会再出现**。
第一条决策行还会以 `dsh-adg-token-budget: first decision: …` 的形式**同时**进一次宿主日志。

插件**不导出 cordis `Config` schema**：它自己手写归一化，所以打错的值回落到默认、不认识的键被忽略，
而不是让 profile 加载失败。
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
        dryRun: true       # ← 建议先只开到这一步：只记录、不注入
```

改完**立即生效、不用重启**（这个文件是 `patchReload: live`）：宿主会重新 `apply` 这一行并写下一行
`activation: active …`。**前提是包里 `src/` 的代码没变过** —— 热重载不会重新 `import` 已经加载过的
模块（见 [装完必须重启 dsh](#装完必须重启-dsh)）。本机已经这样跑过（见下）。想小范围试：
把 `stepTiers` 调到 `[1, 2]`，就会在子代理的头两步各出现一次检查点。

### 推荐的上线顺序（三步）

1. **`enabled: false`** —— 照抄例子文件就是关着的：装上了，但 `apply` 在注册任何监听器之前返回，
   一步都不参与。它照样写一行加载期激活行，所以"宿主确实加载过这个包"看得见。
2. **`enabled: true` + `dryRun: true`** —— 拿**你自己的流量**校准：到期的检查点只写一行日志，
   **不注入任何东西**，也不消耗 tier。看清楚了再往下走。
3. **`enabled: true` + `dryRun: false`** —— 提醒**真的注入**。这就是本机现在的状态
   （`stepNudge: true` + 默认 14 档阶梯）。

**没有第四步。** 已经没有"只武装一半"的开关了（`hardDryRun` 随硬档一起移除），也没有可武装的
破坏性动作 —— 唯一的动作是注入一条**可选**提醒。反过来，**不要在"代码还是旧版"的状态下把
`dryRun` 关掉**：旧代码会把那条已移除的硬档真武装（见 [装完必须重启 dsh](#装完必须重启-dsh)）。

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
  `null`，即完全不写文件）。每次 `apply` 先追加一行 ISO-8601 时间戳开头的激活行，形状是：

  ```
  activation: inactive (enabled: false) presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
  activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
  ```

  （真正的行都在行首带 ISO-8601 时间戳，这里为了读清楚省掉了。）第 1 行是"宿主加载了、但开关是关的"，
  第 2 行是"已武装、`createUserMessage` 由 running profile 的 fallback 目录解析"（`profile-fallback:web`）。
  这两行的阶梯就是当前的 14 档。
  **旧字段已经不在这一行里**：`budgetTokens=` / `softThreshold=` / `softRatio=` / `cacheReadWeight=` /
  `softNudge=` / `hardDryRun=` 都不再出现。所以**这一行同时也是"运行中的宿主到底加载了哪一版代码"的判据**：
  - 出现 `stepNudge=` + `stepTiers=` + `stepText=`，且**没有** `hardDryRun=` → 当前这版代码；
  - 还在写 `budgetTokens=` / `softThreshold=` / `hardDryRun=` → **旧代码**。你部署了新代码却发现
    激活行还是旧形状，就是"热重载重放了 config、但没有重新 import 模块"，需要重启 dsh
    （见 [装完必须重启 dsh](#装完必须重启-dsh)）。
  **一行过期的激活行不是错误**，它只说明那一刻加载的是旧代码；判断"现在跑的是哪一版"要以**最后一行**为准，
  而且不能只看到一个熟悉的字段名就下结论。旧日志文件里还会留着当年的
  `soft stage: …` / `hard stage: cancel …` / `dry-run hard stage: would cancel …` 行 ——
  那是**已移除功能的历史记录**，不会再有新的。
- **除激活行之外，`logFile` 只记决策事件**：到期的步数检查点、dry-run 判定、
  `settled: released session state …`。**没有检查点到期的普通一步什么都不写**，所以 `enabled: true`
  之后文件不会因为"步子多"而膨胀。注意 dry-run 下**每个到期的检查点**都会写一行
  （`dry-run step stage: would nudge …`），所以那个行数是"到期过几次"，不是"注入几条"，
  也不是"子代理个数"。
- **宿主日志**里同一行带前缀 `dsh-adg-token-budget: `；第一条决策行还会额外以
  `dsh-adg-token-budget: first decision: …` 进一次宿主日志。**看到**
  `dsh-adg-token-budget: apply failed (…); the step checkpoints are inactive` **就是坏消息**：
  插件降级成 no-op（profile 照常启动，这正是「永不抛」的设计）；同理
  `context has no event API; the step checkpoints are inactive`。
- **真实触发行为**：**步数检查点的真机注入已经观测到**（三次，且拿到了子代理转写里的原文与它的回应）；
  `dryRun: true` 期间的判定行也观测到过（`dry-run step stage: would nudge …`，且没有注入任何消息）。
  **未观测**：第一个 tier 之外的档、新阶梯下的注入、以及"提醒是否让子代理更快收敛"。
  见 [现在的证据到哪为止](#现在的证据到哪为止)。

**当前这一行是武装状态**（`enabled: true`、`dryRun: false`、`stepNudge: true`、
`stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]`），
加载与注入都已是实测：18:18:22 的激活行出现 `stepText=builtin`（只有新代码会写这个字段），
18:25:14 的激活行把阶梯换成 14 档且**没有重启**（config 热重载）。所以接下来日志里每出现一行
`step stage: nudged …`，都是这条链路上的一次真实注入。

**切换窗口里还留着 5 个惰性旧键。** 本机这一行现在还带着 `budgetTokens: 1000000000000000`、
`softRatio: 1`、`cacheReadWeight: 1`、`softNudge: true`、`hardDryRun: true` —— 这不是配置意图，
是**重启前那段窗口的安全网**：进程里跑的还是旧代码，如果这里少了 `hardDryRun`，旧代码会按默认值
`false` 把已删除的硬档**真武装**；把 `budgetTokens` 抬到 10^15 且 `softRatio: 1`，旧代码的软档也
永不触发。重启 dsh 加载新代码之后这五行可以整体删掉（删不删都不影响行为，新代码对它们静默忽略）。

**最容易误判的一点：**校准期的那个到期检查点在日志里长得像
`dry-run step stage: would nudge tier=1/14 step=4 label=…` ——
**它证明的是计数到了、不是消息发出去了**。要区分"提醒真的注入"和"只是记账"，看行首：
`step stage: nudged …` 是真的注入了，带 `dry-run` 前缀的都是没注入的。
武装之后这条判断仍然适用：只有 `nudged` 那一种算注入。

### 现在的证据到哪为止

哪些是实测、哪些是设计意图，与上一节一个口径 —— 不写没量过的结论：

| 事项 | 证据 |
|---|---|
| 决策逻辑（配置归一化、步数计数与 tier 判定、筛选条件、状态释放、每步最多一条消息） | **单元测试**：`cd plugin/dsh-adg-token-budget && node --test test`，只依赖 `node:test` / `node:assert`（checkout 里没有 `node_modules` 也能跑）；另做过**变异验证**：**步数档 17 个变异（M1..M17，含自定义措辞路径）全部被测试抓住**（详见插件 README 的「Mutation verification」） |
| `package.json` 形状、ESM 可 import | 从**模拟的部署位置**（`…/profiles/node_modules/dsh-adg-token-budget/src/plugin.js`）import 起来验过 |
| `createUserMessage` 的五个解析锚点都解析到同一份模块 | **实测**（详见插件自己的 README） |
| 行能被 dsh 加载、不报 fatal | **实测**：`activation: inactive (enabled: false)` 就是宿主加载成功后写的 |
| `agent/pre-step` 真的走到这个监听器 | **实测**：真机的三次检查点注入，以及几百行 dry-run 判定 |
| `dryRun` 真的不注入 | **实测**：dry-run 期只有 `dry-run step stage: would nudge …` 行，**0 条**注入的消息 |
| **步数检查点**（`step stage: nudged`）在真机上发生 | **已实测**：三次注入（17:45:49 / 17:55:04 / 18:22:13，都在 `tier=1/3 step=12`），且能在对应子代理的 `session.v3.jsonl.zstd` 里找到那条消息本身（`role: user`、`source: {kind:'plugin', plugin:'dsh-adg-token-budget'}`），毫秒级对齐。**未覆盖**：第一个 tier 之外的档、新阶梯下的注入、`dry-run step stage` |
| 注入的提醒被子代理读到并回应 | **已实测（3 例）**：两个收到命令式措辞的表示要收敛；收到选择式措辞的那个明确选择"继续"并列出剩余必需工作、没有缩减计划 |
| **更早更密的阶梯 + 选择式措辞到底有没有用** | **未观测，而且是这个功能的核心问题**：分布（37 个子代理，中位数 39、p10 6）、成本（214 条约占 0.25%）、以及"第 12 步时只花了 10–14 万 token"都是实测的；"收到 14 条检查点的子代理是否比不收到时更早收敛"没有任何证据。量法写在插件 README 里：`audit-steps.mjs` 前后各跑一次，比分位数 |
| `settled: released session state …` / 恢复的子代理被再次提醒 | `settled:` **已实测**（17:55:33，收敛后 29 秒）；**恢复的子代理被再次提醒仍未观测** |
| **已移除的 token 两档**（`agent.cancel` 会被调用、软档会注入、阈值比较按真实账单在跑） | **历史实测，不代表当前行为**：`hard stage: cancel`（`usage=7651807`）、`would nudge` 最早 2,128,454、`would cancel` 最早 3,014,252，`usage=9824410` / `usage=48992135` 是真实累计值；437 行 `would cancel` + 36 行 `would nudge`，**0 次** dry-run 期发出的 `agent.cancel`；`soft stage: nudged` **从未观测**。这些代码路径**已删除**，今天不会再产生任何一行 |
| `adg` preset 改动后能组合 | **实测**（把改好的文件部署到 `.agent-presets/adg/` 之后重跑的那一次）：`resolve('adg')` → `broken` 为空、`standingKeyFor('adg')` → mounted OK、`compositionInventory()` → 34 行 / 10 个 `tool-subagent` 模块行里 **8 行启用** / `tool-subagent-fork` 0 行（行数不变是预期的：这次改的是 persona 文本与政策，不是行的增删） |

### 安全设计（为什么它坏了也拖不垮 GUI）

这不是代码风格偏好，是 cordis 的硬约束：**`apply` 抛出去、又没有声明 schema，就是 fiber 失败，
dsh 把加载失败的行报成 fatal 启动错误**；更糟的是对一个**没挂载的服务**写死 `static inject`，
那条 entry 会永远停在 `pending`，同样是 fatal。所以这个插件的写法是：

- **`apply` 永不抛。** 整个函数体包在 try 里，任何失败都走 `ctx.logger?.warn` 并降级成 no-op。
- **每个事件处理器都包了 try。** 检查点逻辑里的 bug 只会被抓住、记一次日志、然后 `return next()` ——
  它没法中断谁的回合。
- **没有 `static inject`，也不 `ctx.get` 任何服务。** 它只 `ctx.on('agent/pre-step')` 和（可选的）
  `ctx.on('subagent/end')`；这两个事件拿不到时降级成 no-op，靠的是 `typeof ctx?.on !== 'function'`
  的检查，不会让行停在 `pending`。
- **没有静态 import 任何 `@deepseek-ai/*`。** 插件是以普通目录部署在 `profiles/node_modules/` 下的，
  需要什么就在**调用时**用 `createRequire` 解析，解析失败也都可存活（必要时回落到本地构造函数）。
- **没有顶层副作用**，没有 `process.exit`，没有网络，除了配置的 `logFile` 不写任何文件。
- **状态有界**：每会话状态放在按 `agent.id` 索引的 `Map` 里，条目只记两个小字段
  （`steps` / `firedTiers`：已进入的步数与已触发的 tier 索引），`subagent/end` 时释放，
  `ctx.effect` 的 disposer 再整体清一次。`stepNudge: false` 时一步都不建（整层关掉）；
  `stepNudge` 打开时，被治理子代理进入的第一步就会建条目 —— 计数需要它，`dryRun` 也不例外
  （校准要看得见"第几步会提醒"）。

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
  dsh-adg-token-budget/ # host-plane 插件：子代理的步数收敛检查点（名字里的 "token-budget" 是历史名称，已不比较任何 token 阈值）
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
                        # 体积旋钮所在行的结构与"被写回时的合法性"（不钉死取值）
install.ps1             # Windows 安装脚本（preset + 技能 + 插件 + 挂载行）
install.sh              # macOS / Linux 安装脚本（同上，行为等价）
```

## 兼容性

- 从 DSH 出厂 preset `standard`（标准模式）复制而来，实质改动是五处：
  `persona` 增加调度名册与分派规则（步数收敛不写在调度者 persona 里，交给下面的插件在运行期
  注入）；`delegation` 组由通用委派行换成专家行；八个专家的 persona 末尾各留一句收敛纪律；
  `compaction` / `tool-web` 三行**不覆盖任何体积旋钮**（回归出厂默认，
  理由见 [为什么撤销 preset 侧的体积闸门](#为什么撤销-preset-侧的体积闸门)）；
  `agent_browser` 多一条**权限前置闸门**（本机沙箱下浏览器起不来，见「浏览器专家需要完全权限」）。
- **`agent_browser` 需要 `danger-full-access` 是本机的硬约束，不是本 preset 的选择。**
  它无法从 preset 侧修（父智能体不能指定子智能体权限、子代理不能自己升权、沙箱行在 host-plane），
  所以闸门做在调度侧、且是**提示级**的：见「浏览器专家需要完全权限」一节的三问三答与取舍。
- 依赖标准模式本来就有的出厂包（`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-persona`、
  `@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-subagent-control` 等）。
- 新增/删除/修改智能体后需要重启 dsh 才生效，这是 preset 挂载机制决定的，不是缺陷。
- **插件是另一条链路**（名字 `dsh-adg-token-budget` 是历史名称，它**不比较任何 token 阈值**）：
  它是 host-plane 的单半边行（没有浏览器半边），挂在 `web` profile 的
  patch 层上，`config:` 改动热重载、不用重启（**改 `src/` 里的代码则要重启** —— 热重载不重新 import
  已加载的模块）；部署出来的是 `profiles/node_modules/` 下的**真拷贝**，
  所以仓库被删/被挪都不影响已经装好的 dsh。它只依赖宿主本来就有的 `agent/pre-step`
  （状态释放在可选的事件 `subagent/end` 上），拿不到时它自己降级成 no-op
  （见 [安全设计](#安全设计为什么它坏了也拖不垮-gui)）。
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
4. **部署插件**（包名 `dsh-adg-token-budget` 是历史名称，它不比较任何 token 阈值）：把 `<tempdir>/plugin/dsh-adg-token-budget/` 里的
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
     **建议的上线顺序是三步**：`enabled: false` → `enabled: true` + `dryRun: true` 校准 →
     `enabled: true` + `dryRun: false`（提醒真的注入）。**没有第四步**：`hardDryRun` 与它控制的硬档
     都已移除，现在唯一的动作就是注入一条可选提醒。
     **不要在"代码还是旧版"的状态下把 `dryRun` 关掉**：旧代码不认新字段，缺省的 `budgetTokens`
     就是 300 万，会把那条已移除的硬档真武装。
     **行 id / 包名里的 "token-budget" 是历史名称**（现在不比较任何 token 阈值），照抄即可，不要改名。
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
   （插件那一行不用等重启 —— **但只有 `config:` 是这样**。本次交付的插件**代码是新的**
   （激活行多了 `stepNudge=` / `stepTiers=` / `stepText=`，且**不再出现** `budgetTokens=` /
   `softThreshold=` / `softRatio=` / `cacheReadWeight=` / `softNudge=` / `hardDryRun=`），所以：
   部署代码 → 重启 dsh → 确认 `logFile` 里的激活行正在写新字段、且不再有任何 token 字段
   → 这时才把 `dryRun` 从 `true` 改成 `false`（即上线顺序的第三步，也是终点）。
   别把"装了"说成"验过了"：**步数检查点已经在真机上注入过**，但**新阶梯下的注入**、
   以及"提醒到底有没有效果"都还没有证据，而且 token 两档已经不存在了。）
9. 如果用户还需要在**创造模式**里说「给 Adg 加一个智能体」被识别，确认第 3 步的技能已就位——
   `<dshHome>/skills` 是 `dsh-skill-filesystem` 的用户技能根（rank 400），两种模式都会扫描且热加载。
