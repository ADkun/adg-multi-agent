---
name: adg-add-agent
description: 在 Adg 多智能体模式（agent preset id `adg`）里新增、修改或删除一个专家智能体。当用户说「给 Adg 加一个智能体 / 新增一个专家 / 让某个岗位的智能体负责 X / 把某个智能体删掉」时使用。
whenToUse: 用户要求为 Adg 多智能体模式增加、调整或删除一个可委派的专家智能体。
---

# 在 Adg preset 里增删一个智能体

Adg 模式里每个「智能体」就是 Adg preset 的 `agent.cordis.yml` 中 `delegation` 组里的一行
`@deepseek-ai/dsh-tool-subagent`。一行 = 一个可委派的专家：

| 字段 | 含义 |
|---|---|
| `id` | 行标识，约定 `agent-<name>` |
| `config.toolName` | 模型看到的委派工具名，约定 `agent_<name>`，**必须全局唯一** |
| `config.persona` | 这个智能体的职责、能力边界、越界时怎么做、输出要求 |
| `config.toolFilter.allow` | 它被允许使用的工具白名单 |
| `config.backgroundMode` | 保持 `continuable`（后台接续干活，结果以通知回到调度者） |

## 先确认用户意图（一次问清）

用 `ask_user_question` 一次问齐，缺什么问什么：

1. 岗位名与一句话职责（例：文档员，负责把内部笔记改写成对外口径）。
2. 能力范围：需要哪些工具（读写文件 / 跑命令 / 联网检索 / 只读），以及明确**不能**做什么。
3. 越界时应该转交给谁。

如果用户只说「加一个查文档的智能体」，就替他把这三项拟好，给用户确认一次即可，不要反复追问细节。

## 落盘步骤

1. **定位 preset 目录**，不要猜路径。权威来源是 `agentPresets.list()` / `resolve('adg').path`；
   默认根是 `${DSH_HOME:-~/.dsh}/.agent-presets/adg/`。
2. 在 `delegation` 组的专家名册段里**复制一行现有专家**，改 `id`、`toolName`、`persona`、
   `toolFilter.allow` 四个字段。
3. **同步更新文件顶部 `persona` 的 prefix**：把新专家加进「可委派的专家」名册，并按需补一条
   调度规则。这一步不能省，否则调度智能体根本不知道有这个专家。
4. **删除智能体**：删掉那一行 + 顶部名册里的那一行，两处都要改。
5. 写入 preset 目录可能在工作区之外，若被沙箱拒绝，按提示升级重试同一条命令一次即可。

## 校验与生效（重要，别承诺错）

- **校验**：调用 `standingKeyFor('adg')` 走到真实挂载，能把「包解析不到 / 配置非法 / 行没激活 /
  服务发布到全局 realm」四类错误报出来并指明是哪一行。要拿到 `agentPresets`，按技能
  `editing-cordis-compositions` 挂一个临时插件注册工具即可。
- **生效**：**已挂载的 preset 不会因为 composition 文件被改动而重新组合。** 已实测：挂载后把
  28 行改成含 3 个专家行的版本，`compositionInventory()` 仍返回旧的 28 行。因此新增或删除智能体后
  **必须重启 dsh（Host 进程）**，新组合才会在 Adg 的新对话里生效。
- 在重启之前，**不要引导用户去用 Adg 模式**：他拿到的会是旧组合（没有专家名册）。
  正确说法是：「改动已保存，重启 dsh 之后在 Adg 模式新开对话就能用这个智能体。」

## 硬约束（不要违反）

- **不要加回通用的 `dsh-tool-subagent`（`toolName: subagent`）或 `subagent_fork` 行。**
  子代理会继承父代理的这整套 composition，一旦存在通用行，专家就能绕过自己的范围再开一个
  不受限的子代理，能力边界形同虚设（这条已在创造模式实测复现）。
- **能力边界不是安全沙箱。** `toolFilter` 只裁「全局层」工具；preset 里注册的工具（包括专家
  名册本身）裁不掉。persona 是提示级约束。真正的隔离靠两点：删掉通用委派行 + 每个专家的 allow 名单。
- 专家名册行**故意**对所有专家可见，这是「任何智能体都能把工作转交给其他智能体」的实现方式，
  不要为了「更干净」把它们藏起来（也没有机制能藏）。

## 本技能从哪来

位于用户技能根 `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md`，被 `dsh-skill-filesystem`
以 rank 400 扫描并热加载，所以**创造模式与 Adg 模式都能读到它**——在两种模式里说「给 Adg 加一个
智能体」，AI 都知道你在说什么。