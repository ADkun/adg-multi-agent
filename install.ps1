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
#
# 2026-09-28 追加：preset 的生成物有**两种味道**（plain / 注入版），各自占一个稳定目录 ——
#   $DSH_HOME\bundles\dsh-adg-preset         plain（generate 不带旗标）
#   $DSH_HOME\bundles\dsh-adg-preset-bili    注入版（专家的 allow 里带 bili 的四个上下文工具）
# 两份的**包名都是 `dsh-adg-preset`**，所以 profile 的 `dsh.profile.bundles` 那一行两种味道通用，
# 差别只在它 node_modules 里的那个 link 指向哪一个目录。每个 profile 按**自己的**探测结果选，
# 于是混装（一个 profile 挂 bili、另一个没挂）也能各拿对的形状。
# **不要再退回"生成物全机共用一份 + 每个目标 profile 都挂着才注入"那套口径**：那种做法在混装机器上
# 必然给挂着 bili 的那个 profile 装 plain —— 专家收到 bili 的压缩指令却没有工具可调（2026-09-28 本机实测：
# web 挂 bili、desktop 没挂 ⇒ auto 选中 plain ⇒ web 的子代理报 `unknown tool compress`）。
# 插件 dsh-adg-token-budget 自 2026-09-28 起是**同一个形状**：它的挂载行由包自己的
# cordis.patch.yml 提供（旧装法是把行手贴进 profile 的 patch 层，那条路已废弃，脚本只负责报告残留）。
param(
  [string[]]$Profiles,
  [switch]$SkipPackages,
  # billion-context 协同开关（2026-10 加），两个作用见下面「billion-context 探测」那段注释：
  #   auto（默认）= **按每个 profile 自己的探测结果**决定它装哪一份生成物：挂了 bili 的装注入版，
  #                 没挂的装 plain。混装机器上两种形状各归各家（这是 2026-09-28 改掉的核心）。
  #   on  = 给**所有目标 profile** 都装注入版（自己保证它们都挂上了 billion-context，
  #         否则每次委派都抛 `names unknown global tool "compress"`）
  #   off = 给所有目标 profile 都装 plain
  # 注意：dsh-adg-token-budget 的"挂了就别启用"始终按**每个 profile 自己**是否挂 bili 决定，不看这个开关。
  [ValidateSet('auto', 'on', 'off')] [string]$BillionContext = 'auto'
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
# 两种味道两个稳定落点（包名相同，见文件头）：plain = $bundleStable（沿用旧路径，老链接不用动），
# bili = $bundleBiliStable。每个 profile 的 node_modules 里只 link 其中一个。
$bundleStable = Join-Path $root "bundles\$bundleName"
$bundleBiliStable = Join-Path $root "bundles\$($bundleName)-bili"
$pluginName = 'dsh-adg-token-budget'
# 2026-09-28：插件也走 bundle —— 落点与 preset 同为 $DSH_HOME\bundles\，挂载行由包自己的
# cordis.patch.yml（package.json 的 dsh.bundle.patch）提供，不再手贴进 profile 的 patch 层。
$pluginStable = Join-Path $root "bundles\$pluginName"
$pluginLegacyStable = Join-Path $root "plugins\$pluginName"

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

# ── 0. billion-context 探测（2026-10 加；2026-09-28 改成**按 profile** 选味道）──────────────
# 同一件事有两半，判据不一样：
#   1. 专家要不要看见 bili 的上下文工具（compress / decompress / search_context / acp_status）。
#      这决定该 profile 链接哪一种味道的生成物（plain / bili 两个稳定目录，见文件头）。**按 profile 决定**：
#      给没挂 bili 的 profile 装注入版，它每一次委派都会抛 `names unknown global tool "compress"`
#      （restrict() 的真行为，AGENTS.md 红线 7）；反过来给挂了 bili 的装 plain，专家就收到 bili 的压缩
#      指令却没有工具可调 —— 两头都是缺陷，所以不能再用"宁可少给"一刀切。
#      `-BillionContext on|off` 是**整体覆盖**（所有目标 profile 同一味道），auto 才是按 profile 选。
#   2. 挂了 bili 的 profile 不再启用 dsh-adg-token-budget（同一批子代理不同时吃两套收敛/压缩提醒）。
#      这一半本来就按 profile 决定，见 4c。
# 两条判据都要成立才算"挂着"，判据本身在 tools\has-billion-context.mjs —— 它同时决定"要不要注入工具"
# 和"要不要启用 token-budget 插件"这两件方向相反的事，所以两处安装脚本共用一份实现，不要在这里重写。
# 探测结果不能靠 `@(& node ...)` 收（见下面 4b-1 里同一条实测）：把原生命令的 stdout 收进变量时，
# 拿不到输出、$LASTEXITCODE 还是上一条命令留下的值 —— 判据会静默变成"全都没挂 bili"，于是挂了 bili 的
# profile 也被当成没挂。走 cmd 重定向写文件再读（与 4a 的 pnpm 同一套做法），并且**显式检查探测自己的
# 退出码、也检查结果文件在不在**：探测没跑成（≠"没挂 bili"）必须当场停，否则整个安装会按错误的味道装下去。
$biliProbeLog = Join-Path $root 'adg-bili-probe.log'
$biliProbeNames = (@($Profiles) | ForEach-Object { '"' + [string]$_ + '"' }) -join ' '
cmd /c "node `"$here\tools\has-billion-context.mjs`" `"$profilesDir`" $biliProbeNames > `"$biliProbeLog`" 2>&1"
$biliProbeExit = $LASTEXITCODE
if ($biliProbeExit -ne 0 -or -not (Test-Path -LiteralPath $biliProbeLog)) {
  throw "tools\has-billion-context.mjs 探测没跑成（exit $biliProbeExit，结果文件 $(if (Test-Path -LiteralPath $biliProbeLog) { '在' } else { '不在' })）—— 安装停在这里，不要按未探测的状态继续装"
}
$biliProbeLines = @(Get-Content -LiteralPath $biliProbeLog -Encoding UTF8)
Remove-Item -LiteralPath $biliProbeLog -Force
$biliMounts = [ordered]@{}
foreach ($line in $biliProbeLines) {
  $parts = "$line".Split("`t")
  if ($parts.Length -ge 2) { $biliMounts[[string]$parts[0]] = ($parts[1].Trim() -eq '1') }
}
foreach ($name in @($Profiles)) {
  if ($biliMounts[[string]$name] -eq $null) { $biliMounts[[string]$name] = $false }
}
$biliOnProfiles = @($biliMounts.Keys | Where-Object { $biliMounts[$_] } | ForEach-Object { [string]$_ })
$biliOffProfiles = @($biliMounts.Keys | Where-Object { -not $biliMounts[$_] } | ForEach-Object { [string]$_ })
# 每个目标 profile 要哪一种味道：auto = 它自己的探测结果；on / off = 全部强制同一种。
$flavorOf = [ordered]@{}
foreach ($name in @($Profiles)) {
  $wantBili = switch ($BillionContext) {
    'on' { $true }
    'off' { $false }
    default { [bool]$biliMounts[[string]$name] }
  }
  $flavorOf[[string]$name] = $(if ($wantBili) { 'bili' } else { 'plain' })
}
$biliFlavorProfiles = @($flavorOf.Keys | Where-Object { $flavorOf[$_] -eq 'bili' })
$plainFlavorProfiles = @($flavorOf.Keys | Where-Object { $flavorOf[$_] -eq 'plain' })
$biliOnText = $(if ($biliOnProfiles.Count -gt 0) { "已挂载 [$($biliOnProfiles -join ', ')]" } else { '没有任何目标 profile 挂载' })
$biliOffText = $(if ($biliOffProfiles.Count -gt 0) { "[$($biliOffProfiles -join ', ')]" } else { '无' })
Write-Host "billion-context 探测：$biliOnText / 未挂载 $biliOffText"
foreach ($name in @($Profiles)) {
  $flavor = [string]$flavorOf[[string]$name]
  $flavorNote = $(if ($flavor -eq 'bili') { '专家的 allow 里带 bili 的四个上下文工具' } else { '不带 bili 工具' })
  Write-Host "  味道 -> $name : $flavor（$flavorNote）"
}
# 覆盖开关与探测结果对不上时必须明说：判断错的那一方不是少个能力就是每次委派都挂（红线 7）。
$forcedOntoOff = @($biliFlavorProfiles | Where-Object { -not $biliMounts[[string]$_] })
$forcedOffOfOn = @($plainFlavorProfiles | Where-Object { $biliMounts[[string]$_] })
if ($BillionContext -eq 'on' -and $biliFlavorProfiles.Count -eq 0) {
  Write-Host "billion-context：-BillionContext on 但没有任何目标 profile 挂着它 —— 仍按 on 装注入版，请确认这些 profile 之后会装上 billion-context（否则委派会抛 unknown global tool）" -ForegroundColor Yellow
} elseif ($forcedOntoOff.Count -gt 0) {
  Write-Host "billion-context：-BillionContext on 强制注入，但这些目标 profile 没挂 bili：$($forcedOntoOff -join ', ') —— 它们每一次委派都会抛 names unknown global tool `"compress`"（要么给它们装上 bili，要么改回 auto）" -ForegroundColor Yellow
}
if ($BillionContext -eq 'off' -and $forcedOffOfOn.Count -gt 0) {
  Write-Host "billion-context：-BillionContext off 强制不注入，但这些目标 profile 挂着 bili：$($forcedOffOfOn -join ', ') —— 它们的专家会收到 bili 的压缩指令却没有工具可调（改回 auto 才会按 profile 选味道）" -ForegroundColor Yellow
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

# ── 3. preset bundle：两种味道各生成 → 各落到自己的稳定位置（每 profile 只 link 一份）──
# 源文件永远只有 preset\preset.yml + preset\agent.cordis.yml；bundle\adg-*\ 是构建产物
# （在 .gitignore 里），每次安装都重新生成，所以没有人需要手改 patch。
# bili 的上下文工具**只进生成物**、不进源文件（见 tools\gen-preset-bundle.mjs 的注释），
# 所以同一份源文件要生成两份：plain（不带旗标）与 bili（--with-billion-context）。
# **两份都无条件生成**：省掉"这一跑要不要重建那一份"的判断，稳定目录里的形状永远等于它该有的形状。
# outDir 传绝对路径：gen 脚本用的是 process.cwd()，不能跟着"用户从哪个目录调用本脚本"漂。
$genFlavors = @(
  [ordered]@{ flavor = 'plain'; out = (Join-Path $here 'bundle\adg-plain');  dest = $bundleStable;     args = @() },
  [ordered]@{ flavor = 'bili';  out = (Join-Path $here 'bundle\adg-preset'); dest = $bundleBiliStable; args = @('--with-billion-context') }
)
foreach ($gen in $genFlavors) {
  & node (Join-Path $here 'tools\gen-preset-bundle.mjs') $gen.out @($gen.args)
  if ($LASTEXITCODE -ne 0) { throw "tools\gen-preset-bundle.mjs $($gen.args -join ' ') 失败（exit $LASTEXITCODE）" }
}

# $DSH_HOME\bundles\ 是稳定位置：profile 只引用这里，仓库可以随便挪/删。
foreach ($gen in $genFlavors) {
  $dest = $gen.dest
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -LiteralPath (Join-Path $gen.out 'cordis.patch.yml') -Destination $dest -Force
  Copy-Item -LiteralPath (Join-Path $gen.out 'package.json') -Destination $dest -Force
}

# ── 4. 插件：作为 bundle 拷到稳定位置（同上去掉仓库依赖）────────────────────────
# 部署集合六项 = package.json / cordis.patch.yml / src / examples / README.md / LICENSE
# （与插件 package.json 的 files 一致；test\ 与 INSTALL.md 不进部署）。
# cordis.patch.yml 是这一层的第六项：它就是挂载行本身，缺了它这个包只是普通依赖。
$pluginSrc = Join-Path $here "plugin\$pluginName"
if (Test-Path -LiteralPath $pluginStable) { Remove-Item -LiteralPath $pluginStable -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pluginStable | Out-Null
foreach ($item in 'package.json', 'cordis.patch.yml', 'src', 'examples', 'README.md', 'LICENSE') {
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
  # 这个 profile 该拿哪一种味道的稳定目录（见上面第 0 节的 $flavorOf）。换味道也只在这一步发生：
  # 同一个包名 `link:` 到另一个目录，profile 的 `dsh.profile.bundles` 一行都不用改（两种味道包名相同）。
  $flavor = [string]$flavorOf[[string]$name]
  $wantBundle = $(if ($flavor -eq 'bili') { $bundleBiliStable } else { $bundleStable })
  $pnpmFailed = $false
  if ($SkipPackages) {
    $installNotes += "$name : 跳过依赖安装（-SkipPackages）—— 这个 profile 期望的味道是 $flavor（$wantBundle）"
  } elseif (-not $pnpm) {
    $pnpmFailed = $true
    $installNotes += "$name : 未找到 pnpm，跳过依赖安装 —— 请在该 profile 里执行 pnpm add link:`"$wantBundle`" link:`"$pluginStable`""
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
      cmd /c "pnpm add `"link:$wantBundle`" `"link:$pluginStable`" > `"$pnpmLog`" 2>&1"
      if ($LASTEXITCODE -ne 0) {
        $pnpmFailed = $true
        $installNotes += "$name : pnpm add 失败（exit $LASTEXITCODE）—— 常见原因是 dsh 正在运行、node_modules 被占用；关掉 dsh 后重跑本脚本（日志 $pnpmLog）"
        Write-Host (Get-Content -LiteralPath $pnpmLog -Raw -Encoding UTF8)
      } else {
        Remove-Item -LiteralPath $pnpmLog -Force -ErrorAction SilentlyContinue
        $installNotes += "$name : 已 link $bundleName（$flavor 味道）+ $pluginName"
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
  # 4b-1. 断言**已经链接进去的那一份**的味道，正是这个 profile 该拿的味道。
  # 判据不能是"包在不在"：两种味道的 package.json 逐字节相同、包名也一样，只有产物本体不同 ——
  # 所以让 tools\check-bundle-flavor.mjs 逐行验 9 个专家行的 allow 与 compaction-basic 的 auto。
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
    $installNotes += "$name : 落点味道 ≠ $flavor —— 链接到的还是另一种味道（换味道那一步没成功；专家会看不到 / 看不见 bili 的上下文工具）"
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

  # 4c. 插件 bundle 同样要选进 dsh.profile.bundles —— 挂载行现在由包自己的 cordis.patch.yml
  # 提供（package.json 的 dsh.bundle.patch），profile 的 patch 层不再需要那条手贴的 insert 行。
  # 判据比"包在不在 node_modules 里"更严：装上的那份必须真的声明 dsh.bundle.patch。pnpm 失败时
  # 链接可能还指着旧落点 plugins\<pluginName>\，那份 package.json 没有 dsh.bundle.patch，
  # 把它写进列表只会让 dsh 启动时选到一个没有 patch 层的 bundle。
  # 不动机器级的 $root\cordis.patch.yml：那一层套在每个 profile 上（web / headless / sdk / 自建），
  # 而这个插件只对 adg preset 的子代理生效，选进机器级等于让每个 profile 都去 import 它。
  $pluginPkg = Join-Path $profileDir "node_modules\$pluginName\package.json"
  $pluginLayer = $null
  if (Test-Path -LiteralPath $pluginPkg) {
    $pluginManifest = Get-Content -LiteralPath $pluginPkg -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pluginManifest.dsh -and $pluginManifest.dsh.bundle) { $pluginLayer = $pluginManifest.dsh.bundle.patch }
  }
  if (-not $pluginLayer) {
    $packageFailed = $true
    $patchNotes += "$name : 装上的 $pluginName 没有声明 dsh.bundle.patch —— 未写入 dsh.profile.bundles（链接多半还指着旧落点 $pluginLegacyStable；关掉 dsh 重跑本脚本）"
    continue
  }
  # 旧机制留下的手贴挂载行必须删：profile 层是 bundle 层之后应用的，一条 `- insert:` 会再插入
  # 一行同 id 的条目；而按 id 覆盖时 config 是整块替换、不是深合并，留着它就把 bundle 行的
  # config 换掉了（阶梯 / enabled 全回到插件出厂默认）。这里只报告、不代删。
  $patchFile = Join-Path $profileDir 'cordis.patch.yml'
  if (Test-Path -LiteralPath $patchFile) {
    # -Encoding UTF8 不能省：Windows PowerShell 5.1 的 Get-Content 默认按系统 ANSI 代码页读，
    # 用户自己在注释头里写的中文会被读成乱码再被原样写回去（5.1 下实测）。
    $patchLines = @(Get-Content -LiteralPath $patchFile -Encoding UTF8)
    # 在已经解码的行里找，不用 Select-String：5.1 上按 ANSI 解码时，一个残缺的前导字节
    # 可能把紧跟其后的 ASCII 首字母一起吞掉，导致明明存在的行匹配不上。
    # 两种形状都要抓到：旧机制写的是 `- insert:` 里缩进的 `    - id: adg-token-budget`，
    # Plugins 页保存的是顶层的 `- id: adg-token-budget`。Trim 之后两者同形，一次比较就够。
    $handRows = @($patchLines | Where-Object { $_.Trim() -eq '- id: adg-token-budget' })
    if ($handRows.Count -gt 0) {
      $patchNotes += "$name : $patchFile 里还有旧机制手贴的挂载行（$($handRows.Count) 处）—— 请删掉，这一行现在由 bundle 层提供；不删则 profile 层会整块替换掉 bundle 行的 config"
    }
  }
  # 挂了 billion-context 的 profile **不启用**这个插件（用户 2026-10 的决定）：它给 adg 的每个
  # 子代理注入步数收敛检查点，而 bili 自己已经在这个 profile 上给同一批子代理注入压缩/收敛指令，
  # 两套提醒互相重复还都算进每一次请求的前缀。这一半是**按 profile** 决定的：
  # dsh.profile.bundles 本来就是 per-profile 的（preset 生成物自 2026-09-28 起也按 profile 选味道，
  # 见文件头与第 3 节的两种落点），所以混装（一个 profile 挂 bili、另一个没挂）时两边都能各拿对的形状。
  # 摘掉的做法是不选中，而不是给包塞 enabled:false —— profile 层按 id 覆盖是整块替换 config，
  # 要重写阶梯里每一个键；不选中则连挂载行都不读（AGENTS.md 红线 3 同一个理由）。
  $json = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $bundles = @($json.dsh.profile.bundles)
  if ($biliMounts[[string]$name]) {
    if ($bundles -contains $pluginName) {
      Copy-Item -LiteralPath $manifest -Destination "$manifest.bak-adg-token-budget" -Force
      $json.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne $pluginName })
      [System.IO.File]::WriteAllText($manifest, ($json | ConvertTo-Json -Depth 10), $utf8NoBom)
      $patchNotes += "$name : 这个 profile 挂着 billion-context → 已从 dsh.profile.bundles 移除 $pluginName（原文件备份 $manifest.bak-adg-token-budget；包还留在 node_modules 里，想恢复就把它加回列表）"
    } else {
      $patchNotes += "$name : 这个 profile 挂着 billion-context → 不启用 $pluginName（步数检查点与 bili 的收敛/压缩提醒重复）"
    }
  } elseif ($bundles -contains $pluginName) {
    $patchNotes += "$name : $pluginName 已在 dsh.profile.bundles 里（挂载行来自 $pluginLayer）"
  } else {
    Copy-Item -LiteralPath $manifest -Destination "$manifest.bak-adg-token-budget" -Force
    $json.dsh.profile.bundles = @($bundles + $pluginName)
    [System.IO.File]::WriteAllText($manifest, ($json | ConvertTo-Json -Depth 10), $utf8NoBom)
    $patchNotes += "$name : 已把 $pluginName 加进 dsh.profile.bundles（原文件备份 $manifest.bak-adg-token-budget）"
  }
}

