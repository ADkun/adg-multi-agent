# 部署与启用清单（`dsh-adg-token-budget`）

这份文件是**操作清单**，只讲"怎么装、怎么开、怎么确认、怎么回滚"。
插件做什么、每个键什么含义、安全设计、证据边界，见本目录的 `README.md`；
两层预算的整体口径（含实测分布与 300 万这个默认值怎么来的）见仓库根 `README.md` 的
「第二层：子代理 token 预算的硬兜底」一节。

**本文件是仓库文档，不在部署集合里** —— 装到 `$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`
的是 `package.json` / `src/` / `README.md` / `examples/` 四项，`test/` 与 `INSTALL.md` 都不进去。

## 0. 一条约束先记住

**`enabled: false` 时插件不注册任何监听器、不写任何日志。** 所以"装上了"这件事本身在日志里**看不见**：
宿主日志和 `logFile` 都是空的。想看到证据，必须先把 `enabled` 改成 `true`，
再让一个受管的子代理真的越过软阈值。

## 1. 部署（复制文件）

目标：`$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`（`$DSH_HOME` 默认 `~/.dsh`）。
这是**所有 profile 共享的模块解析根**，从 profile 目录按 Node 的常规 `node_modules` 父级上溯会走到它；
本机的 `dsh-windows-notifier` 也在同一位置。

- 复制 `package.json`、`src/`、`README.md`、`examples/`；**`test/` 不要拷**。
- **先删目标目录再拷**（重复执行必须干净覆盖，不留上一版残留）。
- **真拷贝，不要建 junction / symlink**：部署出来的插件必须独立于仓库，否则仓库一删或一挪，
  dsh 启动就会去一个不存在的路径找这个包。
- 部署目录里没有 `node_modules` 也正常：插件不静态 import 任何 `@deepseek-ai/*`，
  需要什么都在调用时用 `createRequire` 解析，解析失败也可存活。

## 2. 挂载行（写 profile 的 patch 层）

目标：`$DSH_HOME/profiles/web/cordis.patch.yml`（web profile 自己的 patch 层，`patchReload: live`）。

- **先备份**成 `cordis.patch.yml.bak-adg-token-budget`。
- 文件里**已经出现 `dsh-adg-token-budget`** → 不要改动，只报告"已注册"。
- 末行**不是恰好 `[]`** → **不要猜**：放弃编辑，让用户手工把 `examples/cordis.patch.yml` 里的行贴进去。
- 否则：保留原有注释头，把 `[]` 换成 `examples/cordis.patch.yml` 里那条 `insert:` 行，
  `enabled: false`，`logFile` 写成**真实绝对路径**（单引号 YAML 字符串，相对路径会被插件关掉文件日志）。
- 写文件用**不带 BOM 的 UTF-8**（`Set-Content -Encoding UTF8` 在 PowerShell 5.1 下会写 BOM）。

安装脚本（`install.ps1` / `install.sh`）已经把这四步做完，并且在输出里说明备份路径与"行是新增还是已存在"。
两者行为等价、零依赖。

## 3. 启用（一步、可撤回）

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
      config:
        enabled: true
```

这个文件热重载：**改完立即生效，不用重启 dsh**。想先小范围试，把 `budgetTokens` 调到 `20000`、
`softRatio` 调到 `0.05`。

## 4. 确认已武装

| 看哪里 | 期望看到什么 |
|---|---|
| 宿主日志（加载期） | `dsh-adg-token-budget: createUserMessage resolved via the "…" anchor`；**出现** `apply failed (…); the token budget is inactive` 就是降级成 no-op 了 |
| `logFile`（默认 `$DSH_HOME/adg-token-budget.log`） | 开启后**先保持为空**，直到某个受管子代理越过软阈值才出现第一行 `… soft stage: nudged usage=… budget=… label=…` |
| 宿主日志（第一次决策时，各一次） | `… token budget active (nudge via …); first decision: …` |
| 行为 | 用一次**超过预算的委派**（临时把 `budgetTokens` 调小）看：调度者收到的那份结果以 `Partial output before the run ended: …` 结尾 |

**注意：**插件的运行期行为**还没在真实 dsh 里观测过**（单元测试 + 从模拟部署位置 import 是现有全部证据）。
补一行加载时的激活日志是紧随其后的改动。别把"已经装上"说成"已经在生效"。

## 5. 关掉 / 回滚

1. `enabled: false` —— 不注册监听器、不写日志（最干净，也是安装时的默认值）。
2. `disabled: true`（写在 `- id: adg-token-budget` 那一行同级）或整行删掉 —— 连包都不 import。
3. 还原 `cordis.patch.yml.bak-adg-token-budget`。
4. 想清干净：删 `$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/`（没有行指向它就不会被 import）。
