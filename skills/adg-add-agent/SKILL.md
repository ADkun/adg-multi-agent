---
name: adg-add-agent
description: 在 Adg 多智能体模式（agent preset id `adg`）里新增、修改或删除一个专家智能体。当用户说「给 Adg 加一个智能体 / 新增一个专家 / 让某个岗位的智能体负责 X / 把某个智能体删掉」时使用。
whenToUse: 用户要求为 Adg 多智能体模式增加、调整或删除一个可委派的专家智能体。
---

# 在 Adg preset 里增删一个智能体

Adg 模式里每个「智能体」就是 Adg preset 的 `agent.cordis.yml` 中 `delegation` 组里的一行
`@deepseek-ai/dsh-tool-subagent`。一行 = 一个可委派的专家（当前名册 8 行）：

| 字段 | 含义 |
|---|---|
| `id` | 行标识，约定 `agent-<name>` |
| `config.toolName` | 模型看到的委派工具名，约定 `agent_<name>`，**必须全局唯一** |
| `config.persona` | 这个智能体的职责、能力边界、越界时怎么做、输出要求 |
| `config.toolFilter.allow` | 它被允许使用的工具白名单 —— 这是**真实的能力边界**，不是提示 |
| `config.backgroundMode` | 保持 `continuable`（后台接续干活，结果以通知回到调度者） |

第 8 行 `agent-general`（`agent_general`）是**特殊的一行**，不是普通的专项专家：它**只在用户显式要求
"交接"时**才被派发（调度 persona 规则 17），拿的是本 preset 里最全的**叶子**工具集，用途是**上下文
隔离**。给它加 `agent_*` 名册行、通用 `subagent` / `subagent_fork`、或 `workflow` / `ralph` 都是**反例**
（`preset/design.md` I16）；它的 `send_message` 也不能删（运行时的"回报上级"指引靠它才注入）。
新增普通专家时**不要**照抄它的 allow 名单与 persona，照抄前 7 行里最近的那个。

## 先确认用户意图（一次问清）

用 `ask_user_question` 一次问齐，缺什么问什么：

1. 岗位名与一句话职责（例：文档员，负责把内部笔记改写成对外口径）。
2. 能力范围：需要哪些工具（读写文件 / 跑命令 / 联网检索 / 只读），以及明确**不能**做什么。
3. 越界时应该报告需要谁（例：需要 `agent_coder`），而不是自己扩大范围。

如果用户只说「加一个查文档的智能体」，就替他把这三项拟好，给用户确认一次即可，不要反复追问细节。

## 落盘步骤

1. **定位 preset 的源文件**，不要猜路径，也不要改错那一份：Adg 现在是一个 **bundle** ——
   `$DSH_HOME/bundles/dsh-adg-preset/cordis.patch.yml`（bili / save-token 的注入版各有自己的稳定目录
   `dsh-adg-preset-bili` / `dsh-adg-preset-save-token` / `dsh-adg-preset-bili-save-token`，见根 `AGENTS.md` 红线 10）是 `tools/gen-preset-bundle.mjs` 从
   `preset/preset.yml` + `preset/agent.cordis.yml` **生成**的构建产物，**每次安装都会被覆盖**，
   所以**要改的是仓库里的 `preset/agent.cordis.yml`**。仓库不在本机就先 `git clone`
   （或让用户给出仓库路径）。旧的 `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` 自 dsh 0.1.7-rc.2
   起已无人读取，别再把改动写到那里。
2. 在 `delegation` 组的专家名册段里**复制一行现有专家**，改 `id`、`toolName`、`persona`、
   `toolFilter.allow` 四个字段。
