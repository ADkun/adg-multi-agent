# 安装 Adg 多智能体模式 preset + 配套技能到本机 dsh 用户根。
# 用法： powershell -ExecutionPolicy Bypass -File .\install.ps1
#        powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profiles web,desktop
#        powershell -ExecutionPolicy Bypass -File .\install.ps1 -BillionContext on -SaveToken on -Profiles web
# 注意：本文件必须保留 UTF-8 BOM —— Windows PowerShell 5.1 在没有 BOM 时会按系统 ANSI
# 代码页读取脚本，中文变成乱码并直接解析失败（本仓库已实测复现，见 README「兼容性」）。
#
# 2026-09-28 重写：dsh 0.1.7-rc.2 起 `$DSH_HOME\.agent-presets\<id>\` 那套目录发现机制已被移除，
# 旧的"拷 preset.yml + agent.cordis.yml"装法装出来的东西**没有任何组件会去读**。现在的形状是
# 一个 bundle：包清单声明 dsh.bundle.patch，patch 里 insert 一行 @deepseek-ai/dsh-agent-preset
# 声明（id/name/description/order/plugins）。本脚本：生成 bundle → 放到 $DSH_HOME\bundles\ →
# 装进目标 profile 的 node_modules 并写进该 profile 的 dsh.profile.bundles。
#
# 2026-09-28 追加 / 2026-10 扩成四种：preset 的生成物有**四种味道**（两个注入组的四种组合），
# 每种占一个稳定目录 ——
#   $DSH_HOME\bundles\dsh-adg-preset                 plain（generate 不带旗标）
#   $DSH_HOME\bundles\dsh-adg-preset-bili            bili（专家的 allow 里带 bili 的四个上下文工具）
#   $DSH_HOME\bundles\dsh-adg-preset-save-token      save-token（带 save_token_expand）
#   $DSH_HOME\bundles\dsh-adg-preset-bili-save-token 两组都带
# 四种的**包名都是 `dsh-adg-preset`**，所以 profile 的 `dsh.profile.bundles` 那一行四种味道通用，
# 差别只在它 node_modules 里的那个 link 指向哪一个目录。每个 profile 按**自己的**探测结果选，
# 于是混装（一个 profile 挂 bili、另一个没挂）也能各拿对的形状。味道键、稳定目录名与 gen 旗标都在
# 第 0 / 3 节问 `node tools\resolve-flavor.mjs`（拼法只写在 tools\flavors.mjs，本脚本不重拼）。
# **不要再退回"生成物全机共用一份 + 每个目标 profile 都挂着才注入"那套口径**：那种做法在混装机器上
# 必然给挂着 bili 的那个 profile 装 plain —— 专家收到 bili 的压缩指令却没有工具可调（2026-09-28 本机实测：
# web 挂 bili、desktop 没挂 ⇒ auto 选中 plain ⇒ web 的子代理报 `unknown tool compress`）。
param(
  [string[]]$Profiles,
  [switch]$SkipPackages,
  # billion-context 协同开关（2026-10 加），语义见下面第 0 节「注入组探测」：
  #   auto（默认）= **按每个 profile 自己的探测结果**决定它装哪一份生成物：装了对应插件的装带该组的味道，
  #                 没装的装 plain。混装机器上各归各家（这是 2026-09-28 改掉的核心）。
  #   on  = 给**所有目标 profile** 都用带 bili 那一组的味道（自己保证它们都挂上了 billion-context，
  #         否则每次委派都抛 `names unknown global tool "compress"`）
  #   off = 给所有目标 profile 都用不带 bili 那一组的味道
  [ValidateSet('auto', 'on', 'off')] [string]$BillionContext = 'auto',
  # save-token 协同开关（2026-10 加），与 $BillionContext **完全并列、语义相同**（同一套 auto/on/off）：
  #   auto（默认）= 按每个 profile 自己的探测结果决定它装哪一份生成物：装了 dsh-plugin-save-token 的
  #                 才往专家的 allow 里注入 `save_token_expand`；on / off 是整体覆盖。
  #   给没装的 profile 注入 = 每次委派都抛 `names unknown global tool "save_token_expand"`（红线 7）；
  #   给装了的不注入 = 专家收到 `[save-token #id] … Call the save_token_expand tool` 的通知却没有工具可调。
  [ValidateSet('auto', 'on', 'off')] [string]$SaveToken = 'auto'
)
$ErrorActionPreference = 'Stop'

