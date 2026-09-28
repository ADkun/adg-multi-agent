# 部署与启用清单（`dsh-adg-token-budget`）

这份文件是**操作清单**，只讲"怎么装、怎么开、怎么确认、怎么回滚"。
插件做什么、每个键什么含义、安全设计、证据边界，见本目录的 `README.md`；
子代理步数检查点这一层的整体口径（含实测分布与实测证据）见仓库根 `README.md` 里对应的那一节。

**本文件是仓库文档，不在部署集合里** —— 装到 `$DSH_HOME/bundles/dsh-adg-token-budget/`
的是 `package.json` / `cordis.patch.yml` / `src/` / `examples/` / `README.md` / `LICENSE` 六项，
`test/` 与 `INSTALL.md` 都不进去。第六项 `cordis.patch.yml` **就是挂载行本身**：缺了它，这个包
在 profile 里只是一条普通依赖，什么都不会挂载（第 2 节）。

> **包名是历史遗留。** 这个包现在**只做一件事**：受管子代理在第 N 步收到的收敛检查点。
> token 软档与硬档取消**已移除（本次改动）**，`budgetTokens` / `softRatio` /
> `cacheReadWeight` / `softNudge` / `hardDryRun` 五个键**被静默忽略**（旧组合仍然能加载，只是不起作用）。
> 名字与行 id（`adg-token-budget`）保留，是为了**不改热重载身份**：这次两者都没动。
> **部署路径改了** —— 2026-09-28 从 `$DSH_HOME/plugins/dsh-adg-token-budget/` 迁到
> `$DSH_HOME/bundles/dsh-adg-token-budget/`，这个包由此成为一个 bundle（第 1、2 节）。

## 0. 一条约束先记住

**`enabled: false` 时插件不注册任何监听器、不写任何决策日志。** 但它**会写一行加载期的激活行**
（`activation: inactive (enabled: false) …`），所以"装上了"这件事**看得见**，
不再需要先改成 `true` 才知道插件被加载过。想看到决策行，必须让一个受管的子代理真的走到
`stepTiers` 上的某一步（或先开 `dryRun: true` 校准）。

## 1. 部署（复制到 bundle 根，再选进 profile）

目标：`$DSH_HOME/bundles/dsh-adg-token-budget/`（`$DSH_HOME` 默认 `~/.dsh`；与 preset 的
`dsh-adg-preset` **同一个根**），再由目标 profile `pnpm add link:$DSH_HOME/bundles/dsh-adg-token-budget`
链进 `profiles/<profile>/node_modules/`，**并把包名 `dsh-adg-token-budget` 写进该 profile 的
`dsh.profile.bundles`** —— 光有依赖不算选中：没进 `dsh.profile.bundles`，这个包的 patch 层
根本不会被读。
**不要**再放 `$DSH_HOME/profiles/node_modules/`：那个"所有 profile 共享的解析根"在本版 dsh 的
模块解析里**被排除**（2026-09-28 实测放那儿解析不到、挂载行起不来），现在的解析是两段锚定 ——
先从 dsh 安装目录解析，再落到当前 profile。

- 复制 `package.json`、`cordis.patch.yml`、`src/`、`README.md`、`examples/`、`LICENSE` 六项
  （与 `package.json` 的 `files` 一致）；**`test/` 与 `INSTALL.md` 不要拷**。
- **先删目标目录再拷**（重复执行必须干净覆盖，不留上一版残留）。
- **真拷贝，不要建 junction / symlink**：部署出来的 bundle 必须独立于仓库，否则仓库一删或一挪，
  dsh 启动就会去一个不存在的路径找这个包。
- 部署目录里没有 `node_modules` 也正常：插件不静态 import 任何 `@deepseek-ai/*`，
  需要什么都在调用时用 `createRequire` 解析，解析失败也可存活。
- 旧落点 `$DSH_HOME/plugins/dsh-adg-token-budget/` 由安装脚本的最后一步清理，判据是
  **没有任何 profile 的链接还指着它**才删（本机已删）。
- 装哪些 profile 由脚本判：`dsh.profile.bundles` 里含 `@deepseek-ai/dsh-web-app` 的才是 preset
  宿主（本机 `web` 与 `desktop`）；不含的（本机 `headless`）**按判据跳过**，这是源码级事实。
- 不走脚本也可以让宿主自己装这个包：`plugin_manager` 的 `install_bundle`（本机这次迁移就是
  这么做的 —— **真机实测**见第 4 节 `01:47:48` 那行）。

## 2. 挂载行（现在来自 bundle 层；手贴那一行必须删）

挂载行本体 = **`plugin/dsh-adg-token-budget/cordis.patch.yml`**（部署后是
`$DSH_HOME/bundles/dsh-adg-token-budget/cordis.patch.yml`），由 `package.json` 的
`dsh.bundle.patch: ./cordis.patch.yml` 声明。profile 只要把包名选进 `dsh.profile.bundles`，
Loader 就把这一行 insert 进来 —— **profile 的 patch 层不再需要那一行**。全部键与取值以那份
文件为准，本文不复制键集合。

