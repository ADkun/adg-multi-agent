# 安装 Adg 多智能体模式 preset + 配套技能到本机 dsh 用户根。
# 用法： powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'

$root = $env:DSH_HOME
if (-not $root) { $root = Join-Path $HOME '.dsh' }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$presetDest = Join-Path $root '.agent-presets\adg'
$skillDest = Join-Path $root 'skills\adg-add-agent'

New-Item -ItemType Directory -Force -Path $presetDest, $skillDest | Out-Null
Copy-Item (Join-Path $here 'preset\preset.yml') (Join-Path $presetDest 'preset.yml') -Force
Copy-Item (Join-Path $here 'preset\agent.cordis.yml') (Join-Path $presetDest 'agent.cordis.yml') -Force
Copy-Item (Join-Path $here 'skills\adg-add-agent\SKILL.md') (Join-Path $skillDest 'SKILL.md') -Force

Write-Host "已安装到 dsh 用户根：$root"
Write-Host "  preset -> $presetDest"
Write-Host "  skill  -> $skillDest"
Write-Host ""
Write-Host "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
Write-Host "（已挂载的 preset 不会因文件变化重新组合，不重启看不到新的智能体名册。）"