3. **同步更新文件顶部 `persona` 的 prefix**：把新专家加进「可委派的专家」名册，并按需补一条
   调度规则。这一步不能省，否则调度智能体根本不知道有这个专家。**不要动编排层与闸门那几条** ——
   编排层是规则 6 / 7 / 13 / 14 / 15（同一实体 + 同一性质的任务合并成一次委派；同一实体的后续任务用
   `list_agents` + `send_message` 接给已经读过它的那个专家；大范围改动先定位再动手；跨专家传递大
   材料走 digest；**派发前过必要性闸门 + 未纳入的旁路必须挂号**），闸门是规则 11 / 12（浏览器权限
   前沿 + 人工介入转达）；规则 5 的**五项必填**（含**验收标准**与**本次不做**）与**输出纪律**（规则 5
   的分字段写 + 规则 10 的去冗余四条）同样别删。新增专家时
   只按它的性质补一句"该派给谁"，别把名册改写成预算、也别删掉或放宽这几条。
4. **删除智能体**：删掉那一行 + 顶部名册里的那一行，两处都要改。
5. **跑自检**：在仓库里 `node tools/check-preset.mjs`（零依赖，exit 0 表示通过）。
   **现在没有"已安装的那一份"可以传路径了** —— 仓库里的 `preset/agent.cordis.yml` 就是唯一真相源
   （旧机制那份 `.agent-presets/adg/agent.cordis.yml` 已随机制一起消失）。
   它会检查行尾/末尾换行/BOM、专家行字段齐全、toolName 唯一且形如 `agent_<name>`、
   `allow` 里只有已注册的工具名、没有通用委派行、调度名册与专家行双向一致，以及承载三组体积旋钮的
   那三行（`compaction-basic` / `tool-result-pruner` / `tool-web`）**结构完好、且没有被写回不合法的
   覆盖值**，并打印 `体积旋钮（生效值）：...` 与 `裁剪后实际吐出（按生效配置算）：...` 两行摘要。
   注意它**不钉死取值**（本 preset 一律用插件出厂默认值），而且**只是逐行文本扫描器，不是 YAML
   解析器**：它保证这些硬约束在文本上没被破坏，但证明不了文件能被 YAML 解析、也证明不了插件
   真的挂载 —— 那要按下面「校验与生效」做一次真实挂载。
6. 写入 preset 目录可能在工作区之外，若被沙箱拒绝，按提示升级重试同一条命令一次即可。

## 校验与生效（重要，别承诺错）

- **校验**：`node tools/check-preset.mjs` 做静态自检（快、可离线）；要验证运行期组合，读
  `agentPresets.resolve('adg').broken` —— **它为空就是可用**，报的字符串会指明是哪一行起不来
  （包解析不到 / 配置非法 / 行没激活 / 服务发布到全局 realm）。`standingKeyFor` 在本版 dsh 里
  **已不存在**，别照旧文档调它。要拿到 `agentPresets`，按技能 `editing-cordis-compositions`
  挂一个临时插件注册工具即可。
- **生效**：改完源文件之后还有一步——**重跑生成与安装**（`node tools/gen-preset-bundle.mjs`
  再 `plugin_manager install_bundle`，或直接重跑 `install.ps1` / `install.sh`，它两步都做），
  否则装到 `${DSH_HOME:-~/.dsh}/bundles/dsh-adg-preset`（挂 bili / save-token 时是
   `.../dsh-adg-preset-bili` / `-save-token` / `-bili-save-token`）的还是旧 bundle —— **四种味道都要重跑**
   （`node tools/gen-preset-bundle.mjs` 与 `--with-billion-context` / `--with-save-token` / 两个旗标叠加），
   挂哪个插件的 profile 用哪一份。
  然后：**已挂载的 preset 不会因为 composition 文件被改动而重新组合。** 已实测：挂载后把
  28 行改成含 3 个专家行的版本，`compositionInventory()` 仍返回旧的 28 行。因此新增或删除智能体后
  **必须重启 dsh（Host 进程）**，新组合才会在 Adg 的新对话里生效。
  （2026-09-28 补测：profile 的 `cordis.patch.yml` 或 profile 清单变动会让整份 patch 栈被重读、
  声明会重新注册 —— 但"已挂载的会话不换组合"这条不变，所以验收口径仍是重启 + 新会话。）