- **它出厂就是武装的**：`enabled: true`、`dryRun: false`、`presets: ['adg']`。旧机制是"贴一行
  `enabled: false`，由人来武装"；现在**把包选进 `dsh.profile.bundles` 就是那个刻意动作**，
  安装脚本只做选中，不再留一档惰性状态。想"装而不起效"：写 profile 层覆盖行把 `enabled` 置
  `false`（热重载），或直接改 bundle 行（要重启）。更干净的一档是在 profile 层只写
  `- id: adg-token-budget` + `disabled: true`（**不带 `config:`**）—— 那一行连 import 都没有，
  同样热重载（**真机实测**见第 4 节第 5 条；两档的区别写在第 5 节第 2 步）。
- **`logFile` 不再逐 profile 硬编码绝对路径**：bundle 行写
  `!!js dshHomePath('adg-token-budget.log')`，由 Loader 求值 ⇒ 任何机器都落到
  `$DSH_HOME/adg-token-budget.log`。本机实测求值结果与旧手贴行**逐字相同**，所以历史日志连续
  （**真机实测（有日志为证）**，2026-09-28T01:47:48.467Z，见第 4 节）。相对路径仍然只会被插件
  关掉文件日志（design.md I13）。
- **旧的 `- insert:` 手贴行必须删，而它的后果不是"多一行"** —— **本插件这一行已实测**（本机
  2026-09-28，UTC 两行日志 + `plugin_manager list_plugins` 逐字段，**真机实测（有日志为证）**，
  逐字行见第 4 节第 6 条）：profile 层残留一条同 id 的 `insert:` 行 ⇒
  **① 不重复挂载**（条目总数仍是 190，激活行只写一行）；**② 但整块接管 `config:`**
  （实测 `dryRun` 被残留行顶成 `true`，出厂是 `false` ⇒ **注入当场停掉，而 `fiberPhase` 仍然是
  `active`、日志看起来完全正常** —— 这就是它危险的地方）；**③ 并且这一行当场脱离管理**
  （`list_plugins` 里 `patchId` 消失、`readOnlyReason` 变成 `"unaddressable"` ⇒ Plugins 页与
  `set_plugin` 都点不动它，只能回到 patch 文件里管）。台账：`docs/evidence.md` §16.4 第 6 条。
  机制就是 §16.2 那条语义：**后到的层带着一个已在的 id ⇒ 按 id 合并，那一行的
  `config` 整个被顶掉**（**不是深合并**）—— 没写的键全部回落到 `src/config.js` 的 `DEFAULT_CONFIG`；
  而 profile 自己的 `cordis.patch.yml` 在**所有 bundle 层之后**应用，所以被顶掉的总是 bundle 行。
  **别混引 `docs/evidence.md` §14.3**：那条护栏讲的是 **preset 声明行**（`preset-adg`）的"同一个 id
  只能有一个家"，说的是**同一层内**的形状；本条讲的是**插件这一行的跨层同 id 合并** ——
  既不报错、也不双挂。§14.3 的原话只记到"危险形状"，**本机没有"同一层内重复插入被 Loader 拒绝"
  那次实测**，别把"被拒"挂到它名下。
- 所以**profile 层的覆盖行必须把要保留的键全部重写**。Plugins 页保存写的就是这一层。
  覆盖条目的**形状**（去掉 `- insert:` 外壳、按 `- id: adg-token-budget` 键住这一行）见
  `examples/cordis.patch.yml` 开头的注释，本文不复制。
- `examples/cordis.patch.yml` 的角色也变了：它是**键参考 + 手工覆盖模板**（每个键的含义与默认值
  都在那里注释着），**不再是"可以直接贴进 profile patch 层的挂载行"** —— 贴之前必须重写全部键，
  理由就是上一条。
- `install.ps1` / `install.sh` 现在**只报告、不代删**手贴行（不猜用户手改过的文件）。而残留的实测
  后果是**静默改掉那一行的 `config:` + 让它脱离 Plugin Manager**（本节第一条），不是"多一条无害条目"
  ⇒ **这一刀必须由人来下**；恢复判据见第 5 节第 3 步。它们改的是
  profile 的 `package.json`（脚本自己写清单时留备份 `package.json.bak-adg-token-budget`；本机
  `web` 的清单是 `plugin_manager install_bundle` 写的，所以**没有**这份备份，`desktop` 有），
  **不再往 `cordis.patch.yml` 里写这一行**。两者行为等价、零依赖。
- **机器级 `$DSH_HOME/cordis.patch.yml` 仍然禁止出现这一行**：那一层套在每个 profile 上，
  还会挡住 Plugins 页保存 —— 这条没变。