$root = $env:DSH_HOME
if (-not $root) { $root = Join-Path $HOME '.dsh' }
# 先把 DSH_HOME 归一成绝对路径：稳定落点、探测与生成日志都按绝对路径用。
if (-not [System.IO.Path]::IsPathRooted($root)) { $root = Join-Path (Get-Location).Path $root }
$root = [System.IO.Path]::GetFullPath($root)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$skillDest = Join-Path $root 'skills\adg-add-agent'
$bundleName = 'dsh-adg-preset'
# 四个稳定落点（包名都是 $bundleName，见文件头）：名字不在本脚本里拼 —— 第 3 节问
# `node tools\resolve-flavor.mjs` 拿（拼法只写在 tools\flavors.mjs）。每个 profile 的 node_modules 里只 link 其中一个。

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

# ── 0. 注入组探测（billion-context / save-token；2026-10 起两组各探一次）─────────────────────
# 口径：**先探测该环境下是否装有对应插件；装了才注入它的工具名**（这正是 auto 的语义）。
# 判据只有一条，决定这个 profile 的专家能看见哪些全局层工具：
#   专家要不要看见某个插件的全局层工具（bili 的 compress / decompress / search_context / acp_status；
#      save-token 的 save_token_expand）。这决定该 profile 链接哪一种味道的生成物（四个稳定目录，见文件头）。
#      **按 profile 决定**：给没装的 profile 注入，它每一次委派都会抛 `names unknown global tool "<名字>"`
#      （restrict() 的真行为，AGENTS.md 红线 7）；反过来给装了的不注入，专家就收到该插件的指令却没有工具可调
#      （bili 的压缩指令 / save-token 的 `[save-token #id] … Call the save_token_expand tool` 通知）——
#      两头都是缺陷，所以不能再用"宁可少给"一刀切。
#      `-BillionContext on|off` / `-SaveToken on|off` 是**整体覆盖**（所有目标 profile 同一味道），
#      auto 才是按 profile 选。
# 判据在 tools\has-bundle.mjs（bili 用缺省包名，save-token 加 --package=dsh-plugin-save-token）：
# 每个组两条判据都要成立才算"装着"，两处安装脚本共用一份实现，不要在这里重写。
# 探测结果不能靠 `@(& node ...)` 收（见下面 4b-1 里同一条实测）：把原生命令的 stdout 收进变量时，
# 拿不到输出、$LASTEXITCODE 还是上一条命令留下的值 —— 判据会静默变成"全都没装"，于是装着的 profile 也被
# 当成没装。走 cmd 重定向写文件再读（与 4a 的 pnpm 同一套做法），并且**显式检查探测自己的退出码、
# 也检查结果文件在不在**：探测没跑成（≠"没装"）必须当场停，否则整个安装会按错误的味道装下去。
function Get-BundleMounts {
  param([string]$PackageArg, [string]$LogName)
  $log = Join-Path $root $LogName
  $names = (@($Profiles) | ForEach-Object { '"' + [string]$_ + '"' }) -join ' '
  cmd /c "node `"$here\tools\has-bundle.mjs`" `"$profilesDir`" $names $PackageArg > `"$log`" 2>&1"
  $probeExit = $LASTEXITCODE
  if ($probeExit -ne 0 -or -not (Test-Path -LiteralPath $log)) {
    throw "tools\has-bundle.mjs $PackageArg 探测没跑成（exit $probeExit，结果文件 $(if (Test-Path -LiteralPath $log) { '在' } else { '不在' })）—— 安装停在这里，不要按未探测的状态继续装"
  }
  $mounts = [ordered]@{}
  foreach ($line in @(Get-Content -LiteralPath $log -Encoding UTF8)) {
    $parts = "$line".Split("`t")
    if ($parts.Length -ge 2) { $mounts[[string]$parts[0]] = ($parts[1].Trim() -eq '1') }
  }
  Remove-Item -LiteralPath $log -Force
  foreach ($name in @($Profiles)) {
    if ($mounts[[string]$name] -eq $null) { $mounts[[string]$name] = $false }
  }
  return $mounts
}
$biliMounts = Get-BundleMounts -PackageArg '' -LogName 'adg-bili-probe.log'
$saveTokenMounts = Get-BundleMounts -PackageArg '--package=dsh-plugin-save-token' -LogName 'adg-save-token-probe.log'

