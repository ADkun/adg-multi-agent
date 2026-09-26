---
title: dsh-adg-token-budget 模块设计
owner: Adg 插件维护者
status: current
last_reviewed: 2026-09-25
---

## 职责与边界

**负责**：受管子代理的**步数收敛检查点** —— 只数"真正进入的步"（`agent/pre-step` 的判定为
`{kind:'enter'}` 的那一步），在步数命中 `stepTiers` 里的某一档时，**追加恰好一条**可选提醒；
并把"这一行有没有被宿主加载、加载的是哪一版"写成一行加载期激活行。

**不负责**（逐条，防越权）：

- 不调度工作、不选模型、不碰顶层会话：深度为 0 的会话一律原样放行（`src/budget.js` 的
  `isDelegatedChild`）；
- **不做任何 token 预算**。包名里的 `token-budget` 与挂载行 id `adg-token-budget` 之所以还叫这个名字，
  是因为**改名会动部署路径与热重载身份**：累计 token 软/硬两档已移除，插件**不读任何投影**、没有阈值、没有权重（`src/config.js` 与
  `src/plugin.js` 的模块注释记录了移除口径）；
- 不截断、不 reject、不 `agent.cancel`：插件自己产生的判定永远是"原样放行 + 可选追加一条消息"；
- 不治"**哪些 preset 受管**"：那是 preset 侧写入 `session.header.agentPreset` 的事实，
  与本插件的 `presets` 配置项两者相乘的结果，不是本插件能单方面决定的；
- 不做聊天 UI、不做浏览器半边：它是 host-plane 单边行，没有客户端产物；
- 不决定工具目录：**不注册任何模型可见工具**。

## 依赖关系

- **依赖（宿主事件，无需经契约）**：`agent/pre-step`（`waterfall`，注册为 `{global:true}`）——
  这是唯一的决策入口；`subagent/end`（可选，注册失败即降级，见 `ChildStepState`）——只用于释放
  逐会话计数。两者都是 host 组合在进程内提供的事件，不是契约文件里的接口，因此没有 `contracts/` 条目。
- **刻意不依赖**：不读 `sessionProjections`（该依赖已随 token 两档一起移除）；不做任何
  `static inject`（见 I2）。
- **依赖（调用时解析，不静态 import）**：`@deepseek-ai/dsh-llm` 的 `createUserMessage`。
  用 `createRequire` 在**调用时**解析，锚点顺序（五个）见 `src/plugin.js` 的
  `resolveCreateUserMessage` 的文档注释；解析失败可存活 —— 退回本地 fallback 构造器
  `localCreateUserMessage`（见 I3）。
- **被依赖**：
  - preset 侧的 `session.header.agentPreset` 是本插件的**输入**（跨模块，见下条路由）；
  - `install.ps1` / `install.sh` 部署本模块，并在 `profiles/web/cordis.patch.yml` 补挂载行；
  - `examples/cordis.patch.yml` 是挂载行的模板（含全部键的注释与默认值）。
- **跨模块改动路由**：
  - 改"治理哪些会话" → 先读 `preset/design.md`（谁写 `agentPreset`、谁写 `delegationDepth`）；
  - 改挂载位置 / 部署集合 / 热重载口径 → 先读 `plugin/dsh-adg-token-budget/INSTALL.md`；
  - 改措辞 → **只动** `config.stepText`，不改代码（措辞住在 `config:` 里，热重载）。

## 核心数据模型

### PluginActivation（生命周期型）

代表：一行 `- id: adg-token-budget` 的**一次加载**（一次 `apply` 调用即一次加载事件）。

- 属性：`config`（该次加载的 `ResolvedConfig`）、`strategy`（`createUserMessage` 的解析结果，
  未解析时为 `unresolved`）。完整字段不在本对象上，见 `src/plugin.js` 的 `activationLine`。
- 状态机：`not-loaded` → `applying` → `active` | `inactive(enabled:false)` | `no-op`。

  | 状态 | 它**不是**什么 |
  |---|---|
  | `not-loaded` | 不是"插件不存在"：包在磁盘上、挂载行在 profile 里，只是进程还没 `apply` 它 |
  | `applying` | 不是可观测状态：它只在一次 `apply` 的栈内存在，没有对外句柄 |
  | `active` | 不是"监听器一定只有一个"：挂载两次时第二次仍进 `active` 并告警（见迁移矩阵） |
  | `inactive(enabled:false)` | **不是没加载** —— 激活行 `activation: inactive (enabled: false) …` 就是它加载成功的证据（I4） |
  | `no-op` | **不是 fatal** —— 它是 `ctx` 无事件 API 或 `apply` 内部失败的降级结果，profile 照常启动 |

  热重载可再入 `applying`：`config:` 变化时宿主重放该行并再次调用 `apply`。
