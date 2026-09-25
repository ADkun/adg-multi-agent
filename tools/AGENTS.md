# AGENTS.md — tools

`tools/` 只有一个模块：`check-preset.mjs`，Adg preset 组合文件的零依赖静态校验器。

**本模块 `AGENTS.md` 的创建理由**（三样信号齐了，不是噪音）：它有独立于根目录的命令（`node tools/check-preset.mjs`，退出码就是门禁）；有模块特有红线（ERROR 只代表"必然抛错"、禁止钉死取值、`KNOWN_TOOLS` 必须与 composition 同步）；有跨模块路由要求（改判错口径要读 `preset/design.md`）。设计细节一律不写在这里，全部指向 `tools/design.md`。

## 命令

```sh
node tools/check-preset.mjs                                                        # 校验仓库里的 preset/agent.cordis.yml
node tools/check-preset.mjs "${DSH_HOME:-~/.dsh}/.agent-presets/adg/agent.cordis.yml"   # 校验已安装的那一份
```

退出码：`0` 通过（允许有 WARN）、`1` 有 ERROR、`2` 目标不存在或不是普通文件。stdout 里两行摘要是 `体积旋钮（生效值）` 与 `裁剪后实际吐出（按生效配置算）`。零依赖，不需要 `node_modules`。

## 模块特有红线

1. **ERROR 只留"这次委派必然抛错"的情形**（例：`allow` 里写了未注册的工具名）。策略性越界（`workflow` / `ralph`）与条件性注册的名字（`bash` / `read_image` / `subagent_codex` / `subagent_claude_code`）禁止判成 ERROR——见 `design.md` I1。
2. **禁止把"取值等于某个数"写成判错**（体积旋钮一律用插件出厂默认值）。见 `design.md` I2、I5。
3. **改 composition 的 tool 行必须同步 `KNOWN_TOOLS`**（漏同步会误报或漏报，`restrict()` 的后果见 `design.md` 非功能红线）。
4. **禁止把 WARN 当失败，也禁止把 `exit 0` 说成"运行期一定生效"**。见 `design.md` I8、I9。
5. **禁止在校验路径里引入第三方依赖、写文件或联网**（零依赖是它的部署前提）。

## 跨模块路由

- 改判错口径或改 composition 的 tool 行 → 先读 `preset/design.md`（体积旋钮与 `allow` 的约束）。
- 改三个旋钮插件的版本 / 包名 / 键集 → 先读 `docs/evidence.md`，同步 `FACTORY_DEFAULTS` 与 `EXPECTED_ROWS`。
- 想知道本模块的用例怎么跑 → `tools/testing-guide.md`。

## 能力边界（不许越界宣称）

它是**逐行文本扫描器，不是 YAML 解析器**：证明不了整份文件能被 YAML 解析；**也不证明插件真的挂载**——包能否解析、行有没有被关掉、服务有没有发布到全局 realm，只有真实挂载能证明。它更**完全不覆盖** `plugin/dsh-adg-token-budget`：插件那一层只能看宿主日志与 `logFile`。
