---
title: 变更记录
owner: Adg preset 维护者
status: current
last_reviewed: 2026-10-02
---

# 变更记录

一行一条，时间倒序，**只记"变了什么"**。为什么记在不变量旁的注释里就地说明（见 `docs/docs-guide.md` 第 1 节的分层契约）；决策过程不进 git。

## 2026-10-02（最新）— 技能面：新规则 18「技能递路径、专家自己 read」，6 处旧口径同步

- 依据（用户要求，本轮裁定）：技能面仍只归调度者（`skill` 只留给 `agent_general`，本次**不放开任何专家的 `allow`**）；要用技能的工作照常委派，但调度者在委派 prompt 里**只给技能的绝对路径 ＋「先 read 该文件再动手」**，不内联、不复述技能正文。例外仅三种：①只需其中一小节→**原文照贴**、不许改写；②目标专家读不了文件（`agent_search`）→只能内联；③技能步骤须与本次任务的已知事实交织改写。
- 理由（写进规则本行）：专家上下文一次任务即弃、调度者上下文是整个会话，长程序化手册该落在可抛弃的那个上下文里；内联＝常驻＋每步重发＋挤占压缩预算，递路径≈+30 token/委派，且专家读的是源头活文件、不陈旧。失败模式点名：专家不读就动手（故 prompt 必须写死先 read）；技能改名是破坏性变更、会静默失效。
- `preset/agent.cordis.yml`：**新增规则 18**（技能递路径，文本如上）；**本轮把上一轮的错误编号扶正** —— 上一轮曾占用 17、把原来的规则 17 顶成 18，那会让全仓 6 处「规则 17」交叉引用（都指 `agent_general` 交接闸门）全部指错；现第 17 条恢复为 `agent_general` 交接闸门（内容一字未动）、新规则作为第 18 条追加其后。顶注第 15 条技能面口径追加递路径那段并自引用改「见规则 18」。
- `preset/design.md`：非功能红线「技能面口径」那条把「要用技能的工作留在调度者手上」改成「由调度者自己做、或按 I16 派 `agent_general`；若委派给别的专家，只在委派 prompt 里给技能的绝对路径＋先 read，不内联不复述」，例外指向调度规则 18；front matter `last_reviewed` 2026-10-01 → **2026-10-02**。
- `preset/AGENTS.md`：技能面红线同步递路径口径与三种例外（判据仍是 `tools/check-preset.mjs` 对该情形给 WARN）。
- `tools/check-preset.mjs`：头部注释 5b 与 warn 前的注脚注释同步递路径口径；**WARN 模板串本身**由「让调度者把技能内容写进委派 prompt」改成「把技能**绝对路径**写进委派 prompt 并要它先 read（只有读不了文件的 agent_search 才内联）」（模板串是反引号字符串，里面不能再嵌反引号）。
- `skills/adg-add-agent/SKILL.md`：技能面硬约束那条同步同样口径（该文件是硬换行散文，按原宽度改）。
- `preset/testing-guide.md`：新增一条 R1 核对项（人工 review：规则 18 在位、第 17 条仍是交接闸门、6 处既有「规则 17」引用仍指交接闸门、三种例外齐全），front matter `last_reviewed` 2026-10-01 → **2026-10-02**。
- 坐标刷新（因 `preset/agent.cordis.yml` +4 行、警告行号整体后移 4）：`preset/testing-guide.md` 的实测基线段（526 / 575 / 715 → **530 / 579 / 719**）与 `docs/evidence.md` §15 反向守卫段的三条警告坐标；两处都留着旧值作对照，不改任何结论与退出码。
- 检验：`node tools/check-preset.mjs` **exit 0（0 错误 / 3 警告**，三条都是条件性注册的 `read_image`：第 530 行 `agent-file`、第 579 行 `agent-browser`、第 719 行 `agent-general` —— `preset/agent.cordis.yml` 820 → **824 行**，警告坐标比上一轮记的 526 / 575 / 715 整体 +4，已同步 `preset/testing-guide.md` 的基线段与 `docs/evidence.md` §15 的反向守卫段）；四味道生成 + 四条 `node tools/check-bundle-flavor.mjs` **全 exit 0**；6 处既有「规则 17」引用 grep 复核全未动、全仓无「把 `agent_general` 说成规则 18」处；旧口径措辞仅剩本文件的历史条目。
- 未观测：**重启 dsh 后的真实挂载本轮没做**（改了 `preset/` 要重启 dsh 才对**新会话**生效），也没有在新会话里做一次真实委派验收"专家收到路径后会不会先 read"。

## 2026-10-01 — 名册 9 → 8：`agent_app` 并入 `agent_computer`，浏览器 / 审查专家的工具面各补一件，技能面收紧到只剩 general

- 依据（用户要求，本轮裁定）：合并 `agent_app` + `agent_computer`、给 `agent_reviewer` 加 `web_search` / `web_fetch`、给 `agent_browser` 加 `read_image` 三项**采纳**；**不做按专家的 token 用量账**（原话要点「每个任务都不一样」）；`browser` 的 `edit` **保留**（脚本出错还要就地改）；人工介入协议在专家 persona 里**保留**、不算冗余（调度 persona 里那份主要是让用户设完全权限）；技能面**二选一**里选「除 `agent_general` 外所有专家都不许用 skill」（原话「以后每加一个专家都要维护一遍仓库吗？」）。
- `preset/agent.cordis.yml`：删掉 `- id: agent-app` 整行；`agent-computer` 的 persona 改成「系统与应用运维专员」双线（① 系统 / 设备层 ② 应用层，含 winget / adb / 小程序），安全要求追加「卸载软件」；调度 persona 的名册由 9 项改 8 项（`agent_computer` 合并描述），规则 4 补「需要跑 `git` / 测试命令的只读核对（`git log -S` / `git blame` / `node --test` 等）→ `agent_reviewer`（它带 pwsh 且只报告不改；researcher 没有 pwsh）」；顶注新增第 15 条（名册 9→8、三处工具面调整、技能面口径）。
- `agent-browser` 的 `allow` 加 `read_image`（persona 加一行「截图核验：`shot --out <png>` 拍下的图用 `read_image` 自己看」），**`edit` 保留**；`agent-reviewer` 的 `allow` 加 `web_search` / `web_fetch`（职责行补只读核对、输出要求补「上游 API / 规范 / 版本这类可查证的事用 web_search / web_fetch 去核」）。
- 技能面口径（用户二选一里的第二项）：`skill` 只留给 `agent_general`，其余专家一律不给 —— 理由写进 `preset/agent.cordis.yml` 顶注第 15 条、`preset/design.md` 与 `preset/AGENTS.md` 的红线：`toolFilter` 只有 allow / deny、preset 侧没有"给所有子代理默认加工具"的开关，逐行写 allow 就是"每加一个专家都要维护一遍仓库"。
- `tools/check-preset.mjs`：新增**提示级**守卫 —— 除 `agent_general` 外 `allow` 里出现 `skill` 即 **WARN**（不是 ERROR；ERROR 只留"这次委派必然抛错"的情形）。
- 名册与计数同步：`preset/preset.yml` description、`preset/bundle.package.json` description、`preset/design.md`（ExpertRow「当前 8 行」+ I16「第 8 个专家行」+ 非功能红线新增技能面一条，含源码依据 `@deepseek-ai/dsh-tool-subagent/lib/index.js:265` 解析、`:370` 要求 allow / deny 至少其一）、`preset/AGENTS.md`（8 行 + 技能面红线）、`README.md`（顶部九个→八个、名册表与分派表合并 `agent_computer` 行、token 账「9 份重复的后台委派提示段」→8 份、目录树与生成描述 9→8）、`skills/adg-add-agent/SKILL.md`（名册 8 行 + 技能面硬约束）、`docs/registry.md`（「八个专家的分工与缺口」）、`install.ps1` / `install.sh`（note 文案与注释里的「9 个专家」→「8 个专家」）。
- 四种味道产物随名册与 persona 变化：`plain` 96120 → **97787**、`bili` 98129 → **99654**、`save-token` 97601 → **99226**、`bili+save-token` 99610 → **101093** B；**这一次数值形状也变了** —— 专家 `allow` 计数由 9 位变 8 位（`agent_app` 位消失、`agent-browser` +1），报告行 10 → 9。
- 文档数字刷新：`tools/testing-guide.md`（用例判据行）、`tools/AGENTS.md`（专家行数、`check-bundle-flavor.mjs` 退出码段）、`docs/evidence.md`（§10.1 第 5/6 条加口径注、§15 的表头 / 四行读数 / 复测链 / 生成器 stdout / 负例条数 / 警告行号）、根 `AGENTS.md`（质量门 1b 与第 1 条；交叉断言 10 → **9** 个错误）、`preset/testing-guide.md`（基线 0 错误 / 2 警告 → **0 错误 / 3 警告**）、`README.md`（第 6 步挂载判据 9 条专家行→8 条、模块名 11 次→**10 次**）。带日期的历史条目（`docs/changelog.md` 旧条目、`docs/evidence.md` §11、`preset/agent.cordis.yml` 顶注里那两笔 2026-09-30 台账、`README.md` 的 2026-09-28 实测段）一律**保留原值**、就地加口径注。
- 检验：`node tools/check-preset.mjs` **exit 0（0 错误 / 3 警告** —— 三处条件性注册的 `read_image`：第 526 行 `agent-file`、第 575 行 `agent-browser`、第 715 行 `agent-general`）；四味道生成 + 四条 `node tools/check-bundle-flavor.mjs` **全 exit 0**；负例两个方向 exit 1（**9 / 8** 个错误）、未知味道键 exit 2；源文件侧探针手写 `save_token_expand` ⇒ exit 1（`不通过：1 个错误，3 个警告`）；`cd browser && node --test test` **37/37**；`install.ps1` 前三个字节 `EF BB BF`（编辑工具会抹掉它，本轮已复原并复核）。
- 未观测：**重启 dsh 后的真实挂载本轮没做** —— 第 6 步的 `compositionInventory()` 行数（按算术应为 34 行 / 31 行启用 / 3 行关闭、`@deepseek-ai/dsh-tool-subagent` 10 次）以及对新专家行的真实委派（`read_image` / `web_search` / `web_fetch` 是否真在子代理可见目录里）都没有证据。

## 2026-10-01 — 浏览器工具链支持 Brave：候选次序改为 Chrome → Brave → Edge

- `browser/lib/target.mjs`：`chromeCandidates` 的 win32 / darwin / linux 三处候选各**新增 Brave**（win32 `BraveSoftware\Brave-Browser\Application\brave.exe`；darwin `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`；linux `/usr/bin/brave-browser`、`/usr/bin/brave-browser-stable`、`/opt/brave.com/brave/brave-browser`），次序固定为 **Chrome → Brave → Edge**（`ADG_CHROME` 仍排第一）；函数名与 `CHROME=` 输出键不变。
- `browser/test/browser.test.mjs`：36 → **37 个用例**。A20 扩为断言 Chrome / Brave / Edge 三种候选形状齐全、且 Brave 的位次在 Edge 之前；新增 A20b（只有 Brave 与 Edge 时选中 Brave）。
- `browser/AGENTS.md` / `browser/design.md` / `browser/testing-guide.md` / `browser/package.json` / 根 `AGENTS.md` / `README.md` / `docs/registry.md`：Chrome 措辞改为 Chromium 系浏览器（Chrome / Brave / Edge）；用例数 36 → 37；`profile` 那一行改称「浏览器可执行文件」；`browser/design.md`「非功能红线」新增一条（候选次序 + 不写死本机路径，判据 A20 / A20b），该节条数 6 → 7。
- `preset/agent.cordis.yml:591` 的 `agent-browser` persona：「确认工具与 Chrome 都在」改成「确认工具与浏览器都在」；降级条件由「没有可用 Chrome」改成「探测不到任何可用浏览器（`profile` 报不出 `CHROME=`、`launch` 报 `CHROME_NOT_FOUND`）」；新增「本机没有 Chrome 不算故障」（`CHROME=` 报 Brave / Edge 都照样 `launch`）；Brave 的受限令牌失败签名标注为**未观测**。
- 四种味道产物随 persona 变大：`plain` 95631 → **96120**、`bili` 97640 → **98129**、`save-token` 97112 → **97601**、`bili+save-token` 99121 → **99610** B（每份 +489）；`allow` 计数、报告行与断言行不变。
- `docs/evidence.md` §8：新增「Brave 支持与真机闭环（2026-10-01）」一节（`profile` / `launch` / `REUSED` / 同 URL 与异 URL 两次 `text` / `close-tab` 护栏 / 点名清理 / `close` 的逐条读数），§8 的单元测试读数 36/36 → 37/37；未观测清单新增一条 **Brave 在受限令牌下的失败签名未观测**（含量法）。§15 四份生成物字节数复测刷新。
- `README.md`：「浏览器专家需要完全权限」与 2026-09-26 A/B 那两处补上 Brave 未实测的边界注；目录树里 `lib/target.mjs` 一行写明候选次序、`test/browser.test.mjs` 一行 36 → 37、`profile` 那行改称浏览器可执行文件。

## 2026-09-30 — 移除 host-plane 的会话提醒插件：仓库、环境、文档、证据一并清除

