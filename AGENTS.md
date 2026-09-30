# AGENTS.md — adg-multi-agent

Adg 多智能体模式：一份 DSH agent preset（**一个调度智能体 + 九个专家智能体**，其中第 9 个 `agent_general` 是交接专用的**叶子**），外加一个浏览器工具链（有头 Chrome 启动器 + 最小 CDP 驱动）、一个「给 Adg 加一个智能体」的用户技能、一个静态自检脚本与一个把 preset 源文件生成成 bundle 的构建脚本、两个安装脚本。本文只做路由，不做百科——细节一律下沉到按需文档。

人向手册与全部实测依据：`README.md`（**改任何东西之前先读它对应的小节**）。

## 命令

零运行时依赖；只要求 Node（`browser/package.json` 声明 `>= 22`；本机实测 Node v26.9.0）。仓库根没有 `package.json`、没有 monorepo 构建、没有 lint 配置。

```sh
# preset 静态自检（零依赖，逐行文本扫描；exit 0 通过 / 1 有 ERROR / 2 读不到目标文件）
node tools/check-preset.mjs
# 注意：**没有"已安装的那一份文本"可以传路径了** —— 旧机制（$DSH_HOME/.agent-presets/<id>/）在
# dsh 0.1.7-rc.2 已被移除，仓库里的 preset/agent.cordis.yml 就是唯一真相源。

# 生成 preset bundle（构建产物，落在 .gitignore 忽略的 bundle/adg-<味道>/；install.* 每次都会按探测结果重跑它）
# 不带旗标 = plain；不传位置参数时才落到缺省出海目录 bundle/adg-preset/（install.* 每次都显式传位置参数）
node tools/gen-preset-bundle.mjs
node tools/gen-preset-bundle.mjs --with-billion-context   # 目标 profile 装了 billion-context 才用：给 9 个专家的 toolFilter.allow 追加它的 4 个上下文工具，并给 compaction-basic 注入 config.auto=false（红线 10）
node tools/gen-preset-bundle.mjs --with-save-token        # 目标 profile 装了 dsh-plugin-save-token 才用：追加 save_token_expand（红线 10）
# 两个旗标可叠加（叠加后就是味道 bili+save-token）。口径是"装了什么才注入什么"：安装脚本先探测、再决定传哪些旗标。
# 味道键 / 稳定目录名 / 注入清单**只有一份**，写在 tools/flavors.mjs，别在别处拼这些字符串。

# 生成物自检：check-preset 读的是**源文件**（专家行在第 4 列），产物里它们在第 14 列 —— 产物是它的盲区，
# 所以"注入没生效 / 注错方向 / 自动压缩没关掉"必须靠这个脚本钉住。它自己探测缩进，**四种味道都要验**：
node tools/gen-preset-bundle.mjs bundle/adg-plain && node tools/check-bundle-flavor.mjs bundle/adg-plain/cordis.patch.yml plain
node tools/gen-preset-bundle.mjs --with-billion-context bundle/adg-bili && node tools/check-bundle-flavor.mjs bundle/adg-bili/cordis.patch.yml bili
node tools/gen-preset-bundle.mjs --with-save-token bundle/adg-save-token && node tools/check-bundle-flavor.mjs bundle/adg-save-token/cordis.patch.yml save-token
node tools/gen-preset-bundle.mjs --with-billion-context --with-save-token bundle/adg-bili-save-token && node tools/check-bundle-flavor.mjs bundle/adg-bili-save-token/cordis.patch.yml bili+save-token

# 探测与味道映射：判据只决定该 profile 拿哪份生成物；别在别处重写这份判定
node tools/has-bundle.mjs ~/.dsh/profiles web               # → 每 profile 一行 `web<TAB>1|0`，退出码恒 0（缺省探测 billion-context）
node tools/has-bundle.mjs ~/.dsh/profiles web --package=dsh-plugin-save-token    # 同一个 profile 换一组问
node tools/resolve-flavor.mjs --billion-context --save-token   # → `<味道键>\t<稳定目录名>\t<gen 旗标>`，安装脚本据此选生成物

# 浏览器工具链的单元测试（零依赖、不需要浏览器）
cd browser && node --test test
cd browser && node --test --test-isolation=none test                       # 沙箱里同样必须加这个 flag

# 安装到本机 dsh 用户根（技能 + preset bundle + browser 工具链；挂载行由包自己带，不再手贴）
sh install.sh                                                              # macOS / Linux
sh install.sh --billion-context=on web                                     # 只给这个 profile 用 bili 注入版（见红线 10）
powershell -ExecutionPolicy Bypass -File .\install.ps1                     # Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BillionContext on -Profiles web
# preset 现在是一个 bundle：脚本生成 / 拷贝到它的**四个稳定目录**（$DSH_HOME/bundles/ 下的
# dsh-adg-preset = plain、-bili、-save-token、-bili-save-token）
# → 按探测到的注入组选一份 link 进去 → 把包名写进该 profile 的 dsh.profile.bundles（光有依赖不算选中）。
# dsh 正在运行时 pnpm 会因文件被占用而失败（脚本会如实报告并继续）—— 要真正装/换依赖先关掉 dsh。
# 两个脚本都先**逐个注入组**探测（tools/has-bundle.mjs，一个组问一次）：装着才把那一组的全局层工具名注进专家 allow，
# 没装就不注入。auto 模式下**逐个 profile**决定它拿哪份味道（`--<组>=on|off` 才整体覆盖），装完用
# tools/check-bundle-flavor.mjs 断言那一份的味道（见红线 10）。
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
9. **`browser/` 工具链的边界**：禁止引入第三方依赖（`playwright` / `puppeteer` / `ws`）；禁止把 profile 放进会话工作区、或写死任何本机绝对路径；禁止代填账号密码、读取 profile 的 cookie 库、验证码识别与指纹伪装。来源与不变量见 `browser/design.md`（I1 / I6）与 `browser/AGENTS.md`「模块特有红线」。
10. **构建期注入组的名字只能由构建期注入，禁止手写进 `preset/agent.cordis.yml`。** 目前有两组（清单**只有一份**，写在 `tools/flavors.mjs` 的 `INJECTION_GROUPS`）：billion-context 的 `compress` / `decompress` / `search_context` / `acp_status`（同属该插件的 `acp_cache` 故意不注入），以及 save-token 的 `save_token_expand`。它们不属于本组合，是那两个 DSH 插件注册在**全局层**的工具（实测：子代理的工具目录里它们是裸名、没有 `mcp__` 前缀，所以 `restrict()` 接受）。两侧后果都不轻：**不给** —— 那两个插件的指令与通知只看自己的 config、不看这个请求有没有那些工具（bili 的 `billion-context/src/server.ts:3427` 系统段与 L3447 nudge 都没有 pluginMode 护栏；save-token 在工具结果**进入历史的那一刻**把大输出换成 `[save-token #id] …` 通知，通知正文直接点名 `Call the save_token_expand tool with id "…"`，见 `dsh-plugin-save-token/lib/index.js:487`），而被委派的专家确实收得到这种通知（`tools/post-execute` 只跳过 `exec.parent !== undefined` 的 PTC / `run_code` 子派发，普通子代理委派不设它），于是专家收到"去调某个工具"的指令却没有工具可调；**给了但目标 profile 没装那个插件** —— 名字不存在，撞红线 7，每一次委派当场抛 `names unknown global tool "compress"`。所以口径是"源文件中立、生成物按探测决定"：探测在 `tools/has-bundle.mjs <profilesDir> <profile...> [--package=<包名>]`（判据 = 包名在该 profile 的 `dsh.profile.bundles` 里 **且** 装上的那份包里真的有它的补丁文件 —— 文件名从该包自己的 `package.json` 的 `dsh.bundle.patch` 读，读不到才退回历史名 `dsh.bundle.patch.yml`），**装着哪个组才带哪个旗标**生成：`node tools/gen-preset-bundle.mjs --with-billion-context --with-save-token`（两个旗标可叠加；`tools/resolve-flavor.mjs` 负责把"装着哪几组"翻成味道键 / 稳定目录名 / gen 旗标）；`tools/check-preset.mjs` 会把源文件里手写的这些名字判成 **ERROR** 并指回对应的旗标（清单从 `tools/flavors.mjs` 推导，它不另抄一份）。生成物按**味道**分份，现在共**四种味道、四个稳定目录**：plain = `$DSH_HOME/bundles/dsh-adg-preset`、bili = `.../dsh-adg-preset-bili`、save-token = `.../dsh-adg-preset-save-token`、bili+save-token = `.../dsh-adg-preset-bili-save-token`（四份的 `package.json` 逐字节相同，只有 `cordis.patch.yml` 不同，**包名都是 `dsh-adg-preset`** ⇒ `dsh.profile.bundles` 那一行四种味道通用）；**目录名不要写死，以 `tools/flavors.mjs` 的 `dirNameFor(key)` 为准**（味道键里的 `+` 换成 `-`）。每个 profile 的 `node_modules/dsh-adg-preset` 只 `link:` 自己该拿的那一份；`auto` 下味道由**该 profile 自己的探测结果**决定（`--<组>=on` / `off` 才是整体覆盖，覆盖与探测不一致时脚本打黄字警告），装完由 `install.*` 的第 4b-1 步用 `tools/check-bundle-flavor.mjs` 断言**已链接的那一份**的味道（判据不能是"包在不在"——四种味道的 `package.json` 逐字节相同）。旧口径"生成物全机共用一份，所以 auto 只在"每个目标 profile 都挂着"时才注入"**已推翻**：混装机器（例如本机 `desktop` 没挂、`web` 挂）上它会**连挂着的那个 profile 也一起装 plain**，于是那些 profile 的专家收得到 bili 的压缩指令、`allow` 里却没有工具，一调就报 `unknown tool compress`（2026-09-28 用户报告的真实缺陷，证据见 `docs/evidence.md` §11）。**billion-context 组激活时还要关掉 preset realm 里的自动压缩**：给 `compaction` 组那行 `compaction-basic` 注入 `config: {auto: false}`，与 bili 自己的 `dsh.bundle.patch.yml`（`- id: compaction-basic` / `config: {auto: false}`）**同键同值** —— 那份官方补丁打在 **profile 层**，而本 preset 的 compaction 三行活在 `isolate: {compaction: true}` 的 realm 里、是另一份实例，跨 lane 的 id 命中与否从未被观测，所以生成物直接写进 preset 自己的组里（两边都生效也无行为差异）。`auto: false` 的语义是「关掉自动压缩与溢出恢复，手动 `/compact` 仍可用」（`@deepseek-ai/dsh-compaction-basic` README 的 `auto` 行；`lib/index.js:827` 用 `if (this.config.auto)` 决定注册不注册那两个 listener），**不是**整行 `disabled`。`auto` 和那些注入名字一样**禁止手写进源文件**（`tools/check-preset.mjs` 判 ERROR）：没挂 bili 的 profile 里，dsh 自带的自动压缩是**唯一**的压缩手段，写死 `false` 等于让那些 profile 的上下文无限增长；billion-context 组未激活的味道里，产物出现这个键同样是 ERROR（`tools/check-bundle-flavor.mjs`）。**save-token 组与体积旋钮的职责划分（红线 3 的同一口径）**：save-token 的入历史改写与内置 `tool-result-pruner` 动的是**同一格**（工具结果进历史的那一刻），两个都开等于在已经缩过的文本上再裁一道 —— 但那三个体积旋钮（`compaction-basic` / `tool-result-pruner` / `tool-web`）归**插件出厂默认值**管，preset 不去关那一行；要不要把 pruner 行 `disabled` 是**宿主 profile 自己**的决定，生成物不管这件事。

## 生效方式（口径不同，别承诺错）

| 改了什么 | 怎么生效 | 怎么复核 |
|---|---|---|
| `preset/` 任何文件（含增删专家） | 先重跑 `tools/gen-preset-bundle.mjs` 并重装 bundle（`install.*` 会自动做），再**重启 dsh**，然后在**新对话**里选「Adg 多智能体模式」 | 重启后按 `README.md`「给 AI 的安装指令」第 6 步做真实挂载校验。**不要**再去 `.agent-presets/` 找那第二份文件——它已经不存在了 |
| 只切换注入组 / 味道（同一份源文件分**四种味道、四个稳定落点**，见红线 10） | 重新生成 + 重装 bundle（`install.*` 在 `auto` 下**按每个 profile 自己的探测结果**选味道，`--<组>=on` / `off` 整体覆盖）+ **重启 dsh** + 新会话 | 先确认该 profile 的 `node_modules/dsh-adg-preset` 链接的是哪一份稳定目录（`dsh-adg-preset` = plain / `dsh-adg-preset-bili` / `dsh-adg-preset-save-token` / `dsh-adg-preset-bili-save-token`），再看**那一份** `cordis.patch.yml`：每个专家行末尾有没有该味道该有的名字、`compaction-basic` 行有没有 `config: {auto: false}`（`tools/check-bundle-flavor.mjs <那份文件> plain\|bili\|save-token\|bili+save-token` 一次断言两件事 —— `install.*` 第 4b-1 步已经这么断言）；再在新会话里委派任一专家，让它报工具目录里看得见 `compress` / `acp_status`（装了 save-token 的还该看得见 `save_token_expand`） |
| composition 里写的 `@deepseek-ai/*` 包名 | 包名会随 dsh 升级**改名**，改完必须真实挂载 | `resolve('adg')` 的 `.broken` 为空；用旧名会报 `… never started`（2026-09-28 实录：`dsh-workflow-worker-thread` → `dsh-workflow-ptc`） |
| `browser/` 任何文件 | **重新跑一次 `install.*` 即生效，不用重启**——它是用户根下的普通文件，不是 preset 也不是插件 | `node "${DSH_HOME:-~/.dsh}/browser/cli.mjs" profile` |


## Project Map

| 模块 | 一句话职责 | 规则见 |
|---|---|---|
| `preset/` | Adg preset 的定义：调度 persona（名册 + 分派规则）与 9 个专家行（第 9 行 `agent-general` 是交接专用叶子）；`preset.yml` / `agent.cordis.yml` / `bundle.package.json` 是 **bundle 的源**（由 `tools/gen-preset-bundle.mjs` 生成、装进 profile 的 `dsh.profile.bundles`） | `preset/AGENTS.md` |
| `tools/` | `check-preset.mjs`（preset 的零依赖静态校验器，**不是 YAML 解析器**）+ `gen-preset-bundle.mjs`（从 `preset/` 源文件生成 bundle 的构建脚本，**产物不许手改**） | `tools/AGENTS.md` |
| `browser/` | 有头 Chrome 启动器 + 最小 CDP 驱动（零依赖，唯一入口 `cli.mjs`） | `browser/AGENTS.md` |

不在模块地图里、也不需要模块 `AGENTS.md` 的（三样信号都没有，建了就是噪音）：`skills/adg-add-agent/SKILL.md`（用户技能文档，位于 `${DSH_HOME:-~/.dsh}/skills/`，无独立命令）、`install.ps1` / `install.sh`（部署脚本，无模块红线）、仓库根 `README.md`。`docs/` 是文档层而非模块：`docs/evidence.md`（实测证据台账 / 未观测清单）、`docs/docs-guide.md`（写作规范与文档分层契约）、`docs/registry.md`（索引与冷启动三问的答题路径）。

**新模块登记义务**：新建模块时在本表与 `docs/registry.md` 各加一行，缺登记即文档体系不完整。

## Context Loading（按你手上的改动读）

| 你要做什么 | 先读 | 再读 |
|---|---|---|
| 新增 / 修改 / 删除一个专家智能体 | `preset/AGENTS.md` | `skills/adg-add-agent/SKILL.md` → `preset/design.md` → 改完 `node tools/check-preset.mjs` |
| 改调度 persona 的名册或分派规则 | `preset/design.md` | `preset/testing-guide.md`（名册与专家行的双向一致性约束）；改**编排层规则**（I13 / I14，含必要性闸门与挂号）或**输出纪律**（I15）再读 `README.md`「多智能体的 token 消耗：已落地与可选手段」 |
| 改 `check-preset.mjs` 的判错口径，或改 composition 的 tool 行 | `tools/design.md` | `preset/design.md`（体积旋钮与 `allow` 的约束） |
| 改浏览器工具链（`cli.mjs` 契约 / `launch` / `close` / 驱动层） | `browser/AGENTS.md` → `browser/design.md` | `browser/testing-guide.md`；动 `launch` / `close` 的默认行为再读 `preset/design.md` I11 / I12 |
| 改 `agent_browser` 的 persona（浏览器那一段） | `preset/design.md` I11 / I12 → `browser/AGENTS.md`（它消费的命令行契约） | 根 `README.md`「浏览器工具链与登录态资产」→ `docs/evidence.md` §8 → 改完 `node tools/check-preset.mjs` |
| 想知道某个数字/结论"量过没有" | `docs/evidence.md` | `README.md` 对应小节（`README.md` 是实测原始依据） |
| 只是想装到本机 | `README.md`「安装」 | `install.sh` / `install.ps1` |
| 搞不清文档体系的写法与分层 | `docs/docs-guide.md` | `docs/registry.md`（索引与冷启动三问的答题路径） |

## Quality Gates

1. `node tools/check-preset.mjs` → **exit 0**（允许 WARN；WARN 不是失败，ERROR 的含义只有一个：**这次委派必然抛错**）。本仓库当前实测：**0 错误 / 2 警告**（`agent-file` 与 `agent-general` 的 `read_image` 是条件性注册；2026-09-28 加第 9 个专家之前是 0 / 1）。
1b. **改了 `tools/gen-preset-bundle.mjs`、`tools/flavors.mjs` 或 `preset/agent.cordis.yml` → 四种味道的产物都要生成、并各自通过自检**（红线 10）：plain / bili / save-token / bili+save-token 各一条（`node tools/gen-preset-bundle.mjs [--with-billion-context] [--with-save-token] bundle/adg-<味道> && node tools/check-bundle-flavor.mjs bundle/adg-<味道>/cordis.patch.yml <味道键>`，完整四条见「命令」章），四条都必须 **exit 0**。`check-preset.mjs` 读的是源文件（专家行在第 4 列），产物里它们在第 14 列 —— **产物是它的盲区**，只跑 plain 那一条证明不了注入有没有生效。本仓库实测（四份生成物都是 18 个顶层子插件条目 / 9 个专家行）：plain 95631 B = 9 行全 `NONE`（`10/7/7/10/2/5/9/7/16`）+ `compaction-basic[auto=未写]`；bili 97640 B = 9 行全 `billion-context:ALL`（`14/11/11/14/6/9/13/11/20`，每行正好 +4）+ `auto=false`；save-token 97112 B = 9 行全 `save-token:ALL`（`11/8/8/11/3/6/10/8/17`，每行 +1）+ `auto=未写`；bili+save-token 99121 B = 9 行全 `billion-context:ALL save-token:ALL`（`15/12/12/15/7/10/14/12/21`，每行 +5）+ `auto=false`。（四份字节数是 2026-09-30 移除那段 persona 末行后重测的现值；再改 `preset/agent.cordis.yml` 的正文就会变，它是读数不是判据。）交叉断言两个方向都 exit 1（拿 bili 产物按 plain 断、拿 plain 产物按 bili 断，各报 10 个错误，其中一条正是 `config.auto` 的方向错 —— `味道 plain 不该有 config.auto（没挂 bili 时它是唯一的压缩手段），实际 auto: false`），所以这个门**不会假绿**。源文件侧的**反向**守卫另测一次：往 `preset/agent.cordis.yml` 的 `compaction-basic` 行临时插 `config: {auto: false}` ⇒ `check-preset.mjs` exit 1（报「构建期注入的键」）且 `gen-preset-bundle.mjs --with-billion-context` 也 exit 1（拒绝叠加第二份 config）；还原后 exit 0。手写注入名字同样被拦：写 `save_token_expand` ⇒ ERROR 提示 `用 node tools/gen-preset-bundle.mjs --with-save-token 生成`，写 `acp_cache` ⇒ 提示 `改 tools/flavors.mjs 里 billion-context 组的 tools`（清单从 `tools/flavors.mjs` 推导，不在 `check-preset.mjs` 里另抄）。
2. 改了 preset → 按 `README.md`「给 AI 的安装指令」第 6 步做**真实挂载**（静态自检证明不了挂载）。
3. 交付前逐条对照 `docs/docs-guide.md` 的写作规范与附件规范的「质量红线清单」。
4. 引用任何实测数字前先读 `docs/evidence.md` 的**未观测清单**与各节的**状态分层**：人向手册里若干"未观测"条目的**依据**可能已被本机日志更新，处置权在人类 —— 但**未观测的结论不许写成实测**，也不许把"日志证明的机制"读成"那一件事本身已被观测"（例：`subagent/end` 对"结束"与"被恢复"发同一事件，所以"某个子代理是被恢复的"无从判定）。
5. `cd browser && node --test test` → 全绿（本仓库实测 **36 个用例全通过**，不需要浏览器）。改了 `browser/` 之后还要跑一次真机闭环（`browser/testing-guide.md` 第 5 节：`profile` → `launch` → 再 `launch` 须 `STATE=REUSED` → 一次性读页须**零残留且正文非空** → `close-tab` 须拒绝关到 0 个页面 → `close`）。

**能力的边界（不许越界宣称）**：`tools/check-preset.mjs` 是**逐行文本扫描器，不是 YAML 解析器**；它证明不了文件能被 YAML 解析，也证明不了 preset 真的挂载。`README.md` 与 `docs/evidence.md` 里的实测都带状态分层（源码级事实 / 检验 / 真机实测 / 未观测）——引用时必须保留该分层，**未观测的结论不许写成实测**。