# ── 5. 旧落点 plugins\<pluginName>\ 的清理 ────────────────────────────────────────
# 只有"没有任何 profile 的链接还指着它"时才删：pnpm 那一步失败时链接可能仍指向旧目录，
# 删掉会让那个 profile 启动时解析不到包（判据用链接目标，不用"包在不在"）。
$legacyNote = '旧落点不存在'
if (Test-Path -LiteralPath $pluginLegacyStable) {
  $legacyUsers = @()
  foreach ($name in $Profiles) {
    $link = Join-Path (Join-Path $profilesDir $name) "node_modules\$pluginName"
    if (-not (Test-Path -LiteralPath $link)) { continue }
    $target = (Get-Item -LiteralPath $link).Target
    if ("$target" -notlike "*bundles\$pluginName") { $legacyUsers += $name }
  }
  if ($legacyUsers.Count -eq 0) {
    Remove-Item -LiteralPath $pluginLegacyStable -Recurse -Force
    $legacyNote = "已删除旧落点 $pluginLegacyStable"
  } else {
    $legacyNote = "旧落点 $pluginLegacyStable 未删除：$($legacyUsers -join ', ') 的链接还指着它（关掉 dsh 重跑本脚本）"
  }
}

Write-Host "已安装到 dsh 用户根：$root"
Write-Host "  skill   -> $skillDest"
Write-Host "  bundle  -> $bundleStable（plain：生成物来自 preset\preset.yml + preset\agent.cordis.yml，不带 bili 工具）"
Write-Host "  bundle  -> $bundleBiliStable（注入版：9 个专家的 allow 里带 bili 的四个上下文工具 + compaction-basic auto: false）"
Write-Host "  plugin  -> $pluginStable（bundle：挂载行来自它自己的 cordis.patch.yml）"
Write-Host "  legacy  -> $legacyNote"
Write-Host "  browser -> $browserNote"
foreach ($note in $installNotes) { Write-Host "  profile -> $note" }
foreach ($note in $patchNotes) { Write-Host "  patch   -> $note" }
Write-Host ""
Write-Host "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
Write-Host "（preset 走的是一条独立的 patch 层：`dsh --profile <name> --dump-config` 能确认它被读到，"
Write-Host "  但只有真的新建一个会话才算挂载成功 —— 静态文件与 --dump-config 都证明不了挂载。）"
Write-Host "（插件行现在来自 bundle 层：没有任何东西 watch bundles\，单独改 bundles\$pluginName\cordis.patch.yml"
Write-Host "  不会自己触发重读 —— 以**重启 dsh** 为准。换过插件 src\ 里的代码同样必须重启（热重载不重新 import）。"
Write-Host "  只想改本机这一份 config：在 Plugins 页保存，它写的是 profile 的 cordis.patch.yml，"
Write-Host "  热重载立即生效；注意那条覆盖行整块替换 config、不是深合并，要留的键都得重写。）"
Write-Host "（browser/ 工具链又是另一回事：用户根下的普通文件，重新跑本脚本即生效，不用重启 dsh。）"
if ($packageFailed) {
  Write-Host ""
  Write-Host "注意：至少有一步 pnpm 没成功，$bundleName / $pluginName 可能还没装进 profile（上面的 profile 与 patch 行里写明了）。" -ForegroundColor Yellow
  Write-Host "先关掉正在运行的 dsh（它占着 node_modules 里的文件，pnpm 无法重建目录），再重跑本脚本。" -ForegroundColor Yellow
  exit 2
}