- 依据（用户要求，原话）：「根据你提供的信息，我判断这个插件其实作用不大，把该插件从当前DSH环境中移除，并且从adg-multi-agent仓库里移除，提交推送。」；清理口径（用户选择）：**彻底清除所有提及** —— 连 `docs/changelog.md` 里记过它的历史条目、`docs/evidence.md` 里量过它的实测读数一并删除（**本行是该组件唯一的残留记录**，且只用通用描述、不写它的包名与代码字面量）。
- 仓库：`plugin/` 下的插件模块（13 个文件）与产物 `bundle/dist/*.tgz` 整体删除，`plugin/` 目录随之消失 —— 仓库里不再有任何插件模块。
- `install.ps1` / `install.sh`：删掉插件拷贝段、插件落点变量、插件注册行与残留挂载行检测（原第 4c 节）、旧落点清理（原第 5 节）及其输出行；preset bundle 链路（四种味道探测 → 生成 → 稳定落点 → 写进该 profile 的 `dsh.profile.bundles` → 技能安装）与步骤顺序未变。
- `preset/agent.cordis.yml`：九个专家 persona 里的提醒纪律行、顶注与中段的相关注释一并删；顶注实质改动计数 **16 → 15 处**、文件 **849 → 820 行**（`git diff --numstat` = +26 / −55）。体量（正文行、含行首缩进、不含换行）：九个专家 persona 合计 **8140 → 7510 字符**（−630，即九行提醒纪律，每行 70 字符），调度 persona `prefix` 正文 **8005 未动**，两处合计 **16145 → 15515 字符**；顶注里压缩条目的"两处合计"从混入被删组件的旧账 `18396 → 16309` 重算为 **18022 → 15954**（与 `README.md` 和上一条条目一致）。
- `docs/evidence.md`：**22 节 → 15 节**（删掉"步数分布与阶梯校准""已移除的 token 两档""两个容易误判的观测口径""本机的惰性旧键""活证据复核快照""会话格式事故""插件挂载行手贴→bundle"七节），节号整体前移（**2→1、3→2、5→3、8→4、10→5、11→6、12→7、13→8、14→9、17→10、18→11、19→12、20→13、21→14、22→15**，子节跟随）；文件 **1096 行 / 148121 B → 636 行 / 96086 B**；全仓 **11 个文件共 112 处** § 引用按该映射同步重编号。
- 生成物与文档里的字节数：四份 `cordis.patch.yml` 随源文件变小（`plain` 99623 → **95631**、`bili` 101632 → **97640**、`save-token` 101104 → **97112**、`bili+save-token` 103113 → **99121** B；专家 `allow` 计数与报告行不变）⇒ 同步刷新 `docs/evidence.md` §15 的四行读数（旧值留在同节作对照）与 `tools/testing-guide.md` 的用例判据行。
- 其它文档：根 `AGENTS.md`（模块地图、生效方式表、质量门、红线）、`README.md`（"第二层"整节 19 个 h3 删除；「给 AI 的安装指令」删掉插件两步后**步骤重编号 7→5 / 8→6 / 9→7 / 10→8** ⇒ 真实挂载校验现在是**第 6 步**）、`browser/*`、`skills/adg-add-agent/SKILL.md`、`tools/*`、`preset/*`、`docs/registry.md`、`docs/docs-guide.md` 同步去引用；关键红线由 11 条变 **10 条**。
- 本机环境：`${DSH_HOME}/bundles/` 下的组件目录、`profiles/*/node_modules` 下的残留（含两个断链）与旧日志文件删除；`profiles/desktop|web/package.json` 删掉依赖行与 `dsh.profile.bundles` 条目（`headless` 本来就没有）⇒ **需重启 dsh 才生效**。
- 检验：`node tools/check-preset.mjs` **exit 0**（0 错误 / 2 警告，仍是 `agent-file` 与 `agent-general` 的条件性 `read_image`）；四味道 `node tools/gen-preset-bundle.mjs` + `node tools/check-bundle-flavor.mjs` **全 exit 0**；`cd browser && node --test --test-isolation=none test` **36/36**；按被删组件的整名与代码字面量全仓扫描 **0 命中**（本行除外）；被改文件的 BOM / 行尾与改动前逐一致（`install.ps1` 仍带 BOM）。
- 未观测：重启 dsh 后两个 profile 的真实挂载（`agentPresets.resolve('adg')` 的 `.broken` 为空 + `compositionInventory()`）本轮没做。

## 2026-09-30 — 构建期注入组扩成两组、四种味道：安装时先探测、装着才注入

- 依据（用户要求，原话）：「更正一下语言，安装时要先检查当前环境有没有安装对应插件，有的话才把对应的工具添加进去。」⇒ 口径定为**安装时逐个注入组探测该 profile 装了没有；装了才把那一组注册在全局层的工具名注进专家 `allow`，没装就不注入**。
- `tools/flavors.mjs`（新增）：构建期注入组的**单一事实来源** —— `INJECTION_GROUPS`（旗标 / 包名 / 注入的工具名 / `notInjected` / 是否关自动压缩）、`GROUP_ORDER`、味道键与稳定目录名的拼法、探测判据 `probeBundle`。两个组：`billion-context`（`compress` / `decompress` / `search_context` / `acp_status`，故意不注入 `acp_cache`，并给 `compaction-basic` 注入 `config.auto: false`）与 `save-token`（只有 `save_token_expand`，不碰任何旋钮）。其余脚本与文档一律从它推导。
- `tools/has-bundle.mjs`（新增，**取代已删除的 `tools/has-billion-context.mjs`**）：`node tools/has-bundle.mjs <profilesDir> <profile...> [--package=<包名>]`，每 profile 一行 `<name>\t<0|1>`，退出码恒 0；缺省包名 `billion-context`（历史默认值），save-token 组用 `--package=dsh-plugin-save-token` 再问一次。判据 = 包名在该 profile 的 `dsh.profile.bundles` 里 **且** 装上的那份包里真的有它的补丁文件 —— **补丁文件名从该包自己的 `package.json` 的 `dsh.bundle.patch` 读**（`billion-context` = `./dsh.bundle.patch.yml`、`dsh-plugin-save-token` = `./cordis.patch.yml`），读不到才退回历史名 `dsh.bundle.patch.yml`。
- `tools/resolve-flavor.mjs`（新增）：`node tools/resolve-flavor.mjs [--billion-context] [--save-token]` → 一行三列 TSV `<味道键>\t<稳定目录名>\t<gen 旗标>`，把"这个 profile 装着哪几组"翻成"该拿哪份生成物"；只做映射、**不做探测**（注意它的旗标是 `--<组>`，与生成的 `--with-*` 不是一套）。
- `tools/gen-preset-bundle.mjs`：接受两个可叠加旗标（`--with-billion-context` / `--with-save-token`）；只有 bili 组激活才给 `compaction-basic` 注入 `config.auto: false`，save-token 组只往 `allow` 加名字。
- `tools/check-bundle-flavor.mjs`：味道键从 `plain|bili` 扩成 `plain|bili|save-token|bili+save-token`，逐组断言"该在的组必须全有 / 不该在的组一个都不能有 / 该组 `notInjected`（`acp_cache`）出现即错"，并断言 `compaction-basic` 的 `auto` 只在 bili 味道恰好为 `false`（其余味道要求这个键不存在）。
- `tools/check-preset.mjs`：`BUILD_TIME_INJECTED_TOOLS` 改为从 `tools/flavors.mjs` **推导**（不再另抄一份名字清单）⇒ 手写 `save_token_expand` 也会被拦，报错直接指回对应旗标。
- 味道键 → 稳定目录：`plain` = `dsh-adg-preset`、`bili` = `dsh-adg-preset-bili`、`save-token` = `dsh-adg-preset-save-token`、`bili+save-token` = `dsh-adg-preset-bili-save-token`（四份 `package.json` 逐字节相同、包名都是 `dsh-adg-preset`）；目录名不写死，以 `flavors.mjs` 的 `dirNameFor(key)` 为准。
- 安装脚本按每个 profile 的探测结果选择味道（**只记口径，不记 `install.ps1` / `install.sh` 的实现细节** —— 那一层尚未定稿）。
- 文档同步：`docs/evidence.md` 新增 §15（机制表、四味道实测、两个方向的负例、源文件侧探针、"产物体积不是稳定判据"与本机 profile/链接现状），并改「证据来源」表两行（生成物自检扩成四味道；挂载判据改指 `tools/flavors.mjs` 的 `probeBundle` 与 `tools/has-bundle.mjs`）、§10 第 7 条补一句"该脚本已由 `has-bundle.mjs` 取代"的括注（原读数保留为历史）；`tools/testing-guide.md`（四味道生成 + 断言 + 三条负例 + 探针做法）；`preset/testing-guide.md`（I3c 与状态机表扩成四个稳定落点 + 构建期注入名怎么验证）；`docs/registry.md`。
- 检验：四份生成物 **99623 / 101632 / 101104 / 103113 B**（各 18 个顶层子插件条目、9 个专家行），四条 `node tools/check-bundle-flavor.mjs <那份文件> <味道键>` **全 exit 0**；负例两个方向 exit 1（10 个错误 / 9 个错误）、未知味道键 exit 2；`node tools/check-preset.mjs` **0 错误 / 2 警告**（第 528 / 742 行的条件性 `read_image`）；源文件侧探针手写 `save_token_expand` / `acp_cache` / `compress` 各 exit 1（报错逐字见 `docs/evidence.md` §15）；回归对照：旧 `bundle/adg-preset/cordis.patch.yml` 与新 `bundle/adg-bili/cordis.patch.yml` 的差异行**全是注释行**、正文行相同。
- 未观测：四种味道产物的**真实挂载**（重启 dsh + 新会话）本轮没做；专家收到 `[save-token #id]` 通知后是否真的去调 `save_token_expand` 未观测；`install.*` 的逐组探测与选味道实现未复核。

## 2026-09-30 — 用户复核：今天两处新增提示词按"只留判据"再精简（−121 字符）

- 依据（用户复核，原话）：「你前面那个子代理到输出上限的，以及这个新权限对新子代理生效的提示词，有必要这么长吗？」
- 规则 7 的识别信号片段 **218 → 143 字符（−75）**：删掉 `Background subagent <id>` 这截样板前缀（只留唯一的判据 `ran out of room before it finished.`）、子代理侧视角那句「已达到输出 token 上限，回答被截断，已有输出保留在对话中」（调度者看不到、也不需要），"被截断不等于被终止"→"被截断≠被终止"；**负面清单保留**（`finished…`／`failed…`／`declined…`／`was stopped…` 都不是截断），否则正常收尾会被误判成截断。现逐字：「你那边的信号是结算通知里的 `ran out of room before it finished.`（只有这一句是截断：`finished…`／`failed…`／`declined…`／`was stopped…` 都不是）—— 被截断≠被终止，**回一条继续消息它就能接着做**：」
- 规则 11 的捕获时刻片段 **154 → 108 字符（−46）**：删掉与括号里重复的"权限在委派那一刻就被钉进子代理自己的会话"，以及同一事实的第二遍复述"它自己也升不了权，你事后也改不了它"；判据、结论（必须新建委派）与顶注出处指针都留着。现逐字：「**新权限只对"切换之后新开的子代理"生效**（委派那一刻就定死了）：切换前已派出的那个**拿不到**，所以用户切完必须**新建委派** —— 把原先那个停掉、重派一个，别等原地那个突然能用（依据见顶注第 5 条）。」
- 口径：`#` 顶注与文档层放源码出处和逐字引用（顶注是 YAML 注释、**永不进入模型上下文**），persona 正文只留可执行判据 —— 本条的改动依据就是这条口径。
- 体量（正文行、含行首缩进、不含换行）：调度 persona `prefix` 正文 **8126 → 8005**（**−121 / −1.5%**，按 ~4 字符/token ≈ **−30 token/步**）；九个专家 persona **未动**。今天两轮对 persona 的净增因此回到 **7972 → 8005（+33）**。
- 检验：`node tools/check-preset.mjs` exit 0（0 错误 / 2 警告，仍在第 524 行 `agent-file` 与第 738 行 `agent-general`，即条件性注册的 `read_image`）；`bundle/adg-plain/cordis.patch.yml` **99463 → 99192 字节** + `check-bundle-flavor` plain exit 0；`bundle/adg-preset/cordis.patch.yml` **101487 → 101216 字节** + flavor bili exit 0；`browser` **36/36/0**；`install.ps1` 前三个字节 `EF BB BF`（30698 字节）；精简后的措辞两份产物各命中一次（plain 316/320 行、bili 323/327 行）。
- 未观测：精简后的措辞是否仍然让调度者稳定认出这句开场白（行为层；与上一轮同一项，本机 6 条 `max-tokens` 截断至今 **0 次**续写）。

## 2026-09-30 — 权限闸门补上**捕获时刻**：新权限只对"切换之后新开的子代理"生效

- 依据（用户要求，原话）：「在调度代理中，目前已有提示如果需要完全权限需要让用户切过去的提问，但还要明确提示新权限只能在新开的子代理中生效。」
- `preset/agent.cordis.yml` 规则 11 末尾追加一句（既有判定、三选项、分支与 `ask_user_question` 动作**一字未动**）：「**新权限只对"切换之后新开的子代理"生效**：权限在**委派那一刻**就被钉进子代理自己的会话 —— 切换前已派出的那个**拿不到**新权限，它自己也升不了权，你事后也改不了它。所以用户切完之后必须**新建委派**：浏览器任务就是把原先那个停掉、重派一个，别等原地那个突然能用（源码依据见顶注第 5 条）。」顶注第 5 条同步补 4 行出处（2026-09-30 补记）。（这一句的逐字措辞已在同日"用户复核"条里按"只留判据"再精简，**以该条为准**。）
- 机制（源码级事实；`docs/evidence.md` §6 的「与本节相关的源码级事实」块新增**第四问**）：`captureDelegatedPolicyOverrides()`（`@deepseek-ai/dsh-subagent/lib/index.js:524-541`）在子代理**首次 await 之前**同步取当时的父会话状态，并在子会话尚未发布的窗口里把它写成 `source: 'delegation'` 的三条子会话事件（`:552-562` 的 `appendDelegatedPolicyOverrides()`：`sandbox/mode` / `approval/policy` / `permission/preset`）；该函数注释逐字为 `a later parent switch belongs to the parent's future, not to this child` ⇒ 父级之后切换权限**改变不了已经在跑的子代理**，要让它用上新权限只能**新建委派**。README 那节的"三问三答"因此扩成**四问四答**（标题、表格新增一行、唯一路径那段末句、处置第 1 条各补一句）。
- 文档同步：`preset/design.md` I11（末尾标 **2026-09-30 扩（用户要求）**：调度 persona 那半还必须写明这条，缺这句＝I11 的那半不完整）与非功能红线段的"源码级事实三问"→**四问**；`preset/testing-guide.md` I11 L1 行（闸门两半的描述、辅助检索模式加第四关键字 `\|新开的子代理`、"缺任一组即违例"改成点名"应在**规则 11 与顶注第 5 条各命中一次**"）；根 `README.md`。
- 体量（正文行、含行首缩进、不含换行）：调度 persona `prefix` 正文 **7972 → 8126**（**+154 / +1.9%**，按 ~4 字符/token ≈ **+38 token/步**）；九个专家 persona **未动**。首稿把源码路径与英文注释原文也塞进 persona（**+316 字符**），复核后按"顶注放出处、persona 只留判据"的口径精简到 +154。`node tools/check-preset.mjs` exit 0（0 错误 / 2 警告，与前一轮同一批）。
- 生效：`preset/` 改动 = 重生成 bundle + 重装 + **重启 dsh** + 新会话；**既有会话与它们已派出的子代理保留启动时那一份 preset**，所以这条只在新会话的新委派上可验（技能 `editing-cordis-compositions` 的既有结论）。
- 未观测：真机上调度者在用户切权后是否真的**新建委派**（行为层；§6 第四问末已标未观测 —— 本轮只把判据写进 persona，没有真机日志证明它照做）。