# 一组按 auto/on/off 解析：auto = 这个 profile 自己的探测值；on / off = 强制。
function Resolve-GroupWanted {
  param([string]$Mode, [bool]$Probed)
  switch ($Mode) {
    'on' { return $true }
    'off' { return $false }
    default { return $Probed }
  }
}
# 每个目标 profile 最终注入哪几组，以及由 tools\resolve-flavor.mjs 给的三列
# （味道键 / 稳定目录名 / gen 旗标）。探测与 auto/on/off 的判定在上面，resolve-flavor 只做映射。
$biliWanted = [ordered]@{}
$saveTokenWanted = [ordered]@{}
$flavorOf = [ordered]@{}
$bundleDirOf = [ordered]@{}
$flavorResolveLog = Join-Path $root 'adg-resolve-flavor.log'
foreach ($name in @($Profiles)) {
  $wantBili = Resolve-GroupWanted -Mode $BillionContext -Probed ([bool]$biliMounts[[string]$name])
  $wantSaveToken = Resolve-GroupWanted -Mode $SaveToken -Probed ([bool]$saveTokenMounts[[string]$name])
  $biliWanted[[string]$name] = $wantBili
  $saveTokenWanted[[string]$name] = $wantSaveToken
  $groupFlags = @()
  if ($wantBili) { $groupFlags += '--billion-context' }
  if ($wantSaveToken) { $groupFlags += '--save-token' }
  cmd /c "node `"$here\tools\resolve-flavor.mjs`" $($groupFlags -join ' ') > `"$flavorResolveLog`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "tools\resolve-flavor.mjs $($groupFlags -join ' ') 失败（exit $LASTEXITCODE）" }
  $resolvedLines = @(Get-Content -LiteralPath $flavorResolveLog -Encoding UTF8)
  Remove-Item -LiteralPath $flavorResolveLog -Force -ErrorAction SilentlyContinue
  if ($resolvedLines.Count -eq 0) { throw "tools\resolve-flavor.mjs 没写出结果（$flavorResolveLog 是空的）" }
  $resolvedParts = "$($resolvedLines[0])".Split("`t")
  if ($resolvedParts.Length -lt 3) { throw "tools\resolve-flavor.mjs 的输出不是三列 TSV：$($resolvedLines[0])" }
  $flavorOf[[string]$name] = [string]$resolvedParts[0]
  $bundleDirOf[[string]$name] = [string]$resolvedParts[1]
}

