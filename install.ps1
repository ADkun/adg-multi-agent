# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： powershell -ExecutionPolicy Bypass -File .\install.ps1
# 注意：本文件必须保留 UTF-8 BOM —— Windows PowerShell 5.1 在没有 BOM 时会按系统 ANSI
# 代码页读取脚本，中文变成乱码并直接解析失败（本仓库已实测复现，见 README「兼容性」）。
$ErrorActionPreference = 'Stop'

$root = $env:DSH_HOME
if (-not $root) { $root = Join-Path $HOME '.dsh' }
# 插件要求 logFile 是绝对路径（相对路径会被它关掉文件日志），所以这里先把 DSH_HOME 归一成绝对路径。
if (-not [System.IO.Path]::IsPathRooted($root)) { $root = Join-Path (Get-Location).Path $root }
$root = [System.IO.Path]::GetFullPath($root)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$presetDest = Join-Path $root '.agent-presets\adg'
$skillDest = Join-Path $root 'skills\adg-add-agent'

New-Item -ItemType Directory -Force -Path $presetDest, $skillDest | Out-Null
Copy-Item (Join-Path $here 'preset\preset.yml') (Join-Path $presetDest 'preset.yml') -Force
Copy-Item (Join-Path $here 'preset\agent.cordis.yml') (Join-Path $presetDest 'agent.cordis.yml') -Force
Copy-Item (Join-Path $here 'skills\adg-add-agent\SKILL.md') (Join-Path $skillDest 'SKILL.md') -Force