## 2026-09-30 — 截断接续补上**父级侧的触发信号**：规则 7 加一句"结算通知的开场白就是被截断的判据"

- 依据（用户要求，原话）：「如果子代理因为达到输出token上限被截断，向其发继续消息可以让其接着工作。例：当收到这样的系统提示时代表子代理因为输出token上限被截断了：Background subagent 926daaa2-… ran out of room before it finished.It left no closing message.」并明确要求"用**最简语言**写入调度代理的提示词"。
- `preset/agent.cordis.yml` 规则 7 既有的那半条（"被输出上限截断时不要换人、要就地接着写"）只补**一句识别信号**：新增片段逐字为「你那边的信号是结算通知的开头那句 `Background subagent <id> ran out of room before it finished.`（它自己看到的是「已达到输出 token 上限，回答被截断，已有输出保留在对话中」；开场是 `finished…` / `failed…` / `declined…` / `was stopped…` 的都不是截断）—— 被截断不等于被终止，**回一条继续消息它就能接着做**」。`send_message` 的既定动作、"不要重派新专家"、"整段驻留期已厚则写完这一截再换人"**都不动**；顶注第 15 条同步记下这句开场白的源码出处。（这一段的逐字措辞已在同日"用户复核"条里按"只留判据"再精简，**以该条为准**。）
- 机制（源码级事实；`docs/evidence.md` 新增 §14.1）：后台子代理结算时运行时构造一条 `kind: "subagent-settled"` 的父级 user 消息，开场白由 `@deepseek-ai/dsh-subagent/lib/types/continuation-messages.js:57-78` 的 `settlementSummary()` 按 `stopReason` 分支 —— `completed` / `aborted` / **`max-tokens`** / `refusal` / `error` 各一句，**只有 `max-tokens` 是 `ran out of room before it finished.`**；`:85-105` 的 `createSettlementMessage()` 在没有非空收尾文本时补一句 `It left no closing message.`（`@deepseek-ai/dsh-subagent/README.md:150` 逐字记载；运行时实现另见 `lib/index.js:618` 与 `:642`）⇒ 用户给的例子正是"被截断且没留下收尾文本"这一态。**被截断 ≠ 被终止**，`resume({ resumeSessionId: childId })` 那条路照旧可用。
- 文档同步：`preset/design.md` I15 ②（恢复那半）、`preset/testing-guide.md` N12（② 里写明父级侧信号 + 辅助检索模式加 `ran out of room before it finished`、判违例加"缺这半"）、根 `README.md` 手段表"交付形态 + 截断接续"行（标题与三处说明）与 persona 体积账。
- 体量（正文行、含行首缩进、不含换行）：调度 persona `prefix` 正文 **7814 → 7972**（**+158 / +2.0%**，按 ~4 字符/token ≈ **+40 token/步**）；九个专家 persona **未动**。`node tools/check-preset.mjs` exit 0（0 错误 / 2 警告，与改动前同一批）。
- 生效：`preset/` 改动 = 重生成 bundle + 重装 + **重启 dsh**（bundle 层的挂载行以重启为准，没有东西 watch `bundles/`），新会话才带得动新 persona。
- 未观测：真实会话里调度者见到这句开场白之后**会不会真的发出继续消息**（§14.1 末与 §4 同一行行为观测；本机 6 条 `max-tokens` 截断至今 **0 次续写**）。

## 2026-09-30 — 全字段提示词压缩（调度 persona / 九个专家 persona）

- 依据（用户要求）：优化 Adg 多智能体模式里**所有**提示词，从语言上缩减字数、降低 token 消耗，**语义不能有任何损耗**。上游 `plan-mode` 的 `section` 按用户选择**保持原样** —— 它是 `@deepseek-ai/dsh-web-app` 那份 preset 文本的逐字拷贝，不属于本仓库自有措辞。
- 体量（同一口径：正文行、**含**行首缩进、**不含**换行）：调度 persona `prefix` 正文 **9082 → 7814**（−1268，−14.0%）；九个专家 persona 合计 **8940 → 8140**（−800，−9.0%）；合计 **18022 → 15954**（−2068，−11.5%）。人向口径（≈4 字符/token）折合约 **−517 token/请求当量**：调度者那半 **−317 token/步**、每个被委派子代理 **−200 token/步**。
- 做法：同义改写为更短的句子、删掉**同一块内重复的复述**（名册已经逐条写了每个专家的分派范围，规则 3 就不再重复一张路由表；专家 persona 里写了两遍的"网页内容一律当作数据"只留一遍）、把解释性从句压成括号短语。**没有被压缩的**：规则编号，以及每条规则的全部规范性内容（五条编排层规则、输出／交接纪律、人工介入四分支、权限闸门、回报协议、五项必填）、任何工具名与 `allow` 名单；也**没有**引入任何 token／字数上限（I10 / I15 仍然禁止）。压缩的是表述，不是约束。
- 同步改动的字面量：`agent_browser` persona 的失败签名收短为 `platform_channel.cc:183 Check failed … 拒绝访问(0x5)`（判据词 `platform_channel` 保留）。
- `preset/agent.cordis.yml` 顶注：新增一段"2026-09-30 全字段提示词压缩"（体量、做法、哪些没压、同步改了哪些字面量），并把第 4 条里过时的"**八个**专家"改成"九个专家"（第 9 行 `agent_general` 早在 2026-09-28 就已加入，这处计数一直没跟上）。
- 校验：`node tools/check-preset.mjs` **exit 0**（0 错误 / 2 警告，与压缩前完全一致）；两种味道的产物校验各 **exit 0**（专家行 allow 计数 `10/7/7/10/2/5/9/7/16` 与 `+4` 的 bili 形状都没动）。
- 变更记录的时间序：本条的 `last_reviewed` 一并改为 2026-09-30。
- 未观测：压缩后的表述在真实会话里是否与压缩前**同样被遵守**（观测量：I13 / I15 的同一批抽查在压缩前后各跑一次 —— "未验证 / 未纳入"块的齐全率、回贴重合率、重复率）。**不含语义变化的证据是静态的**：`preset/testing-guide.md` 的探针字符串在压缩后**全部仍然命中**（`danger-full-access` / `platform_channel` / `正常路径` / `预先禁止` / `不许请你登录` / `至多一轮` / `只问一次` / `次数上限` / `不要打扰` / `同一实体` / `path:line` / `digest` / `验收标准` / `必要性闸门` / `未纳入本次` / `只在一个站点` / `steer` / `interrupt_agent` / `结算通知` / `不要换人、要就地接着写` / `交接摘要` / `adg-digest` / `临时根` / `绝不` / `去冗余` / `回贴` / `未验证 / 未纳入` / `分字段` / `agent_general` / `显式要求`），而"表述是否等价"这件事只有人能判 —— 逐条对照见提交说明。

## 2026-09-29（同日更早，本机部署）— 卸载 billion-context、恢复 DSH 原生压缩；`adg` 因此重新部署为 plain

