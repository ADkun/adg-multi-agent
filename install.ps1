# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： powershell -ExecutionPolicy Bypass -File .\install.ps1
#        powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profiles web,desktop
# 注意：本文件必须保留 UTF-8 BOM —— Windows PowerShell 5.1 在没有 BOM 时会按系统 ANSI
# 代码页读取脚本，中文变成乱码并直接解析失败（本仓库已实测复现，见 README「兼容性」）。
#
# 2026-09-28 重写：dsh 0.1.7-rc.2 起 `$DSH_HOME\.agent-presets\<id>\` 那套目录发现机制已被移除，
# 旧的"拷 preset.yml + agent.cordis.yml"装法装出来的东西**没有任何组件会去读**。现在的形状是
# 一个 bundle：包清单声明 dsh.bundle.patch，patch 里 insert 一行 @deepseek-ai/dsh-agent-preset
# 声明（id/name/description/order/plugins）。本脚本：生成 bundle → 放到 $DSH_HOME\bundles\ →
# 装进目标 profile 的 node_modules 并写进该 profile 的 dsh.profile.bundles。
param(
  [string[]]$Profiles,
  [switch]$SkipPackages
)
$ErrorActionPreference = 'Stop'

$root = $env:DSH_HOME
if (-not $root) { $root = Join-Path $HOME '.dsh' }
# 插件要求 logFile 是绝对路径（相对路径会被它关掉文件日志），所以这里先把 DSH_HOME 归一成绝对路径。
if (-not [System.IO.Path]::IsPathRooted($root)) { $root = Join-Path (Get-Location).Path $root }
$root = [System.IO.Path]::GetFullPath($root)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$skillDest = Join-Path $root 'skills\adg-add-agent'
$bundleName = 'dsh-adg-preset'
$bundleStable = Join-Path $root "bundles\$bundleName"
$pluginName = 'dsh-adg-token-budget'
$pluginStable = Join-Path $root "plugins\$pluginName"

# ── 目标 profile ────────────────────────────────────────────────────────────────
# 默认：能装 preset 的所有 profile —— 判据是它的 bundle 列表里有 @deepseek-ai/dsh-web-app，
# 因为 agent-preset-registry（agentPresets 服务）正是这个 bundle 声明的（实测：dsh-base 和
# dsh-headless 都不声明它）。往缺 registry 的 profile 里塞声明行会让该 profile 启动失败。
$profilesDir = Join-Path $root 'profiles'
if (-not $Profiles -or $Profiles.Count -eq 0) {
  $Profiles = @()
  foreach ($dir in Get-ChildItem -LiteralPath $profilesDir -Directory -ErrorAction SilentlyContinue) {
    if ($dir.Name -eq 'node_modules') { continue }
    $manifest = Join-Path $dir.FullName 'package.json'
    if (-not (Test-Path -LiteralPath $manifest)) { continue }
    # 防御式读取：profile 目录里可能有 dsh.profile 缺字段的 package.json（或根本不是 profile），
    # 那样的目录不该让整个安装脚本崩掉，跳过即可（判据本身只认 bundles 列表里有 web-app 的）。
    $json = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundles = @()
    if ($json.dsh -and $json.dsh.profile -and $json.dsh.profile.bundles) { $bundles = @($json.dsh.profile.bundles) }
    if ($bundles -contains '@deepseek-ai/dsh-web-app') { $Profiles += $dir.Name }
  }
}
if ($Profiles.Count -eq 0) { throw "在 $profilesDir 下没找到可装 preset 的 profile（判据：dsh.profile.bundles 含 @deepseek-ai/dsh-web-app）" }

# ── 1. 用户技能 ────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $skillDest | Out-Null
Copy-Item (Join-Path $here 'skills\adg-add-agent\SKILL.md') (Join-Path $skillDest 'SKILL.md') -Force