- 迁移唯一入口：`apply(ctx, rawConfig)`（`src/plugin.js`）。**禁止绕过它直接改模块状态** ——
  进程级的注册账本（`appliedContexts` / `activeRegistrations`）只由 `apply` 与其 disposer 写。
- 不变量：
  - **I1** 禁止 `apply` 抛出。Cordis 里 `apply` 抛且未声明 schema = fiber 失败 = `dsh` 报
    fatal 启动错误（来源见"非功能红线"第 1 条）。
  - **I2** 禁止 `static inject` 任何服务：未挂载的服务会让 entry 永远 `pending`，同样是 fatal。
  - **I3** 禁止静态 `import` 任何 `@deepseek-ai/*`：部署在 `profiles/node_modules/` 下解析不到就整行挂不起来。
  - **I4** 每一次 `apply` 必须**恰好写一行**激活行，`enabled: false` 时也写。

### ChildStepState（句柄型）

代表"一次进行中的驻留期计数"：短生命周期、对外不可见、自带回收。

- 属性：`{ steps, firedTiers }`。键 = `agent.id`（即 session id，见 `sessionKeyOf`）。
  `firedTiers` 存的是**档位下标**而非档位值，所以被配置重复的档位不会互相当成同一档。
- 状态机：`open → released`。

  | 状态 | 它**不是**什么 |
  |---|---|
  | `open` | 不是"子代理还在跑"的证明：它是本监听器自己数出来的计数，与子代理的真实生命周期只通过 `subagent/end` 对齐 |
  | `released` | **不是"这个子代理结束了"**：可续跑的子代理被恢复后进入新的驻留期，`steps` 与 `firedTiers` **从头开始**、可以被再次提醒。这是有意的（恢复后的子代理有新的计划与新的跑飞机会）。**已由真机实测复核确认**（2026-09-25，见 `docs/evidence.md` §9）：`adg/807257e4-…` 在 18:52:10 出现 `settled:`、18:53:47 又出现新驻留期的首个检查点；`adg/448965ba-…` 有三轮完整驻留期、每轮都从第一档重新开始。单测覆盖的仍是"状态被清掉后会重新计数"这一**机制**，不是"恢复的子代理会重新收到提醒"这一**事实** |

- 迁移唯一入口：`markStep` / `entryOf(key, true)` 开（`src/plugin.js` 内）；`subagent/end` 处理器与
  `ctx.effect` disposer 释放。**禁止直接改 `steps` / `firedTiers`**。
- 不变量：
  - **I5** 禁止计"没真正进入的步"：下游 `reject` 掉的那一步不算步数，也不消耗档位
    （档位只在提醒**真的被投递**之后才标记）。
  - **I6** 禁止同一档位在同一驻留期内触发两次。
  - **I7** 禁止同一步注入超过一条消息：一步只评一个触发，多个档位同时到期时只发最靠前的那个，
    下一个到期的档位留到下一步。
  - **I8** `stepNudge: false` 时禁止分配任何状态（连计数都不建）。

### ResolvedConfig（不可变值对象）

代表：一次 `apply` 由 `normalizeConfig` 重新产出的完整选项对象；创建后即冻结。

- 属性（只列语义关键的，完整字段与默认值见 `src/config.js` 的 `DEFAULT_CONFIG`）：
  `enabled` / `presets` / `stepNudge` / `stepTiers` / `stepText` / `dryRun` / `logFile`。
- 无状态机。
- 不变量：
  - **I9** 禁止未知名让整行挂载失败：手写归一化、不导出 Cordis `Config` schema，
    被移除的 token 键与任何未知键一律忽略。
  - **I10** 禁止无效值让提醒变成**没有正文**的空话：空串/非字符串 `stepText` 回落到内置正文，
    不是回落到空。
  - **I11** 禁止 `stepTiers` 被清空后静默关掉功能：清洗后为空回落默认阶梯；要关功能只能用
    `stepNudge: false`。
  - **I12** 阶数上限 `MAX_STEP_TIERS` = 16；`stepText` 上限 `MAX_STEP_TEXT_CHARS` = 4000 **字符**，
    超长**截断而非拒绝**。
  - **I13** 禁止相对路径 `logFile` 静默写文件：相对路径关掉文件日志并告警（`createLogger`）。

### ConvergenceReminder（不可变值对象）

代表：`stepNudgeText({tierIndex,tierCount,stepCount,body})` 产出的提醒正文，包进 `UserMessage` 后
**深度冻结**（`localCreateUserMessage` / `createUserMessage` 两条路径都冻结）。

- 属性：`tierIndex` / `tierCount` / `stepCount` / `body`（内置或 `stepText`），产出一段文本。
- 无状态机。
- 不变量：
  - **I14** 禁止正文被读成停止指令：必须明说可选、可直接无视、两个分支对称、由任务本身决定；
    **禁止规定子代理汇报什么**（交付了什么、哪些没验证由它自己决定）；正文里禁止"立即停止"这类命令句。
  - **I15** 禁止各档正文递进：只有**最后**一档多一句信息，不是逐次加压。
  - **I16** 禁止自定义 `stepText` 再被追加内置尾句：整段替换。

