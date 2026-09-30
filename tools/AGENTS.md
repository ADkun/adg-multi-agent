# AGENTS.md — tools

`tools/` 有六个脚本：

- `check-preset.mjs` —— Adg preset 组合文件的零依赖静态校验器（本模块的主体，设计见 `tools/design.md`）。它拦"**构建期注入组的名字**被手写进源文件"，而那份名字清单**从 `tools/flavors.mjs` 推导**、不在这里另抄一份。
- `gen-preset-bundle.mjs` —— 把 `preset/preset.yml` + `preset/agent.cordis.yml` + `preset/bundle.package.json` 生成成 bundle（`bundle/adg-<味道>/{cordis.patch.yml,package.json}`；不传位置参数时才落到缺省出海目录 `bundle/adg-preset/`）的构建脚本；带 `--with-billion-context` / `--with-save-token`（可叠加）时，给 9 个专家行的 `allow` 追加对应组注册在**全局层**的工具名，billion-context 组还要给 `compaction-basic` 行注入 `config: {auto: false}`（红线 10）。**设计记录在它自己的头部注释里**（为什么不引 YAML 库、生成形状、退出码、能力边界），本文不复制。
- `check-bundle-flavor.mjs` —— **产物**自检：读一份生成出来的 `cordis.patch.yml`，按 `plain` / `bili` / `save-token` / `bili+save-token` **逐组**断言：① 9 个专家行的 `toolFilter.allow` 里，该在的组必须**全有**、不该在的组**一个都不能出现**，并拒绝 `acp_cache`（它在该组的 `notInjected` 里，理由见 `README.md` 的「与构建期注入组协同」）；② `compaction-basic` 行的 `config.auto` **只在 billion-context 组激活时**恰好是 `false`（其余味道则断言这个键不存在）。存在的理由：`check-preset.mjs` 读的是**源文件**，专家行在第 4 列；生成物里它们被嵌进 `delegation` 组、在第 14 列 —— **产物是源文件校验器的盲区**，注入有没有真生效只能这样验。
- `flavors.mjs` —— **构建期注入组的单一事实来源**：组表 `INJECTION_GROUPS`（旗标 / 包名 / 注入的工具名 / 故意不注入的名字 / 是否关自动压缩）、固定的组顺序 `GROUP_ORDER`、味道键与稳定目录名的拼法，以及探测判据 `probeBundle`。其余脚本一律 `import` 它，**不另抄清单**（抄了迟早会漂，漂的后果是"委派全部抛 `names unknown global tool`"或"专家收到通知却没有工具"）。
- `has-bundle.mjs` —— 探测入口：`node tools/has-bundle.mjs <profilesDir> <profile> [...] [--package=<包名>]`，每个 profile 一行 `<name>\t<0|1>`（缺省包名 `billion-context`，历史默认值；`install.ps1` / `install.sh` 对每个注入组各调一次）。判据实现在 `flavors.mjs` 的 `probeBundle`：包名在该 profile 的 `dsh.profile.bundles` 里 **且** 装上的那份包里真的有它的 patch 文件 —— 文件名**从该包自己的 `package.json` 的 `dsh.bundle.patch` 读**（billion-context 是 `./dsh.bundle.patch.yml`、`dsh-plugin-save-token` 是 `./cordis.patch.yml`），读不到才退回历史名 `dsh.bundle.patch.yml`。它只决定**味道**（这个 profile 该拿哪一份生成物），与任何插件启不启用无关。
- `resolve-flavor.mjs` —— `node tools/resolve-flavor.mjs [--billion-context] [--save-token]`：把"这个 profile 装着哪几组"翻成一行三列 TSV `<味道键>\t<稳定目录名>\t<该味道的 gen 旗标>`，供安装脚本挑选生成物（`--<组>` 表示**这个 profile 装着该组**，由 `has-bundle.mjs` 探测得到）。它只做"键 → 目录 → 旗标"的映射，**不做探测**（探测是 `has-bundle.mjs` 的事，auto/on/off 的判定也留调用方）。

