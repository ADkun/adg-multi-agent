# AGENTS.md — adg-multi-agent

Adg 多智能体模式：一份 DSH agent preset（**一个调度智能体 + 九个专家智能体**，其中第 9 个 `agent_general` 是交接专用的**叶子**），外加一个给委派出去的子代理注入**步数收敛检查点**的 host-plane 插件、一个浏览器工具链（有头 Chrome 启动器 + 最小 CDP 驱动）、一个「给 Adg 加一个智能体」的用户技能、一个静态自检脚本与一个把 preset 源文件生成成 bundle 的构建脚本、两个安装脚本。本文只做路由，不做百科——细节一律下沉到按需文档。

人向手册与全部实测依据：`README.md`（**改任何东西之前先读它对应的小节**）。

## 命令

零运行时依赖；只要求 Node（插件 `package.json` 声明 `engines.node >= 20`，`browser/package.json` 声明 `>= 22`；本机实测 Node v26.9.0）。仓库根没有 `package.json`、没有 monorepo 构建、没有 lint 配置。

```sh
# preset 静态自检（零依赖，逐行文本扫描；exit 0 通过 / 1 有 ERROR / 2 读不到目标文件）
node tools/check-preset.mjs
# 注意：**没有"已安装的那一份文本"可以传路径了** —— 旧机制（$DSH_HOME/.agent-presets/<id>/）在
# dsh 0.1.7-rc.2 已被移除，仓库里的 preset/agent.cordis.yml 就是唯一真相源。

# 生成 preset bundle（构建产物，落在 .gitignore 忽略的 bundle/adg-preset/；install.* 每次都会重跑它）
node tools/gen-preset-bundle.mjs
node tools/gen-preset-bundle.mjs --with-billion-context   # 目标 profile 挂了 billion-context 时才用：给 9 个专家的 toolFilter.allow 追加它的 4 个上下文工具（红线 11）

# 生成物自检：check-preset 读的是**源文件**（专家行在第 4 列），产物里它们在第 14 列 —— 产物是它的盲区，
# 所以"注入没生效 / 注错方向"必须靠这个脚本钉住。它自己探测缩进，两种模式都要验：
node tools/gen-preset-bundle.mjs bundle/adg-plain && node tools/check-bundle-flavor.mjs bundle/adg-plain/cordis.patch.yml plain
node tools/check-bundle-flavor.mjs bundle/adg-preset/cordis.patch.yml bili

# 判据："某个 profile 到底算不算挂着 billion-context" —— 两件方向相反的事共用这一份实现，别在别处重写
node tools/has-billion-context.mjs ~/.dsh/profiles web      # → 每 profile 一行 `web<TAB>1|0`，退出码恒 0

# 插件单元测试（只依赖 node:test / node:assert，无 node_modules 也能跑）
cd plugin/dsh-adg-token-budget && node --test test
cd plugin/dsh-adg-token-budget && node --test --test-isolation=none test   # DSH 沙箱（workspace-write）里必须加这个 flag，见下

# 浏览器工具链的单元测试（零依赖、不需要浏览器）
cd browser && node --test test
cd browser && node --test --test-isolation=none test                       # 沙箱里同样必须加这个 flag

# 安装到本机 dsh 用户根（技能 + preset bundle + 插件 bundle + browser 工具链；挂载行由包自己带，不再手贴）
sh install.sh                                                              # macOS / Linux
sh install.sh --billion-context=on web                                     # 只给这个 profile 用注入版（见红线 11）
powershell -ExecutionPolicy Bypass -File .\install.ps1                     # Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BillionContext on -Profiles web
# preset 与插件现在都是 bundle：脚本生成 / 拷贝 → $DSH_HOME/bundles/dsh-adg-preset 与
# $DSH_HOME/bundles/dsh-adg-token-budget → link 进每个能装 preset 的 profile → 把两个包名都写进该 profile
# 的 dsh.profile.bundles（光有依赖不算选中）。dsh 正在运行时 pnpm 会因文件被占用而失败（脚本会如实报告并
# 继续）—— 要真正装/换依赖先关掉 dsh。
# 两个脚本都会探测 billion-context（tools/has-billion-context.mjs）：auto 模式下"每个目标 profile 都挂着"
# 才生成注入版；挂着 bili 的 profile 一律**不启用** dsh-adg-token-budget（会把它从 dsh.profile.bundles 里
# 移除并备份 .bak-adg-token-budget）—— 理由见红线 11。
```

**本仓库没有"一条命令跑完全部"的入口**：上面几组命令彼此独立，各自覆盖一层。验收方式是这几组 + 一次真实挂载，见「Quality Gates」。