## 对外接口

指针，不复制内容：

- 挂载行与**全部配置键的形状**：`examples/cordis.patch.yml`；默认值：`src/config.js` 的 `DEFAULT_CONFIG`。
- 模块导出面（`name` / `apply` / `stepNudgeText` / `createNudgeFactory` / `localCreateUserMessage` /
  `activationLine`，加 `resetRegistrationStateForTests` 这一测试缝），以及 4 个判定 helper
  （`delegationDepthOf` / `isDelegatedChild` / `presetIsGoverned` / `dueStepTier`）：
  `src/plugin.js` 与 `src/budget.js` 的导出声明。
- 部署单元：`package.json` 的 `files`。
- **本模块不覆盖 preset 的对外接口**（那是 `preset/design.md` 的范围），也**不注册任何模型可见工具**。

## 非功能红线

每条注明来源；来源一律指向实测/测试/事故的**指针**。

1. **禁止让 `apply` 抛出、禁止 `static inject`、禁止静态 `import` 任何 `@deepseek-ai/*`** ——
   来源：cordis 约束 + `dsh-app-boot` 的 fatal 上报口径（`plugin/dsh-adg-token-budget/README.md`
   的「Safety design」小节，该文件用英文小节名）。对应 I1/I2/I3。
2. **禁止恢复任何 token 触发路径**（读投影、阈值注入、`agent.cancel`、`{kind:'reject'}`）——
   来源：实测分布（默认阈值落在正常流量主体内、被观测到的越线会话全部越过），见仓库根 `README.md`
   的「第二层」一节及其「已移除的 token 两档：当年的实测证据」小节；台账口径见
   `docs/evidence.md` §4（该文件是证据台账，**其中 §9 才是本次复核的权威快照**）。对应 I9 与
   "不负责"清单。**该来源曾把"新阶梯下的注入"记为未观测，
   已被 `docs/evidence.md` §9 的复核推翻（冲突待人类裁决）** —— 本条红线本身不依赖那个说法：走
   token 触发路径的旧构建已不存在，这是源码级事实。
3. **禁止在同一水位重复注入**（一步最多一条消息；每个 tier 每驻留期一次）—— 来源：注入的消息会
   留在上下文里、之后每一步重发（成本理由），见 `plugin/dsh-adg-token-budget/README.md` 的
   「Safety design」小节与 `INSTALL.md` 第 4 节对"哪些行只在事件时写"的说明。对应 I6/I7。
4. **禁止把提醒写成停止指令** —— 来源：变异 **M13** 被测试抓住（"命令披着选择的外衣"），
   见 `plugin/dsh-adg-token-budget/README.md` 的「Mutation verification」小节。对应 I14。
5. **禁止去掉 `Number.isSafeInteger(value) && value >= 0` 这道深度闸门** —— 来源：`'1' > 0` 为真，
   会让一个被往返成字符串的 header 被当成子代理（旧代码里那会真的砍掉一个子代理）；
   见仓库根 `README.md`"第二层"一节的筛选条件说明。对应 `delegationDepthOf`。
6. **禁止热重载后不复核激活行就宣称新代码已生效** —— 来源：实测（换包后宿主重放了 `config:`、
   但激活行仍是旧形状：Node 的 ESM registry 按文件 URL 缓存，热重载不重新 `import`）；
   见 `plugin/dsh-adg-token-budget/INSTALL.md` 第 3 节。对应 I4 的"激活行是版本判据"。

## For Agents

- **动手前先读**：`plugin/dsh-adg-token-budget/AGENTS.md`（命令与模块红线）→ 本 `design.md` →
  改行为之前先读 `plugin/dsh-adg-token-budget/test/plugin.test.js`：**该行为是否已经被钉住**
  （被钉住的行为改之前要先想清楚是改测试还是改实现）。
- **绝不能做**：本文件"非功能红线"6 条；以及**禁止在 `dryRun` 打开时宣称"提醒已注入"**
  （`dryRun` 下 `firedTiers` 不被消费、只写 dry-run 判定行）。
- **停止并升级人类**（只有起草权，批准权在人类）：要推翻"提醒只能是可选"这条语义；要恢复任何
  token 档；要改挂载位置或包名 —— **包名与行 id 是热重载身份**，改名属于部署变更。

## 测试与验证

指向 `plugin/dsh-adg-token-budget/testing-guide.md`（不变量 I1–I16 的穷举用例、两个状态机的迁移
矩阵、跨模块消费侧契约测试、无破坏性路径的源码级检查、未被断言覆盖的变异面）。