- 手写 profile 层覆盖行时用**不带 BOM 的 UTF-8**（`Set-Content -Encoding UTF8` 在 PowerShell 5.1
  下会写 BOM），并保留原有注释头。
- **哪一层遗留了 `budgetTokens` 等已移除的键？不用动。** 新构建对未知键静默忽略，
  旧组合照常加载，只是那五个键没有任何效果；想清理可以删掉，但不删也不会报错。
- 判据（本机迁移后的**检验**：证明的是"能不能解析 + 键集合"，**不是挂载验证** —— 挂载判据在第 4 节）：
  **六份**文件都过了 Loader —— `profiles/web/cordis.patch.yml`、`profiles/desktop/cordis.patch.yml`、
  机器级 `$DSH_HOME/cordis.patch.yml`、部署后的 `bundles/dsh-adg-token-budget/cordis.patch.yml`、
  仓库 `plugin/dsh-adg-token-budget/cordis.patch.yml`、仓库 `examples/cordis.patch.yml`
  （`loadOverlayPatches('dsh', file)` 全部 OK）；bundle 行 **6 个键**；
  两个 profile 层里 `adg-token-budget` 的行数 **0**。

## 3. 启用（三步、可撤回）与生效方式

推荐的武装顺序仍然是三步，**没有需要校准的破坏性档**：

1. `enabled: false` —— 装上但完全惰性（旧机制的例子行是这个值；**bundle 行不是**，见下）；
2. `enabled: true` + `dryRun: true` —— 按你自己的流量校准：每个到期的检查点写一行
   `dry-run step stage: would nudge …`，不注入任何消息；**步数照常计数**（那正是校准要看的），
   而且**不消耗任何 tier**，所以之后武装仍然会补发那个检查点；
3. `enabled: true` + `dryRun: false` —— 提醒真的注入。**bundle 行出厂就在这一档。**

**第 3 步就是终点。** 取消已经从插件里删除，所以**没有 `hardDryRun`，后面也没有"再武装一次"这回事**：
剩下的唯一动作是措辞（`stepText`）与阶梯（`stepTiers`）。
想先小范围看到效果，把 `stepTiers` 临时改成 `[1, 2]`。

**改哪儿，决定要不要重启**（三条口径，别写反）：

| 改哪里 | 怎么生效 | 怎么复核 |
|---|---|---|
| **bundle 层**的 `bundles/dsh-adg-token-budget/cordis.patch.yml`（= 挂载行本体） | **以重启 dsh 为准** —— **没有任何东西 watch `bundles/`**，单独编辑这个文件不会自己触发重读。（改一次 profile 的 `cordis.patch.yml` 或 profile 清单会让**整份 patch 栈重读**、bundle 层顺带被重读 —— 见下面那个引用块） | 重启后 `plugin_manager list_bundles` 仍有 `dsh-adg-token-budget` 这一条，且 `logFile` 里新出现一行 `activation: …` |
| **profile 层**那条 `- id: adg-token-budget` **覆盖行**里的 `config:`（Plugins 页保存写的就是这一层） | **热重载，不用重启**（`web` profile 是 `patchReload: live`）；宿主重新 `apply` 这一行。**但覆盖行是整块替换 `config`，要留的键必须全部重写**（第 2 节） | 同一 `logFile` 里新出现一行 `activation: …` |
| `src/` 下的代码 | **必须重启** —— 热重载只重放 `config:` | 激活行是**当前形状**（见下） |

措辞与阶梯都住在 `config:` 里，所以它们走中间那一行：**热重载即可**。
行 id `adg-token-budget` 与包名都没改 ⇒ **热重载身份不变**。

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml —— profile 层的覆盖行（**示意，键不全**）
# 只写两个键是为了讲形状。真的动手必须把要保留的键全部重写一遍（`presets` / `stepNudge` /
# `stepTiers` / `logFile`… 以 bundle 那份为准，本文不复制键集合），否则没写的键回落到
# `src/config.js` 的 `DEFAULT_CONFIG`。
      config:
        enabled: true
        dryRun: true        # 认完了删掉这条覆盖行，就回到 bundle 行的出厂形状
