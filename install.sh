#!/usr/bin/env sh
# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： sh install.sh
set -eu

root="${DSH_HOME:-$HOME/.dsh}"
here="$(cd "$(dirname "$0")" && pwd)"

# 插件要求 logFile 是绝对路径（相对路径会被它关掉文件日志），所以先把 DSH_HOME 归一成绝对路径。
case "$root" in
  /*) ;;
  *)
    resolved="$(cd "$root" 2>/dev/null && pwd)" || resolved=""
    if [ -z "$resolved" ]; then
      echo "DSH_HOME 得是绝对路径，或者一个已存在的相对路径：$root" >&2
      exit 1
    fi
    root="$resolved"
    ;;
esac

mkdir -p "$root/.agent-presets/adg" "$root/skills/adg-add-agent"
cp "$here/preset/preset.yml" "$root/.agent-presets/adg/preset.yml"
cp "$here/preset/agent.cordis.yml" "$root/.agent-presets/adg/agent.cordis.yml"
cp "$here/skills/adg-add-agent/SKILL.md" "$root/skills/adg-add-agent/SKILL.md"

# 插件装到 profiles/node_modules：这是所有 profile 共享的模块解析根 —— 从 profile 目录
# （web 的 cordis.yml 就在 profiles/web/）按 Node 的常规父级 node_modules 上溯正好走到这里，
# 所以一份拷贝对所有 profile 都可用（本机的 dsh-windows-notifier 也在这个位置）。
# 真拷贝，不是符号链接：部署后的插件独立于仓库，删掉或挪走仓库都不会让 dsh 启动失败。
# 先删后拷：重复执行会干净覆盖，不留下上一层版本的残留（test/ 不进部署）。
plugin_src="$here/plugin/dsh-adg-token-budget"
plugin_dest="$root/profiles/node_modules/dsh-adg-token-budget"
rm -rf "$plugin_dest"
mkdir -p "$plugin_dest"
cp -R "$plugin_src/package.json" "$plugin_src/src" "$plugin_src/README.md" "$plugin_src/examples" "$plugin_src/LICENSE" "$plugin_dest/"

# 挂载行写进 web profile 自己的 patch 层（热重载），不动机器级的 $root/cordis.patch.yml：
# 机器级那一层套在每个 profile 上（web / headless / sdk / 自建），而这个插件只对 adg preset 的
# 子代理生效，装到机器级等于让每个 profile 都去 import 它。要全机生效就把同一行搬过去。
patch_file="$root/profiles/web/cordis.patch.yml"
if [ ! -f "$patch_file" ]; then
  patch_note="未找到 $patch_file，跳过挂载行注册（插件文件已复制；请手工把 plugin/dsh-adg-token-budget/examples/cordis.patch.yml 的行贴上去）"
elif grep -q 'dsh-adg-token-budget' "$patch_file"; then
  patch_note="挂载行已在 $patch_file 里（未改动；enabled 的值以该文件为准）"
elif [ "$(tail -n 1 "$patch_file")" != '[]' ]; then
  # patch 层的末行不是空数组字面量，说明这个文件被手工改过；不猜结构，只报错让人自己加。
  patch_note="末行不是 []，内容不可预期：未改动 $patch_file，请手工把 plugin/dsh-adg-token-budget/examples/cordis.patch.yml 的行贴上去"
else
  cp "$patch_file" "$patch_file.bak-adg-token-budget"
  {
    sed '$d' "$patch_file"
    printf '%s\n' \
      '# 步数收敛检查点：按 4/8/12/…/280 的阶梯给 Adg 专家子代理注入可选收敛提醒（可选、可直接无视，不是停止指令）。' \
      '# 按累计 token 介入的软/硬两档已整体移除，插件不再注入 token 触发的消息、也从不 agent.cancel。' \
      '# enabled: false 表示已挂载但不动作；确认无误后改成 true 即可（该文件热重载，立即生效，无需重启）。' \
      '# 注意：这次改过插件 src\ 里的代码，必须重启 dsh 才会加载新代码（热重载只重放 config）。' \
      '- insert:' \
      '    - id: adg-token-budget' \
      "      name: 'dsh-adg-token-budget'" \
      '      config:' \
      '        enabled: false' \
      "        presets: ['adg']" \
      '        stepNudge: true' \
      '        stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]' \
      "        logFile: '$root/adg-token-budget.log'"
  } > "$patch_file.tmp-adg-token-budget"
  mv "$patch_file.tmp-adg-token-budget" "$patch_file"
  patch_note="已加入挂载行（enabled: false），原文件备份为 $patch_file.bak-adg-token-budget"
fi

echo "已安装到 dsh 用户根：$root"
echo "  preset -> $root/.agent-presets/adg"
echo "  skill  -> $root/skills/adg-add-agent"
echo "  plugin -> $plugin_dest"
echo "  patch  -> $patch_note"
echo ""
echo "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
echo "（已挂载的 preset 不会因文件变化重新组合，不重启看不到新的智能体名册。）"
echo "（插件行是另一回事：web profile 的 cordis.patch.yml 热重载，改 enabled 立即生效、不用重启；"
echo "  但插件只在 enabled: true 时才注册监听器，装好不等于已武装，见 README。）"
echo ""
echo "小结：复制了 preset 2 个文件 + 技能 1 个 + 插件 5 项（package.json/src/README.md/examples/LICENSE）；挂载行 -> $patch_note；preset 改动必须重启 dsh 才生效；插件行改 config: 热重载，但换过 src/ 里的代码之后必须重启。"
