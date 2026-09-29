# AGENTS.md — tools

`tools/` 有四个脚本：

- `check-preset.mjs` —— Adg preset 组合文件的零依赖静态校验器（本模块的主体，设计见 `tools/design.md`）；
- `gen-preset-bundle.mjs` —— 把 `preset/preset.yml` + `preset/agent.cordis.yml` + `preset/bundle.package.json` 生成成 bundle（`bundle/adg-preset/{cordis.patch.yml,package.json}`）的构建脚本；带 `--with-billion-context` 时**同时**做两件事：给 9 个专家行的 `allow` 追加那四个名字、给 `compaction-basic` 行注入 `config: {auto: false}`（红线 11）。**设计记录在它自己的头部注释里**（为什么不引 YAML 库、生成形状、退出码、能力边界），本文不复制。
- `check-bundle-flavor.mjs` —— **产物**自检：读一份生成出来的 `cordis.patch.yml`，按 `plain` / `bili` 断言**两件事**：① 9 个专家行的 `toolFilter.allow` 里有没有 billion-context 那四个名字（`compress` / `decompress` / `search_context` / `acp_status`），并拒绝 `acp_cache`（它不在注入清单里，理由见 `README.md` 的「与 billion-context 协同」）；② `compaction-basic` 行的 `config.auto` 是不是恰好 `false`（`plain` 模式则断言这两样**都不存在**）。存在的理由：`check-preset.mjs` 读的是**源文件**，专家行在第 4 列；生成物里它们被嵌进 `delegation` 组、在第 14 列 —— **产物是源文件校验器的盲区**，注入有没有真生效只能这样验。
- `has-billion-context.mjs` —— 判据：某个 profile 到底挂没挂 billion-context（`dsh.profile.bundles` 里有它 **且** `node_modules/billion-context/dsh.bundle.patch.yml` 在）。`install.ps1` / `install.sh` 用它决定该 profile 拿哪份生成物（plain / bili 两种味道）—— **不再**决定 `dsh-adg-token-budget` 启不启用（2026-10 用户决定：挂着 bili 也一律启用，见根 `AGENTS.md` 红线 11）。判据必须只有一份，否则"选哪份味道"会漂移。

**本模块 `AGENTS.md` 的创建理由**（三样信号齐了，不是噪音）：它有独立于根目录的命令（`node tools/check-preset.mjs`，退出码就是门禁；`node tools/gen-preset-bundle.mjs`，`install.*` 每次安装都调它）；有模块特有红线（ERROR 只代表"必然抛错"、禁止钉死取值、`KNOWN_TOOLS` 必须与 composition 同步、**生成物不许手改**）；有跨模块路由要求（改判错口径要读 `preset/design.md`）。设计细节一律不写在这里，全部指向 `tools/design.md` 或脚本头部注释。

## 命令

```sh
node tools/check-preset.mjs        # 校验仓库里的 preset/agent.cordis.yml（唯一真相源）
node tools/gen-preset-bundle.mjs   # 生成 bundle/adg-preset/（构建产物，在 .gitignore 里；不手改）
# 改过 gen 或 agent.cordis.yml → 两种味道都要生成并各自验一遍（根 AGENTS.md 质量门 1b）：
node tools/gen-preset-bundle.mjs bundle/adg-plain && node tools/check-bundle-flavor.mjs bundle/adg-plain/cordis.patch.yml plain
node tools/gen-preset-bundle.mjs --with-billion-context && node tools/check-bundle-flavor.mjs bundle/adg-preset/cordis.patch.yml bili
node tools/has-billion-context.mjs ~/.dsh/profiles web [desktop ...]   # 每 profile 一行 "<name>\t<0|1>"
```

**没有"已安装的那一份"可以传路径了**：旧 `${DSH_HOME:-~/.dsh}/.agent-presets/<id>/` 目录发现机制在 dsh 0.1.7-rc.2 已被移除（**实测**），仓库里的 `preset/agent.cordis.yml` 就是唯一文本真相源；安装侧的真相是 profile 里注册的声明行。