```

> **"单独编辑 bundle 层不会自己触发重读"≠"bundle 层只在启动时读"。** 本机迁移是靠
> `plugin_manager install_bundle` 装上包、把包名写进该 profile 的 `dsh.profile.bundles`
> —— 那是**改了一次 profile 清单**，于是整份 patch 栈重读、bundle 层顺带被重读：**迁移前**启动的
> 那个进程（本地时间 09:05:04）写出了 `2026-09-28T01:47:48.467Z` 的激活行，bundle 层的行第一次
> 被读到就挂上了（**真机实测（有日志为证）**，日志
> `C:\Users\cenqian\.dsh\adg-token-budget.log`，见第 4 节；同一机制的既有口径见 `preset/design.md`
> 与 `docs/evidence.md` §16.3）。
> **但验收口径不变：禁止宣称"不重启也会生效"** —— 改 bundle 层就按重启处理，重启 + 新会话才是
> 最终判据。**冷启动之后 bundle 层还挂不挂得上：未观测**（量法见第 4 节末）。

> **但改了包里的代码就必须重启，而且顺序不能反。** 已实测：替换包目录之后，宿主重放了这一行、
> 激活行里的 `dryRun` 跟着变了，**但激活行没有新字段** —— 因为热重载不会重新 `import`
> 已经加载过的模块（Node 的 ESM registry 按文件 URL 缓存，而 URL 没变）。
> 正确顺序是：**复制新代码到 `$DSH_HOME/bundles/dsh-adg-token-budget/` → 重启 dsh → 确认激活行是当前形状 → 这时才动 `dryRun` / `stepTiers`。**
>
> **怎么判断激活行是哪一版写的**：当前形状是
> `activation: active createUserMessage=<解析策略> presets=[adg] stepNudge=… stepTiers=[…] stepText=builtin|custom dryRun=… logFile=…`。
> 只要行里还带着 `budgetTokens=` / `softThreshold=` / `softRatio=` / `cacheReadWeight=` /
> `softNudge=` / `hardDryRun=`，或者**没有 `stepText=`**，它就是**旧模块**写的：
> 旧代码不认识新键，反过来，**在旧模块还活着的时候改配置，改的是一个旧代码读得懂的更小集合**。
> （当年那次就踩过这个组合：以 `dryRun: false` 生效、加载的却是旧模块，好在那一分多钟里没有
> Adg 委派跑过。）

## 4. 确认已武装

| 看哪里 | 期望看到什么 |
|---|---|
| `plugin_manager list_bundles` | 有 **`dsh-adg-token-budget`** 这一条：`version 0.3.0`、`enabled: true`、`installed: true`、`removable: true`、rows `[{rowId: adg-token-budget, moduleName: dsh-adg-token-budget, entryId: include:adg-token-budget}]`、`overrides: []`；配套 `list_plugins` 里 `include:adg-token-budget` 是 `enabled: true` + `fiberPhase: active` + `patchId: adg-token-budget`。**手贴时代这一条根本不存在**（行只活在 profile patch 文件里，Plugin Manager 的 bundle 清单看不到它）—— 那正是"看起来没生效"的直接原因。本机迁移后的**当次读数**（Plugin Manager）：条目总数迁移前后都是 190 —— **但 190 只证明"没有多出来的条目"，证明不了没有残留手贴行**：残留的同 id 行会**按 id 合并**成同一条，总数一样是 190（**真机实测**，见下面第 6 条）。排除残留用下一行那条判据 |
| **有没有残留的手贴挂载行**（profile 的 `cordis.patch.yml` 里还留着 `- insert:` 的那一行） | **最快的信号在 `plugin_manager list_plugins`**：这一条**还有没有 `patchId: adg-token-budget`** —— 残留期间 `patchId` **消失**、`readOnlyReason` 变成 **`"unaddressable"`**；此时条目总数**不变**（仍 190）、`list_bundles` 的 `overrides` 也仍是 `[]` ⇒ **这两样都不能用来发现残留**。文本侧判据见第 2 节末（profile 层 `adg-token-budget` 行数应为 **0**）。**真机实测**，逐条结论见下面第 6 条、台账见 `docs/evidence.md` §16.4 第 6 条。再补一句读法：§14.3 把 `patchId=adg-token-budget` 当"这一行在活组合里"的**正证据**，本条是它的反面 —— **`patchId` 消失 = 这一行被跨层残留接管、已脱离管理** |
| `logFile`（现在由 bundle 行的 `!!js dshHomePath(...)` 求值 ⇒ `$DSH_HOME/adg-token-budget.log`，任何机器都一样） | **加载期就有第一行**：`activation: active createUserMessage=<解析策略> presets=[adg] stepNudge=true stepTiers=[…] stepText=builtin\|custom dryRun=… logFile=…`。**激活行的字段集合没有变化**（行 id 与包名都没改）；变的是**来源**：这一行现在由 bundle 层写出，`logFile=` 是 Loader 求值出来的绝对路径，而**新装（选进 `dsh.profile.bundles`）的 profile 第一行就是 `active`** —— 出厂即武装，不再是 `enabled: false`。`enabled: false` 时写的是 `activation: inactive (enabled: false) …`（同样是"宿主确实加载过"的证据）。行里若还有 `budgetTokens=` / `softNudge=` / `hardDryRun=` 之类的旧字段，说明内存里跑的还是旧模块。**反例，别读错**：这一行被 `disabled: true` 关掉时 Loader **根本不 import 它** ⇒ 日志里**不会有任何新行**（连 `activation: inactive …` 都没有）；判活要用 `list_plugins` 的 `enabled` / `fiberPhase`（**真机实测**，见下面第 5 条） |
| `logFile`（决策行） | 只有**事件**才写：步数检查点 `step stage: nudged tier=n/N step=S label=…`、`step stage (no nudge injected: …) …`、dry-run 判定（`dry-run step stage: would nudge …` / `dry-run step stage: would not nudge (…) …`）、`settled: released session state label=…`。**普通放行一步什么都不写** |
| 宿主日志（加载期） | `dsh-adg-token-budget: activation: active createUserMessage=…`；出现 `apply failed (…); the step checkpoints are inactive` 或 `context has no event API; the step checkpoints are inactive` 就是降级成 no-op 了 |
| 宿主日志（第一次决策时，一次） | `dsh-adg-token-budget: first decision: …` |
| 行为（检查点） | 受管子代理走到阶梯上的某一步时会收到一条 `【收敛检查点 n／N】调度代理提醒：这是你的第 N 步。…`，正文是一条**可选**提醒（自己选"收尾汇报"还是"继续"）。想最快看到，把 `stepTiers` 临时改成 `[1, 2]`；想连措辞都自己认，用 `stepText` 写一句——**这两件都只是 `config:` 改动**：写在 profile 覆盖行上热重载（键要写全），写在 bundle 行上以重启为准（第 3 节）。**先确认你走的是哪一个委派**：`presets: ['adg']` 只治理 header 记 `agentPreset: adg` 的子代理，而通用 `subagent` / `subagent_fork` 委派出去的子代理 header 记的是 `agentPreset: "cordis"`、`delegationDepth: 1`（**真机实测**，本机 2026-09-28，证据见本节下面 `2026-09-28T01:59:25.308Z … label=cordis/b625f841-…` 那行）⇒ 按设计**不受管**（fail open），拿通用委派验"没反应"验不出任何问题 |
| 源码（确认没有破坏性路径） | 见下面的代码级检查：滤掉注释行后，`agent.cancel` / `sessionProjections` / `kind: 'reject'` **一个都不应匹配** —— 这是"token 两档真的被删掉了"的事实，和日志无关 |
| 测试 | 在插件目录里 `node --test test`（不依赖 `node_modules`；沙箱里若 piped stdio 被挡，用 `node --test --test-isolation=none test`） |

源码检查（模块注释里**故意**留着"这里曾经 agent.cancel / 读 sessionProjections"的说明文字，所以要先滤掉注释行）：

```powershell
Get-ChildItem src\*.js | ForEach-Object { Get-Content -LiteralPath $_.FullName } |
  Where-Object { $_ -notmatch '^\s*(\*|//|/\*)' } |
  Select-String "agent\.cancel|sessionProjections|kind: 'reject'"