## 关键红线（违反即返工，改任何文件前先读）

1. **禁止加回通用 `subagent` / `subagent_fork` 委派行。** 子代理继承父代理的整套 composition；一旦存在通用行，专家就能绕过自己的范围再开一个不受限的子代理（已在创造模式实测复现）。
2. **`toolFilter.allow` 是真实的能力边界，不是提示。** 实测：专家可见的工具目录**恰好等于**它的 `allow` 名单（连 preset 自己注册的工具一起被裁）。因此禁止在 persona 里要求它做 `allow` 之外的事，也禁止承诺"专家之间默认能互相转交"。
3. **禁止给承载体积旋钮的三行写回覆盖值**（`compaction-basic` / `tool-result-pruner` / `tool-web`）。本 preset 一律用插件出厂默认值：截断工具结果会把工具**已经取到**的事实切掉。
4. **禁止在 persona 里写 token／读取预算**（"结论控制在 N 字符内""委派 prompt 自带读取预算"之类）。该层纪律已整体撤销。**与成本有关的只剩调度侧五条编排层规则 + 一条输出纪律 + 一条交接闸门**（编排层：同一实体 + 同一性质的任务合并成一次委派 —— **含浏览器那半：同一份信息默认只在一个站点取**（2026-09-27 按用户要求追加，一轮浏览下限实测 0.8–2.0 秒，除非用户要多源 / 对比、单站点拿不到或各站数据矛盾、或交付物本身就是跨站比较）；大范围改动先让 `agent_researcher` 出 `path:line` 再让 `agent_coder` 按位改；同一实体的后续任务接给已经读过它的那个专家；跨专家传递大材料走 digest；派发前过**必要性闸门**并给未纳入的旁路挂号。输出纪律：不回贴工具输出原文、同一结论只说一次、不转述中间过程、**"未验证 / 未纳入"必填块不许为求简短省略**。交接闸门：`agent_general` 只在用户显式要求时派、禁止因为"任务大 / 想省上下文 / 想并行"自行改派。`preset/design.md` I13 / I14 / I15 / I16）—— 它们约束"派给谁、派几次、材料怎么中转、要不要做、写下来的东西怎么组织"，不是"单个专家能读多少、能写多少"；禁止把这些改写成预算或**字数上限**（I15 明文禁止），也禁止把 digest 工件写进工作区（I14）、把未纳入的旁路静默丢掉（I13 第 ⑤ 条）。
4b. **禁止给 `agent-general` 的 `allow` 加任何 `agent_*` 名册行、通用 `subagent` / `subagent_fork`、或 `workflow` / `ralph`**（`preset/design.md` I16）：它是刻意做成**叶子**的交接专用全功能角色，能再委派就破坏一跳可达的链路（孙代理对调度者不可见、不可 steer）。也禁止删掉它的 `send_message` —— 运行时的回报指引只在子代理看得见它时才注入。**技术事实**：子代理会 `composeFrom` 继承整套组合、`allow` 写进去就生效（深度上限由该行 `maxDepth` 决定，默认 3），所以这是一次刻意的能力裁剪。
5. **禁止给任何请求设 `maxTokens` / `agentOptions` / `reasoningEffort`。** 后者在手工声明的路由上会让每次委派直接报 `UNSUPPORTED_REASONING_EFFORT`。
6. **禁止给专家行写 `maxDepth`。** 写 `0` 会让**每一次** `agent_*` 委派以 `subagent depth 1 exceeds maxDepth 0` 失败。
7. **`allow` 里只能写已注册的工具名。** `dsh-tools` 的 `restrict()` 遇到未知名直接抛 `names unknown global tool ...`，那一次委派当场失败；合法名单见 `tools/design.md`。
8. **`install.ps1` 必须保留 UTF-8 BOM。** Windows PowerShell 5.1 没有 BOM 时会按系统 ANSI 代码页读脚本，中文乱码并直接解析失败；编辑工具会**悄悄**去掉它，改完单独确认前三个字节仍是 `EF BB BF`。
9. **插件的提醒只能是"可选提醒"，不能读成停止指令**（文本里禁止"立即停止"这类命令句）。这条由测试钉住（变异 M13）。
10. **`browser/` 工具链的边界**：禁止引入第三方依赖（`playwright` / `puppeteer` / `ws`）；禁止把 profile 放进会话工作区、或写死任何本机绝对路径；禁止代填账号密码、读取 profile 的 cookie 库、验证码识别与指纹伪装。来源与不变量见 `browser/design.md`（I1 / I6）与 `browser/AGENTS.md`「模块特有红线」。
11. **billion-context 的上下文工具只能由构建期注入，禁止手写进 `preset/agent.cordis.yml`。** `compress` / `decompress` / `search_context` / `acp_status` 这四个名字不属于本组合，它们是 billion-context 的 DSH 插件注册在**全局层**的工具（实测：子代理的工具目录里它们是裸名、没有 `mcp__` 前缀，所以 `restrict()` 接受）。两侧后果都不轻：**不给** —— bili 的压缩指令与 nudge 只看自己的 config、不看这个请求有没有那些工具（`billion-context/src/server.ts:3427` 的系统段与 L3447 的 nudge 都没有 pluginMode 护栏），于是专家收到"去调 `compress` / `acp_status`"的指令却没有工具可调；**给了但目标 profile 没挂 bili** —— 名字不存在，撞红线 7，每一次委派当场抛 `names unknown global tool "compress"`。所以口径是"源文件中立、生成物按探测决定"：`node tools/gen-preset-bundle.mjs --with-billion-context`，探测在 `tools/has-billion-context.mjs`（判据 = 包在 `dsh.profile.bundles` 里 **且** 装上的那份真的带 `dsh.bundle.patch.yml`）；`tools/check-preset.mjs` 会把源文件里手写的这四个名字判成 **ERROR** 并指回这个旗标。生成物**全机共用一份**（各 profile 的 node_modules 链接同一个 `$DSH_HOME/bundles/dsh-adg-preset`），所以 auto 只在"每个目标 profile 都挂着"时才注入。同一份判据的另一半：**挂着 bili 的 profile 不启用 `dsh-adg-token-budget`**（它按步数档位给子代理下收敛提醒，bili 的压缩/nudge 是同类指令，两套同时给同一批子代理会互相抢阈值）。实现方式是把这个 bundle 从该 profile 的 `dsh.profile.bundles` 里**移除**（脚本会备份 `.bak-adg-token-budget`）—— **不要**改成塞一条 `enabled: false` 覆盖行（红线 3 的同一理由：按 id 覆盖是整块替换 `config`，为关一个键重写整份 config 容易丢别的键）。

