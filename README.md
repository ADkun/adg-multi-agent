# Adg 多智能体模式（DSH agent preset）

一个 DSH 自建 agent preset：**一个调度智能体 + 可委派的专家智能体名册**。
任务由调度智能体判断范围后分派给专家，专家之间也能继续互相转交。

- 内置专家：`agent_researcher`（只读检索，结论带出处）、`agent_coder`（改代码并自证）、`agent_reviewer`（只报告不修改）
- 配套技能：`adg-add-agent` —— 让你在**任何模式**（包括创造模式）下说一句「给 Adg 加一个智能体」就能新增专家

## 安装

装到两个位置（`${DSH_HOME:-~/.dsh}` 是你的 dsh 用户根）：

| 仓库里的路径 | 安装到 |
|---|---|
| `preset/`（两个文件） | `${DSH_HOME:-~/.dsh}/.agent-presets/adg/` |
| `skills/adg-add-agent/SKILL.md` | `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md` |

### 方式 A：把仓库地址交给 AI（推荐）

把这个仓库的地址发给 dsh 里的 AI，说一句「按仓库 README 装到本机」即可 ——
下面的 [给 AI 的安装指令](#给-ai-的安装指令) 一节就是写给它看的。

### 方式 B：手动

```sh
git clone <repo-url> ~/adg-multi-agent
sh ~/adg-multi-agent/install.sh                     # macOS / Linux
```

```powershell
git clone <repo-url> $HOME\adg-multi-agent
powershell -ExecutionPolicy Bypass -File $HOME\adg-multi-agent\install.ps1   # Windows
```

### 装完必须重启 dsh

**已挂载的 preset 不会因为 composition 文件变化而重新组合。** 已实测：preset 挂载之后把
composition 的行改掉，`compositionInventory()` 仍然返回旧行。所以安装完必须重启 dsh，
重启后在新建对话里选择「Adg 多智能体模式」。
（在重启之前，Adg 模式会用旧组合运行，不要拿它做验证。）

## 怎么用

1. 新对话选择 **Adg 多智能体模式**，直接说需求。
2. 调度智能体判断范围：调度、拆解、汇总自己做；查资料交 `agent_researcher`；
   写代码、改文件、跑命令验证交 `agent_coder`；审查已有改动交 `agent_reviewer`。
3. 需要多个专家时它会并行启动多个委派，最后自己汇总交付。
4. 专家之间也能互相转交，不需要你规划路径。

## 怎么加一个智能体

在**任何模式**里说，例如：

> 给 Adg 加一个智能体：文档员，负责把内部笔记改写成对外口径，只能读不能改文件，需要改动时交给 agent_coder。

AI 会加载技能 `adg-add-agent`，一次问清岗位 / 能力范围 / 越界转交给谁，然后改两处
（新增专家行 + 顶部调度名册），最后告诉你重启 dsh。

## 设计要点（为什么这么做）

- **刻意删掉了通用的 `subagent` / `subagent_fork` 行。** 子代理会继承父代理的整套
  composition；一旦存在通用委派行，专家就能绕过自己的范围再开一个"什么都能干"的子代理
  （已在创造模式实测复现）。删掉之后，「每个智能体只负责有限范围」才真正成立。
- **专家名册行故意对所有专家可见。** 这是「任何智能体都能把工作转交给其他智能体」的实现
  方式：名册行是 preset 作用域注册的，`toolFilter` 裁不掉，也不需要裁。
- **能力边界不是安全沙箱。** `toolFilter.allow` 只能裁掉"全局层"工具（`write`/`edit`/`pwsh`
  等），persona 是提示级约束。它保证的是**分工清晰、越界会转交**，不是权限隔离。

## 目录结构

```
preset/
  preset.yml            # 在模式选择器里显示的名称与简介
  agent.cordis.yml      # 调度智能体 persona + 三个专家智能体行
skills/
  adg-add-agent/
    SKILL.md            # 「给 Adg 加一个智能体」的操作手册
install.ps1             # Windows 安装脚本
install.sh              # macOS / Linux 安装脚本
```

## 兼容性

- 从 DSH 出厂 preset `standard`（标准模式）复制而来，只有两处实质改动：
  `persona` 增加调度名册与分派规则；`delegation` 组由通用委派行换成专家行。
- 依赖标准模式本来就有的出厂包（`@deepseek-ai/dsh-tool-subagent`、`@deepseek-ai/dsh-persona`、
  `@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-subagent-control` 等）。
- 新增/删除智能体后需要重启 dsh 才生效，这是 preset 挂载机制决定的，不是缺陷。
- **`install.ps1` 带 UTF-8 BOM，是有意的，不要去掉。** Windows PowerShell 5.1 在没有 BOM 时
  会按系统 ANSI 代码页读取脚本，中文会变成乱码并直接解析失败（本仓库已实测复现并修复）。

## 给 AI 的安装指令

（人类可忽略；把仓库地址交给 AI 时让它照此执行。）

1. `git clone <repo-url> <tempdir>`
2. 复制 `<tempdir>/preset/preset.yml` 与 `<tempdir>/preset/agent.cordis.yml`
   → `${DSH_HOME:-~/.dsh}/.agent-presets/adg/`
3. 复制 `<tempdir>/skills/adg-add-agent/SKILL.md`
   → `${DSH_HOME:-~/.dsh}/skills/adg-add-agent/SKILL.md`
4. 目标目录通常在工作区之外，写入会被沙箱拒绝一次；按提示用 `sandbox_permissions`
   升级重试同一条命令（用户会在界面上批准）。
5. 校验：挂一个注入 `agentPresets` 的临时插件（见技能 `editing-cordis-compositions`），
   - `await resolve('adg')` 的 `broken` 必须为空；
   - `await standingKeyFor('adg')` 走一次真实挂载（能报出包解析不到、配置非法、行未激活、
     服务发布到全局 realm 四类错误）；
   - `await compositionInventory()` 里 `adg` 必须出现 `agent-researcher`、`agent-coder`、
     `agent-reviewer` 三行，且**没有** `tool-subagent`、`tool-subagent-fork` 行。
6. 明确告诉用户：**必须重启 dsh**，之后在新建对话里选择「Adg 多智能体模式」。
7. 如果用户还需要在**创造模式**里说「给 Adg 加一个智能体」被识别，确认第 3 步的技能已就位——
   `<dshHome>/skills` 是 `dsh-skill-filesystem` 的用户技能根（rank 400），两种模式都会扫描且热加载。