```

预期：**没有任何输出**。

**本机的实测证据**（`C:\Users\cenqian\.dsh\adg-token-budget.log`，逐字引用）。
旧的三档阶梯下，步数检查点**已经真机注入过三次**，三次都是 `tier=1/3 step=12`：

```
2026-09-24T17:45:49.845Z step stage: nudged tier=1/3 step=12 usage=124291 budget=3000000 label=adg/fdd55c65-4584-4082-83d2-618570604e5f
2026-09-24T17:55:04.609Z step stage: nudged tier=1/3 step=12 usage=104900 budget=3000000 label=adg/12bf2213-0322-4dfb-9c85-80e12066ab40
2026-09-24T18:22:13.725Z step stage: nudged tier=1/3 step=12 usage=142986 budget=3000000 label=adg/41c07ec8-a997-47e7-8bb1-9457ccf4bd89
```

（这三行是当时的旧日志格式，所以还带 `usage=` / `budget=`；**当前格式是
`step stage: nudged tier=n/N step=S label=…`，没有 token 字段**。）
它们同时证明：`agent/pre-step` 真的走到了这个监听器、步数计数与 tier 判定按真实子代理在跑、
而且被注入的消息确实出现在每个子代理的 `session.v3.jsonl.zstd` 转写里
（`role: user`、`source: {kind:'plugin', plugin:'dsh-adg-token-budget'}`），与日志行毫秒级对齐；
第 12 步时它们只花了 10–14 万 token。`settled: released session state …` 也已经观测到（17:55:33）。

> **引用上面那行 source 时必须带上这一句**：那是 **v3 文件里的历史形状**。session format v4
> **废弃**了 `{kind:'plugin', plugin}` 包装，新记录直接写生产者自有的 kind
> `{kind:'plugin:dsh-adg-token-budget'}`（两者是同一个生产者身份：v4 读取 v3 记录时会把它转成
> 后者的形状）。**写回旧包装会让每一次委派在持久化那一刻整轮失败**
> —— `format v4 message requires a producer-owned source kind`（2026-09-28 实测事故，
> 见 `plugin/dsh-adg-token-budget/README.md`「The source kind is a v4 admission contract」与
> `docs/evidence.md` §15）。

**迁移成 bundle 之后的实测（真机实测，有日志为证）** —— 逐字引用自
`C:\Users\cenqian\.dsh\adg-token-budget.log`，时间戳是 UTC：

```
2026-09-28T01:47:48.467Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T01:57:12.041Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[1, 2] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-28T01:59:25.308Z step stage: nudged tier=1/2 step=1 label=cordis/b625f841-df55-4983-a4eb-66f96ac0b05f
2026-09-28T01:59:31.672Z step stage: nudged tier=2/2 step=2 label=cordis/b625f841-df55-4983-a4eb-66f96ac0b05f
2026-09-28T01:59:43.808Z settled: released session state label=b625f841-df55-4983-a4eb-66f96ac0b05f
2026-09-28T02:00:09.597Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

