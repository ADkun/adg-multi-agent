# AGENTS.md — browser（Adg 浏览器工具链）

本模块 = 一份**有头 Chrome 驱动**：规范 profile 的解析、实例的复用/启动决策、一条最小 CDP 通道（navigate / evaluate / screenshot）、**标签页卫生**（自己开的临时页自己收、存量靠 `close-tab` 点名清理），以及唯一命令行入口 `cli.mjs`。设计与不变量见 `design.md`（I1..I10）。

**为什么本模块需要独立文档**（三样信号都在）：有独立于仓库根的命令（`node cli.mjs …`）；有模块特有红线（禁止第三方依赖、禁止把 profile 放进工作区、禁止代填密码 / 验证码自动化）；有跨模块路由要求（`preset/agent.cordis.yml` 的 `agent-browser` persona 消费它的命令行契约，`install.ps1` / `install.sh` 部署它）。

## 独立命令

```sh
node cli.mjs help        # 命令行契约：**选项与退出码以它为准**，本文不复制
node cli.mjs profile     # 报解析出来的 profile / 端口 / Chrome（排错第一站）
node cli.mjs status      # 端口是否活着、浏览器版本、当前标签页
node cli.mjs tabs        # 只列标签页（清理存量前先看这个）
node cli.mjs launch      # 开有头窗口；**实例活着就复用，不重启**
node cli.mjs close-tab   # 关标签页：--match <子串> 关所有匹配的，--tab <n> 关那一个
node cli.mjs close       # 优雅关闭 —— 唯一让登录态落盘的动作

cd browser && node --test test                                  # 单元测试（36 个用例，不需要浏览器）
cd browser && node --test --test-isolation=none test            # DSH 沙箱（workspace-write）里必须加这个 flag
```

零依赖：只要求 Node ≥ 22（需要全局 `WebSocket`；`lib/cdp.mjs` 的 `assertRuntime()` 会显式报错，不静默降级）。没有 `node_modules`、没有构建步骤。

## 模块特有红线

一行一条，理由与来源见 `design.md`「非功能红线」：

- 禁止引入第三方依赖（`playwright` / `puppeteer` / `ws` 一律不许）：I6 由测试钉住。
- 禁止把 profile 放进会话工作区、禁止写死本机绝对路径：profile 只能是显式配置或 `<DSH_HOME>/browser-profile`（I1）。
- 禁止重启一个活着的实例（I3）；禁止用 `PageSession.close()` 关浏览器（I8，只有 `cli.mjs close` 能关）。
- 禁止关掉**不是本任务开的**标签页，也禁止用 `close-tab` 把页面关到 0 个（I9 / I10）：不点名不关、不关到 0 个、自己开的临时页自己收（`--keep` 才留）。用户窗口里的页既有登录态，也可能是他正在用的。
- 禁止代填账号密码、读取 profile 的 cookie 库、验证码识别或指纹伪装：登录永远由人在有头窗口里完成。
- 禁止把「浏览器起不来」写成重试题：命中沙箱失败签名（Chrome 退出码 21 / Edge `platform_channel.cc … 拒绝访问。(0x5)`）就停手如实报（`preset/design.md` I11）。
- 部署落点与仓库路径同名（`browser/` → `${DSH_HOME:-~/.dsh}/browser/`）；改目录名要同步改 `install.ps1` / `install.sh` 与 `agent-browser` 的 persona。

## 跨模块路由

| 你要改什么 | 先读 |
|---|---|
| 命令行契约（命令名 / 选项 / 输出行 / 退出码） | `design.md`「对外接口」→ `preset/agent.cordis.yml` 的 `agent-browser` persona（消费侧）→ `testing-guide.md` 的消费侧契约 |
| `launch` / `close` 的默认行为 | `design.md` I3 / I8 → `preset/design.md` I11（权限闸门）与 I12（人工介入分工） |
| 标签页清理（`tabs` / `close-tab` / 临时页自动收） | `design.md` I9 / I10（不点名不关、不关到 0 个、谁开的谁收）→ `testing-guide.md` 的 I9 / I10 用例 |
| profile 的规范默认路径 | `design.md` I1 → 根 `README.md`「浏览器工具链与登录态资产」→ `docs/evidence.md` §13 |
| 部署集合与落点 | `install.ps1` / `install.sh` → 本文件「模块特有红线」最后一条 |
| 想引用本模块的任何数字 / 结论 | `docs/evidence.md` §11（沙箱前提）/ §13（本模块的实测与未观测） |

## 生效方式

`browser/` 是**用户根下的普通文件**，不是 dsh 插件也不是 preset：改完重新跑一次 `install.ps1` / `install.sh` 就生效，**不需要重启 dsh**（与 `preset/` 的生效方式不同，别承诺错）。preset 里引用本模块的 persona 改动仍然按 preset 的口径走：重启 dsh + 新对话验收。

**跟 `install.*` 的其余步骤解耦**：这两个脚本现在还会生成/重装两个 bundle —— preset bundle（`$DSH_HOME/bundles/dsh-adg-preset` + `link:` 进 profile）与插件 bundle（`$DSH_HOME/bundles/dsh-adg-token-budget`，**与 preset bundle 同一根**，2026-09-28 起，见 `docs/evidence.md` §16.1），`browser/` 的拷贝排在它们**之前**；所以即使后面那几步因 dsh 正在运行而报 `pnpm` 失败（脚本以 exit 2 结束），**已拷好的 `browser/` 仍然是最新的** —— 判据是 `node "${DSH_HOME:-~/.dsh}/browser/cli.mjs" profile` 正常报出 `DSH_HOME=` / `PROFILE=` / `PROFILE_EXISTS=` / `PORT=` / `CHROME=`（或直接比对用户根 `browser/` 与仓库 `browser/` 的文件）。