# 探测名单（供日志与覆盖提醒用）。
$biliOnProfiles = @($Profiles | Where-Object { $biliMounts[[string]$_] })
$biliOffProfiles = @($Profiles | Where-Object { -not $biliMounts[[string]$_] })
$saveTokenOnProfiles = @($Profiles | Where-Object { $saveTokenMounts[[string]$_] })
$saveTokenOffProfiles = @($Profiles | Where-Object { -not $saveTokenMounts[[string]$_] })
$biliOnText = $(if ($biliOnProfiles.Count -gt 0) { "已挂载 [$($biliOnProfiles -join ', ')]" } else { '没有任何目标 profile 挂载' })
$biliOffText = $(if ($biliOffProfiles.Count -gt 0) { "[$($biliOffProfiles -join ', ')]" } else { '无' })
$saveTokenOnText = $(if ($saveTokenOnProfiles.Count -gt 0) { "已挂载 [$($saveTokenOnProfiles -join ', ')]" } else { '没有任何目标 profile 挂载' })
$saveTokenOffText = $(if ($saveTokenOffProfiles.Count -gt 0) { "[$($saveTokenOffProfiles -join ', ')]" } else { '无' })
Write-Host "billion-context 探测：$biliOnText / 未挂载 $biliOffText"
Write-Host "save-token 探测：$saveTokenOnText / 未挂载 $saveTokenOffText"
foreach ($name in @($Profiles)) {
  $flavor = [string]$flavorOf[[string]$name]
  $flavorNoteParts = @()
  if ($biliWanted[[string]$name]) { $flavorNoteParts += 'bili 的四个上下文工具' }
  if ($saveTokenWanted[[string]$name]) { $flavorNoteParts += 'save-token 的 save_token_expand' }
  $flavorNote = $(if ($flavorNoteParts.Count -gt 0) { "专家的 allow 里带 $($flavorNoteParts -join ' + ')" } else { '不带任何注入的上下文工具' })
  Write-Host "  味道 -> $name : $flavor（$flavorNote）"
}
# 覆盖开关与探测结果对不上时必须明说：判断错的那一方不是少个能力就是每次委派都挂（红线 7）。
# 每组三档，与旧版 bili 那三条一一对应：on 但一个都没装 / on 被强制套到没装的 profile / off 把装着的关掉。
$biliWantedProfiles = @($Profiles | Where-Object { $biliWanted[[string]$_] })
$biliUnwantedProfiles = @($Profiles | Where-Object { -not $biliWanted[[string]$_] })
$biliForcedOntoOff = @($biliWantedProfiles | Where-Object { -not $biliMounts[[string]$_] })
$biliForcedOffOfOn = @($biliUnwantedProfiles | Where-Object { $biliMounts[[string]$_] })
if ($BillionContext -eq 'on' -and $biliWantedProfiles.Count -eq 0) {
  Write-Host "billion-context：-BillionContext on 但没有任何目标 profile 挂着它 —— 仍按 on 装带 bili 那一组的味道，请确认这些 profile 之后会装上 billion-context（否则委派会抛 unknown global tool）" -ForegroundColor Yellow
} elseif ($biliForcedOntoOff.Count -gt 0) {
  Write-Host "billion-context：-BillionContext on 强制注入，但这些目标 profile 没挂 bili：$($biliForcedOntoOff -join ', ') —— 它们每一次委派都会抛 names unknown global tool `"compress`"（要么给它们装上 bili，要么改回 auto）" -ForegroundColor Yellow
}
if ($BillionContext -eq 'off' -and $biliForcedOffOfOn.Count -gt 0) {
  Write-Host "billion-context：-BillionContext off 强制不注入，但这些目标 profile 挂着 bili：$($biliForcedOffOfOn -join ', ') —— 它们的专家会收到 bili 的压缩指令却没有工具可调（改回 auto 才会按 profile 选味道）" -ForegroundColor Yellow
}
$saveTokenWantedProfiles = @($Profiles | Where-Object { $saveTokenWanted[[string]$_] })
$saveTokenUnwantedProfiles = @($Profiles | Where-Object { -not $saveTokenWanted[[string]$_] })
$saveTokenForcedOntoOff = @($saveTokenWantedProfiles | Where-Object { -not $saveTokenMounts[[string]$_] })
$saveTokenForcedOffOfOn = @($saveTokenUnwantedProfiles | Where-Object { $saveTokenMounts[[string]$_] })
if ($SaveToken -eq 'on' -and $saveTokenWantedProfiles.Count -eq 0) {
  Write-Host "save-token：-SaveToken on 但没有任何目标 profile 装着它 —— 仍按 on 装带 save-token 那一组的味道，请确认这些 profile 之后会装上 dsh-plugin-save-token（否则委派会抛 unknown global tool）" -ForegroundColor Yellow
} elseif ($saveTokenForcedOntoOff.Count -gt 0) {
  Write-Host "save-token：-SaveToken on 强制注入，但这些目标 profile 没装 dsh-plugin-save-token：$($saveTokenForcedOntoOff -join ', ') —— 它们每一次委派都会抛 names unknown global tool `"save_token_expand`"（要么给它们装上那个插件，要么改回 auto）" -ForegroundColor Yellow
}
if ($SaveToken -eq 'off' -and $saveTokenForcedOffOfOn.Count -gt 0) {
  Write-Host "save-token：-SaveToken off 强制不注入，但这些目标 profile 装着 dsh-plugin-save-token：$($saveTokenForcedOffOfOn -join ', ') —— 它们的专家会收到 `"[save-token #id] … Call the save_token_expand tool`" 的通知却没有工具可调（改回 auto 才会按 profile 选味道）" -ForegroundColor Yellow
}

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

# ── 3. preset bundle：四种味道全部生成 → 各自落到自己的稳定位置（每 profile 只 link 一份）──
# 源文件永远只有 preset\preset.yml + preset\agent.cordis.yml；bundle\adg-*\ 是构建产物
# （在 .gitignore 里），每次安装都重新生成，所以没有人需要手改 patch。
# 各注入组的工具名**只进生成物**、不进源文件（见 tools\gen-preset-bundle.mjs 与 tools\flavors.mjs 的注释），
# 所以同一份源文件要生成四份（两个注入组的四种组合）。
# **四份都无条件生成**：省掉"这一跑要不要重建那一份"的判断，稳定目录里的形状永远等于它该有的形状。
# 表里只写"味道键 + 输出目录 + 它含哪几组"；**稳定目录名与 gen 旗标都问 tools\resolve-flavor.mjs**
# （拼法只写在 tools\flavors.mjs，本脚本不重拼），并当场核对它给的味道键与表里一致。
# outDir 传绝对路径：gen 脚本用的是 process.cwd()，不能跟着"用户从哪个目录调用本脚本"漂。
$genFlavors = @(
  [ordered]@{ flavor = 'plain';           out = (Join-Path $here 'bundle\adg-plain');           groups = @();                                     note = '不带任何注入的上下文工具（源文件原样）' },
  [ordered]@{ flavor = 'bili';            out = (Join-Path $here 'bundle\adg-bili');            groups = @('--billion-context');                  note = '8 个专家的 allow 里带 bili 的四个上下文工具 + compaction-basic auto: false' },
  [ordered]@{ flavor = 'save-token';      out = (Join-Path $here 'bundle\adg-save-token');      groups = @('--save-token');                       note = '8 个专家的 allow 里带 save-token 的 save_token_expand' },
  [ordered]@{ flavor = 'bili+save-token'; out = (Join-Path $here 'bundle\adg-bili-save-token'); groups = @('--billion-context', '--save-token');  note = '上述两组的并集（bili 四个上下文工具 + save_token_expand + auto: false）' }
)
$genResolveLog = Join-Path $root 'adg-gen-flavor.log'
foreach ($gen in $genFlavors) {
  cmd /c "node `"$here\tools\resolve-flavor.mjs`" $($gen.groups -join ' ') > `"$genResolveLog`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "tools\resolve-flavor.mjs $($gen.groups -join ' ') 失败（exit $LASTEXITCODE）" }
  $genLines = @(Get-Content -LiteralPath $genResolveLog -Encoding UTF8)
  Remove-Item -LiteralPath $genResolveLog -Force -ErrorAction SilentlyContinue
  if ($genLines.Count -eq 0) { throw "tools\resolve-flavor.mjs 没写出结果（$genResolveLog 是空的）" }
  $genParts = "$($genLines[0])".Split("`t")
  if ($genParts.Length -lt 3) { throw "tools\resolve-flavor.mjs 的输出不是三列 TSV：$($genLines[0])" }
  if ([string]$genParts[0] -ne [string]$gen.flavor) { throw "味道键对不上：本脚本表里是 $($gen.flavor)，tools\resolve-flavor.mjs 给的是 $($genParts[0])" }
  $gen.dest = Join-Path $root "bundles\$($genParts[1])"
  $gen.flags = @(([string]$genParts[2] -split ' ') | Where-Object { $_ -ne '' })
}
foreach ($gen in $genFlavors) {
  & node (Join-Path $here 'tools\gen-preset-bundle.mjs') $gen.out @($gen.flags)
  if ($LASTEXITCODE -ne 0) { throw "tools\gen-preset-bundle.mjs $($gen.flags -join ' ') 失败（exit $LASTEXITCODE）" }
}

# $DSH_HOME\bundles\ 是稳定位置：profile 只引用这里，仓库可以随便挪/删。
# 四种味道的 package.json 必须**逐字节相同、包名都叫 $bundleName**（profile 的 dsh.profile.bundles 那一行
# 四种味道通用，差别只在 link 指向哪个目录），所以拷完当场用哈希验一遍。
$bundlePkgHashes = [ordered]@{}
foreach ($gen in $genFlavors) {
  $dest = $gen.dest
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -LiteralPath (Join-Path $gen.out 'cordis.patch.yml') -Destination $dest -Force
  Copy-Item -LiteralPath (Join-Path $gen.out 'package.json') -Destination $dest -Force
  $bundlePkgHashes[[string]$gen.flavor] = (Get-FileHash -LiteralPath (Join-Path $dest 'package.json') -Algorithm SHA256).Hash
}
if (@($bundlePkgHashes.Values | Select-Object -Unique).Count -ne 1) {
  throw "四种味道的 package.json 不是逐字节相同（$(($bundlePkgHashes.Keys | ForEach-Object { "$_=$($bundlePkgHashes[$_])" }) -join ' / ')）—— 包名与清单必须一致，profile 的 dsh.profile.bundles 才能四种味道通用"
}
$plainPkgName = "$((Get-Content -LiteralPath (Join-Path $genFlavors[0].dest 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).name)"
if ($plainPkgName -ne $bundleName) {
  throw "稳定目录里的包名是 $plainPkgName，期望 $bundleName（profile 的 dsh.profile.bundles 那一行按这个包名写）"
}

# ── 4. 装进目标 profile（依赖 link + 写进该 profile 的 dsh.profile.bundles）────────
$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue)
$installNotes = @()
$packageFailed = $false
foreach ($name in $Profiles) {
  $profileDir = Join-Path $profilesDir $name
  $manifest = Join-Path $profileDir 'package.json'
  if (-not (Test-Path -LiteralPath $manifest)) { throw "profile 不存在：$profileDir" }

  # 4a. 依赖（等价于 `dsh plugin --profile <name> add link:<dir>`，那是一条 pnpm 直通命令）。
  # 用 link: 而不是把文件真拷进 node_modules：目标目录在 $DSH_HOME 下的稳定位置，
  # 重新生成 preset 之后不用重装就生效。
  # 这个 profile 该拿哪一种味道的稳定目录（见上面第 0 节的 $flavorOf / $bundleDirOf）。换味道也只在这一步发生：
  # 同一个包名 `link:` 到另一个目录，profile 的 `dsh.profile.bundles` 一行都不用改（四种味道包名相同）。
  $flavor = [string]$flavorOf[[string]$name]
  $wantBundle = Join-Path $root "bundles\$($bundleDirOf[[string]$name])"
  $pnpmFailed = $false
  if ($SkipPackages) {
    $installNotes += "$name : 跳过依赖安装（-SkipPackages）—— 这个 profile 期望的味道是 $flavor（$wantBundle）"
  } elseif (-not $pnpm) {
    $pnpmFailed = $true
    $installNotes += "$name : 未找到 pnpm，跳过依赖安装 —— 请在该 profile 里执行 pnpm add link:`"$wantBundle`""
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
      cmd /c "pnpm add `"link:$wantBundle`" > `"$pnpmLog`" 2>&1"
      if ($LASTEXITCODE -ne 0) {
        $pnpmFailed = $true
        $installNotes += "$name : pnpm add 失败（exit $LASTEXITCODE）—— 常见原因是 dsh 正在运行、node_modules 被占用；关掉 dsh 后重跑本脚本（日志 $pnpmLog）"
        Write-Host (Get-Content -LiteralPath $pnpmLog -Raw -Encoding UTF8)
      } else {
        Remove-Item -LiteralPath $pnpmLog -Force -ErrorAction SilentlyContinue
        $installNotes += "$name : 已 link $bundleName（$flavor 味道）"
      }
    } finally { Pop-Location }
  }

  # 4b. bundle 必须被选进 dsh.profile.bundles，否则它的 patch 层根本不会被读。
  # 但"选进列表"和"包装上了"必须同时成立：只写列表而包装不上，会让这个 profile 启动时报
  # 未安装的 bundle。所以先确认包真的解析得到，包不在就只报告、不写列表。
  if (-not (Test-Path -LiteralPath (Join-Path $profileDir "node_modules\$bundleName\package.json"))) {
    $packageFailed = $true
    $installNotes += "$name : $bundleName 还没装进这个 profile 的 node_modules —— 未写入 dsh.profile.bundles（先解决上一条的 pnpm 失败）"
    continue
  }
  # pnpm 那一步失败、但包其实早就在位（例如上一次安装留下的）时不算失败，只说明本次没重装依赖。
  if ($pnpmFailed) {
    $installNotes += "$name : pnpm 那一步没成功，但 $bundleName 已在 node_modules 里 —— 本次安装不受影响"
  }
  # 4b-1. 断言**已经链接进去的那一份**的味道，正是这个 profile 该拿的味道。
  # 判据不能是"包在不在"：四种味道的 package.json 逐字节相同、包名也一样，只有产物本体不同 ——
  # 所以让 tools\check-bundle-flavor.mjs 逐行验 8 个专家行的 allow 与 compaction-basic 的 auto
  # （四种味道各按自己的注入组断言：该有的全有、不该有的一个都不能出现）。
  # 这一格是本缺陷的"静默失效"出口：味道换错时一切看起来都正常，只有专家的工具目录少四个名字
  # （2026-09-28 现场：web 链接的是 plain，子代理报 unknown tool compress）。
  $linkedPatch = Join-Path $profileDir "node_modules\$bundleName\cordis.patch.yml"
  $flavorLog = Join-Path $profileDir 'adg-flavor-check.log'
  $flavorReport = @()
  $flavorOk = $false
  if (Test-Path -LiteralPath $linkedPatch) {
    # 同第 0 节：不收原生命令的 stdout，走 cmd 重定向写文件再读 —— 否则拿不到报告、$LASTEXITCODE 还是
    # 上一条命令留下的 0，这一格会**假装通过**（比不做断言更糟：它把"味道错了"报成"味道对"）。
    cmd /c "node `"$here\tools\check-bundle-flavor.mjs`" `"$linkedPatch`" $flavor > `"$flavorLog`" 2>&1"
    $flavorOk = ($LASTEXITCODE -eq 0)
    if (Test-Path -LiteralPath $flavorLog) {
      $flavorReport = @(Get-Content -LiteralPath $flavorLog -Encoding UTF8)
      Remove-Item -LiteralPath $flavorLog -Force
    } else {
      $flavorOk = $false
      $flavorReport = @("tools\check-bundle-flavor.mjs 没写出报告（$flavorLog 不在）")
    }
  } else {
    $flavorReport = @("$linkedPatch 不存在")
  }
  if ($flavorOk) {
    $installNotes += "$name : 落点味道 = $flavor（tools\check-bundle-flavor.mjs 通过）"
  } else {
    $installNotes += "$name : 落点味道 ≠ $flavor —— 链接到的还是另一种味道（换味道那一步没成功；专家的 allow 会少该有的注入名字，或多出这个 profile 没装的那个插件的名字）"
    foreach ($flavorLine in $flavorReport) { Write-Host "      $flavorLine" }
    $packageFailed = $true
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
}