## 生效方式（口径不同，别承诺错）

| 改了什么 | 怎么生效 | 怎么复核 |
|---|---|---|
| `preset/` 任何文件（含增删专家） | 先重跑 `tools/gen-preset-bundle.mjs` 并重装 bundle（`install.*` 会自动做），再**重启 dsh**，然后在**新对话**里选「Adg 多智能体模式」 | 重启后按 `README.md`「给 AI 的安装指令」第 8 步做真实挂载校验。**不要**再去 `.agent-presets/` 找那第二份文件——它已经不存在了 |
| 只切换 billion-context 注入与否（同一份源文件的两种生成物，见红线 11） | 重新生成 + 重装 bundle（`install.*` 探测后自动带旗标）+ **重启 dsh** + 新会话 | 先看 `$DSH_HOME/bundles/dsh-adg-preset/cordis.patch.yml` 里每个专家行末尾有没有那四个名字；再在新会话里委派任一专家，让它报工具目录里看得见 `compress` / `acp_status` |
| composition 里写的 `@deepseek-ai/*` 包名 | 包名会随 dsh 升级**改名**，改完必须真实挂载 | `resolve('adg')` 的 `.broken` 为空；用旧名会报 `… never started`（2026-09-28 实录：`dsh-workflow-worker-thread` → `dsh-workflow-ptc`） |
| 插件的挂载行**本体**（bundle 层：`$DSH_HOME/bundles/dsh-adg-token-budget/cordis.patch.yml`） | **以重启 dsh 为准**——没有任何东西 watch `bundles/`，单独改这个文件不会自己触发重读；**禁止宣称"不重启也会生效"** | 重启后 `plugin_manager list_bundles` 仍有 `dsh-adg-token-budget` 这条 + `logFile` 新出现一行 `activation: …`（**冷启动后的 bundle 层：未观测**，量法见 `docs/evidence.md` §8 / §16.5） |
| 插件的 `config:` **覆盖行**（`profiles/<profile>/cordis.patch.yml`；Plugins 页保存写的就是这一层） | **热重载，不用重启**（`web` 是 `patchReload: live`）——但覆盖行按 id **整块替换** `config`、不是深合并，要留的键必须全部重写 | `logFile` 里新出现一行 `activation: …` |
| 插件的 `src/` 下的代码 | **必须重启**——热重载只重放 `config:`，不会重新 `import` 已加载的模块（Node 的 ESM registry 按文件 URL 缓存） | 激活行出现 `stepNudge=` / `stepTiers=` / `stepText=` 且**没有** `budgetTokens=` / `hardDryRun=` |
| `browser/` 任何文件 | **重新跑一次 `install.*` 即生效，不用重启**——它是用户根下的普通文件，不是 preset 也不是插件 | `node "${DSH_HOME:-~/.dsh}/browser/cli.mjs" profile` |