# ── 2. browser/ 工具链 ─────────────────────────────────────────────────────────
# 它是普通文件、不是插件也不是 preset：重新跑一次本脚本就生效，**不需要重启 dsh**。
# 先删后拷，避免上一层版本的残留。
$browserSrc = Join-Path $here 'browser'
$browserDest = Join-Path $root 'browser'
if (Test-Path -LiteralPath $browserSrc) {
  if (Test-Path -LiteralPath $browserDest) { Remove-Item -LiteralPath $browserDest -Recurse -Force }
  Copy-Item -LiteralPath $browserSrc -Destination $browserDest -Recurse -Force
  $browserNote = "browser/ 工具链 -> $browserDest"
} else {
  $browserNote = "未找到 $browserSrc，跳过 browser/ 工具链部署"
}

# ── 3. preset bundle：生成 → 落到稳定位置 → 装进 profile ───────────────────────
# 源文件永远只有 preset\preset.yml + preset\agent.cordis.yml；bundle\adg-preset\ 是构建产物
# （在 .gitignore 里），每次安装都重新生成，所以没有人需要手改 patch。
& node (Join-Path $here 'tools\gen-preset-bundle.mjs')
if ($LASTEXITCODE -ne 0) { throw "tools\gen-preset-bundle.mjs 失败（exit $LASTEXITCODE）" }

# $DSH_HOME\bundles\ 是稳定位置：profile 只引用这里，仓库可以随便挪/删。
if (Test-Path -LiteralPath $bundleStable) { Remove-Item -LiteralPath $bundleStable -Recurse -Force }
New-Item -ItemType Directory -Force -Path $bundleStable | Out-Null
Copy-Item -LiteralPath (Join-Path $here 'bundle\adg-preset\cordis.patch.yml') -Destination $bundleStable -Force
Copy-Item -LiteralPath (Join-Path $here 'bundle\adg-preset\package.json') -Destination $bundleStable -Force