各行归属（引用时必须带上，别把某一行读成"bundle 层冷启动"）：

1. `01:47:48` —— 手贴行已从 `profiles/web/cordis.patch.yml` 删除**之后**、`plugin_manager`
   的 `install_bundle` 装上 bundle **之后**写的。当时进程里唯一能提供这一行的层就是 bundle 层
   ⇒ **实测：bundle 层的行确实挂载并 `apply` 了**，且 `!!js dshHomePath(...)` 求值成功
   （`logFile` 落回同一个文件）。**该进程没有重启**（本地时间 09:05:04 启动，早于迁移）。
   **机制归属**：触发这次重读的是改写 profile 清单 ⇒ 整份 patch 栈重读、顺带重读 bundle 层
   （第 3 节），**不是** bundle 层自己被 watch。
2. `01:57:12` / `01:58:46` —— 临时在 profile 层**加**、再**删**一条 `- id: adg-token-budget`
   覆盖行（`stepTiers: [1, 2]`）之后各写的一行 ⇒ **实测：profile 覆盖行热重载、不用重启**；
   `01:58:46` 那行已回到 14 档出厂形状。（`01:59:20` 还有一行：同一层把 `presets` 临时写成
   `[cordis]`、`stepTiers` 仍是 `[1, 2]`，为的是走一条真实注入路径 —— 原因见上面"行为"那行。）
3. `01:59:25` + `01:59:31` + `01:59:43` —— 一次真实委派 ⇒ **实测：迁移后的行确实计数并注入了
   检查点**（`tier=1/2 step=1`、`tier=2/2 step=2`），收尾 `settled: released session state`。
   同一子代理的转写
   `C:\Users\cenqian\.dsh\sessions\--D-dsh--\b625f841-df55-4983-a4eb-66f96ac0b05f/session.v4.jsonl.zstd`
   里两条 `user/message` 记录带 `"source":{"kind":"plugin:dsh-adg-token-budget"}`（v4 生产者自有
   的 kind），**持久化没有失败** ⇒ 2026-09-28 那次 `format v4 message requires a producer-owned
   source kind` 事故没有复发；`2/2` 那一条带最后一档的追加句，子代理在下一步回复里说明了选择
   （"我选择**继续**——预计还需 3 步……"）。**核对这种转写必须按多帧文件处理**，判据见
   `plugin/dsh-adg-token-budget/testing-guide.md` 第 3 节。
4. `02:00:09` —— 临时覆盖行删掉之后，恢复成 bundle 行的出厂形状。
5. `02:19:52`（同日稍后，**关掉再放开的实测**）—— 在 profile 层追加一条**只写**
   `- id: adg-token-budget` + `disabled: true`（**不带 `config:`**）的覆盖行 ⇒
   `plugin_manager list_plugins` 里 `include:adg-token-budget` 变成 **`enabled: false`、
   `fiberPhase: null`**，条目总数仍是 **190**（既没有多一条、也没有少一条），而**日志没有写出任何新行**
   —— 被 `disabled` 的行不会被 import，所以连 `activation: inactive (enabled: false) …` 都没有。
   删掉这条覆盖行之后，日志重新写出下面这一行、`list_plugins` 回到 `enabled: true` /
   `fiberPhase: active` ⇒ **这一行确实是从 bundle 层恢复的**（没有往 profile 层贴回任何 `config:`）：

   ```
   2026-09-28T02:19:52.105Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
   ```

   ⇒ 两条结论：**`disabled: true` 是一个可用的关掉开关**（写在 profile 覆盖行上、热重载、不用重启，
   因为是整块替换语义，**不需要也不应该带 `config:`**）；**"日志里没有新行"不等于"插件还活着"**
   —— 这一档的复核要用 `list_plugins` 的 `enabled` / `fiberPhase`，或看恢复那一刻的 `activation:` 行
   （第 5 节第 2 步把它与 `enabled: false` 的区别写清）。