- 动作与结果：`plugin_manager remove_bundle billion-context` 生效（pnpm 移除 40 个包）；`$DSH_HOME/profiles/{web,desktop}/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 都不再含它；两条 `dsh-adg-preset` 都按探测结果落 **plain**（`tools/has-billion-context.mjs` 复测 web / desktop / headless 全 0），`install.ps1` 退出 0 并报告"没有任何目标 profile 挂载"，`tools/check-bundle-flavor.mjs` 通过。
- 还原的键：bili 的味道会给 preset 的 `compaction-basic` 注入 `config.auto: false`；卸载后装配出来的配置里**没有任何** `auto:` 键 ⇒ DSH 自带的自动压缩回到默认开启。核对时看到 host plane 的 `compaction-basic` / `command-compact` / `tool-result-pruner` 是 `disabled: true` —— 那是 `@deepseek-ai/dsh-web-app` 自带补丁的设计（压缩后端归 preset 层）、**与 bili 无关**，未改。
- 为什么 `adg` 必须重新部署：① bili 味道把 4 个 bili 工具名注进了 9 个专家的 `allow`，卸载后那些名字不存在 ⇒ 撞红线 7（`names unknown global tool "compress"`，每次委派必抛）；② 同一次注入把 `compaction-basic.auto` 钉成 `false`，不重新部署的话卸载后原生压缩也不会回来。重装一次两件事一起解决。
- 未观测：重启 dsh 之后 `web` / `desktop` 的冷启动装配（`resolve('adg').broken` 为空 + 激活行形状）；**保留未删**的 bili 运行残留（`~/.local/state/billion-context/` 下的 `bili.log` ≈5.8 MB、`prefix-affinity.json` ≈394 KB 等，处置待用户决定）。

## 2026-09-29（同日更早）— 派发拓扑：**异实体按实体拆 + 边界写死 + 共同结论层工件**，并复核上一条的机制口径与体积

- 依据（用户要求）：现在的调度规则**默认"同一实体就复用同一个子代理"**，而子代理的输出 token 会到上限、几轮再派就容易满 —— 要改成按**任务性质**决定"复用同一个"还是"拆给不同个"。用户给的两个例子按同一根轴划分：*调研 3 款手表*（异实体 → 拆，且必须写死边界以免它顺手去查别款）与 *阅读大型文档库回答多个问题*（同实体 → 要么一个专家通读并产出一份**结论层工件**供后续委派复读，要么一个专家专职回答）。
- `preset/agent.cordis.yml` 规则 6：补**异实体按实体拆**（每个实体一条委派、**边界写死三件套**：目标点名唯一一个实体 / 验收标准写成"只就它作答" / 本次不做列出相邻实体并加「若必须拿到别的实体的数据才能作答就停手、把它作为未决问题报回来，不要自行扩面」）；补**共同结论层工件**（同一批结论要被多条委派共读时，先由**一个**专家把它做成可复用工件或接进委派 prompt，源材料变了先刷新）。+447 字符。
- `preset/agent.cordis.yml` 规则 7：补"**是否要重复读同一批材料**"这条转向理由（要 → 接给已读过它的那个它；不要 → 另开新专家、委派里带**交接摘要**：一条结论 + 证据位置 + 未决项），并补"**该停的时候**"（在飞任务已在同一件材料上走了很多步、或它这一轮被截断且整体上下文已厚 ⇒ 停掉它、按规则 5 另开并带交接摘要；会话虽被持久化、恢复会重建计数，但既有上下文会在余下每一步作为 cache-read 重新计费）。+283 字符（另一改动的 +275 见上一条）。
- `preset/agent.cordis.yml` 规则 10 ⑤：改写成**预防式** —— "输出上限**不可预测**，所以大产出按规则 5 分段交付、不要憋到单条回答里；截断后的续写入口只有'由你用 `send_message` 接给**同一个**被委派的子代理'那一条路，**你不是那个能续写的人**"。上一轮记的"⑤ = 撞上输出上限不是删内容、是从断点接着写完"**已被本次复核推翻**：⑤ 写恢复动作是错的（截断在 agent 循环里正常 `return`，恢复动作归规则 7）。
- `preset/agent.cordis.yml` 顶注：第 3 行"十五处"改**十六处**；第 15 条整段按复核改写 —— ① 截断**已量到频次**（不只机制）② 6 条截断**之后记录数为 0** ⇒ "就地接续"在本机**没有先例**，只能写成调度者动作 ③ 本机上限是 pi-ai 的 `DEFAULT_MAX_TOKENS = 32768`、撞上限时 `tool-call` 块被整体丢弃、工具返回会把保留的部分答案附在错误里 ⇒ 正确口径是"先消费部分产出、再决定续跑还是换人" ④ 代价按重测改为 **+1346**（正文 7736 → **9082**，≈320 token/步），并指向新增的 `docs/evidence.md` §14。
- `preset/design.md`：I13 ① 补**异实体按实体拆 + 边界写死 + 共同结论层工件 + 源材料变了先刷新**；I13 ② 补**规则 7 的两种相反处置必须一起在位、判据不得互相覆盖**（换人管*上下文量*、就地接续管*单轮的截断事件*）；I14 补**同一类工件的第二形态**（共同结论层工件 / 索引 / 跨委派共享 `path:line` 清单受同一条约束）；I15 补**"预防（规则 5 / 规则 10 ⑤）/ 恢复（规则 7，不属本条）"两半**与"分段交付是交付形态要求、不是产出量上限"；front matter `last_reviewed: 2026-09-28 → 2026-09-29`。
- `docs/evidence.md`：§12 之后新增 **§13（派发拓扑：实体 × 性质、"是否要重复读同一批材料"的直接推论、边界写死三件套、共同结论层工件与 I14）** 与 **§14（输出上限截断：`{kind:"max-tokens"}` 的规范结局与源码行号、`tool-call` 块被丢弃、本机上限 32768、只读扫描 285 个档案量到 6 条截断的逐条清单与"截断后 0 记录"、多帧 zstd 的读法）**；§4 未观测清单登记"截断后就地接续（行为）""异实体拆分与共同结论层的真实效果"两行。
- `preset/testing-guide.md`：N13 的 ② 按现行规则 10 ⑤ 改为预防式、辅助检索换掉失效的 `接着说` 判据（改查 `输出上限不可预测`）；N1 末句把"三处"逐条点名（规则 5 交付形态 / 规则 7 恢复 / 规则 10 ⑤ 预防）。
- `README.md`：手段表的"交付形态 + 截断接续"行改为正确机制（`max-tokens` 是正常结局、不走 `agent/request-error`、无内建重试、只有调度者能接）+ **已量到的 6 条截断**；体积账 9002 → **9082 / +1346**；"未观测"段把"截断频次没有证据"改成"频次已量到、行为仍未观测"。
- 未观测：**"调度者会不会真的去接"与"接住之后产出是否完整"**（6 条历史截断里一条都没续写过）；**异实体按实体拆 + 共同结论层工件**的真实效果（子代理个数 / 调度者上下文增量 / 重复读取次数，量法与观测量见根 `README.md`「多智能体的 token 消耗」节与 `preset/testing-guide.md` I13 的 N1 / N2 / N3）。

## 2026-09-29（上一条）— 交付形态与**截断接续**：规则 5 / 7 / 10 各改一处（被输出上限截断的委派要就地接上，不是重派）

- 依据（用户报告）：单条回复撞 `maxTokens` 时 **DSH 中断那一轮**并把已写出的部分留在对话里 —— 用户实测的报错文案是「已达到输出 token 上限回答被截断，已有输出保留在对话中。发送"继续"可让模型接着输出。」。**续写入口只有人工"继续"，被委派的子代理自己发不了**，所以"谁去接"只能落在调度者身上。
- **新增的日志证据（只读扫描，本机 285 个会话档案）**：`turn/end` 的 `reason.kind` 分布为 `completed` 385 / `aborted` 36 / **`max-tokens` 6** / `error` 5 / `interrupted` 2；6 条 max-tokens 全部落在 `agentPreset:"adg"` + `origin:"subagent"` + `delegationDepth:1` 的被委派子代理会话里（4 条 v4、2 条 v3），而**这 6 个会话在截断之后都没有任何后续记录**（`assistant/message` 0 条、`user/message` 0 条）⇒ "截断后就地接续"在本机属于**未观测**，正因如此才要把它写成调度者的动作。读档案的坑：`session.v*.jsonl.zstd` 是**多帧 zstd 拼接**（例：某 v4 档案 574248 字节含 155 帧，`zstdDecompressSync(整文件)` 只解出 259 字节的头部），必须先按 magic `28 b5 2f fd` 切帧；本机不需要外部 zstd（Node v26 的 `node:zlib` 自带 `zstdDecompressSync`）。
- `preset/agent.cordis.yml` 规则 5：**期望产出**里补"产出大时（整份报告 / 长表 / 逐条清单 / 全文对比）分**段交付**"——先给结论 / 证据位置 / 未验证的梗概，再分段给大正文；并写明这是**交付形态**要求、**不是产出量上限**。
- `preset/agent.cordis.yml` 规则 7：补**接续**半条并钉死与"换人"的先后 —— 被截断时**立刻** `send_message` 接给**同一个它**（"上一条在输出上限处断了，请从断点继续写，直到交付块完整"），理由是"人只能从界面上发继续、子代理发不了"；"换人"只留给"它已无法接续"或"这一截写完后整段驻留期已厚、按规则 5 另开并带交接摘要"，**一被截断就重派新专家等于丢掉前半段**。
- `preset/agent.cordis.yml` 规则 10：去冗余纪律从四条扩成五条，⑤ = "撞上输出上限不是删内容、是从断点接着写完"（④ 的"未验证 / 未纳入"仍是必填块）。**（本条 ⑤ 的措辞已被上一条复核推翻并改写为预防式：见上。）**
- `preset/agent.cordis.yml` 顶注：删去"实质改动有十四处"里的旧数、改为**十五处**，新增第 15 条（机制、三处改动、代价、未观测项）。代价 **+1266 字符**（`prefix` 正文按不含换行实测 7736 → **9002**，≈316 token/步）—— 本仓库历次规则改动里最大的一笔。
- `preset/design.md`：I13 补"同一实体的续做形态 + 预防 / 恢复两半各钉一处"（含"是否要重复读同一批材料"是该判据的直接推论）；I17 补"**被截断的子代理发不出结算通知** —— 那一轮是 DSH 强制中断而非它的收尾，所以别等通知、要主动接"。
- `preset/testing-guide.md`：新增 **N12**（规则 7 的两种相反处置都在、且判据不互相覆盖；`不要换人、要就地接着写` / `交接摘要` 各应命中 1 行）与 **N13**（规则 5 的分段交付 + 规则 10 ⑤ 都在位、且两处都没被写成字数 / 产出量上限）；N1 的那行补了指向 N12 / N13 的指针。
- `README.md`：「多智能体的 token 消耗」表新增"**交付形态 + 截断接续**"一行（状态 = 机制实测 / 收益未量），「persona 的体积账」改写为 9002 字符并写明**两套口径不可混用**（4584 / 4820 是旧口径"整个 `prefix: |-` 块"，7219 / 7736 / 9002 是顶注第 13 条起改用的"正文行、不含换行"口径），「未观测」段补上截断接续与截断频次。
- 未观测：真实会话里调度者会不会真的去接（量法 = 转录里截断后**有没有**指向同一个子代理的 `send_message`）；本机截断频次虽已扫出 6 条，但那是历史档案、且**没有一条续写过**，所以"接住之后产出是否完整"仍无证据。

## 2026-09-28（追加，生成物分两种味道两个稳定目录）— `install.*` 逐 profile 选味道（修"挂了 bili 的 profile 也拿到 plain"）

- 症状与根因：`install.ps1:88` 的 `$useBiliTools = ($biliOnProfiles.Count -gt 0 -and $biliOffProfiles.Count -eq 0)` 配上"生成物全机共用一份" ⇒ 混装机器（本机 `desktop` 没挂 bili、`web` 挂）**给所有 profile 都装 plain**，`web` 的专家 `allow` 里一个 bili 工具都没有，子代理一调就报 `unknown tool compress`（真机实测：两个 profile 的 `node_modules/dsh-adg-preset` 都指向 `bundles/dsh-adg-preset`，那份产物里 `- name: compress` 出现 **0** 次）。源文件 9 个专家行的 `allow` 齐全，"缺 allow"的假设不成立。
- `install.ps1` / `install.sh`：生成物改为**两份**（plain → `$DSH_HOME/bundles/dsh-adg-preset`，注入版 → `$DSH_HOME/bundles/dsh-adg-preset-bili`，包名都叫 `dsh-adg-preset`，两份味道无条件都生成），`auto` 下**逐个 profile** 用它自己的探测结果决定 `link:` 哪一份，`on` / `off` 只做整体覆盖（覆盖与探测不一致时打黄字警告）。
- `install.ps1` / `install.sh`：新增第 4b-1 步 —— 用 `tools/check-bundle-flavor.mjs` 断言该 profile **实际链接到的那一份**的味道（判据不能是"包在不在"：两种味道的 `package.json` 逐字节相同），不一致即判失败（exit 2）。
- `install.ps1` / `install.sh`：第 0 节探测与 4b-1 都改成"`cmd /c` 重定向写文件 + 读文件 + 显式查退出码"——沙箱里 `@(& node ...)` 捕获会把输出吞成空串、`$LASTEXITCODE` 还是上一条的值（会静默把味道判反、断言假绿）。
- `AGENTS.md` 红线 10：删掉"生成物全机共用一份 ⇒ auto 只在'每个目标 profile 都挂着'时才注入"，改为两种味道两个落点 + 逐 profile 选味道 + 4b-1 断言；命令段与生效方式表同步（复核第一步改成"先确认该 profile 的 `node_modules/dsh-adg-preset` 链接的是哪一份"）。
- `README.md`：「与 billion-context 协同」的 auto 口径改写；**删掉"本机特例（`web` 的 `dsh-adg-preset` 是实体目录）"**——那套绕法不再需要，改为写明 `web` 该指向注入版、`desktop` 指向 plain；第 2 步"生成 bundle"、第 3 步"装 bundle"与部署目标表都补第二种味道。
- `docs/evidence.md`：新增 **§11**（症状 / 根因 / 修法 / 临时 DSH_HOME 端到端四轮检验 / 未观测）；§10.1 第 8 条加"该口径已被推翻"的指针，§10.2 ① 补一条负向观测（plain 落点下真实专家确实报 `unknown tool compress`）。

## 2026-09-28（追加）— 调度 persona 规则 8：**委派一律走后台**（阻塞会把这一次降级成一次性、接不回来）

- `preset/agent.cordis.yml` 规则 8（原来只有"同一条回复里同时启动多个委派、不要串行等待"）补一条口径：委派一律用后台方式发出（不设 `run_in_background: false`），并写明代价 —— 前台（阻塞）分支走 `subagents.start()`，而 `dsh-subagent` 的 `start()` 固定发 `mode: "one-shot"` 描述符，于是这一次委派**不进 `list_agents`**（`dsh-tool-subagent-control` 的 `list-agents` 只保留 continuable）、`send_message` 报 `NOT_RESUMABLE`，规则 6 / 7 省下的"重读"退回原价，用户也不能在界面上给这个子代理发消息或停它。同时写明"后台不等于结果丢了、也不用停在那里等"：即使这一轮下一步就要用该结果，也照样后台派出后结束本轮，由子代理的**结算通知**（唤醒型投递）把它重新唤起。**没有任何阻塞例外**（初稿曾写"唯一例外 = 同一轮下一步要用到该结果且无可并行工作"，同日**按用户指出纠正**：前台不会让它更快拿到结果）。代价 +429 字符（`prefix` 正文按不含换行实测 7219 —— 同日纠正"唯一例外"时又改过措辞，初版是 +366 / 7156；顶注第 10 条记的 4820 是那一次改动之后的旧值）。
- `preset/agent.cordis.yml` 顶注新增第 13 条改动说明（源码依据 + "只能是提示级"：`enableRunInBackground: false` 是反方向，会强制永远阻塞 + 永远一次性；框架没有"只能后台"的开关；含"没有阻塞例外"的唤醒型投递依据 `notifySettlement` → `sendWaking(...)`）。
- `preset/design.md`：`SchedulerPersona` 新增 **I17**（口径 + 两条禁止 + 源码依据 + "未观测"量法）。
- `preset/testing-guide.md`：`I1..I16` → `I1..I17`；新增 **Q1**（规则 8 四件是否都在；`run_in_background` 只应命中规则 8 与顶注第 13 条）与 **Q2**（真实挂载量法：`run_in_background: false` 计数应为 0；阻塞的那一次应看不到、接不上）。
- 依据（用户报告 + 源码勘探）：用户观察到"有时阻塞、有时一次性"，实为**同一个开关的副作用** —— 阻塞与一次性是同一件事（`run_in_background: false` ⇒ 前台 ⇒ one-shot 描述符）。用户要求默认非阻塞，理由是只有 continuable 子代理才能被用户手动发消息 / 停止，并与规则 7 的"子代理复用"联动；非阻塞不影响后续工作（结算通知会回到调度者）。

## 2026-09-28（晚间）— 挂 bili 的 profile 连**自动压缩**也交给 bili：`compaction-basic` 的 `auto: false` 改为构建期注入；bundle `1.2.0`

- 第二处交界（同一旗标 `--with-billion-context`）：`tools/gen-preset-bundle.mjs` 在 preset 的 `compaction` 组里给 `compaction-basic` 行注入 `config: {auto: false}` —— 与 bili 自己的 `dsh.bundle.patch.yml`（`- id: compaction-basic` / `config: {auto: false}`）**同键同值**，两边都生效也无行为差异（幂等）。语义是"关掉自动折叠与溢出恢复、手动 `/compact` 仍可用"（该包 `README.md:76`、`lib/index.js:827`），**不是**整行 `disabled`。
- 为什么写在 preset 自己的组里：那三行活在 `isolate: {compaction: true, toolResultPruner: true}` 的 **realm** 里、是另一份实例，而 bili 那份补丁打在 **profile 层**，"同 id 能不能跨 lane 命中"从未被观测 ⇒ 产物不依赖它。
- `tools/check-bundle-flavor.mjs`：断言从"四个名字"扩到两件事 —— plain ⇒ 9 行全 `NONE` + `compaction-basic[auto=未写]`；bili ⇒ 9 行全 `ALL` + `compaction-basic[auto=false]`；交叉断言各 **exit 1**（各报 10 个 ERROR）。
- `tools/check-preset.mjs`：源文件里手写 `compaction-basic` 的 `auto` 判 **ERROR** 并指回 `--with-billion-context`（`auto` 本就在该插件 `allowedKeys` 里，"未知键"那条拦不住它）。
- `preset/agent.cordis.yml`：注释块记录"唯一一个构建期注入的键是 `compaction-basic` 的 `auto`"；**源文件本体仍不写 config**。
- `preset/bundle.package.json`：`1.1.0` → `1.2.0`。
- `AGENTS.md`：红线 10 与质量门 1b 各补 compaction 半边（含两种味道的实测计数与"手写即 ERROR"的反向守卫实测）；生效方式表那一行同步。
- `README.md`：「与 billion-context 协同」改写成**两处交界**，并写明**本机特例** —— `web` 的 `dsh-adg-preset` 是实体目录（不是共享稳定目录的链接），重跑 `install.*` 会把它打平回 plain；给出恢复命令与"给 `desktop` 也装 bili"的绕开办法。
- `docs/evidence.md`：§10.1 新增第 10 条（四层依据 + 检验 + 防重踩）、§10.2 从三条改四条、§4"realm 里 `auto` 取值"那行从「刻意留在范围外」改成「部分已处置 + 两条未观测」，§10 边界句改为"开关不是旋钮"。
- 依据：bili 官方 patch 自己就关自动压缩；只注入那四个名字而不关它，结果是两套折叠各自抢阈值、压同一段历史。

## 2026-09-28（下午 15:31+08:00）— billion-context 协同：那四个上下文工具改为**构建期条件化注入**

- `tools/gen-preset-bundle.mjs`：新增 `--with-billion-context`，给 9 个专家行的 `toolFilter.allow` 追加 `compress` / `decompress` / `search_context` / `acp_status`（**不含** `acp_cache` —— 它是账本诊断，归调度者）。不带旗标时产物逐字节不变。
- 新增 `tools/has-billion-context.mjs`：判据"某个 profile 算不算挂着 billion-context" = `dsh.profile.bundles` 含该包 **且** `node_modules/billion-context/dsh.bundle.patch.yml` 存在；输出每 profile 一行 `<name><TAB>1|0`，退出码恒 0。
- 新增 `tools/check-bundle-flavor.mjs`：钉住**产物**里那四个名字的有无（`check-preset.mjs` 读源文件、专家行在第 4 列；产物里它们在第 14 列，产物是它的盲区）。自己探测缩进；`acp_cache` 出现在产物里即 ERROR。
- `tools/check-preset.mjs`：新增 `BUILD_TIME_INJECTED_TOOLS`，源文件里**手写**这四个名字判 **ERROR** 并指回构建期旗标（红线 10）。
- `install.sh`：新增 `--billion-context[=auto|on|off]` 与 `ADG_BILLION_CONTEXT`；探测段（auto = 每个目标 profile 都挂着才注入）；gen 调用带旗标。
- `AGENTS.md`：新增**红线 10**（两侧后果、判据位置、"生成物全机共用一份"）；命令段加两条；`Context Loading` / 生效方式表补一行。
- `README.md`：新增「与 billion-context 协同（可选能力）」一节（L615-656）。
- `docs/evidence.md`：新增 §10（逐条带状态档 + 交叉断言与零回归证据）、§4 三条未观测、证据来源表两行。
- 依据：`allow` 是真白名单（`restrict()` 未知名当场抛 ⇒ 红线 7），而 bili 的压缩指令与 nudge **不看可见性**（`billion-context/src/server.ts:3427`）⇒ 不给就是指令悬空、乱给就是委派必挂。

## 2026-09-28（晚）— dsh 0.1.7-rc.2 之后 preset 挂不上：旧目录机制被移除 + 引擎行包名改名，安装链路整体改成 bundle

- **两个独立成因，都必须修（详见 `docs/evidence.md` §9）**：① dsh 0.1.7-rc.2 **移除**了
  `$DSH_HOME/.agent-presets/<id>/` 那套目录发现机制，而 `install.ps1` / `install.sh` 仍在往那里拷文件 ——
  拷过去的东西没有任何组件会读，这就是用户报的「预设加载不出来」；② 同一版里引擎行的包名从
  `@deepseek-ai/dsh-workflow-worker-thread` 变成 `@deepseek-ai/dsh-workflow-ptc`，旧名会让 registry
  判整份 preset `broken`（`… : never started`），该模式在新会话里直接不可用。
- 新增 `tools/gen-preset-bundle.mjs`（零依赖，构建脚本）：从 `preset/preset.yml` +
  `preset/agent.cordis.yml` + `preset/bundle.package.json` 生成
  `bundle/adg-preset/{cordis.patch.yml,package.json}`（实测 80,547 B / 18 个顶层条目 / id=adg / order=20），
  产物目录在 `.gitignore` 里、**不许手改**。
- 新增 `preset/bundle.package.json`：bundle 清单模板（包名 `dsh-adg-preset`）。
- `preset/agent.cordis.yml`：引擎行 `workflow-worker-thread` → `workflow-ptc`
  （`name: '@deepseek-ai/dsh-workflow-ptc'`、`config: {provider: spawn}`），行旁留注释记录改名与原诊断字符串。
- `install.ps1` / `install.sh` 重写：生成 bundle → 拷到 `$DSH_HOME/bundles/dsh-adg-preset` → 自动识别
  "能装 preset 的 profile"（判据：其 `dsh.profile.bundles` 含 `@deepseek-ai/dsh-web-app`，因为声明
  `agentPresets` 服务的 `agent-preset-registry` 由它提供）→ `pnpm add link:` 装 bundle → 写 `dsh.profile.bundles` → 部署技能与 `browser/`。pnpm 失败不再中断脚本、只如实报告；**只有包真的出现在 profile 的 `node_modules` 里之后**才写清单。
- 文档同步：`README.md`（安装表、"给 AI 的安装指令"整节重写、"为什么装在 `$DSH_HOME/plugins`"、
  历史段落加"已过时"标注）、根 `AGENTS.md`（命令块、生效方式表新增"包名会随 dsh 改名"一行、
  模块地图 `tools/` 行、Quality Gates 第 3 条指向新步骤号）、`preset/*`、`tools/*`、
  `skills/adg-add-agent/SKILL.md`
  （改成"改仓库源文件 + 重跑生成与安装"）、`browser/*` 的交叉引用。
- **实测（本机，web profile）**：bundle 路线 18:23:07 与 18:28:18 各一次、profile-patch 路线 18:24:27
  一次，三次数值一致 —— `resolve('adg').broken` 为空、`compositionInventory()` 35 行 / 32 启用 /
  3 关闭 / 0 条件、9 条 `tool-subagent` 启用、fork 0 行、32 行 `fiberState === 2`。
- **未观测**：`desktop` profile 的挂载（`dsh --profile desktop --dump-config` 被
  `managed exclusively by the Electron application` 拒绝）；`install.sh` 在本机没跑过（Windows 无 `sh`）。
- **遗留的环境问题（如实记录，未修好）**：`profiles/web/node_modules/.modules.yaml` 缺失、锁文件与清单
  有漂移 —— dsh 正在运行时 pnpm 无法重建目录；**影响为 0**（依赖都能解析、行都 active），
  关掉 dsh 后重跑安装脚本或 `pnpm install` 即修复（`docs/evidence.md` §9.6）。

## 2026-09-28 — 新增第 9 个专家 `agent_general`（交接专用全功能**叶子**）：只在用户显式要求时派，靠运行时注入的 `send_message` 指引回报上级

- **按用户要求新增**：名册从 8 行变 9 行 —— 加一个「全功能的子代理角色」，可以做任意事情，但**只在用户显式要求的前提下**才被调用，用途是**上下文隔离**（上层把一整件工作交接给下一个智能体、另开一个上下文）。
- **待定项已裁决：不让它继续委派（叶子）。** 技术事实（源码级，本次查证）：子代理会 `composeFrom` 继承父代理的整套组合，把 `agent_*` 名册行写进它的 `toolFilter.allow` 就生效；深度上限由该行的 `maxDepth` 决定，`dsh-tool-subagent` 的默认值是 **3**（调度者 → 它 → 它 → 它为止）。**仍选择做成叶子**，理由三条：① 调度者的 `list_agents` 只列直接子级、`send_message` 只到直接父/子，**孙代理对它不可见、不可 steer**（一跳可达才有可追踪的链路）；② I13 的那些编排层规则只作用于调度者自己那一次委派，一旦它再委派就整段失效，而同一份材料会被再读一遍（实测 cache-read 占提示 token 的 **91%**）；③ 用户要的是"一个独立上下文把活做完"，不是"再长出一棵树"。
- **补偿：回报协议由运行时自带**（不是我们自己写的约定）。`@deepseek-ai/dsh-subagent` 的 `withContinuableReturnGuidance` **只在子代理看得见 `send_message` 时**，给它的任务末尾追加「Your parent agent id is …，结束前用 `send_message` 把结果回报给它」；它每一轮的 final message 还会作为 settlement notice 的 closing message 回到调度者。所以"结束本次会话并回报上级 → 调度者继续 / 再派新子代理"这条链路**不需要递归**就成立，`send_message` 也因此必须留在它的 `allow` 里。
- `preset/agent.cordis.yml`：① `delegation` 组新增 `- id: agent-general`（`toolName: agent_general`、`provider: spawn`、`backgroundMode: continuable`、`allow` 共 16 项：`read` / `read_image` / `write` / `edit` / `glob` / `grep` / `pwsh` / `job_list` / `job_output` / `job_kill` / `web_search` / `web_fetch` / `skill` / `todo_write` / `send_message` / `present`）；**刻意不含**任何 `agent_*`、通用 `subagent` / `subagent_fork`、`workflow` / `ralph`、`ask_user_question`、goal 三件套、`exit_plan_mode`。② 调度 persona 名册加一行；规则 3 补"交接 → `agent_general`（仅当用户显式要求）"；**新增规则 17**（交接闸门 + 派发时的三条额外要求 + 回报后按规则 7 接给同一个它）。③ 文件顶注加第 12 条（技术上能委派、为什么不做、回报协议从哪来），名册段由"两组"改"三组"。
- `preset/design.md`：新增 **I16**（三半：`allow` 是叶子 / 触发条件是用户显式要求 / 派发时重申回报协议；含源码依据与"未观测"标注）；`ExpertRow` 的行清单 8 → 9；新增一条非功能红线（禁止给它加 `agent_*` 或删它的 `send_message`）；顺手把"For Agents"里写死的"上面 13 条非功能红线"改成不写条数（该数字早已与实际的 14 条脱钩，条数会被每一次改动改掉）。
- `preset/testing-guide.md`：`I1..I15` → `I1..I16`；新增 **P1**（静态核对三个半条 + 为什么"给它加 `agent_*`"脚本拦不住）与 **P2**（真实挂载量法：不提"交接"时不应派、提了应派、它那一轮有没有 `send_message` 与四字段交接回执）；K2 / M1 / 3.2 的"8 行"改"9 行"，3.2 补一句"技能对 `agent-general` 特殊性的断言过期也算过期"。
- `preset/AGENTS.md`、根 `AGENTS.md`：专家行数 8 → 9；新增 I16 红线（含"`send_message` 不许删"）；根 `AGENTS.md` 关键红线新增 4b；Quality Gates 第 1 条的实测值由 **0 错误 / 1 警告** 改 **0 错误 / 2 警告**（`agent-general` 也用了条件性注册的 `read_image`）。
- `skills/adg-add-agent/SKILL.md`：名册 8 → 9；开头新增一段说明第 9 行是**特殊行**（不要照抄它的名单与 persona、不要给它加委派能力、不要删它的 `send_message`）；硬约束节新增同一条。
- `README.md`：顶部改成"九个专家"并新增 `agent_general` 条目 + 一段设计说明（含"技术上能委派、为什么做成叶子、回报协议从哪来"）；「怎么用」表格新增一行并写明触发条件是**用户的话**而不是任务性质；「装完必须重启 dsh」那段补 2026-09-28 的重测数字；「persona 层保留的政策」「token 消耗」「实质改动（十一处 → 十二处）」等处的 8/10/34 计数同步为 9/11/35；「给 AI 的安装指令」第 6 步的挂载判据由 **10/8/0** 改 **11/9/0**（并保留旧值作对照）。
- `docs/registry.md`：`README.md` 一行由"八个专家的分工"改"九个"；`preset/design.md` 一行补 I16。
- **本次实测（preset 改动的挂载校验，按 README「给 AI 的安装指令」第 6 步）**：`standingKeyFor('adg')` → **mounted OK**（挂载校验用的是**已部署**到 `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` 的那一份）、`compositionInventory()` → **35 行** / 11 个 `tool-subagent` 模块行里 **9 行启用**（`agent-general` 与其余 8 行同为 `enabled: true`、`fiberState` 相同）/ `tool-subagent-fork` **0 行**。静态自检：**0 错误 / 2 警告**（两条都是 `read_image` 条件性注册）。
- **未观测（不许写成实测）**：① 真实委派下 `agent_general` 的可见工具目录"恰好等于 allow 名单"（机制与 `agent_coder` 的已实测同源）；② 调度者是否真的只在用户显式要求时才派它；③ 它的任务末尾是否真的被追加了那段回报指引（源码级事实，真机没有观测过）。三条都登记在 `preset/testing-guide.md` 的 **P2**。
- 未改动：`browser/` 全部文件、`tools/check-preset.mjs`（它的 `KNOWN_TOOLS` 已含本次用到的全部工具名，无需同步）、`.gitattributes` / `.gitignore` / 两个安装脚本。生效方式照 preset 口径：**重启 dsh + 新对话**（`agent_general` 要先重启才会出现在新会话的工具面里）。

## 2026-09-27（晚·五）— 调度纪律：同一份信息默认只在一个站点取（I13 ① 的浏览器那半）

- **按用户要求追加**：浏览器操作非常耗时，除非有必要，调度时不要要求同一个信息在两个以上站点获取。这条并入**规则 6**（同一实体 + 同一性质的任务只派一次）的末尾，不新开编号 —— 它本来就是同一条原则（同一份材料不要买 N 次）在浏览器上的形态，且 I13 的"五条编排层规则"计数与全部引用都不用改。
- `preset/agent.cordis.yml` 规则 6 末尾新增：**同一份信息默认只在一个站点取**；一轮浏览的**下限**实测 **0.8–2.0 秒**（开空白标签 → 导航 → 等可读 → 读回 → 收走临时页；不含每个模型步），多站点取同一份信息基本等于把同一份材料买 N 次；三个例外 —— ①用户明确要「多源 / 对比 / 交叉验证」②那个站点拿不到、或各站数据互相矛盾 ③交付物本身就是跨站点比较的结果（比价、同款选型）；真要多源就让**一个** `agent_browser` 在一条委派里串行跑完并合并产出。
- `preset/design.md`：I13 ① 补上这半条（含三个例外与实测成本下限，指向 `docs/evidence.md` §8）。
- `preset/AGENTS.md` 与根 `AGENTS.md`：I13 的红线条目 / 关键红线 4 同步这半条。
- `preset/testing-guide.md`：N1 的 ① 补这半条；新增 **N8**（静态核对：默认只在一站点 + 三个例外 + 一个专家一条委派）与 **N9**（真实挂载量法：数委派里点名的站点数，应为 1 个；同时对照 `TABS` 净增长）。
- `README.md`：「登录墙与验证码」之后新增「**同一份信息默认只在一个站点取**」一段（给出实测下限与三个例外，说明这条属规则 6 的浏览器那半）；「多智能体的 token 消耗」里列举五条规则的那句同步。
- `docs/evidence.md`：「未观测清单」新增一行（**浏览器任务是否真的只在一个站点取** —— 来源是用户报告 + 本机成本实测，尚无真实会话为证，含量法）。§8 已有的单轮耗时实测就是这条规则的依据。
- 未观测：这条规则**没有真实会话证据**（N9 登记为此结论）；成本下限是工具侧实测，每个模型步的耗时没有测量。生效方式照 preset 口径：**重启 dsh + 新对话**。

## 2026-09-27（晚·四）— 一次性读页抢跑修复（I10 补两半）：先开空白标签再导航等可读，失败也收页

- **发现（真机实测）**：量浏览器单轮耗时的时候顺手量出一个真缺陷 —— `text --url <新地址>` 早先是「按目标 URL 建页 → 固定 `sleep(600)` → 读」，**抢在页面加载之前**就读，于是 example.com / qunar / ctrip 三个真实站点**全部 `BYTES=0`**（空正文）；修复后同一命令分别读到 **129 / 547 / 2061 字节**。空正文与"这页本来就空"在调用方看来一模一样，会被当成"这个站点没用"而白烧一整轮，还常诱发重试（再烧一轮）。
- `browser/lib/cdp.mjs`：`pageSession` 的 `newUrl` 分支改为**先开 `about:blank`、轮询等它出现在 `/json/list`、attach 之后再 `Page.navigate` 并等可读状态**（复用既有的 `goto` / `waitForLoad`，去掉固定 `sleep(600)` 的赌法）；等不到可读状态**报错**并带上 `readyState` 与 URL（不再返回空正文）；新增 `catch` 分支 —— 初始导航失败/超时时，关掉**自己开的**那个临时页再抛（只关 `created` 的，别人开的页一律不碰）。
- `browser/test/browser.test.mjs`：**34 → 36 个用例**。新增 A38（不许抢跑：断言 `about:blank` 建页、`sleep(600)` 已消失、复用 `goto`、超时报错）与 A39（失败路径也要收自己开的页，断言清理行落在 `pageSession` 的 `catch` 里）。
- 真机实测：一次性实例（端口 9444 + 临时 profile）三个站点 `TABS` 全程 1 → 1 且每条都打 `TAB_CLOSED=`；单轮工具侧耗时 **0.78 / 1.43 / 1.98 s**。异常地址另测两条：`.invalid` 域名读到 Chrome 错误页（224 字节、退出码 0）、不可路由 IP `10.255.255.1` 约 10.7s 后正常返回 —— 两种都**不留标签**，但也都**没有触发**超时分支。
- `browser/design.md`：I10 补两半（不许抢跑 / 失败路径同样"谁开的谁收"）+ For Agents 的「绝不能做」同步。
- `browser/testing-guide.md`：新增 A38 / A39 / A40 三行 + 未观测一条（**超时与失败清理分支没有真机触发过**，因为 Chrome 对不可达站点给错误页或 10.7s 后返回，只有源码级断言）；第 5 节最小闭环那条改为「须打 `TAB_CLOSED=`、**正文非空**且 tabs 数不变」；顺手修掉本文件第 10 / 15 行还写着 `I1..I8` 与「27 个用例」的漏改（那批编辑当时因"文件未读"被拒，只补上了一部分）。
- 用例数同步（34 → 36）：`browser/AGENTS.md`、根 `AGENTS.md`（Quality Gates 第 7 条，同时补"正文非空"）、`README.md` 目录树、`docs/registry.md`、`docs/evidence.md` §8 及重测脚本。
- `docs/evidence.md` §8：新增「一次性读页的抢跑」小节（修复前后对比表 + 三个站点的单轮耗时），未观测清单新增一条（超时 / 失败清理分支）。
- 生效方式：`browser/` 是用户根下的普通文件 —— **重新跑一次 `install.*` 即生效，不用重启 dsh**。

## 2026-09-27（晚·三）— 删除「人工介入每任务至多一轮」：默认不设上限，只按用户要求受限（I12 修订）

- **按用户要求删除**：调度 persona 规则 12 里「**同一条路径的人工介入每任务至多一轮**」这条上限不妥 —— 它把所有任务（**不只浏览器**）的人工介入变成了一次性配额。调度 persona 的「试过了还是被挡」分支改为「停手交回用户换方案（用户想再试一次、或换个办法，照常重派 —— 默认**不设次数上限**）」。
- `preset/agent.cordis.yml`：**新增规则 16**，写成**一般规则**（不挂在浏览器那一条下）：需要用户本人做的事（登录／验证码／二次验证／切会话权限／需要用户拍板／需要用户在本机某处操作）默认**不设次数上限**，**默认禁止**「每任务至多一轮」「只问一次」「不要再让他试第二次」这类上限（理由：它会让智能体把"还能请用户帮忙"错当成"已经没救了"，过早放弃或事前就禁掉某条路径）；**唯一例外是用户自己要求** —— 「不要打扰我 / 别问我」→ 需要介入时直接如实报「因为没有打扰你，X 拿不到」，不许换路径偷试；「只介入一轮」→ 该任务最多请他介入一次，之后停手如实报；两种情形都要在交付里写明这是**用户的要求**。收手判据固定为两条：用户说不想做、或他自己试过仍被挡。规则 12 末尾加「见规则 16」的指路。`agent-browser` persona 的「试过了还是被挡」分支同步（不再写「不要再要求第二次人工尝试」，改成"要不要再试由用户决定，并照办委派里写明的用户要求"）。文件顶注第 8 条同步（当时"一并保留"的那条上限标注为 2026-09-27 已删除）。
- `preset/design.md`：I12 修订（删除上限，写明默认不设上限、适用范围是所有专家所有任务、用户要求才算例外、收手判据两条，并注明按用户要求删除的日期与理由）；「非功能红线」里提到该上限的那条同步。
- `preset/AGENTS.md`：「模块特有红线」新增一条（禁止给人工介入设次数上限，含例外口径与删除理由）。
- `preset/testing-guide.md`：新增 **M7**（人工介入不得有次数上限 + 规则 16 在位的静态核对，含"历史条目不算违例"的口径）；I11 的 L1 行里"至多一轮"那句同步。
- `README.md`：「登录墙与验证码」表格里「试过了还是被挡」一行改口径，并在表后新增一段「**人工介入没有次数上限**」（默认不设上限、适用所有专家所有任务、唯一例外是用户自己要求「不要打扰」／「只介入一轮」、收手判据两条）；那处描述压缩结果的「同一条路径至多一轮」全部保留**加日期标注**说明它已不存在。
- `docs/evidence.md` §7：「规则缺口复核」的复核表把该上限标为已删除，并追加「同日追加处置」——删除理由、例外口径、落地位置清单、以及"历史条目不回改"的处置。
- **不回改历史条目**：`docs/changelog.md` 里记录当时压缩"保留了什么"的旧条目、README 里那句压缩结论，都按"变更记录只记当时发生了什么"的纪律原样保留（README 那句加日期标注）。
- 未改动：I11 权限闸门、I13 / I14 / I15、`tools/`、`browser/`。生效方式照 preset 口径：**重启 dsh + 新对话**。

## 2026-09-27（晚·二）— 调度 persona 补「事前登录口径」（I12 下半）：请用户手动登录是正常路径

- **问题（用户实测报告 + 源码级复核）**：上一版调度代理会给 `agent_browser` 下「不登录」的要求，而本模式本来就可以请用户手动登录（除非用户说过不登录）。逐行复核 `preset/agent.cordis.yml` 后确认这是**规则缺口**而非模型乱来：调度 persona 里与登录有关的位置只有三处 —— 名册与规则 4（都只把"需要登录"当**路由关键词**）、规则 12（**纯事后**分支，只在专家报墙之后触发，且四个选项里三个是收手 / 降级）。**事前**没有任何一句说"需要登录态时照常派发"，而规则 11 的三选项（切权限 / 降级静态抓取 / 暂不做）与规则 12 的「同一条路径的人工介入每任务至多一轮」都在把调度者推向事前禁掉登录；规则 5 又要求填「本次不做」，却没说不许把「不登录」填进去。全仓检索：这条事前规则**在任何文件里都不存在**。历史证据：`6cfdbe6` 把规则 11 / 12 从 1281 → 812 字符时，选项文案「**我去手动登录**／过验证，已完成」被压成「已手动完成」，归属信息变弱 —— 但旧版同样只有事后分支，属长期缺口。
- `preset/agent.cordis.yml`：**规则 12 补事前半条**（「请用户手动登录是本模式的正常路径，不是失败」+ 不要在委派 prompt 里预先禁止它登录、尤其别把「不登录」写进「本次不做」+ 不要为回避登录先降级静态抓取 + 只有明确知道用户不想登录 / 不想验证时才预先禁止 + 判据「登录由人在有头窗口里完成」约束的是代理不许自己代填密码、不许绕过登录墙，不是「不许请你登录」）；规则 12 的事后四分支**原文不动**、编号不重排。顶注第 6 条同步（并顺手改掉「转达用户的三选一」→ **四选一**，与实际四分支对齐）。`agent-browser` persona 的「判定值不值得介入」补一句：委派里明确写了「不登录」就照办（那是用户的决定），但最终回答要如实写「未登录 → 拿不到 X」，不要写成已完成或"静态抓取已足够"。
- `preset/design.md`：I12 增加**下半**（请用户手动登录是正常入口、禁止派发前预先禁止、判据与来源）；「非功能红线」新增一条（禁止把"请用户手动登录"写成失败路径或事先禁掉它，来源写明是用户实测反馈；并重申用户说了不想登录时禁止再劝、禁止换路径偷试）。
- `preset/AGENTS.md`：「模块特有红线」新增同一条（I12 下半）。
- `preset/testing-guide.md`：I12 新增 **M5**（事前半条的静态核对，含判违例口径）与 **M6**（真实挂载量法，状态记为**有反例、改动后未观测**：上一版调度者确实下过「不登录」）；顺手把辅助检索里 `\|` 与 `|` 的取用口径写清楚（`\|` 是字面竖线，实测命中 0 行；要择一匹配须取用成不带反斜杠的 `|`，行内写作 `\|` 只为不在 GFM 表格里断格）。
- `README.md`：「登录墙与验证码：人工介入协议」导语补明**这是默认路径**（需要登录态才拿得到目标时调度者就该照常派发并请你登录一次；只有你明确说过不想登录 / 不想验证时才走收手），并点明「不许代理代填密码 / 不许绕过登录墙」≠「不许请你登录」这两件事曾被混为一谈。
- `docs/evidence.md` §7：新增「规则缺口复核：调度者事前禁止登录」小节 —— 用户报告（真实挂载观测，转写未提供）、逐行复核表（名册 / 规则 4 / 规则 11 / 规则 12 / 规则 5 / `agent_browser` persona 各自说了什么、缺了什么）、全仓检索结论、`6cfdbe6` 的历史证据、处置清单与"改动后未观测"。
- 未改动：I11 权限闸门（原文不动）、I13 / I14 / I15、`tools/`、`browser/`（登录边界那条红线的措辞不变：仍然禁止代填密码 / 读取 cookie 库 / 验证码识别与指纹伪装）。生效方式照 preset 口径：**重启 dsh + 新对话**。

## 2026-09-27（晚）— 标签页卫生（I9 / I10）：`tabs` 与 `close-tab`、一次性读取不留页

- **问题（实测）**：一轮真实任务之后实例里堆了 **19 个标签页**（12 个携程酒店详情页、3 个只差 query 的列表页、2 个重复的去哪儿首页……）。成因是源码级事实：旧实现里 `text/eval/shot --url <新地址>` 为读一页会 `Target.createTarget` 开新标签，读完只 `cdp.close()`（断连）**从不关目标**，`open` 同样只开不关。
- `browser/lib/cdp.mjs`：新增 `closeTarget(port, targetId)`（浏览器级端点发 `Target.closeTarget`）与纯函数 `pickTabsToClose(targets, {match, tab})`；`pageSession` 现在返回 `created`（这一页是不是本次调用自己开的）与 `target`；顺手修掉 `closeBrowser` 注释里引用不存在的 `design.md I9`（应为 I8）。
- `browser/cli.mjs`：新增 `tabs`（只列标签页，清理前先看）与 `close-tab`（`--match <子串>` 关掉所有匹配的 / `--tab <n>` 关那一个）；`text` / `eval` / `shot` 新增 `--keep`，默认把**自己开的临时标签**读完收走（打 `TAB_CLOSED=`），只关 `created` 的页；USAGE 增加"标签页卫生"段。
- `browser/design.md`：新增第四个对象 **PageTab（清理型）** 与两条不变量 —— **I9**（关标签页必须点名，且不许关到 0 个页面：那等于绕过 `close`）、**I10**（谁开的谁收：`text/eval/shot --url` 的临时页自己收，`open`/`launch` 的页不自动关）；「对外接口」补 `TAB_EXISTS` / `TAB_OPENED` / `TAB_CLOSED` / `CLOSED_TABS`；非功能红线加一条（禁止关别人的页 / 禁止关到 0 个，5 → 6 条）；For Agents 与「不负责」同步。
- `browser/test/browser.test.mjs`：**27 → 34 个用例**。新增 A29..A33（I9 纯函数 + 源码级断言：点名、不猜、越界、缺值、拒绝关到 0 个、`Browser.close` 仍只出现 1 次）与 A35/A36（I10：`created` 标记、三个读取命令都必须走收尾、`--keep` 放行）。
- `browser/testing-guide.md`：I1..I8 → **I1..I10**；不变量全表新增 4 行（两条单元 + 两条真机 A34/A37）；新增第三个状态机矩阵 **PageTab**（含"用户早先开的页绝不自动关"一行）；未观测清单新增"哪一页已经不需要了这个判断没有自动化"；最小闭环加 `tabs` / 一次性读页零残留 / `close-tab` 护栏三步。真机实测：`text --url <新地址>` 后 `TABS` 21 → 21（零残留）、`--keep` → 22、`close-tab --match` → 21；护栏在一次性实例（端口 9444 + 临时 profile）验：命中全部 → 退出码 1 且 `ALIVE=true`。
- `browser/AGENTS.md`：命令块补 `tabs` / `close-tab`（用例 27 → 34），红线加一条（禁止关别人的标签页 / 关到 0 个），跨模块路由加一行。
- `preset/agent.cordis.yml`：`agent-browser` 的 persona 补一段**标签页卫生**（一次性读取会自己收、`--keep` 才留、收尾用 `close-tab --match <站点>` 点名清并保留用户正在用的页、拒绝关到 0 个）；顶注第 11 条与 design.md 的不变量编号同步（I1 / I3 / I8 / I9 / I10）。I11 / I12 语义不动。
- `README.md`：「浏览器工具链与登录态资产」的"三条不变的行为" → **四条**（新增标签页不堆积，附 19 个标签页的实测来源）；示例补 `tabs` / `close-tab`；目录结构补 `PageTab` / 34 个用例 / 三个矩阵。
- `docs/evidence.md` §8：新增「标签页堆积：问题与修复」小节（19 个页的构成、成因、修复后四组实测数字、护栏输出原文），单元测试 27/27 → **34/34**，未观测清单加一条（收尾点名清理没有真实 Adg 会话为证），重测脚本补三行。
- 根 `AGENTS.md`：Quality Gates 第 7 条同步（27 → 34，真机闭环加"零残留"与"拒绝关到 0 个页面"）。`docs/registry.md`：三个 browser 行的描述同步。
- 未改动：`tools/` 全部文件、`preset/preset.yml`、`browser/lib/target.mjs`（标签页规则全在 cdp/cli 两层，`target.mjs` 的纯函数不涉及目标选择）。

## 2026-09-27 — 浏览器工具链入仓：新模块 `browser/` + `agent_browser` 收敛到单一入口

- **新增模块 `browser/`**：`cli.mjs`（唯一入口：`launch` / `status` / `profile` / `open` / `text` / `eval` / `shot` / `close`）、`lib/target.mjs`（纯函数：profile / 端口 / Chrome / 启动参数 / 复用决策）、`lib/cdp.mjs`（最小 CDP 通道 + 会话便捷层，`socketFactory` 可注入）、`test/browser.test.mjs`（**27 个用例**，不需要浏览器）、`package.json`（私有、零依赖、`engines.node >= 22`）、`AGENTS.md` / `design.md` / `testing-guide.md`（不变量 I1..I8）。有头启动优先、实例活着就复用、`close` 是唯一关浏览器的入口。零依赖：只用 `node:` 内建与全局 `fetch` / `WebSocket`。
- **新模块登记**：根 `AGENTS.md` 的 Project Map 与 Context Loading 各加一行、Quality Gates 加第 7 条（`cd browser && node --test test` 27/27）、关键红线加第 10 条、生效方式表加 `browser/` 一行（**重新安装即生效、不用重启**）、导语与命令块同步；`docs/registry.md` 索引表加 3 行、状态表 **13 → 16 条**、"三个模块" → **四个模块**、冷启动三问的"三套" → "四套"。
- `preset/agent.cordis.yml`：`agent-browser` 的 persona 改为「只用 `$DSH_HOME/browser/cli.mjs` 一个入口」（禁止现场手写 CDP 脚本、禁止装 playwright / puppeteer / ws）；profile 口径由"工作区里一个固定目录"改为**固定在 `<DSH_HOME>/browser-profile`、与工作区无关**（旧写法换工作区就换 profile、登录态当场清零）；补「`launch` 幂等、`STATE=REUSED` 不要重启」「任务进行中不要 `close`」「撞墙前先用 `text` 确认是不是真的登录墙」；顶注「实质改动十处」→ **十一处**并加第 11 条。**I11 / I12 两半只改措辞、语义不动**（四组检索命中仍在）。
- `install.ps1` / `install.sh`：部署集合加 `browser/` → `${DSH_HOME:-~/.dsh}/browser/`，输出与小结同步。（`install.ps1` 的 UTF-8 BOM 被编辑工具剥掉后**已补回**，实测前三个字节 `EF BB BF`；`install.sh` 本机没有 `sh`，只做了人工核对。）
- `docs/evidence.md`：新增 **§8**（浏览器工具链真机实测：规范 profile、幂等复用、优雅关闭后 cookie 落盘并跨浏览器重启存活、部署校验、四条未观测、可照抄的重测脚本）；**§7** 的两条未观测按日期复核 —— "cookie 落盘"那半被 §8 **推翻并升为实测**，"真实站点端到端"那半仍标未观测。
- `README.md`：新增「浏览器工具链与登录态资产」一节；`agent_browser` 名册行与「怎么用」派发表同步；「安装」的部署集合加 `browser/`。
- `preset/design.md` / `preset/testing-guide.md`：依赖关系补 `browser/`（被依赖）；新增 **L4**（工具链路径与命令是否指向真实存在的东西：`$DSH_HOME/browser/cli.mjs` 的落点、persona 里的命令名与 `STATE=` / `PORT=` / `PROFILE=` 输出行对照 `cli.mjs` 的 `USAGE`）与 **M4**（禁止代填密码 / 读 cookie 库 / 验证码识别与指纹伪装三条边界是否还在）两条用例；M2 / M3 的措辞同步成"再 `launch` 走幂等复用"。
- `preset/testing-guide.md`（**顺带修的既有缺陷**）：6 行的 `Select-String` 示例把**裸 `|`** 写在行内代码里 —— GFM 表格会在那里切断单元格（行内代码**不**保护 `|`，只有 `\|` 保护），其中一行还正好在解释"`\|` 是字面竖线"。6 处已转义为 `\|`；现在全仓 21 个 markdown 文件的表格列数逐行一致（检查脚本用完即删，未留在仓库里）。
- 未改动：`tools/` 全部文件、`preset/preset.yml`、`bundle/`。

## 2026-09-26（晚·六）— 输出／交接去冗余纪律（I15）：分字段写、不回贴原文、未验证块必填

- `preset/agent.cordis.yml` **规则 5**：补"五项**分字段写**（不要写成一整段散文：这段话专家每一步都会重读）"+ "**期望产出**里写明返回结构：结论 / 证据（`path:line` 或链接）/ 未验证或未纳入（必填）"。171 → 277 字符。
- `preset/agent.cordis.yml` **规则 10**：由一句话（"不要把中间过程原样转述给用户"）扩成**四条去冗余纪律** —— ① 不回贴工具输出原文（给位置就够）② 同一结论只说一次，后文用"见上 / 第 N 条"引用 ③ 不转述中间过程 ④ **"未验证 / 未纳入"必填块不许为求简短省略**；并写明最终答复同样适用。40 → 170 字符。
- `preset/agent.cordis.yml` 顶注：实质改动「九处」→「十处」并新增第 10 条；prefix 块 4584 → **4820 字符**（+236）。顶注写明依据是"输出只占账单 1%，但它会变成上下文"这一算术，以及**纪律一律写成禁止式、不写字数上限**（后者会精确退化成已撤销的那层）。
- `preset/design.md`：新增 **I15**（输出／交接件的去冗余纪律：四条禁止式判据 + 分字段写 + 返回结构 + **明文禁止被改写为字数上限**；依据引 `docs/evidence.md` §1 的 94.1M / 0.9M / 85.1M，并**标注"乘数"部分是由聚合数字算出的推算、不是新实测**；形态依据引 `doc-engineer` 的"约束必须可执行化 / 禁止无据形容词"）；I10 的边界补 I15；非功能红线补一条（禁止把 I15 写成字数上限、禁止为"简洁"省掉未验证块），「12 条」→「13 条」。
- `preset/testing-guide.md`：`I1..I14` → `I1..I15`；新增 **O1**（四条禁止式判据与分字段写是否在位、有没有被写成字数上限，人工 review）与 **O2**（真实挂载，**未观测**，五条量法，含**反向检查**："未验证 / 未纳入"块是否仍齐全）；K1 补 I15 不算预算违例的边界。
- `README.md`：「多智能体的 token 消耗」新增一行（规则 5 / 10 的交接件纪律，**已落地**，含"为什么价值不在那 1%"的理由与四条判据）；四个观测量表新增**去冗余抽查**一行；"成本控制分两层"改**三层**（编排层 / 输出层 / 运行期）；「persona 层保留的政策」「兼容性」（九处 → 十处）与 persona 体积账（4584 → 4820）同步。
- `AGENTS.md`（根）：红线 4 补"一条输出纪律"及其边界（禁止改写成字数上限）；Context Loading 新增输出／交接纪律一行。
- `preset/AGENTS.md`：新增 I15 一条模块红线；导语与路由表各补一行。
- `skills/adg-add-agent/SKILL.md`：第 3 步的"不要动"清单补输出纪律（规则 5 分字段写 + 规则 10 四条）。
- 未改动：`install.ps1` / `install.sh`、`tools/`、`preset/preset.yml`、`docs/evidence.md`（§4 的两行已在晚·五登记，本次未新增）、`docs/registry.md`。

## 2026-09-26（晚·五）— 编排层第五层：验收标准 + 本次不做、必要性闸门 + 强制挂号

- `preset/agent.cordis.yml` **规则 5**：由"四项内容"改为**五项必填** —— 目标 / **验收标准**（怎么算做完，同时是调度者与专家的判据）/ **本次不做**（明确排除的相邻问题：只记录、不顺手做）/ 已知事实 / 期望产出；并写明"没有验收标准的委派不许发出"。53 → 171 字符。
- `preset/agent.cordis.yml` **规则 6**：把"实体"锚点从**检索到的材料**改为**委派最终服务的那条需求 / 那个对象**（要改的代码库、要读的文档库、要操作的站点、要选购的那个产品、要答的那个问题）；并补一条"服务于同一条交付物的旁路调研并在同一条委派里，不许换个检索对象就另开子代理"。406 → 521 字符。
- `preset/agent.cordis.yml` **新增规则 15**：必要性闸门（三问任一"否"就不派：答案会改变交付物吗 / 是验收标准的一部分吗 / 需要专家的能力闭环吗）+ **强制挂号**（不做的旁路必须在最终交付里写「未纳入本次：X（可能影响 Y，未调研）」，不许静默丢掉）+ 旁路确定要做时并进同实体同性质的那条委派。300 字符。
- `preset/agent.cordis.yml` 顶注：实质改动「八处」→「九处」并新增第 9 条；prefix 块 4050 → **4584 字符**（+534，≈130 token/步）。来源写进顶注：一次真实任务的旁路委派（"便携小巧的录音笔" → 为"录音合规性"单独开了一个子代理）。
- `preset/design.md`：I13 由四条扩为**五条**（补必要性闸门 + 强制挂号 + 委派 prompt 五项必填 + "实体"锚点定义，并把旁路委派的实测案例作为**来源**写进依据）；I10 的计数同步；非功能红线补一条"**禁止把未纳入的旁路静默丢掉**"（含理由：静默丢掉比不做这条规则更糟），「11 条」→「12 条」；负责行改五条。
- `preset/testing-guide.md`：I13 的 N1 / N2 / N3 改写为五条规则；新增 **N6**（规则 15 与挂号义务在位，人工 review）与 **N7**（真实挂载，**未观测**，含四个观测量：子代理个数 / 步数 p50-p90 / `requests` / 挂号抽查的三种判定）。
- `README.md`：「多智能体的 token 消耗」新增两行（五项必填、必要性闸门 + 挂号，均**已落地**并给出理由与量法）；把原来那段"怎么判断合并真的落地"换成**四个观测量表**（含 p50/p90 为什么不用均值、挂号抽查的三种判定）；"这一轮的净体积"改写为 persona 体积账（4050 → 4584）；「省 token 的口径」「persona 层保留的政策」「怎么用」第 3 条、「兼容性」（八处 → 九处）同步。
- `AGENTS.md`（根）：红线 4 由四条改五条并补"禁止把未纳入的旁路静默丢掉"；Context Loading 的编排层规则一行补闸门与挂号。
- `preset/AGENTS.md`：模块红线的 I13 一条改五条 + 五项必填；新增"禁止静默丢掉旁路"一条；路由行与导语同步。
- `skills/adg-add-agent/SKILL.md`：第 3 步的编排层规则清单补 15 与五项必填；硬约束的唯一例外由四条改五条。
- `docs/evidence.md` §4 未观测清单：新增两行 —— 五条编排层规则的遵守情况（四个观测量）与"旁路是否被记录而非被做"（含来源与三种判定）。
- 未改动：`install.ps1` / `install.sh`、`tools/` 全部文件、`preset/preset.yml`、`docs/registry.md`。

## 2026-09-26（晚·三）— 编排层再落地三条：压缩浏览器细则、digest 中转、先定位再改

- `preset/agent.cordis.yml` 调度 persona **压缩规则 11 / 12**（只动措辞、不动语义）：删掉与 `agent_browser` persona 重复的失败签名与根因复述（退出码 21 / `platform_channel` / `--no-sandbox` 无效那一段），保留 `danger-full-access` 判定、`ask_user_question` 三选项、四分支处置、「同一条路径每任务至多一轮」。两条合计 **1281 → 812 字符**（占 prefix 块 35.6% → 20.0%）。
- `preset/agent.cordis.yml` 新增**规则 13**：大范围改动先派只读的 `agent_researcher` 出 `path:line` 清单，再让 `agent_coder` 按位改（规则 6 的"性质不同"正例；仓库小或改动点已明确时不加这一跳）。
- `preset/agent.cordis.yml` 新增**规则 14**（digest 中转 + 清理口径）：跨专家传递大材料默认塞进委派 prompt（零文件）；长了才落成文件工件，**只写平台临时根**下的 `adg-digest`、**绝不写进工作区 / 仓库**、后续只传绝对路径、**任务结束即删并如实报告删除结果**、`read-only` 下不造工件；digest 必须被标注为派生材料（冲突以源材料为准）。调度者开场那行"不直接碰文件"补上这个唯一例外。
- `preset/agent.cordis.yml` 顶注：实质改动「七处」→「八处」，新增第 8 条说明（规则 13/14 + 压缩 11/12 的量化）；净体积 prefix 块 3598 → **4050 字符**（+452：规则 13+14 加 868，压缩减 469）。
- `preset/design.md`：I13 由「两条派发拓扑规则」扩展为**四条编排层规则**（补入先定位再改、digest 中转）；新增 **I14**（digest 工件的位置、生命周期、`read-only` 退化与"派生材料"标注，依据 `@deepseek-ai/dsh-fs-sandbox` 包文档「围栏行为」）；非功能红线补一条（禁止写进工作区、禁止未删就宣称已清理），「10 条」→「11 条」；「不负责」补「不拥有文件写入的可用范围」（preset 只能规定写哪、何时删，保证不了写得进去）。
- 根 `README.md`：「多智能体的 token 消耗」三行状态由**建议**改**已落地**并更新量化（压缩 −36.6%、digest 的清理口径、规则 13 与规则 6 的校准关系），补"这一轮的净体积"段；「省 token 的口径」「怎么用」第 3 条、「兼容性」（七处 → 八处）同步。
- `preset/testing-guide.md`：不变量全表 `I1..I13` → `I1..I14`；I13 的 N1/N2/N3 三条改写为"四条规则"；新增 **N4 / N5**（digest 落位与清理，N5 含包文档级机制前提，状态如实标**未观测**）；I11 L1 补一句分工说明（调度那组靠 `danger-full-access` / `完全权限` 命中，搜不到 `platform_channel` 是压缩后的预期形状）。
- `preset/AGENTS.md`、根 `AGENTS.md`：编排层红线由两条扩为四条、新增 digest 落位红线；跨模块路由与 Context Loading 的 I13 引用改为 I13 / I14。
- `skills/adg-add-agent/SKILL.md`：第 3 步的"不要动规则 6 / 规则 7"扩为"不要动编排层与闸门那几条（6 / 7 / 13 / 14 / 11 / 12）"；硬约束的唯一例外由两条改四条。
- 未改动：`install.ps1` / `install.sh`、`tools/` 全部文件、`preset/preset.yml`、`docs/registry.md`、`docs/evidence.md`。

## 2026-09-26（晚·二）— 派发拓扑：同实体合并 + 复用既有专家；去掉无关产品提示词

- `preset/agent.cordis.yml` 调度 persona 新增规则 6 / 规则 7：① **同一实体 + 同一性质**的任务合并成一次委派（判据只有"实体 × 性质"两个维度；同一实体的多个方面列进同一条委派，由一个专家一次通读、按方面分节产出）；② 同一实体的**后续**任务先 `list_agents` 找到既有子代理、再 `send_message` 接给已经读过它的那个专家，不重新开一个。原规则 6–10 顺延为 8–12（权限闸门与人工介入两条现为规则 11 / 12）。
- `preset/agent.cordis.yml` 调度 persona 规则 1 补一句：一两次抓取就能答完的已知 URL 定点核对由调度者自己 `web_fetch`，不为此派子代理。
- `preset/agent.cordis.yml` 去掉全部无关产品提示词：删除文件顶注里的名册出处段（腾讯 Marvis 及其专项 Agent 划分）、五个专家 persona 开头的「参考 Marvis 的 X Agent」、`agent_app` 里对 Marvis GUI 路线的对照，以及名册段的「Marvis 参考组」小标题 —— 能力口径与缺口一字未改，只去掉产品名。
- 根 `README.md`：「专家名册与 Marvis 对应关系」改为「专家名册」（三列 8 行，去掉 Marvis 列与「无对应」标注）；`agent_browser` 行的登录墙口径改为指向人工介入协议；新增「多智能体的 token 消耗：已落地与可选手段」一节（8 条手段 + 状态 + 量法 + 1 条未观测）；「persona 层保留的政策」一节标题改写，并写明它与已撤销那层的边界；顶部「省 token 的口径」、「怎么用」、「兼容性」（六处改七处）同步。
- `preset/design.md`：`SchedulerPersona` 新增不变量 I13（两条派发拓扑规则、判据是"实体 × 性质"、禁止改写成预算）；I10 收窄为只管**子代理预算**并写明与 I13 的边界；非功能红线补一条（禁止删掉这两条规则）；For Agents 的「9 条」改「10 条」；负责清单、依赖关系、跨模块路由同步。
- `preset/AGENTS.md`：模块红线把 I10 一条改写为「子代理预算」并补 I13 一条；跨模块路由补「派发拓扑规则」一行。
- `preset/testing-guide.md`：不变量全表补 I13 三条用例（N1 规则在位 / N2 未写成预算 / N3 真实合并与恢复，如实标**未观测**）；I10 K1、I11 L1、I12 M1 的规则编号与判据同步，并去掉几处会漂移的行号坐标。
- `skills/adg-add-agent/SKILL.md`：落盘步骤第 3 步补「不要动规则 6 / 规则 7」；硬约束里那条"不要写 token／读取预算"补上唯一例外（编排层两条规则）；"旧 allow 6 个工具"改成不写会漂移的数量。
- 根 `AGENTS.md`：关键红线第 4 条补上唯一例外（编排层两条派发拓扑规则约束的是"派给谁、派几次"，不是"单个专家能读多少"）；Context Loading 的调度 persona 一行补 I13 的读法。
- 未改动：`install.ps1` / `install.sh`（部署集合没变）、`tools/` 全部文件、`preset/preset.yml`、`docs/registry.md`、`docs/evidence.md`。

## 2026-09-26（晚）— 登录墙／验证码的人工介入协议

- `preset/agent.cordis.yml` 调度 persona 新增规则 10：浏览器专家报「需要用户人工介入」时**由调度者去问用户**（专家问不了，见下），四分支处置 —— 「我去手动登录／过验证，已完成」→ 重新派发同一个 `agent_browser` 并带上端口/profile，要求它 **CDP 重连旧实例**；「不想登录或验证」→ 停手如实汇总；「试过了还是被挡」→ 停手换方案、同一条路径的人工介入每任务至多一轮；「换种方式」→ 走降级路径或改派。并注明不是完全权限时人工介入同样走不通。
- `preset/agent.cordis.yml` 的 `agent_browser` persona：新增「人工介入协议」一段（有头浏览器 + 固定 `--user-data-dir`/`--remote-debugging-port` + 分离启动 → 报四件事 → 停手，**不在工具调用里等用户**；重派时 CDP 重连旧实例、靠端口/profile 而非 pid 定位；三条用户反馈对应的停手口径），并把原「边界与协作」里那句「立刻停止并请用户介入」改成指向该协议。
- `preset/agent.cordis.yml` 文件顶注：实质改动由「五处」改「六处」，补第 6 条（人工介入为什么只能由调度者转达：`ask_user_question` 按 preset 注册且 `ask()` 只认 live runtime root，子代理拿 `DELEGATED_CALLER`）。
- `preset/design.md`：`SchedulerPersona` 新增不变量 I12（专家行不得直接问用户、不得把 `ask_user_question` 加进 `allow`、同一条路径人工介入至多一轮）；「不负责」补一条（不拥有用户问答通道）；非功能红线补一条；For Agents 的「8 条」改「9 条」。
- `preset/AGENTS.md`：模块红线补 I12；跨模块路由补「登录墙／验证码的人工介入」一行。
- `preset/testing-guide.md`：不变量全表补 I12 的三条用例（M1 allow 机器可读 + 语义判读、M2 分工两半、M3 真实重连，如实标**未实现**）；I11 的 L1 用例按实测把命中位置由「三处」更正为「四组」（新协议段末句也命中权限关键字）。
- 根 `README.md`：在浏览器那节新增「登录墙与验证码：人工介入协议」一小节（四分支处置表、为什么专家问不了、窗口怎么开的三条机制实测、两条未观测）；「兼容性」的实质改动清单由五处改六处并补一条「人工介入也只能由调度者转达」。
- `docs/evidence.md`：新增 §7「子代理能不能直接问用户？人工介入的可行路径」（四条源码级事实表 + 有头窗口存活／跨调用 CDP 重连的五条机制实测 + 三条未观测 + 重测口径）；证据来源表补一行人工介入探测脚本；§4 未观测清单补三条（真实站点端到端、关掉浏览器后靠 profile 复用登录态、调度者是否真的转达）。
- `docs/registry.md`：`docs/evidence.md` 行的索引补 §7。
- 未改动：`install.ps1` / `install.sh`、`tools/` 全部文件、`skills/adg-add-agent/SKILL.md`、`preset/preset.yml`。

## 2026-09-26 — 浏览器专家的权限前置闸门

- `preset/agent.cordis.yml` 调度 persona 新增规则 9：派发 `agent_browser` 前先读自己上下文里的 `Current DSH file policy:`，不是 `danger-full-access` 就先 `ask_user_question`（三选项：已切权限继续 / 降级只做 `web_fetch` 静态抓取 / 暂不做），答已切换后还要确认那行真的变了才派发。
- `preset/agent.cordis.yml` 的 `agent_browser` persona：原「实现口径」一段替换为「权限前提 + 失败签名早停 + 降级口径」，写明 `workspace-write` / `read-only` 下浏览器起不来的两条签名（Chrome 退出码 21、Edge `platform_channel.cc … 拒绝访问。(0x5)`）与「不许反复换参数重试、不许假装完成」。
- `preset/agent.cordis.yml` 文件顶注：实质改动由「四处」改「五处」，补第 5 条（权限闸门及其为什么不能从 preset 侧修），并在「刻意没有做的事」里登记未采用 `tools/pre-execute` 硬拦的理由。
- `preset/design.md`：`SchedulerPersona` 新增不变量 I11（派发 `agent_browser` 前必须有权限闸门、且闸门只能是提示级）；「不负责」清单补一条（不拥有沙箱与审批栈的**判定入口**）；非功能红线补一条（禁止删掉或绕过该闸门）。
- `preset/AGENTS.md`：模块特有红线补一条（I11）。
- `preset/testing-guide.md`：不变量全表补 I11 的两条用例（人工 review + 本地文本检索），如实标注**未实现**。
- 根 `README.md`：新增「浏览器专家需要完全权限」一节（A/B 真机实测表、三问三答的源码依据、两道闸门的口径、备选方案的取舍、「这是流程闸门不是安全边界」）；专家名册 Browser Agent 行、怎么用派发表 `agent_browser` 行、「兼容性」的实质改动清单与两条说明同步。
- `docs/evidence.md`：新增 §6「浏览器自动化的沙箱前提（真机实测 A/B）」；§4 未观测清单补两条（闸门是否真的触发、沙箱外手工拉起浏览器 + 连 CDP 端口）；证据来源表补一行沙箱探测脚本。
- 未改动：`install.ps1` / `install.sh`（部署集合没变）、`tools/` 全部文件、`skills/adg-add-agent/SKILL.md`、`preset/preset.yml`。
- 引用真实性复核（按 `docs/docs-guide.md` §5 逐条判存在），更正三处：`docs/evidence.md` 证据来源表与 §6 里那个不存在的 `probe2-*.err.txt` 改成实际文件名形状 `<变体>.out.txt` / `<变体>.err.txt`（如 `edge-dumpdom.err.txt`）；根 `AGENTS.md` 去掉手写的「`README.md`（905 行）」行数（已漂移到 986，且规范禁止手写会漂移的副本）；README 小节标题去掉括号后缀，让全仓 9 处「浏览器专家需要完全权限」引用逐字命中标题。

## 2026-09-25（晚·三）— 按对抗性审查结论修正文档

- 删除 `preset/design.md` 里指向不存在文件的契约引用（`docs/contracts/roster.md`），改为直接指向 `preset/agent.cordis.yml` 的 `delegation` 组并注明是唯一真相源。
- 去掉文档里所有手写行数：`docs/docs-guide.md` 与本文对根 `AGENTS.md` 记的"58 行"是过期值（实测 81 行），一律改成不写当前行数；`preset/design.md` 里 8 个专家行的具体行号（280/307/…）改为按 `id` 定位（行号会被任何一次编辑改掉，需要坐标就跑自检脚本）。
- 对象形态判错修正：`tools/design.md` 的 `KnobRow` 由"受控操作对象"改判为**不可变值对象**（只读投影，无批准接口、无特权操作封装），`ExitStatus` 删掉状态机、改为**返回契约 + 不变量**。
- 无条件化不变量：`preset/design.md` I3 由带"在…情况下"的条件式拆成两条无条件式（禁止不附前后对比数字就改成本结论 / 禁止把 §1 基线当可比基线）。
- 消除手抄副本：`tools/design.md` 不再复述三个插件的出厂默认值数字，改为指向 `check-preset.mjs` 的 `FACTORY_DEFAULTS`。
- 补登记一条能力边界：`tools/testing-guide.md` 记下自检脚本的行匹配器写死 4 空格缩进，缩进一变整段专家行检查会**静默跳过并仍报通过**。
- `preset/design.md` 补登记 `agent-instructions` 那一行**不是专家委派行**（位于 `delegation` 组之外，自检的专家行检查不覆盖它）。
- 体例统一：状态分层的第二档统一为"单元 / 静态检验 / 变异验证"。

## 2026-09-25（晚·一）— 沙箱测试口径修正（本次交付的附带发现）

- 修正文档层里对沙箱测试口径的描述：DSH 沙箱（`workspace-write`）下 `node --test test` 必因 piped-stdio 子进程被拒而报 `spawn EPERM`，必须用 `node --test --test-isolation=none test`；PowerShell 管道 `|` 另被拒为 `Access is denied`，重定向到文件允许。

## 2026-09-25（早）— 新增文档层（本次交付）

- 新增根 `AGENTS.md`：项目一句话、命令、关键红线 9 条、生效方式两条链路、模块地图、Context Loading 路由、Quality Gates、能力边界。
- 新增 `preset/design.md`（I1–I10）/ `preset/AGENTS.md` / `preset/testing-guide.md`。
- 新增 `tools/design.md`（I1–I9）/ `AGENTS.md` / `testing-guide.md`。
- 新增 `docs/docs-guide.md`（写作规范与文档分层契约）、`docs/registry.md`（索引与冷启动三问的答题路径）、`docs/evidence.md`（实测证据台账）。
- `docs/` 下不建 `_index.md`（当前 4 篇；`docs/registry.md` 即该目录的索引页）。
- 既有文件一律未改：`README.md`、`preset/*.yml`、`tools/check-preset.mjs`、`skills/adg-add-agent/SKILL.md`、`install.ps1` / `install.sh`。
