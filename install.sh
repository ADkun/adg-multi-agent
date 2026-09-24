#!/usr/bin/env sh
# 安装 Adg 多智能体模式 preset + 配套技能到本机 dsh 用户根。
# 用法： sh install.sh
set -eu

root="${DSH_HOME:-$HOME/.dsh}"
here="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$root/.agent-presets/adg" "$root/skills/adg-add-agent"
cp "$here/preset/preset.yml" "$root/.agent-presets/adg/preset.yml"
cp "$here/preset/agent.cordis.yml" "$root/.agent-presets/adg/agent.cordis.yml"
cp "$here/skills/adg-add-agent/SKILL.md" "$root/skills/adg-add-agent/SKILL.md"

echo "已安装到 dsh 用户根：$root"
echo "  preset -> $root/.agent-presets/adg"
echo "  skill  -> $root/skills/adg-add-agent"
echo ""
echo "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
echo "（已挂载的 preset 不会因文件变化重新组合，不重启看不到新的智能体名册。）"