6. `02:31:45` + `02:32:13`（同日更晚，**残留手贴行的实测**）—— 在 `C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml`
   末尾追加一条同 id 的 `- insert:` 手贴行（`config:` 只写 `enabled: true` / `presets: ['adg']` /
   `stepNudge: true` / **`dryRun: true`** / 出厂 14 档 `stepTiers` / `logFile: !!js dshHomePath('adg-token-budget.log')`），
   等热重载，再删掉。**三件事都要按真机实测档引用**（第二行是节引，`…` 处与上一行同段，只有时间戳与
   `dryRun` 不同）：

   ```
   2026-09-28T02:31:45.335Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
   2026-09-28T02:32:13.279Z activation: active … stepText=builtin dryRun=false …
   ```

   - **不是"重复挂载"**：条目总数仍然 **190**（`plugin_manager list_plugins`），而且整个过程
     **只写出一行**激活行（上面第一行）。
   - **残留行整块接管了 `config:`**：那一行的 `dryRun` 变成 **`true`**（出厂 bundle 行是 `false`；
     上面第 5 条 `02:19:52` 那行还是 `dryRun=false`）。删掉残留行后立刻恢复成上面第二行的
     `dryRun=false` ⇒ **它是"改掉那一行"，不是"多加一行"**：后到的层带着一个已在的 id ⇒ 按 id 合并，
     `config` 整个被顶掉（`docs/evidence.md` §16.2 的整块替换语义）。**危险的落点在后果**：
     `dryRun=true` 意味着**注入当场停掉**，而 `fiberPhase` 仍然是 `active`、日志看起来完全正常 ——
     "插件在跑"与"提醒还在发"是两件事。
   - **这一行同时脱离管理**：残留期间 `list_plugins` 里这一条是 `entryId: include:adg-token-budget`、
     `enabled: true`、`fiberPhase: active`、**`readOnlyReason: "unaddressable"`**，原本的
     **`patchId: "adg-token-budget"` 字段消失**；删掉残留行后 `patchId` 回来、`readOnlyReason` 消失
     ⇒ 残留期间 **Plugins 页和 `set_plugin` 都再也点不动这一行**。

   （这与 `docs/evidence.md` §14.3 那条护栏是**两件事**：那一条讲的是 preset 声明行 `preset-adg`
   的"同一个 id 只能有一个家"，当时只登记为危险形状、没量过后果。引用时别混。）

**已移除的 token 两档：当年实测（历史证据，不代表当前行为）。** 下面三行来自仍然带
token 两档的旧构建，插件再也不会写出这类行；保留它们是因为"为什么会删掉"就是这些实测：

```
2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
```

之后这一行被切成 `dryRun: true`，用户自己的真实委派又写了几百行 dry-run 判定。截至
`2026-09-25T01:1x+08:00` 的统计快照：**5 个**真实子代理、`dry-run soft stage: would nudge`
**36** 行、`dry-run hard stage: would cancel` **437** 行、`agent.cancel` **0** 次、
`soft stage: nudged` **0** 行；
最大的那一个子代理自己就占了 297 行 `would cancel`、峰值 **48,992,135**。
这证明 dry-run 真的不动作，也证明**300 万落在这台机器自己流量的主体里**（5/5 都越过去了）
—— 这正是把两档删掉的理由：按累计 token 介入只会截断正常产出，累计量大本身不是"跑飞了"的证据。

**哪些还没观测过 —— 说清楚：**

- **默认 14 档阶梯下的注入还没观测过。** 三次真实注入都是旧的三档阶梯下的 `tier=1/3 step=12`；
  迁移后那两条是 `[1, 2]` 临时覆盖行下的 `tier=n/2`（上面第 3 条），不是这 14 档；
  `[4, 8, …, 280]` 这 14 档下还没有一次注入记录，`dry-run step stage: would nudge` 这类行
  在本机也**从来没出现过**（这台机器从"没有这个 stage"直接到"已武装"，中间没停过）。
  （旧版"步数检查点与 token 软档同一步的折叠路径"已经随软档一起删除，不再是待观测项。）
- **迁移后 `presets: ['adg']` 对真实 Adg 专家子代理的注入：未观测。** 上面第 3 条走的是
  `presets: ['cordis']` 下的**通用委派**，不是 Adg 专家委派。量法：新对话里走一次 Adg 专家委派
  （或临时加一条 profile 覆盖行 `presets: ['adg']` + `stepTiers: [1, 2]`），看日志里
  `step stage: nudged … label=adg/…`。
- **冷启动后的 bundle 层：未观测。** 上面那几行不是"bundle 层被 watch"来的：写它们的进程是
  迁移**前**起的，这次生效靠的是**改写 profile 清单带来的整份 patch 栈重读**（第 3 节）。
  量法：重启 dsh → `list_bundles` 仍有这一条 + 日志里新出现一行 `activation: …`。
