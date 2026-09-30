---
title: check-preset.mjs 校验器 模块设计
owner: Adg preset 维护者
status: current
last_reviewed: 2026-09-30
---

## 职责与边界

负责：对 `preset/agent.cordis.yml`（**仓库里的这一份就是唯一真相源** —— 旧 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>/` 机制在 dsh 0.1.7-rc.2 已被移除，不再有"已安装的第二份文本"）做**零依赖的逐行静态扫描**，把"这些硬约束在文本上被破坏"的情形提前拦下来——行尾/末尾换行/BOM、专家行字段齐全、`toolName` 唯一且形如 `agent_<name>`、`allow` 只写已注册工具名、不存在通用委派行、调度名册与专家行双向一致、承载三组体积旋钮的三行结构完好（含"万一某键被写回时"的合法性），并在 stdout 打印两行生效值摘要。

不负责（逐条，防越权）：

- **不是 YAML 解析器。** 证明不了整份文件能被 YAML 解析，更证明不了解析结果等于写的人以为的结构。
- **不证明插件真的挂载。** 包能否解析、行是否被 `disabled` 或条件表达式关掉、服务是否发布了全局 realm——这三类只有真实挂载能证明：`agentPresets.resolve('adg')` 的 `.broken` 为空（**判据**）与 `agentPresets.compositionInventory()` 的形状（`entryId` / `moduleName` / `enabled` / `fiberState`）。`standingKeyFor` 在本版 dsh 里**已不存在**，别照旧文档调它。
- **不校验 `plugin/dsh-adg-token-budget`。** 插件那一层它完全没覆盖：能否 import、行有没有激活、`stepNudge` / `stepTiers` 生效值是什么，只能看宿主日志与 `logFile`。
- **不修改任何文件。** 只读目标，不写、不格式化、不修 BOM。
- **不部署。** 复制到用户根是 `install.ps1` / `install.sh` 的职责。
- **不校验 `KNOWN_TOOLS` 之外的工具是否在当前这台机器上注册。** 条件性注册的名字（`bash` / `read_image` / `subagent_codex` / `subagent_claude_code`）只给 WARN——静态检查求值不了条件表达式，也判断不了服务是否挂载。

## 依赖关系

- 依赖：Node 内建 `node:fs`（`readFileSync` / `statSync`）、`node:url`（`fileURLToPath`）、`node:path`（`dirname` / `join` / `resolve`）。**零第三方依赖，不引入 YAML 库**——文件形状由本仓库自己固定，逐行扫描足够。
- 依赖的事实来源（改这几处时必须重新核对本模块的常量）：
  - `skills/adg-add-agent/SKILL.md`「硬约束」小节里的硬约束与实测事实；
  - 三个插件包的**出厂默认值**：见 `tools/check-preset.mjs` 的 `FACTORY_DEFAULTS`（**唯一真相源**——本文件不复述具体数字，换插件版本时会漂移，脚本只把它当对照）。
  - **构建期注入组的组表**：见 `tools/flavors.mjs` 的 `INJECTION_GROUPS` / `GROUP_ORDER`（**唯一真相源**——旗标、包名、注入的工具名、故意不注入的名字、是否关自动压缩、味道键与目录名的拼法、探测判据全在那里；`check-preset.mjs` / `gen-preset-bundle.mjs` / `check-bundle-flavor.mjs` / `has-bundle.mjs` / `resolve-flavor.mjs` 一律 `import` 它，本文件不复述里面的字符串）。
- 被依赖：
  - `skills/adg-add-agent/SKILL.md`（改完 preset 跑它，并在它的正文里描述本模块的检查范围与边界）；
  - `install.ps1` / `install.sh` 的交付说明（把"preset 改动要重启"与本模块的门禁位置讲给用户）；
  - `preset/AGENTS.md`——该模块把本模块当门禁引用。
- 跨模块改动路由：
  - 改 composition 的 tool 行 → **必须同步 `tools/check-preset.mjs` 的 `KNOWN_TOOLS`**（理由见下一条），改完读 `preset/design.md`；
  - 改三个旋钮插件的版本或包名 → 同步 `FACTORY_DEFAULTS` 与 `EXPECTED_ROWS` 的 `name` / `allowedKeys`，并读 `docs/evidence.md`。**包名会随 dsh 升级改名**（2026-09-28 实例：引擎行 `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`），所以这一步是**每次 dsh 升级后**都要重核的，不是一次性的。

## 核心数据模型

### Finding（不可变值对象）

一条 `ERROR` 或 `WARN`，创建后内容冻结；报告阶段按类别批量打印，不做二次改写。

- 属性：类别（`ERROR` / `WARN`）、文本（含出错行号与 `id`，便于直接跳到 composition 那一行）、所属不变量（I1..I9 里能被追溯到的那一条，供用例表对齐）。
- 不变量：
  - I1: **ERROR 的含义只有一个——这次委派必然抛错**（例如 `allow` 里写了未注册的工具名，`restrict()` 会抛 `names unknown global tool ...`）。策略性越界（`workflow` / `ralph`）与条件性注册（`bash` / `read_image` / `subagent_codex` / `subagent_claude_code`）**禁止**判成 ERROR，只能 WARN。
  - I2: **禁止**把"取值等于某个数"写成判错。钉死取值的口径已撤销：本 preset 一律用插件出厂默认值，`FACTORY_DEFAULTS` 只在报告里当对照。

### KnobRow（不可变值对象）

承载体积旋钮的三行：`compaction-basic` / `tool-result-pruner` / `tool-web`。三行各有期望包名，由 `EXPECTED_ROWS` 声明。

**这是只读投影，不是受控操作对象**：脚本没有任何"批准"接口、不封装任何特权操作；三个结构守卫（行存在 / 包名正确 / 未被 `disabled` 且 id 不重复）是**检查器的前置条件**，不是对象上的门。本仓库真正的受控操作对象在 `preset/design.md` 的 `PresetRevision`（deploy 门）。

- 属性：行号、`id`、`name`、`disabled`、`config:` 下的键值路径（`paths` / `pathLines` / `rootScalars`）。
- 无状态机（值对象一律写不变量）。**禁止**把"解析完成 / 已校验"读成对象的状态：一轮检查的信息由 `Finding[]` 与 `ExitStatus` 承载，对象本身始终是同一份原文快照。
- 唯一的读取入口是 `readRowBlock()`。**禁止绕过它直接读原文**，也**禁止"命中多行时取第一条了事"**——重复 id 必须报错，因为"哪一行生效"不可判定。
- 不变量：
  - I3: 三行必须存在、`name:` 必须是期望包名、不得 `disabled: true`、同一 `id` 不得重复。
  - I4: 万一某个旋钮键被写回，它必须**直挂**在 `config:` 下；嵌得更深、或提到与 `name:` 同级，都必须在报错里点名。
  - I5: 被写回的取值必须落在插件会接受的范围内——两个 ratio ∈ (0, 1] 且 `retainRatio < thresholdRatio`；pruner 三个键为正整数且 `headChars + 标记(39) + tailChars ≤ thresholdChars`；`fetchMaxOutputChars ≤ 200000`，且 `> 60000` 另给 WARN。
  - I6: `config:` 里出现插件不认识的键必须报错并点名（插件校验键集时会抛 unknown key，整行挂载失败）。
  - I7: pruner 的算式**必须**带上 39 字符标记（`PRUNER_MARKER_CHARS = 39`）；只看 `head + tail` 会漏掉它，历史上曾因此让一个越界的覆盖蒙混过关。

### ExitStatus（不可变值对象）

脚本的退出码，取值集合固定为 `{0, 1, 2}`。

- 属性：`0` 通过（允许有 WARN）、`1` 有 ERROR、`2` 目标不存在或不是普通文件。
- 无状态机：退出码是**进程的返回契约**（`readTarget()` 的返回/退出分支与报告末尾的 `process.exit`），不是对象的生命周期。三码的判定规则写成不变量（I8/I9），不写成迁移。
- 两条必须说清的语义：`unreadable` 判定必须先 `statSync().isFile()`（目录在 Windows 上会被 `readFileSync` 读到垃圾字节，而不是报错）；`passed` 不是"运行期会生效"，`failed` 不是"挂载会失败"（挂载失败另有四类原因，见边界）。
- 不变量：
  - I8: **禁止**把 WARN 当成失败：有 WARN 而 ERROR 为 0 时，退出码必须为 `0`（否则 CI 会把"通过"判成失败）。
  - I9: **禁止**把 `exit 0` 解读为"运行期一定按这个口径生效"；它只承诺"这些硬约束在文本上没被破坏"。

## 对外接口

命令行（脚本式 CLI，无公开 API）：

```
node tools/check-preset.mjs [<path-to-agent.cordis.yml>]
```

省略参数时校验仓库里的 `preset/agent.cordis.yml`；传路径即校验那一份**文本**（路径参数还在，但**没有第二份"已安装的文本"**可传了 —— 安装侧的真相是 profile 里注册的声明行，它由 `tools/gen-preset-bundle.mjs` 生成）。退出码契约：`0` 通过（允许 WARN）、`1` 有 ERROR、`2` 目标不存在/不是普通文件。stdout 打印报告，其中两条是生效值摘要行：`体积旋钮（生效值）` 与 `裁剪后实际吐出（按生效配置算）`；读不到目标时的原因走 stderr。

模块内导出面：**无**。`KNOWN_TOOLS` / `CONDITIONAL_TOOLS` / `SCHEDULER_ONLY` / `FACTORY_DEFAULTS` / `EXPECTED_ROWS` / `PRUNER_MARKER_CHARS` 都只是本文件内的常量，不 `export`——要读它们只能读源码。调用方（技能、安装脚本、CI）一律只按"退出码 + stdout 摘要行"消费。

## 构建期注入组与味道（`tools/flavors.mjs`）

`tools/` 里除校验器与生成器外还有一份**组表**：`tools/flavors.mjs`。它回答四个问题，且每题只有这一处答案。

1. **有哪些注入组**：`INJECTION_GROUPS`，顺序由 `GROUP_ORDER = ['billion-context', 'save-token']` 固定（它同时决定 `allow` 里名字的追加顺序）。一组 = 一个旗标（`--with-billion-context` / `--with-save-token`）+ 一个插件包名 + 该组注册在**全局层**的工具名 + 故意不注入的名字（`notInjected`）+ 是否顺手关掉 preset realm 里 `compaction-basic` 的 `auto`。
2. **味道是"组的集合"，不是枚举**：`plain` = 空集；其余键按 `GROUP_ORDER` 把各组的 `flavorToken` 用 `+` 连起来（`bili` / `save-token` / `bili+save-token`）。`flavorKeys()` / `parseFlavorKey()` 都按组表算。**把味道写成枚举是这类机制最容易犯的错**：加第三个组时手写的枚举会漏掉半数组合，而组表推导一次就对。
3. **稳定目录名是推导结果**：`dirNameFor(key)` —— 空集是 `DIR_PREFIX`（`dsh-adg-preset`），否则 `dsh-adg-preset-` + 各 token 以 `-` 连接（味道键里的 `+` 换成 `-`）。**文档与脚本都不许写死这串名字**；安装脚本用 `resolve-flavor.mjs` 的输出拿目录名，而不是自己拼。
4. **怎么判断一个 profile"装着某个组"**：`probeBundle(profilesDir, profile, packageName)` = ① 包名在该 profile 的 `dsh.profile.bundles` 里（**声明选中**）；**且** ② 该 profile 的 `node_modules/<包名>/` 下真的有这个包自己的补丁文件。两条都要，因为它们各自会失效：
   - 只看 ①：清单里写了名字、`node_modules` 里却没有实体（依赖没装成、链接断了）—— 此时把工具名注入 `allow` 等于给了一个不存在的工具，`restrict()` 抛 `names unknown global tool`；
   - 只看 ②：包被别的东西当传递依赖带进来，而 profile 并没有**选中**这个 bundle —— 插件其实没挂载，"注入"同样是幻觉；
   - 补丁文件名**从包自己的 `package.json` 的 `dsh.bundle.patch` 字段读**（billion-context 是 `./dsh.bundle.patch.yml`、`dsh-plugin-save-token` 是 `./cordis.patch.yml`），读不到才退回历史名 `dsh.bundle.patch.yml`。写死历史名的后果不是报错而是**静默漏判**：新插件换文件名时判据恒为假、味道恒落 plain，而没有任何一处会说出来。
5. **谁做映射、谁做判定**：`resolve-flavor.mjs` **只做"键 → 目录 → 旗标"的映射**，不探测、不做 auto/on/off 决策。这样它能在没有 profile 的机器上被调用、也能被直接喂输入测试；探测（`has-bundle.mjs`）与覆盖策略（安装脚本）各自独立，任一环换实现都不影响另外两环。

**加一个新的注入组**（例如某个新插件往全局层注册 `foo`）：只改 `tools/flavors.mjs` 的 `INJECTION_GROUPS` 加一项（旗标 / 包名 / 工具名 / `flavorToken` / `missingHint` 等），再在 `GROUP_ORDER` 里插上它的位置。之后自动获得：新的味道键与稳定目录名、`gen-preset-bundle.mjs` 的新旗标、`check-preset.mjs` 的"手写即 ERROR"拦截（清单从组表推导，不在校验器里另抄）、`check-bundle-flavor.mjs` 的逐组断言、`has-bundle.mjs --package=<新包>` 与 `resolve-flavor.mjs --<新组>`。**禁止**在校验器、生成器、检查器或文档里另抄一份名字清单 —— 那正是这套机制要消灭的漂移源。

## 非功能红线

- 禁止引入第三方依赖或 YAML 库（来源：零依赖是它的部署前提——本仓库没有 `node_modules`，安装脚本与技能都假设"克隆下来直接能跑"）。
- 禁止钉死体积旋钮取值（来源：撤销 preset 侧体积闸门那次实测——截断与提前压缩会把工具已取到的事实切掉）。
- 禁止把"文本扫描通过"说成"挂载成功"（来源：README「自检到底静态挡住了什么」——`exit 0` 与真实挂载是两件事）。
- 禁止教人传"已安装的那一份"路径，也禁止把 `$DSH_HOME/bundles/` 或 `bundle/` 下的生成物当校验对象的真相源（来源：`.agent-presets/<id>/` 机制已被 dsh 0.1.7-rc.2 移除，仓库里那份是**唯一**文本真相源；生成物每次安装都被覆盖）。
- 改 tool 行必须同步 `KNOWN_TOOLS`（来源：`restrict()` 实测抛 `names unknown global tool`——漏同步会让合法名字被误报，或让拼错的名字漏报）。
- 禁止在校验过程中写目标文件（来源：评审决定——校验器必须能在只读介质上跑）。

## For Agents

动手前先读：`tools/AGENTS.md` → 本 `design.md`；要改判错口径，先读 `preset/design.md` 的 I5 / I6。

绝不能做：

- 把一条 WARN 改判成 ERROR，却拿不出"这次委派必然抛错"的依据；
- 用它的 `exit 0` 代替真实挂载校验；
- 在校验路径里引入依赖、写文件或联网。

停止并升级人类的时机：要求它承担 YAML 解析；要求它校验插件是否挂载；要求它重新钉死体积旋钮取值。

## 测试与验证

见 `tools/testing-guide.md`（不变量 I1..I9 的用例、两个状态机的迁移矩阵、跨模块消费侧契约，以及本校验器**故意不做**的检查清单都在那里）。