- 在重启之前，**不要引导用户去用 Adg 模式**：他拿到的会是旧组合（没有新专家）。
  正确说法是：「改动已保存，重启 dsh 之后在 Adg 模式新开对话就能用这个智能体。」

## 硬约束（不要违反）

- **不要加回通用的 `dsh-tool-subagent`（`toolName: subagent`）或 `subagent_fork` 行。**
  子代理会继承父代理的这整套 composition，一旦存在通用行，专家就能绕过自己的范围再开一个
  不受限的子代理，能力边界形同虚设（这条已在创造模式实测复现）。
- **`toolFilter.allow` 真实生效，是能力边界本身。** 已实测：给 `agent_coder`（当时的 allow 名单）
  委派任务，它报告的可见工具目录**恰好等于它的 allow 名单**，`agent_*` 名册行与通用 `subagent`
  都不在其中 —— 连 preset 自己注册的工具也一起被裁。所以：
  - 专家之间**不能**直接互相转交（名册行不在它们的 allow 里）；越界的正确做法是回一句
    「超出能力范围，需要 agent_X」，由调度智能体据此再派发下一步（链路可追踪）。
    如果确实想让某个专家能直接转交，把对应的 `agent_*` 名字加进它的 `allow` 即可 ——
    这是唯一的切换方法，不要在文档里承诺"默认就能互相转交"。
  - 给专家的 `allow` 就是它的全部工具目录，persona 只是补充说明。写 persona 时不要要求它做
    allow 之外的事（例：allow 里没有 `write` 就不能要求它落盘）。
- **`allow` 里只能写已注册的工具名。** `dsh-tools` 的 `restrict()` 遇到未知名会直接抛
  `names unknown global tool ...`，委派会当场失败。合法名单见 `tools/check-preset.mjs` 里的
  `KNOWN_TOOLS`（本组合注册过的工具名：shell、filesystem、jobs、skill/goal、委派控制、
  ask_user/todo/web/present 等）—— 改 composition 的 tool 行时同步那份清单，改完跑一次自检。
  注意**条件性注册**的名字：`bash` 被 Windows 上的 `disabled` 行关掉、`read_image` 依赖
  `attachments` 服务（base 组合里恒有）、`disabled` 的 codex/claude-code 行同理。自检对这类
  名字只给「提示」；真在缺条件的部署上用到，那一次委派会抛错而不是挂载失败。
  - **构建期注入的名字不要手写进 `allow`**：billion-context 的 `compress` / `decompress` / `search_context` /
    `acp_status` 与 save-token 的 `save_token_expand` 只在装着对应插件的 profile 里存在，清单只有一份、在
    `tools/flavors.mjs`。手写它们会让没装那些插件的 profile 每次委派当场抛 `names unknown global tool`，
    所以 `check-preset.mjs` 见到源文件里手写这些名字直接判 ERROR。要给专家补上它们就用生成命令，不要改源文件：
    `node tools/gen-preset-bundle.mjs --with-billion-context` / `--with-save-token`（两个旗标可叠加）。
- **有 `pwsh` 的专家要同时给 `job_list` / `job_output` / `job_kill`**，否则后台跑起来的任务取不回来。
- **除 `agent-general` 外，别给专家的 `allow` 里写 `skill`**（技能面口径，2026-10-01 按用户要求；理由见
  `preset/design.md` 非功能红线）：`toolFilter` 只有 `allow` / `deny` 两种形态，preset 侧**没有**
  "给所有子代理默认加一个工具"的开关，而**不写 `allow`** 的专家会继承调度者整套目录（连名册行一起
  继承 ⇒ 违反一跳可达红线），所以"让所有专家都能用技能"只能逐行写 `allow` —— 那正是"每加一个专家
  都要维护一遍仓库"。默认口径＝专家不用技能面：要用技能的工作由调度者自己做、或按 I16 派
  `agent-general`（它的 `allow` 里有 `skill`）；委派给别的专家时只在委派 prompt 里给技能的
  **绝对路径**＋「先 read 该文件再动手」，**不内联、不复述技能正文**（只有读不了文件的
  `agent-search` 才内联）—— 完整口径与三种例外见调度规则 18。自检对该情形只给 WARN（提示级）。