- **`desktop` profile 生效：未观测。** 它的 `patchReload` 不是 `live` ⇒ 该 profile 要下次启动才生效。
  量法：启动 desktop profile → 看同一份日志的 `activation` 行。
- **更早更密的阶梯 + 选择式措辞有没有用，完全未观测。** 分布（37 个子代理，中位数 39 步、p10 只有 6）
  与成本（214 条提醒约占总账单 0.25%）都是实测的；"收到检查点的子代理是否更早收敛"没有证据。
  量法：`node D:\dsh\.dsh-token-audit\audit-steps.mjs "C:\Users\cenqian\.dsh\sessions"`
  前后各跑一次，比 p50/p75/p90，不要比均值。
- **注入的提醒是否真的让子代理收敛得更快**：三个子代理对提醒做出了反应（两个说要收敛、
  一个选继续并说明理由），说明提醒被读到并被当成决策输入；但三例、三个不同任务，
  不足以说明它让任何东西变快了。**恢复的子代理会不会被再次提醒**仍未观测。
- dry-run 的行是**每一步**写一行，所以那个行数是"检查点到期的步数"，不是"子代理个数"；
  真正武装的检查点每个 tier 只注入一次，也只写一行 `step stage: nudged`。

## 5. 关掉 / 回滚

1. `enabled: false` —— 不注册监听器、不写决策日志（最干净）。**写在哪一层决定要不要重启**：
   profile 层的覆盖行热重载（**键要写全**，整块替换），bundle 行要重启。注意**两个出厂值都是
   "开着"**：bundle 行是 `enabled: true`，插件自己的默认值也是 `true`；只有
   `examples/cordis.patch.yml` 那一行仍写着 `enabled: false` —— 它是键参考 / 手工覆盖模板，
   **不是**挂载行（第 2 节）。
2. **在 profile 层的覆盖行上写 `disabled: true`** —— 这是迁移后**实测可用**的关掉开关
   （**真机实测**，2026-09-28，见第 4 节第 5 条）：**热重载、不用重启**；因为按 id 命中是整块替换
   语义，这条**只写 `- id: adg-token-budget` + `disabled: true`，不需要也不应该带 `config:`**。
   **它与第 1 步的区别必须写清楚**：`enabled: false` 是插件自己在 `apply` 里写激活行，所以
   "宿主确实加载过"仍然有证据；`disabled: true` 是 **Loader 根本不 import 这一行**，所以
   **什么证据都不会有** —— 日志里连 `activation: inactive (enabled: false) …` 都不会出现。
   ⇒ **"日志里没有新行"不等于"插件还活着"**；这一档的复核要用 `plugin_manager list_plugins` 的
   `enabled` / `fiberPhase`，或者看恢复那一刻新写出的 `activation:` 行。
   想退到"连包都不选"：把 `dsh-adg-token-budget` 从该 profile 的 `dsh.profile.bundles` 去掉
   —— 那动的是 profile 清单，**以重启为准**（第 3 节）。
3. **删掉残留的手贴挂载行 —— 这一刀必须人来下。** `install.ps1` / `install.sh` 只报告、不代删
   （不猜用户手改过的文件），而残留的**实测**后果不是"多一条条目"，是**静默改掉那一行的 `config:`**
   （实测 `dryRun` 被顶成 `true` ⇒ **注入当场停掉，而 `fiberPhase` 仍是 `active`、日志看起来完全
   正常**）**并且让这一行脱离 Plugin Manager**（`patchId` 消失、
   `readOnlyReason: "unaddressable"` ⇒ Plugins 页与 `set_plugin` 都点不动它）—— 第 2 节与
   第 4 节第 6 条。**恢复判据**：删掉之后热重载重新写出一行 `activation: … dryRun=false …`
   （回到出厂形状），且 `list_plugins` 里 `patchId: adg-token-budget` **回来**、`readOnlyReason`
   **消失**；两条都成立才算清干净。
   想还原改前的样子：profile 清单的备份是 `package.json.bak-adg-token-budget`（脚本写的；
   `install_bundle` 写的清单没有这份备份 —— 本机 `web` 就没有），删手贴行时留的备份是
   `cordis.patch.yml.bak-adg-token-budget-bundle-migration`。
   **不要把后者当成挂载行还原回去** —— 再贴一次就按 id 合并、整块接管 bundle 行的 `config`（第 2 节）。
4. 想清干净：删 `$DSH_HOME/bundles/dsh-adg-token-budget/`（以及 profile 的 `node_modules` 下那条
   链接、`dsh.profile.bundles` 里那个名字；没有包被选中就不会被 import）。旧落点
   `$DSH_HOME/plugins/dsh-adg-token-budget/` 本机已由脚本删除。
   顺带可以把任一层次遗留的 `budgetTokens` / `softRatio` / `cacheReadWeight` / `softNudge` /
   `hardDryRun` 删掉 —— 它们已经被静默忽略，删不删都不影响行为，只影响可读性。