# ── 4. 插件：拷到稳定位置（同上去掉仓库依赖），挂载行写进 profile 自己的 patch 层 ──
$pluginSrc = Join-Path $here "plugin\$pluginName"
if (Test-Path -LiteralPath $pluginStable) { Remove-Item -LiteralPath $pluginStable -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pluginStable | Out-Null
foreach ($item in 'package.json', 'src', 'README.md', 'examples', 'LICENSE') {
  Copy-Item -LiteralPath (Join-Path $pluginSrc $item) -Destination $pluginStable -Recurse -Force
}

$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue)
$installNotes = @()
$patchNotes = @()
$packageFailed = $false
foreach ($name in $Profiles) {
  $profileDir = Join-Path $profilesDir $name
  $manifest = Join-Path $profileDir 'package.json'
  if (-not (Test-Path -LiteralPath $manifest)) { throw "profile 不存在：$profileDir" }

  # 4a. 依赖（等价于 `dsh plugin --profile <name> add link:<dir>`，那是一条 pnpm 直通命令）。
  # 用 link: 而不是把文件真拷进 node_modules：目标目录在 $DSH_HOME 下的稳定位置，
  # 重新生成 preset 之后不用重装就生效。
  $pnpmFailed = $false
  if ($SkipPackages) {
    $installNotes += "$name : 跳过依赖安装（-SkipPackages）"
  } elseif (-not $pnpm) {
    $pnpmFailed = $true
    $installNotes += "$name : 未找到 pnpm，跳过依赖安装 —— 请在该 profile 里执行 pnpm add link:`"$bundleStable`" link:`"$pluginStable`""
  } else {
    Push-Location $profileDir
    try {
      # 走 cmd /c 而不是直接 `& pnpm`：Windows PowerShell 5.1 里原生命令写 stderr 会生成
      # ErrorRecord，在 $ErrorActionPreference='Stop' 下直接变成终止错误（实测：脚本在 web
      # 这一步整个退出、exit 1，后面的 profile 根本没跑到）。cmd 自己把两个流重定向进日志，
      # PowerShell 就看不到 stderr 了。
      # pnpm 失败本身有个很常见的原因：**dsh 正在运行时**它发现 node_modules 不是自己管的
      # （.modules.yaml 缺失）就想整目录重建，而文件被运行中的 dsh 占着
      # （实测：ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR / os error 32）。那要先关掉 dsh。
      $pnpmLog = Join-Path $profileDir 'pnpm-adg-install.log'
      cmd /c "pnpm add `"link:$bundleStable`" `"link:$pluginStable`" > `"$pnpmLog`" 2>&1"
      if ($LASTEXITCODE -ne 0) {
        $pnpmFailed = $true
        $installNotes += "$name : pnpm add 失败（exit $LASTEXITCODE）—— 常见原因是 dsh 正在运行、node_modules 被占用；关掉 dsh 后重跑本脚本（日志 $pnpmLog）"
        Write-Host (Get-Content -LiteralPath $pnpmLog -Raw -Encoding UTF8)
      } else {
        Remove-Item -LiteralPath $pnpmLog -Force -ErrorAction SilentlyContinue
        $installNotes += "$name : 已 link $bundleName + $pluginName"
      }
    } finally { Pop-Location }
  }

  # 4b. bundle 必须被选进 dsh.profile.bundles，否则它的 patch 层根本不会被读。
  # 但"选进列表"和"包装上了"必须同时成立：只写列表而包装不上，会让这个 profile 启动时报
  # 未安装的 bundle。所以先确认包真的解析得到，包不在就只报告、不写列表。
  if (-not (Test-Path -LiteralPath (Join-Path $profileDir "node_modules\$bundleName\package.json"))) {
    $packageFailed = $true
    $installNotes += "$name : $bundleName 还没装进这个 profile 的 node_modules —— 未写入 dsh.profile.bundles（先解决上一条的 pnpm 失败）"
    $patchNotes += "$name : 同上，未注册插件挂载行（不想让 profile 指向没装上的包）"
    continue
  }
  # pnpm 那一步失败、但包其实早就在位（例如上一次安装留下的）时不算失败，只说明本次没重装依赖。
  if ($pnpmFailed) {
    $installNotes += "$name : pnpm 那一步没成功，但 $bundleName / $pluginName 已在 node_modules 里 —— 本次安装不受影响"
  }
  $json = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $bundles = @($json.dsh.profile.bundles)
  if ($bundles -contains $bundleName) {
    $installNotes += "$name : $bundleName 已在 dsh.profile.bundles 里"
  } else {
    Copy-Item -LiteralPath $manifest -Destination "$manifest.bak-adg-bundle" -Force
    $json.dsh.profile.bundles = @($bundles + $bundleName)
    [System.IO.File]::WriteAllText($manifest, ($json | ConvertTo-Json -Depth 10), $utf8NoBom)
    $installNotes += "$name : 已把 $bundleName 加进 dsh.profile.bundles（原文件备份 $manifest.bak-adg-bundle）"
  }

  # 4c. 挂载行写进该 profile 自己的 patch 层（热重载），不动机器级的 $root\cordis.patch.yml：
  # 机器级那一层套在每个 profile 上（web / headless / sdk / 自建），而这个插件只对 adg preset 的
  # 子代理生效，装到机器级等于让每个 profile 都去 import 它。要全机生效就把同一行搬过去。
  # 同一个判据管插件行：包不在 node_modules 里就只报告、不写挂载行（否则 profile 会指向没装上的包）。
  if (-not (Test-Path -LiteralPath (Join-Path $profileDir "node_modules\$pluginName\package.json"))) {
    $patchNotes += "$name : $pluginName 还没装进这个 profile 的 node_modules —— 未注册挂载行（先解决上一条的 pnpm 失败）"
    continue
  }
  $patchFile = Join-Path $profileDir 'cordis.patch.yml'
  if (-not (Test-Path -LiteralPath $patchFile)) {
    $patchNotes += "$name : 未找到 $patchFile，跳过挂载行注册（请手工把 plugin\$pluginName\examples\cordis.patch.yml 的行贴上去）"
    continue
  }
  # -Encoding UTF8 不能省：Windows PowerShell 5.1 的 Get-Content 默认按系统 ANSI 代码页读，
  # 用户自己在注释头里写的中文会被读成乱码再被原样写回去（5.1 下实测）。
  $lines = @(Get-Content -LiteralPath $patchFile -Encoding UTF8)
  # 在已经解码的行里找，不用 Select-String：5.1 上按 ANSI 解码时，一个残缺的前导字节
  # 可能把紧跟其后的 ASCII 首字母一起吞掉，导致明明存在的行匹配不上。
  if (@($lines | Where-Object { $_.Contains($pluginName) }).Count -gt 0) {
    $patchNotes += "$name : 挂载行已在 cordis.patch.yml 里（未改动；enabled 的值以该文件为准）"
    continue
  }
  $backup = "$patchFile.bak-adg-token-budget"
  Copy-Item -LiteralPath $patchFile -Destination $backup -Force
  # 全新 profile 的 patch 层是空数组字面量 `[]`：把它换成我们的块。已被手工改过的文件
  # （末行不是 `[]`）就按追加处理，不再要求"末行必须是 []"。
  $head = $lines
  if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -eq '[]') {
    $head = @()
    if ($lines.Count -gt 1) { $head = $lines[0..($lines.Count - 2)] }
  }
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
    "    - id: adg-token-budget",
    "      name: '$pluginName'",
    '      config:',
    '        enabled: false',
    "        presets: ['adg']",
    '        stepNudge: true',
    '        stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]',
    "        logFile: '$(Join-Path $root 'adg-token-budget.log')'"
  )
  # 不带 BOM 的 UTF-8 + LF：与 dsh 自己生成的 patch 文件逐字节一致（-Encoding UTF8 在 5.1 下会写 BOM）。
  [System.IO.File]::WriteAllText($patchFile, (($head + $row) -join "`n") + "`n", $utf8NoBom)
  $patchNotes += "$name : 已加入挂载行（enabled: false），原文件备份为 $backup"
}

