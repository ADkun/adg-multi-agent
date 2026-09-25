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
   **加 `--test-isolation=none` 即可**（不起子进程），实测 50 个测试全过。
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
   （design.md I4 + 非功能红线 6）。
4. **禁止把提醒写成停止指令、禁止各档正文递进、禁止给自定义 `stepText` 追加内置尾句**
   （design.md I14/I15/I16）。
5. **禁止在同一水位重复注入**：一步最多一条消息、每个 tier 每驻留期一次（design.md I6/I7）。
6. **禁止在 `dryRun` 打开时宣称"提醒已注入"**（design.md「For Agents」）。

## 跨模块路由

| 你要改什么 | 先读 |
|---|---|
| 治理哪些会话（preset 命中、深度闸门） | `preset/design.md` + design.md「依赖关系」的路由段 |
| 挂载位置、部署集合（`package.json` 的 `files`）、上线顺序 | 本目录 `INSTALL.md` |
| 提醒措辞 | 只动 `config.stepText`，不改代码（design.md「跨模块改动路由」） |
| 行为本身（筛选 / 计数 / 激活行） | 本目录 `design.md` → `testing-guide.md`（先看该行为是否已被钉住） |

## 生效方式

- 改 `src/` 下的代码 → **必须重启 dsh**（热重载只重放 `config:`，不重新 `import` 已加载的模块），
  重启后复核激活行形状再动别的。
- 改挂载行里的 `config:` → **热重载，不用重启**；复核方式是 `logFile` 里新出现一行 `activation: …`。