**这条链路上唯一的静默失效模式**：profile 层残留一条同 id 的旧 `- insert:` 手贴行。它**不多挂一行**，但**整块接管**那一行的 `config:`（注入可以当场停掉，而日志看起来完全正常），并让该行**脱离管理**。`list_bundles` 的 `overrides` 发现不了它——判据是 `list_plugins` 里这一条**还有没有 `patchId`**（真机实测与逐条结论见 `docs/evidence.md` §16.4 第 6 条；**别与 §14.3 混引** —— 那条讲的是"同一个 profile 里同一个 preset 声明行只能有一个家"）。

## Project Map

| 模块 | 一句话职责 | 规则见 |
|---|---|---|
| `preset/` | Adg preset 的定义：调度 persona（名册 + 分派规则）与 9 个专家行（第 9 行 `agent-general` 是交接专用叶子）；`preset.yml` / `agent.cordis.yml` / `bundle.package.json` 是 **bundle 的源**（由 `tools/gen-preset-bundle.mjs` 生成、装进 profile 的 `dsh.profile.bundles`） | `preset/AGENTS.md` |
| `plugin/dsh-adg-token-budget/` | host-plane 插件：受管子代理的步数收敛检查点（包名是历史名称，**不比较任何 token 阈值**）；**现在是一个 bundle**——挂载行由包自己的 `cordis.patch.yml` 提供（`package.json` 的 `dsh.bundle.patch`），装进 `$DSH_HOME/bundles/`，**不再手贴进 profile 的 patch 层** | `plugin/dsh-adg-token-budget/AGENTS.md` |
| `tools/` | `check-preset.mjs`（preset 的零依赖静态校验器，**不是 YAML 解析器**）+ `gen-preset-bundle.mjs`（从 `preset/` 源文件生成 bundle 的构建脚本，**产物不许手改**） | `tools/AGENTS.md` |
| `browser/` | 有头 Chrome 启动器 + 最小 CDP 驱动（零依赖，唯一入口 `cli.mjs`） | `browser/AGENTS.md` |

不在模块地图里、也不需要模块 `AGENTS.md` 的（三样信号都没有，建了就是噪音）：`skills/adg-add-agent/SKILL.md`（用户技能文档，位于 `${DSH_HOME:-~/.dsh}/skills/`，无独立命令）、`install.ps1` / `install.sh`（部署脚本，无模块红线）、仓库根 `README.md`。`docs/` 是文档层而非模块：`docs/evidence.md`（实测证据台账 / 未观测清单）、`docs/docs-guide.md`（写作规范与文档分层契约）、`docs/registry.md`（索引与冷启动三问的答题路径）。

**新模块登记义务**：新建模块时在本表与 `docs/registry.md` 各加一行，缺登记即文档体系不完整。

## Context Loading（按你手上的改动读）

| 你要做什么 | 先读 | 再读 |
|---|---|---|
| 新增 / 修改 / 删除一个专家智能体 | `preset/AGENTS.md` | `skills/adg-add-agent/SKILL.md` → `preset/design.md` → 改完 `node tools/check-preset.mjs` |
| 改调度 persona 的名册或分派规则 | `preset/design.md` | `preset/testing-guide.md`（名册与专家行的双向一致性约束）；改**编排层规则**（I13 / I14，含必要性闸门与挂号）或**输出纪律**（I15）再读 `README.md`「多智能体的 token 消耗：已落地与可选手段」 |
| 改插件行为（筛选 / 计数 / 措辞 / 激活行） | `plugin/dsh-adg-token-budget/AGENTS.md` → `design.md` | `plugin/dsh-adg-token-budget/testing-guide.md`（先看该行为是否已被测试钉住） |
| 改插件的挂载行在哪一层、部署落点与部署集合（`package.json` 的 `files` 与 `dsh.bundle.patch`）或上线顺序 | `plugin/dsh-adg-token-budget/INSTALL.md` | `plugin/dsh-adg-token-budget/design.md` |
| 改 `check-preset.mjs` 的判错口径，或改 composition 的 tool 行 | `tools/design.md` | `preset/design.md`（体积旋钮与 `allow` 的约束） |
| 改浏览器工具链（`cli.mjs` 契约 / `launch` / `close` / 驱动层） | `browser/AGENTS.md` → `browser/design.md` | `browser/testing-guide.md`；动 `launch` / `close` 的默认行为再读 `preset/design.md` I11 / I12 |
| 改 `agent_browser` 的 persona（浏览器那一段） | `preset/design.md` I11 / I12 → `browser/AGENTS.md`（它消费的命令行契约） | 根 `README.md`「浏览器工具链与登录态资产」→ `docs/evidence.md` §13 → 改完 `node tools/check-preset.mjs` |
| 想知道某个数字/结论"量过没有" | `docs/evidence.md` | `README.md` 对应小节（`README.md` 是实测原始依据） |
| 只是想装到本机 | `README.md`「安装」 | `install.sh` / `install.ps1` |
| 搞不清文档体系的写法与分层 | `docs/docs-guide.md` | `docs/registry.md`（索引与冷启动三问的答题路径） |