- **不要**再往 persona 里写 token／读取预算（"委派 prompt 必须自带读取预算"、
  "结论控制在 N 字符内"、"禁止整读大文件"之类）：那一层纪律已整体撤销 —— 截断与提前压缩会把
  工具已经取到的事实切掉，写在 persona 里的预算提示会把注意力从"把事情做对"挪到"别写太多"，
  净效果是更差的结论。**唯一的例外是调度侧那五条编排层规则**（同实体合并、优先恢复既有专家、
  先定位再动手、digest 中转、必要性闸门 + 挂号）：它们管的是"派给谁、派几次、材料怎么中转、
  要不要做"，不管"单个专家能读多少、写多少"，所以**不要拿这条红线当理由删掉它们**。成本口径见
  README「token 成本纪律（这些上限是怎么来的）」与「多智能体的 token 消耗：已落地与可选手段」。
- **不要给那三行体积旋钮加回覆盖值。** `compaction-basic` / `tool-result-pruner` / `tool-web` 三行
  刻意不写压缩阈值、单条工具结果截断、`fetchMaxOutputChars` / `searchMaxResults` /
  `searchMaxQueries`，一律用插件出厂默认值 —— 加一个智能体**不需要**动它们，而且"靠截断省 token"
  那套口径已整体撤销（见 README「为什么撤销 preset 侧的体积闸门」）。确实要覆盖时，取值得落在插件
  会接受的范围内，并在同一个提交里给出对比数据（对**会话目录**（`<DSH_HOME>/sessions`，本机缺省即
  `~/.dsh/sessions`）跑一次会话审计脚本、改动前后各一次 —— 该脚本**本项目不带**，口径见根
  `README.md`「怎么重新测量」：按 preset 分组看 `input` / `cache` / `output` / `requests`；
  拿不出对比数字就不要改）；自检会把覆盖过的键
  标成「已覆盖」。同理不要顺手加 `maxTokens` / `agentOptions` / `reasoningEffort`：
  输出只占账单 1%，压它只损伤质量；`reasoningEffort` 在手工声明的路由上会让每次委派直接报
  `UNSUPPORTED_REASONING_EFFORT`。也不要给专家行加 `maxDepth`：它是"经这一行创建的子代理深度上限"，
  写 `0` 会让**每一次** `agent_*` 委派以 `subagent depth 1 exceeds maxDepth 0` 失败。
  改完跑 `node tools/check-preset.mjs`。
- **不要给 `agent-general` 加委派能力，也不要把它当模板。** 它是 I16 里刻意做成**叶子**的一行：
  把任何 `agent_*` 名册行、通用 `subagent` / `subagent_fork`、或 `workflow` / `ralph` 写进它的 `allow`
  技术上就生效（子代理会 `composeFrom` 继承整套组合），但那会让孙代理对调度者不可见、不可 steer，
  并让调度侧那五条编排层规则整段失效。它的 `send_message` 是**功能性**的（运行时的"结束前回报上级"
  指引只在子代理看得见它时才注入），不许删。**新增普通专家时不要照抄它的名单与 persona。**

## 本技能从哪来

位于用户技能根 `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md`，被 `dsh-skill-filesystem`
以 rank 400 扫描并热加载，所以**创造模式与 Adg 模式都能读到它**——在两种模式里说「给 Adg 加一个
智能体」，AI 都知道你在说什么。