Write-Host "已安装到 dsh 用户根：$root"
Write-Host "  skill   -> $skillDest"
Write-Host "  bundle  -> $bundleStable（生成物来自 preset\preset.yml + preset\agent.cordis.yml）"
Write-Host "  plugin  -> $pluginStable"
Write-Host "  browser -> $browserNote"
foreach ($note in $installNotes) { Write-Host "  profile -> $note" }
foreach ($note in $patchNotes) { Write-Host "  patch   -> $note" }
Write-Host ""
Write-Host "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
Write-Host "（preset 走的是一条独立的 patch 层：`dsh --profile <name> --dump-config` 能确认它被读到，"
Write-Host "  但只有真的新建一个会话才算挂载成功 —— 静态文件与 --dump-config 都证明不了挂载。）"
Write-Host "（插件行是另一回事：profile 的 cordis.patch.yml 改 config: 热重载、不用重启；"
Write-Host "  但换过插件 src\ 里的代码之后必须重启 —— 热重载不会重新 import 已加载的模块。）"
Write-Host "（browser/ 工具链又是另一回事：用户根下的普通文件，重新跑本脚本即生效，不用重启 dsh。）"
if ($packageFailed) {
  Write-Host ""
  Write-Host "注意：至少有一步 pnpm 没成功，preset bundle 可能还没装进 profile（上面的 profile 行里写明了）。" -ForegroundColor Yellow
  Write-Host "先关掉正在运行的 dsh（它占着 node_modules 里的文件，pnpm 无法重建目录），再重跑本脚本。" -ForegroundColor Yellow
  exit 2
}