**本模块 `AGENTS.md` 的创建理由**（三样信号齐了，不是噪音）：它有独立于根目录的命令（`node tools/check-preset.mjs`，退出码就是门禁；`node tools/gen-preset-bundle.mjs`，`install.*` 每次安装都调它）；有模块特有红线（ERROR 只代表"必然抛错"、禁止钉死取值、`KNOWN_TOOLS` 必须与 composition 同步、**生成物不许手改**）；有跨模块路由要求（改判错口径要读 `preset/design.md`）。设计细节一律不写在这里，全部指向 `tools/design.md` 或脚本头部注释。

## 命令

```sh
node tools/check-preset.mjs        # 校验仓库里的 preset/agent.cordis.yml（唯一真相源）
node tools/gen-preset-bundle.mjs   # 不带旗标 = plain；不传位置参数时才落到缺省出海目录 bundle/adg-preset/（构建产物，在 .gitignore 里；不手改）
# 改过 gen 或 agent.cordis.yml → 四种味道都要生成并各自验一遍（根 AGENTS.md 质量门 1b）：
node tools/gen-preset-bundle.mjs bundle/adg-plain && node tools/check-bundle-flavor.mjs bundle/adg-plain/cordis.patch.yml plain
node tools/gen-preset-bundle.mjs --with-billion-context bundle/adg-bili && node tools/check-bundle-flavor.mjs bundle/adg-bili/cordis.patch.yml bili
node tools/gen-preset-bundle.mjs --with-save-token bundle/adg-save-token && node tools/check-bundle-flavor.mjs bundle/adg-save-token/cordis.patch.yml save-token
node tools/gen-preset-bundle.mjs --with-billion-context --with-save-token bundle/adg-bili-save-token && node tools/check-bundle-flavor.mjs bundle/adg-bili-save-token/cordis.patch.yml bili+save-token
# 探测与味道映射（安装脚本对**每个注入组各问一次**，再拿结果去映射目录与旗标）：
node tools/has-bundle.mjs ~/.dsh/profiles web [desktop ...]                       # 每 profile 一行 "<name>\t<0|1>"（缺省探测 billion-context）
node tools/has-bundle.mjs ~/.dsh/profiles web --package=dsh-plugin-save-token    # 换一组问同一个 profile
node tools/resolve-flavor.mjs --billion-context --save-token                      # "<味道键>\t<稳定目录名>\t<gen 旗标>"
```

