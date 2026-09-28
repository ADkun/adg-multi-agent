# AGENTS.md — `plugin/dsh-adg-token-budget/`

host-plane 插件：数受管子代理**真正进入的步**，在命中阶数时追加**恰好一条**可选收敛提醒，
并写一行加载期激活行。

## 为什么本模块有独立于根目录的 `AGENTS.md`

1. 有独立于根目录的命令（本模块自己的测试入口，见下）；
2. 有模块特有的红线：**本插件没有破坏性档**、**激活行是版本判据**、**包名是历史名称**；
3. 有跨模块路由要求（改"治理谁"要先读 `preset/design.md`）。

## 命令

```sh
cd plugin/dsh-adg-token-budget && node --test test
node --test --test-isolation=none test   # 同一目录；DSH 沙箱里**必须**用这一条
```

**两条都必须在模块目录里跑**（`test` 是相对路径参数；在仓库根跑会找不到测试目录）。

只依赖 `node:test` / `node:assert`，无 `node_modules` 也能跑。其余命令统一见
根 `AGENTS.md`（本文件不重复）。

**沙箱口径（两个独立的拦截，别混成一个）**：
1. `node --test test` 在沙箱里**必然失败**，形态是测试文件报 `Error: spawn EPERM` ——
   `node --test` 默认给每个测试文件起一个 **piped-stdio 子进程**，沙箱拒绝 pipe。
   **加 `--test-isolation=none` 即可**（不起子进程），实测 54 个测试全过。
   `spawn EPERM` 出现在输出里，**不是断言失败**，别把它当红灯。
2. `| Select-String` / `| Select-Object` 这类 PowerShell 管道会被拒成
   `Program 'node.exe' failed to run: Access is denied`；**重定向到文件是允许的**。
判据与四条命令的实测结果见 `testing-guide.md` 第 0 节。

## 模块特有红线（编号是 `design.md` 的不变量号）

1. **禁止加回任何破坏性档**：不读投影、无阈值、不 `agent.cancel`、不返回 `{kind:'reject'}`
   （design.md「职责与边界」+ 非功能红线 2）。
2. **禁止让 `apply` 抛出；禁止 `static inject`；禁止静态 `import` 任何 `@deepseek-ai/*`**
   （design.md I1/I2/I3）。
3. **禁止在 `enabled: false` 时省掉激活行** —— 激活行是"宿主确实加载过"的唯一证据，也是版本判据
   （design.md I4 + 非功能红线 6）。本条只管**这一行被 import 了**的情况：`disabled: true` 是
   Loader 根本不 import 那一行，本来就不会有激活行 —— 那种"关掉"没有日志证据，复核改用
   `plugin_manager list_plugins` 的 `enabled` / `fiberPhase`（`INSTALL.md` 第 5 节第 2 步）。
4. **禁止把提醒写成停止指令、禁止各档正文递进、禁止给自定义 `stepText` 追加内置尾句**
   （design.md I14/I15/I16）。
5. **禁止在同一水位重复注入**：一步最多一条消息、每个 tier 每驻留期一次（design.md I6/I7）。
6. **禁止在 `dryRun` 打开时宣称"提醒已注入"**（design.md「For Agents」）。
7. **禁止把注入消息的来源写回 `{kind:'plugin', plugin}`**：session format v4 在**持久化写入路径**上
   拒这个 kind（`source.kind === 'plugin'`），而异常发生在监听器返回之后、插件接不住 ——
   **整轮委派当场失败**：`format v4 message requires a producer-owned source kind`。写生产者自有的
   `{kind:'plugin:dsh-adg-token-budget'}`（design.md I17；测试 + 变异 M18 钉住；宿主侧复测见
   `testing-guide.md` 第 6 节）。2026-09-28 真机事故：当时新阶梯的第一档是第 4 步，
   **凡走到第 4 步的受管子代理全部在那里失败**。

## 跨模块路由

| 你要改什么 | 先读 |
|---|---|
| 治理哪些会话（preset 命中、深度闸门） | `preset/design.md` + design.md「依赖关系」的路由段 |
| 挂载行在哪一层、部署落点与部署集合（`package.json` 的 `files` 与 `dsh.bundle.patch`）、上线顺序 | 本目录 `INSTALL.md` |
| 提醒措辞 | 只动 `config.stepText`，不改代码（design.md「跨模块改动路由」） |
| 行为本身（筛选 / 计数 / 激活行） | 本目录 `design.md` → `testing-guide.md`（先看该行为是否已被钉住） |

## 生效方式

挂载行现在来自 **bundle 层** —— 仓库里的 `plugin/dsh-adg-token-budget/cordis.patch.yml`（由
`package.json` 的 `dsh.bundle.patch` 声明），部署后是 `$DSH_HOME/bundles/dsh-adg-token-budget/cordis.patch.yml`；
profile 层只放覆盖行。行 id 与包名都没改 ⇒ **热重载身份不变**。三处改动口径不同：

- 改 **bundle 层**那一行（连它的 `config:` 一起）→ **以重启 dsh 为准**：**没有任何东西 watch
  `bundles/`**，单独编辑那个文件不会自己触发重读（改一次 profile 的 `cordis.patch.yml` 或 profile
  清单会让**整份 patch 栈重读**、bundle 层顺带被重读，但**禁止宣称"不重启也会生效"**）。
  复核方式：重启后 `plugin_manager list_bundles` 仍有 `dsh-adg-token-budget` 这一条，且 `logFile`
  里新出现一行 `activation: …`（三层口径的完整表与实测见 `INSTALL.md` 第 3 节）。
- 改 **profile 层**那条 `- id: adg-token-budget` **覆盖行**里的 `config:`（Plugins 页保存写的就是
  这一层）→ **热重载，不用重启**（`web` profile 是 `patchReload: live`）；复核方式是 `logFile` 里
  新出现一行 `activation: …`。**覆盖行是整块替换 `config`、不是深合并**，要留的键必须全部重写
  （层序与这条坑的实测见 `INSTALL.md` 第 2、4 节）。
  **这条链路上唯一的静默失效模式**：profile 层残留一条同 id 的旧 `- insert:` 手贴行。它**不多挂一行**
  （条目总数仍 190、激活行只写一行），但**整块接管**那一行的 `config:`（实测把 `dryRun` 顶成 `true`
  ⇒ **注入当场停掉，而 `fiberPhase` 仍是 `active`、日志看起来完全正常**），并让该行 `patchId` 消失、
  `readOnlyReason` 变成 `"unaddressable"` ⇒ Plugins 页与 `set_plugin` 都点不动它。
  **判据：看 `list_plugins` 里这一条还有没有 `patchId`**（`list_bundles` 的 `overrides` 发现不了它）。
  逐条实测见 `INSTALL.md` 第 4 节第 6 条；**别与 `docs/evidence.md` §14.3 混引** —— 那条讲的是 preset
  声明行"同一个 id 只能有一个家"，当时没有量过后果。
- 改 `src/` 下的代码 → **必须重启 dsh**（热重载只重放 `config:`，不重新 `import` 已加载的模块），
  重启后复核激活行形状再动别的。