## Quality Gates

1. `node tools/check-preset.mjs` → **exit 0**（允许 WARN；WARN 不是失败，ERROR 的含义只有一个：**这次委派必然抛错**）。本仓库当前实测：**0 错误 / 2 警告**（`agent-file` 与 `agent-general` 的 `read_image` 是条件性注册；2026-09-28 加第 9 个专家之前是 0 / 1）。
1b. **改了 `tools/gen-preset-bundle.mjs` 或 `preset/agent.cordis.yml` → 两种味道的产物都要验**（红线 11）：`node tools/gen-preset-bundle.mjs bundle/adg-plain && node tools/check-bundle-flavor.mjs bundle/adg-plain/cordis.patch.yml plain` 与 `node tools/gen-preset-bundle.mjs --with-billion-context && node tools/check-bundle-flavor.mjs bundle/adg-preset/cordis.patch.yml bili`，两条都必须 **exit 0**。`check-preset.mjs` 读的是源文件（专家行在第 4 列），产物里它们在第 14 列 —— **产物是它的盲区**，只跑第 1 条证明不了注入有没有生效。本仓库实测：plain = 9 行全 `NONE`（`10/7/7/10/2/5/9/7/16`）、bili = 9 行全 `ALL`（`14/11/11/14/6/9/13/11/20`，每行正好 +4）；交叉断言两个方向都 exit 1（拿 bili 产物按 plain 断、拿 plain 产物按 bili 断），所以这个门**不会假绿**。
2. `cd plugin/dsh-adg-token-budget && node --test test` → 全绿（本仓库实测 **54 个测试全通过**）。**在 DSH 沙箱（`workspace-write`）里这条命令必然失败**，失败形态是测试文件本身报 `Error: spawn EPERM`（不是断言失败）：`node --test` 默认每个测试文件起一个 piped-stdio 子进程，沙箱拒绝 pipe。加 `--test-isolation=none` 即走同一条测试路径且不需要子进程，实测全绿；另外 `| Select-String / Select-Object` 这类 PowerShell 管道在沙箱里也会被拒（`Access is denied`），重定向到文件则正常。
3. 改了 preset → 按 `README.md`「给 AI 的安装指令」第 8 步做**真实挂载**（静态自检证明不了挂载）。
4. 改了插件的 `src/` → 重启后复核激活行形状（见上表）。
5. 交付前逐条对照 `docs/docs-guide.md` 的写作规范与附件规范的「质量红线清单」。
6. 引用任何实测数字前先读 `docs/evidence.md` 的**未观测清单**与**活证据复核快照**：人向手册里若干"未观测"条目的**依据**已被本机日志更新（新阶梯下的注入确已发生，见 `docs/evidence.md` 第 9 节），处置权在人类。**但有一条不是冲突、不许读成冲突**：「恢复的子代理被再次提醒」仍是未观测——日志证明的是**驻留期重置机制**在跑，"那个子代理是被恢复的"无从判定（`subagent/end` 对"结束"与"被恢复"发同一事件）。
7. `cd browser && node --test test` → 全绿（本仓库实测 **36 个用例全通过**，不需要浏览器）。改了 `browser/` 之后还要跑一次真机闭环（`browser/testing-guide.md` 第 5 节：`profile` → `launch` → 再 `launch` 须 `STATE=REUSED` → 一次性读页须**零残留且正文非空** → `close-tab` 须拒绝关到 0 个页面 → `close`）。

**能力的边界（不许越界宣称）**：`tools/check-preset.mjs` 是**逐行文本扫描器，不是 YAML 解析器**；它证明不了文件能被 YAML 解析，也证明不了插件真的挂载，**更完全不覆盖插件那一层**。`README.md` 与 `docs/evidence.md` 里的实测都带状态分层（源码级事实 / 检验 / 真机实测 / 未观测）——引用时必须保留该分层，**未观测的结论不许写成实测**。