**没有"已安装的那一份"可以传路径了**：旧 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>/` 目录发现机制在 dsh 0.1.7-rc.2 已被移除（**实测**），仓库里的 `preset/agent.cordis.yml` 就是唯一文本真相源；安装侧的真相是 profile 里注册的声明行。

退出码（`check-preset.mjs`）：`0` 通过（允许有 WARN）、`1` 有 ERROR、`2` 目标不存在或不是普通文件。stdout 里两行摘要是 `体积旋钮（生效值）` 与 `裁剪后实际吐出（按生效配置算）`。零依赖，不需要 `node_modules`。`gen-preset-bundle.mjs` 的退出码：`0` 成功 / `1` 输入缺失、形状不符或不认识的旗标（错误在 stderr；两旗标叠加合法）。`check-bundle-flavor.mjs`：`0` 断言成立 / `1` 有 ERROR（专家行数不是 9、该在的组缺名字、不该在的组出现名字、出现了该组 `notInjected` 里的名字、`compaction-basic` 的 `auto` 值/有无与该味道不符）/ `2` 参数、味道键或文件不对。`has-bundle.mjs`：`0` 正常输出 / `2` 缺参数或包名为空（它**不因 profile 没挂那个包而失败**——那是数据，不是错误）。`resolve-flavor.mjs`：`0` 成功 / `2` 不认识的旗标或位置参数。`flavors.mjs` 不是 CLI，没有退出码。

## 模块特有红线

1. **ERROR 只留"这次委派必然抛错"的情形**（例：`allow` 里写了未注册的工具名）。策略性越界（`workflow` / `ralph`）与条件性注册的名字（`bash` / `read_image` / `subagent_codex` / `subagent_claude_code`）禁止判成 ERROR——见 `design.md` I1。
2. **禁止把"取值等于某个数"写成判错**（体积旋钮一律用插件出厂默认值）。见 `design.md` I2、I5。
3. **改 composition 的 tool 行必须同步 `KNOWN_TOOLS`**（漏同步会误报或漏报，`restrict()` 的后果见 `design.md` 非功能红线）。
4. **禁止把 WARN 当失败，也禁止把 `exit 0` 说成"运行期一定生效"**。见 `design.md` I8、I9。
5. **禁止在校验路径里引入第三方依赖、写文件或联网**（零依赖是它的部署前提）。
6. **生成物不许手改**：`bundle/adg-plain/`、`bundle/adg-bili/`、`bundle/adg-save-token/`、`bundle/adg-bili-save-token/`（安装脚本每次都显式传位置参数；不传位置参数时才落到缺省出海目录 `bundle/adg-preset/`）是 `gen-preset-bundle.mjs` 的产物（`.gitignore` 忽略、每次安装都被覆盖）。`$DSH_HOME/bundles/` 下那**四个稳定目录**（`dsh-adg-preset` = plain、`dsh-adg-preset-bili`、`dsh-adg-preset-save-token`、`dsh-adg-preset-bili-save-token`）只是它的落点，按**每个 profile 的注入组探测结果**各选一份（见根 `AGENTS.md` 红线 10）。**落点目录名不要写死**，以 `flavors.mjs` 的 `dirNameFor(key)` 为准（味道键里的 `+` 换成 `-`；安装脚本用 `node tools/resolve-flavor.mjs` 拿 `<味道键>\t<稳定目录名>\t<gen 旗标>`）。要改就改 `preset/` 的源文件再重新生成（`preset/design.md` I3c）。

## 跨模块路由

- 加 / 改一个**构建期注入组**（要注入新的全局层工具名、或换包/换旗标） → 只改 `tools/flavors.mjs` 里那一处组表，其余脚本与文档按它推导；设计理由见 `tools/design.md`。
- 改判错口径或改 composition 的 tool 行 → 先读 `preset/design.md`（体积旋钮与 `allow` 的约束）。
- 改三个旋钮插件的版本 / 包名 / 键集 → 先读 `docs/evidence.md`，同步 `FACTORY_DEFAULTS` 与 `EXPECTED_ROWS`。**包名会随 dsh 升级改名**（2026-09-28 实例：`@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`），所以每次 dsh 升级后都要重核一遍。
- 改 bundle 的生成形状（读哪些源文件、写出什么、缩进与标量转义） → 先读 `gen-preset-bundle.mjs` 头部注释与 `preset/bundle.package.json`；消费方是 `install.ps1` / `install.sh`。
- 想知道本模块的用例怎么跑 → `tools/testing-guide.md`。

## 能力边界（不许越界宣称）

`check-preset.mjs` 是**逐行文本扫描器，不是 YAML 解析器**：证明不了整份文件能被 YAML 解析；**也不证明插件真的挂载**——包能否解析、行有没有被关掉、服务有没有发布到全局 realm，只有真实挂载能证明（`agentPresets.resolve('adg')` 的 `.broken` 为空是判据；`standingKeyFor` 在本版 dsh 里已不存在）。

`gen-preset-bundle.mjs` 只保证**生成物形状**正确（能被 YAML 解析成一行 `insert:`），证明不了 dsh 会挂载它——那要装进 profile 后看真实挂载与 `fiberState`。