# 插件装到 profiles\node_modules：这是所有 profile 共享的模块解析根 —— 从 profile 目录
# （web 的 cordis.yml 就在 profiles\web\）按 Node 的常规父级 node_modules 上溯正好走到这里，
# 所以一份拷贝对所有 profile 都可用（本机的 dsh-windows-notifier 也在这个位置）。
# 真拷贝，不是 junction/symlink：部署后的插件独立于仓库，删掉或挪走仓库都不会让 dsh 启动失败。
# 先删后拷：重复执行会干净覆盖，不留下上一层版本的残留（test\ 不进部署）。
$pluginSrc = Join-Path $here 'plugin\dsh-adg-token-budget'
$pluginDest = Join-Path $root 'profiles\node_modules\dsh-adg-token-budget'
if (Test-Path -LiteralPath $pluginDest) { Remove-Item -LiteralPath $pluginDest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pluginDest | Out-Null
foreach ($item in 'package.json', 'src', 'README.md', 'examples', 'LICENSE') {
  Copy-Item -LiteralPath (Join-Path $pluginSrc $item) -Destination $pluginDest -Recurse -Force
}

# 挂载行写进 web profile 自己的 patch 层（热重载），不动机器级的 $root\cordis.patch.yml：
# 机器级那一层套在每个 profile 上（web / headless / sdk / 自建），而这个插件只对 adg preset 的
# 子代理生效，装到机器级等于让每个 profile 都去 import 它。要全机生效就把同一行搬过去。
$patchFile = Join-Path $root 'profiles\web\cordis.patch.yml'
if (-not (Test-Path -LiteralPath $patchFile)) {
  $patchNote = "未找到 $patchFile，跳过挂载行注册（插件文件已复制；请手工把 plugin\dsh-adg-token-budget\examples\cordis.patch.yml 的行贴上去）"
} else {
  # -Encoding UTF8 不能省：Windows PowerShell 5.1 的 Get-Content 默认按系统 ANSI 代码页读，
  # 用户自己在注释头里写的中文会被读成乱码再被原样写回去（5.1 下实测）。
  $lines = @(Get-Content -LiteralPath $patchFile -Encoding UTF8)
  # 在已经解码的行里找，不用 Select-String：5.1 上按 ANSI 解码时，一个残缺的前导字节
  # 可能把紧跟其后的 ASCII 首字母一起吞掉，导致明明存在的行匹配不上。
  $registered = @($lines | Where-Object { $_.Contains('dsh-adg-token-budget') }).Count -gt 0
  if ($registered) {
    $patchNote = "挂载行已在 $patchFile 里（未改动；enabled 的值以该文件为准）"
  } elseif ($lines.Count -eq 0 -or $lines[$lines.Count - 1].Trim() -ne '[]') {
    # patch 层的末行不是空数组字面量，说明这个文件被手工改过；不猜结构，只报错让人自己加。
    $patchNote = "末行不是 []，内容不可预期：未改动 $patchFile，请手工把 plugin\dsh-adg-token-budget\examples\cordis.patch.yml 的行贴上去"
  } else {
    $backup = "$patchFile.bak-adg-token-budget"
    Copy-Item -LiteralPath $patchFile -Destination $backup -Force
    $head = @()
    if ($lines.Count -gt 1) { $head = $lines[0..($lines.Count - 2)] }
    $row = @(
      '# 步数收敛检查点：按 4/8/12/…/280 的阶梯给 Adg 专家子代理注入可选收敛提醒。',
      '# 提醒是"自己选：收尾汇报 or 继续做完必需的工作"，不是停止指令——阶梯提前加密度就是靠这一点才安全。',
      '# 按累计 token 介入的两档（软档收尾提醒 + 硬档 agent.cancel）已整体移除：输出型任务本来就需要那么多 token，',
      '#   按阈值砍只会截断产出。插件现在既不注入任何 token 触发的消息，也从不 agent.cancel（详见 README）。',
      '# enabled: false 表示已挂载但不动作。改 config: 热重载立即生效；但换过 src\ 里的代码之后必须重启 dsh',
      '# （已实测：热重载只重放 config，不会重新 import 已经加载过的模块）。',
      '# 推荐上线顺序：enabled: true + dryRun: true 校准 → dryRun: false（提醒真的注入）。没有硬档要武装了。',
      '# 想调措辞：写 stepText（config: 改动，热重载、不用重启）；激活行会写 stepText=builtin|custom。',
      '- insert:',
      '    - id: adg-token-budget',
      "      name: 'dsh-adg-token-budget'",
      '      config:',
      '        enabled: false',
      "        presets: ['adg']",
      '        stepNudge: true',
      '        stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]',
      "        logFile: '$(Join-Path $root 'adg-token-budget.log')'"
    )
    # 不带 BOM 的 UTF-8 + LF：与 dsh 自己生成的 patch 文件逐字节一致（-Encoding UTF8 在 5.1 下会写 BOM）。
    [System.IO.File]::WriteAllText($patchFile, (($head + $row) -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
    $patchNote = "已加入挂载行（enabled: false），原文件备份为 $backup"
  }
}

Write-Host "已安装到 dsh 用户根：$root"
Write-Host "  preset -> $presetDest"
Write-Host "  skill  -> $skillDest"
Write-Host "  plugin -> $pluginDest"
Write-Host "  patch  -> $patchNote"
Write-Host ""
Write-Host "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
Write-Host "（preset 改动按重启验收：已挂载的会话不会中途换组合，别在重启前拿它做验证。）"
Write-Host "（插件行是另一回事：web profile 的 cordis.patch.yml 改 config: 热重载、不用重启；"
Write-Host "  但换过插件 src\ 里的代码之后必须重启 —— 热重载不会重新 import 已加载的模块，"
Write-Host "  所以这次改完 src\ 的代码，必须重启 dsh 才会生效。装好不等于已武装，见 README。）"
Write-Host ""
Write-Host "小结：复制了 preset 2 个文件 + 技能 1 个 + 插件 5 项（package.json/src/README.md/examples/LICENSE）；挂载行 -> $patchNote；preset 改动必须重启 dsh 才生效；插件行改 config: 热重载，但换过 src\ 里的代码之后同样必须重启。"