退出码（`check-preset.mjs`）：`0` 通过（允许有 WARN）、`1` 有 ERROR、`2` 目标不存在或不是普通文件。stdout 里两行摘要是 `体积旋钮（生效值）` 与 `裁剪后实际吐出（按生效配置算）`。零依赖，不需要 `node_modules`。`gen-preset-bundle.mjs` 的退出码：`0` 成功 / `1` 输入缺失或形状不符（错误在 stderr）。`check-bundle-flavor.mjs`：`0` 断言成立 / `1` 有 ERROR（专家行数不是 9、该注入的行缺名字、不该注入的行有名字、出现了 `acp_cache`、`compaction-basic` 的 `auto` 值/有无与模式不符）/ `2` 参数或文件不对。`has-billion-context.mjs`：`0` 正常输出 / `2` 缺参数（它**不因 profile 没挂 bili 而失败**——那是数据，不是错误）。

## 模块特有红线

1. **ERROR 只留"这次委派必然抛错"的情形**（例：`allow` 里写了未注册的工具名）。策略性越界（`workflow` / `ralph`）与条件性注册的名字（`bash` / `read_image` / `subagent_codex` / `subagent_claude_code`）禁止判成 ERROR——见 `design.md` I1。
2. **禁止把"取值等于某个数"写成判错**（体积旋钮一律用插件出厂默认值）。见 `design.md` I2、I5。
3. **改 composition 的 tool 行必须同步 `KNOWN_TOOLS`**（漏同步会误报或漏报，`restrict()` 的后果见 `design.md` 非功能红线）。
4. **禁止把 WARN 当失败，也禁止把 `exit 0` 说成"运行期一定生效"**。见 `design.md` I8、I9。
5. **禁止在校验路径里引入第三方依赖、写文件或联网**（零依赖是它的部署前提）。
6. **生成物不许手改**：`bundle/adg-preset/` 与 `bundle/adg-plain/` 是 `gen-preset-bundle.mjs` 的产物（`.gitignore` 忽略、每次安装都被覆盖），`$DSH_HOME/bundles/dsh-adg-preset/`（plain）与 `$DSH_HOME/bundles/dsh-adg-preset-bili/`（注入版）只是它的两个稳定落点，按 profile 选一份（见根 `AGENTS.md` 红线 11）。要改就改 `preset/` 的源文件再重新生成（`preset/design.md` I3c）。

## 跨模块路由

- 改判错口径或改 composition 的 tool 行 → 先读 `preset/design.md`（体积旋钮与 `allow` 的约束）。
- 改三个旋钮插件的版本 / 包名 / 键集 → 先读 `docs/evidence.md`，同步 `FACTORY_DEFAULTS` 与 `EXPECTED_ROWS`。**包名会随 dsh 升级改名**（2026-09-28 实例：`@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`），所以每次 dsh 升级后都要重核一遍。
- 改 bundle 的生成形状（读哪些源文件、写出什么、缩进与标量转义） → 先读 `gen-preset-bundle.mjs` 头部注释与 `preset/bundle.package.json`；消费方是 `install.ps1` / `install.sh`。
- 想知道本模块的用例怎么跑 → `tools/testing-guide.md`。

## 能力边界（不许越界宣称）

`check-preset.mjs` 是**逐行文本扫描器，不是 YAML 解析器**：证明不了整份文件能被 YAML 解析；**也不证明插件真的挂载**——包能否解析、行有没有被关掉、服务有没有发布到全局 realm，只有真实挂载能证明（`agentPresets.resolve('adg')` 的 `.broken` 为空是判据；`standingKeyFor` 在本版 dsh 里已不存在）。它更**完全不覆盖** `plugin/dsh-adg-token-budget`：插件那一层只能看宿主日志与 `logFile`。

`gen-preset-bundle.mjs` 只保证**生成物形状**正确（能被 YAML 解析成一行 `insert:`），证明不了 dsh 会挂载它——那要装进 profile 后看真实挂载与 `fiberState`。