Write-Host "已安装到 dsh 用户根：$root"
Write-Host "  skill   -> $skillDest"
foreach ($gen in $genFlavors) {
  Write-Host "  bundle  -> $($gen.dest)（$($gen.flavor) 味道：$($gen.note)；生成物来自 preset\preset.yml + preset\agent.cordis.yml）"
}
Write-Host "  browser -> $browserNote"
foreach ($note in $installNotes) { Write-Host "  profile -> $note" }
Write-Host ""
Write-Host "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
Write-Host "（preset 走的是一条独立的 patch 层：`dsh --profile <name> --dump-config` 能确认它被读到，"
Write-Host "  但只有真的新建一个会话才算挂载成功 —— 静态文件与 --dump-config 都证明不了挂载。）"
Write-Host "（browser/ 工具链又是另一回事：用户根下的普通文件，重新跑本脚本即生效，不用重启 dsh。）"
if ($packageFailed) {
  Write-Host ""
  Write-Host "注意：至少有一步 pnpm 没成功，$bundleName 可能还没装进 profile（上面的 profile 行里写明了）。" -ForegroundColor Yellow
  Write-Host "先关掉正在运行的 dsh（它占着 node_modules 里的文件，pnpm 无法重建目录），再重跑本脚本。" -ForegroundColor Yellow
  exit 2
}