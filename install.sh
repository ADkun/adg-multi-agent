#!/usr/bin/env sh
# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： sh install.sh [--billion-context=auto|on|off] [--save-token=auto|on|off] [profile ...]
#        不带 profile 参数 = 所有能装 preset 的 profile；两个开关默认 auto（也可以用环境变量
#        ADG_BILLION_CONTEXT / ADG_SAVE_TOKEN 给默认值）。
#
# 2026-09-28 重写：dsh 0.1.7-rc.2 起 `$DSH_HOME/.agent-presets/<id>/` 那套目录发现机制已被移除，
# 旧的"拷 preset.yml + agent.cordis.yml"装法装出来的东西**没有任何组件会去读**。现在的形状是
# 一个 bundle：包清单声明 dsh.bundle.patch，patch 里 insert 一行 @deepseek-ai/dsh-agent-preset
# 声明（id/name/description/order/plugins）。本脚本：生成 bundle → 放到 $DSH_HOME/bundles/ →
# 装进目标 profile 的 node_modules 并写进该 profile 的 dsh.profile.bundles。
#
# 2026-09-28 追加 / 2026-10 扩成四种：preset 的生成物有**四种味道**（两个注入组的四种组合），
# 每种占一个稳定目录 ——
#   $DSH_HOME/bundles/dsh-adg-preset                 plain（gen 不带旗标）
#   $DSH_HOME/bundles/dsh-adg-preset-bili            bili（专家的 allow 里带 bili 的四个上下文工具）
#   $DSH_HOME/bundles/dsh-adg-preset-save-token      save-token（带 save_token_expand）
#   $DSH_HOME/bundles/dsh-adg-preset-bili-save-token 两组都带
# 四种的**包名都是 dsh-adg-preset**，所以 profile 的 dsh.profile.bundles 那一行四种味道通用，
# 差别只在它 node_modules 里的那个 link 指向哪一个目录。每个 profile 按**自己的**探测结果选，
# 于是混装（一个 profile 挂 bili、另一个没挂）也能各拿对的形状。味道键、稳定目录名与 gen 旗标都在
# 第 0 / 3 节问 `node tools/resolve-flavor.mjs`（拼法只写在 tools/flavors.mjs，本脚本不重拼）。
# **不要再退回"生成物全机共用一份 + 每个目标 profile 都挂着才注入"那套口径**：那种做法在混装机器上
# 必然给挂着 bili 的那个 profile 装 plain —— 专家收到 bili 的压缩指令却没有工具可调（2026-09-28 本机实测：
# web 挂 bili、desktop 没挂 ⇒ auto 选中 plain ⇒ web 的子代理报 `unknown tool compress`）。
# 插件 dsh-adg-token-budget 自 2026-09-28 起是**同一个形状**：它的挂载行由包自己的
# cordis.patch.yml 提供（旧装法是把行手贴进 profile 的 patch 层，那条路已废弃，脚本只负责报告残留）。
set -eu

root="${DSH_HOME:-$HOME/.dsh}"
here="$(cd "$(dirname "$0")" && pwd)"
bundle_name='dsh-adg-preset'
plugin_name='dsh-adg-token-budget'
# 四个稳定落点（包名都是 $bundle_name，见文件头）：名字不在本脚本里拼 —— 第 3 节问
# `node tools/resolve-flavor.mjs` 拿（拼法只写在 tools/flavors.mjs）。每个 profile 只 link 其中一个。
plugin_stable="$root/bundles/$plugin_name"
plugin_legacy_stable="$root/plugins/$plugin_name"

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
    plugin_stable="$root/bundles/$plugin_name"
    plugin_legacy_stable="$root/plugins/$plugin_name"
    ;;
esac

# ── 目标 profile ────────────────────────────────────────────────────────────────
# 默认：能装 preset 的所有 profile —— 判据是它的 bundle 列表里有 @deepseek-ai/dsh-web-app，
# 因为 agent-preset-registry（agentPresets 服务）正是这个 bundle 声明的（实测：dsh-base 和
# dsh-headless 都不声明它）。往缺 registry 的 profile 里塞声明行会让该 profile 启动失败。
#
# 注入组探测（bili / save-token 两组各探一次，与 install.ps1 同一份实现 tools/has-bundle.mjs）：
#   1) 口径是"**先探测该环境下是否装有对应插件；装了才注入它的工具名**"（这正是 auto 的语义）。
#      每个 profile 链接**自己该拿的**那份味道的生成物（四个稳定目录，见文件头）：装着 bili 的拿带 bili
#      那一组的味道（给专家的 toolFilter.allow 追加那四个上下文工具）、装着 save-token 的拿带
#      save_token_expand 的那一组；两组都装 / 都不装各有一种味道。不注入 = 专家收到该插件的指令或
#      `[save-token #id] … Call the save_token_expand tool` 通知却没工具可调；给没装的 profile 注入 =
#      每一次委派抛 names unknown global tool —— 所以每种组合必须分开装，不能"宁可少给"一刀切。
#      `--billion-context=on|off` / `--save-token=on|off` 是整体覆盖。
#   2) （2026-10 起**不再**有这一半）早先挂着 bili 的 profile 不启用配套插件 dsh-adg-token-budget，
#      理由是两套收敛/压缩提醒重复；用户决定推翻：挂着 bili 也一律启用（见 4c）。
# 覆盖：--billion-context=auto|on|off，或环境变量 ADG_BILLION_CONTEXT（默认 auto）；
#       --save-token=auto|on|off，或环境变量 ADG_SAVE_TOKEN（默认 auto）。两者完全并列、语义相同。
billion_context_mode="${ADG_BILLION_CONTEXT:-auto}"
save_token_mode="${ADG_SAVE_TOKEN:-auto}"
positional=""
has_positional=0
for arg in "$@"; do
  case "$arg" in
    --billion-context=*) billion_context_mode="${arg#--billion-context=}" ;;
    --billion-context)
      echo "--billion-context 需要值：--billion-context=auto|on|off" >&2
      exit 1
      ;;
    --save-token=*) save_token_mode="${arg#--save-token=}" ;;
    --save-token)
      echo "--save-token 需要值：--save-token=auto|on|off" >&2
      exit 1
      ;;
    *)
      positional="$positional $arg"
      has_positional=1
      ;;
  esac
done
case "$billion_context_mode" in
  auto | on | off) ;;
  *)
    echo "billion-context 模式只认 auto|on|off，给的是：$billion_context_mode" >&2
    exit 1
    ;;
esac
case "$save_token_mode" in
  auto | on | off) ;;
  *)
    echo "save-token 模式只认 auto|on|off，给的是：$save_token_mode" >&2
    exit 1
    ;;
esac

profiles=""
package_failed=0
if [ "$has_positional" -eq 1 ]; then
  # shellcheck disable=SC2086
  profiles="$positional"
else
  profiles="$(node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.argv[1];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "node_modules") continue;
      const m = path.join(dir, e.name, "package.json");
      if (!fs.existsSync(m)) continue;
      let j;
      try { j = JSON.parse(fs.readFileSync(m, "utf8")); } catch { continue; }
      const bundles = (j.dsh && j.dsh.profile && j.dsh.profile.bundles) || [];
      if (bundles.includes("@deepseek-ai/dsh-web-app")) console.log(e.name);
    }' "$root/profiles")"
fi
if [ -z "$profiles" ]; then
  echo "在 $root/profiles 下没找到可装 preset 的 profile（判据：dsh.profile.bundles 含 @deepseek-ai/dsh-web-app）" >&2
  exit 1
fi

# ── 0. 注入组探测（billion-context / save-token；两组各探一次，共用 tools/has-bundle.mjs）────
# 口径：**先探测该环境下是否装有对应插件；装了才注入它的工具名**（这正是 auto 的语义）。
# 每组两张名单：
#   bili_on / save_token_on  = 装着该组的 profile —— 只决定它拿哪份生成物；**不再**决定 token-budget
#                              插件启不启用（2026-10 用户决定：挂着 bili 也一律启用，此前那一半已推翻，见 4c）
#   *_off                    = 没装的 profile —— 它拿不含该组的生成物
# shellcheck disable=SC2086
bili_map="$(node "$here/tools/has-bundle.mjs" "$root/profiles" $profiles)"
# shellcheck disable=SC2086
save_token_map="$(node "$here/tools/has-bundle.mjs" "$root/profiles" $profiles --package=dsh-plugin-save-token)"
tab="$(printf '\t')"
bili_on=""
bili_off=""
while IFS="$tab" read -r bili_name bili_flag; do
  [ -n "$bili_name" ] || continue
  if [ "$bili_flag" = "1" ]; then bili_on="$bili_on $bili_name"; else bili_off="$bili_off $bili_name"; fi
done <<EOF
$bili_map
EOF
save_token_on=""
save_token_off=""
while IFS="$tab" read -r st_name st_flag; do
  [ -n "$st_name" ] || continue
  if [ "$st_flag" = "1" ]; then save_token_on="$save_token_on $st_name"; else save_token_off="$save_token_off $st_name"; fi
done <<EOF
$save_token_map
EOF
# has_bili / has_save_token <profile> → 打印 0/1（4c 只用 bili 那个给提示语加一句"挂着 bili 也照样启用"）
has_bili() {
  printf '%s\n' "$bili_map" | awk -F'\t' -v want="$1" '$1 == want { print $2 }'
}
has_save_token() {
  printf '%s\n' "$save_token_map" | awk -F'\t' -v want="$1" '$1 == want { print $2 }'
}
# 每组按 auto/on/off 解析：auto = 这个 profile 自己的探测值；on / off 强制。
want_bili_of() {
  case "$billion_context_mode" in
    on) echo 1 ;;
    off) echo 0 ;;
    *) if [ "$(has_bili "$1")" = "1" ]; then echo 1; else echo 0; fi ;;
  esac
}
want_save_token_of() {
  case "$save_token_mode" in
    on) echo 1 ;;
    off) echo 0 ;;
    *) if [ "$(has_save_token "$1")" = "1" ]; then echo 1; else echo 0; fi ;;
  esac
}
# 每个目标 profile 的三列解析结果（每个 profile 只起一次 node），一行一个：
#   `<profile>\t<味道键>\t<稳定目录名>\t<gen 旗标>`；三列都由 tools/resolve-flavor.mjs 给
#   （拼法只写在 tools/flavors.mjs，本脚本不重拼）。它只做映射、**不做探测**。
flavor_table=""
for name in $profiles; do
  group_flags=""
  if [ "$(want_bili_of "$name")" = "1" ]; then group_flags="$group_flags --billion-context"; fi
  if [ "$(want_save_token_of "$name")" = "1" ]; then group_flags="$group_flags --save-token"; fi
  # shellcheck disable=SC2086
  resolved="$(node "$here/tools/resolve-flavor.mjs" $group_flags)"
  # 行用 printf 的格式串拼：`$(printf '\n')` 会被命令替换吞掉末尾的换行（值变成空串），几行就会挤成一行，
  # 于是除第一个 profile 外谁都查不到自己的味道（实测踩过）。
  flavor_table="$(printf '%s\n%s\t%s' "$flavor_table" "$name" "$resolved")"
done
flavor_of() { printf '%s\n' "$flavor_table" | awk -F'\t' -v want="$1" '$1 == want { print $2 }'; }
bundle_dir_of() { printf '%s\n' "$flavor_table" | awk -F'\t' -v want="$1" '$1 == want { print $3 }'; }
# 每组最终注入与否的名单（供日志与覆盖提醒用）。
bili_wanted_profiles=""
bili_unwanted_profiles=""
save_token_wanted_profiles=""
save_token_unwanted_profiles=""
for name in $profiles; do
  if [ "$(want_bili_of "$name")" = "1" ]; then
    bili_wanted_profiles="$bili_wanted_profiles $name"
  else
    bili_unwanted_profiles="$bili_unwanted_profiles $name"
  fi
  if [ "$(want_save_token_of "$name")" = "1" ]; then
    save_token_wanted_profiles="$save_token_wanted_profiles $name"
  else
    save_token_unwanted_profiles="$save_token_unwanted_profiles $name"
  fi
done
echo "billion-context 探测：$([ -n "$bili_on" ] && echo "已挂载 [${bili_on# }]" || echo "没有任何目标 profile 挂载") / 未挂载 $([ -n "$bili_off" ] && echo "[${bili_off# }]" || echo "无")"
echo "save-token 探测：$([ -n "$save_token_on" ] && echo "已挂载 [${save_token_on# }]" || echo "没有任何目标 profile 挂载") / 未挂载 $([ -n "$save_token_off" ] && echo "[${save_token_off# }]" || echo "无")"
for name in $profiles; do
  flavor="$(flavor_of "$name")"
  case "$flavor" in
    plain) flavor_note="不带任何注入的上下文工具" ;;
    bili) flavor_note="专家的 allow 里带 bili 的四个上下文工具" ;;
    save-token) flavor_note="专家的 allow 里带 save-token 的 save_token_expand" ;;
    bili+save-token) flavor_note="专家的 allow 里带 bili 的四个上下文工具 + save-token 的 save_token_expand" ;;
    *) flavor_note="" ;;
  esac
  echo "  味道 -> $name : $flavor（$flavor_note）"
done
# 覆盖开关与探测结果对不上时必须明说：判断错的那一方不是少个能力就是每次委派都挂（红线 7）。
# 每组三档，与旧版 bili 那三条一一对应：on 但一个都没装 / on 被强制套到没装的 profile / off 把装着的关掉。
bili_forced_onto_off=""
bili_forced_off_of_on=""
for name in $bili_wanted_profiles; do
  if [ "$(has_bili "$name")" != "1" ]; then bili_forced_onto_off="$bili_forced_onto_off $name"; fi
done
for name in $bili_unwanted_profiles; do
  if [ "$(has_bili "$name")" = "1" ]; then bili_forced_off_of_on="$bili_forced_off_of_on $name"; fi
done
save_token_forced_onto_off=""
save_token_forced_off_of_on=""
for name in $save_token_wanted_profiles; do
  if [ "$(has_save_token "$name")" != "1" ]; then save_token_forced_onto_off="$save_token_forced_onto_off $name"; fi
done
for name in $save_token_unwanted_profiles; do
  if [ "$(has_save_token "$name")" = "1" ]; then save_token_forced_off_of_on="$save_token_forced_off_of_on $name"; fi
done
if [ "$billion_context_mode" = "on" ] && [ -z "$bili_wanted_profiles" ]; then
  echo "  注意：--billion-context=on 但按名单没有任何 profile 挂着 billion-context —— 仍按 on 装带 bili 那一组的味道，" >&2
  echo "    请确认这些 profile 之后会装上 billion-context（否则委派给专家会失败：names unknown global tool）。" >&2
fi
if [ -n "$bili_forced_onto_off" ]; then
  echo "  注意：--billion-context=on 强制注入，但这些目标 profile 没挂 bili：${bili_forced_onto_off# } ——" >&2
  echo "    它们每一次委派都会抛 names unknown global tool \"compress\"（要么装上 bili，要么改回 auto）。" >&2
fi
if [ -n "$bili_forced_off_of_on" ]; then
  echo "  注意：--billion-context=off 强制不注入，但这些目标 profile 挂着 bili：${bili_forced_off_of_on# } ——" >&2
  echo "    它们的专家会收到 bili 的压缩指令却没有工具可调（改回 auto 才会按 profile 选味道）。" >&2
fi
if [ "$save_token_mode" = "on" ] && [ -z "$save_token_wanted_profiles" ]; then
  echo "  注意：--save-token=on 但按名单没有任何 profile 装着 dsh-plugin-save-token —— 仍按 on 装带 save-token 那一组的味道，" >&2
  echo "    请确认这些 profile 之后会装上 dsh-plugin-save-token（否则委派给专家会失败：names unknown global tool）。" >&2
fi
if [ -n "$save_token_forced_onto_off" ]; then
  echo "  注意：--save-token=on 强制注入，但这些目标 profile 没装 dsh-plugin-save-token：${save_token_forced_onto_off# } ——" >&2
  echo "    它们每一次委派都会抛 names unknown global tool \"save_token_expand\"（要么给它们装上那个插件，要么改回 auto）。" >&2
fi
if [ -n "$save_token_forced_off_of_on" ]; then
  echo "  注意：--save-token=off 强制不注入，但这些目标 profile 装着 dsh-plugin-save-token：${save_token_forced_off_of_on# } ——" >&2
  echo "    它们的专家会收到 \"Call the save_token_expand tool\" 的取回通知却没有工具可调（改回 auto 才会按 profile 选味道）。" >&2
fi

# ── 1. 用户技能 ────────────────────────────────────────────────────────────────
mkdir -p "$root/skills/adg-add-agent"
cp "$here/skills/adg-add-agent/SKILL.md" "$root/skills/adg-add-agent/SKILL.md"

# ── 2. browser/ 工具链 ─────────────────────────────────────────────────────────
# 它是普通文件、不是插件也不是 preset：重新跑一次本脚本就生效，**不需要重启 dsh**。
# 先删后拷，避免上一层版本的残留。
browser_src="$here/browser"
browser_dest="$root/browser"
if [ -d "$browser_src" ]; then
  rm -rf "$browser_dest"
  mkdir -p "$browser_dest"
  cp -R "$browser_src/." "$browser_dest/"
  browser_note="browser/ 工具链 -> $browser_dest"
else
  browser_note="未找到 $browser_src，跳过 browser/ 工具链部署"
fi

# ── 3. preset bundle：四种味道全部生成 → 各自落到自己的稳定位置（每 profile 只 link 一份）──
# 源文件永远只有 preset/preset.yml + preset/agent.cordis.yml；bundle/adg-*/ 是构建产物
# （在 .gitignore 里），每次安装都重新生成，所以没有人需要手改 patch。
# 各注入组的工具名只进生成物、不进源文件：源文件得对没装那些插件的人也成立（见 gen 脚本的 --with-* 说明）。
# **四份都无条件生成**：省掉"这一跑要不要重建那一份"的判断，稳定目录里的形状永远等于它该有的形状。
# 表里只写"味道键 + 输出目录 + 它含哪几组"；输出目录按"味道键里的 + 换成 -"，
# **稳定目录名与 gen 旗标都问 tools/resolve-flavor.mjs**（拼法只写在 tools/flavors.mjs，本脚本不重拼），
# 并当场核对它给的味道键与表里一致。
# outDir 传绝对路径：gen 脚本用的是 process.cwd()，不能跟着"用户从哪个目录调用本脚本"漂。
gen_flavors='plain bili save-token bili+save-token'
bundle_dest_table=""
for gen_flavor in $gen_flavors; do
  case "$gen_flavor" in
    plain) gen_groups="" ;;
    bili) gen_groups="--billion-context" ;;
    save-token) gen_groups="--save-token" ;;
    bili+save-token) gen_groups="--billion-context --save-token" ;;
  esac
  # shellcheck disable=SC2086
  gen_resolved="$(node "$here/tools/resolve-flavor.mjs" $gen_groups)"
  gen_key="$(printf '%s' "$gen_resolved" | cut -f1)"
  gen_dir_name="$(printf '%s' "$gen_resolved" | cut -f2)"
  gen_flags="$(printf '%s' "$gen_resolved" | cut -f3)"
  if [ "$gen_key" != "$gen_flavor" ]; then
    echo "味道键对不上：本脚本表里是 $gen_flavor，tools/resolve-flavor.mjs 给的是 $gen_key" >&2
    exit 1
  fi
  gen_out="$here/bundle/adg-$(printf '%s' "$gen_flavor" | tr '+' '-')"
  # shellcheck disable=SC2086
  node "$here/tools/gen-preset-bundle.mjs" $gen_flags "$gen_out"
  # $DSH_HOME/bundles/ 是稳定位置：profile 只引用这里，仓库可以随便挪/删。
  gen_dest="$root/bundles/$gen_dir_name"
  rm -rf "$gen_dest"
  mkdir -p "$gen_dest"
  cp "$gen_out/cordis.patch.yml" "$gen_dest/cordis.patch.yml"
  cp "$gen_out/package.json" "$gen_dest/package.json"
  # 同上：换行由 printf 的格式串给，别用 `$(printf '\n')`（命令替换会把末尾换行吞掉，几行挤成一行）。
  bundle_dest_table="$(printf '%s\n%s\t%s' "$bundle_dest_table" "$gen_flavor" "$gen_dest")"
done
# 四种味道的 package.json 必须**逐字节相同、包名都叫 $bundle_name**（profile 的 dsh.profile.bundles
# 那一行四种味道通用，差别只在 link 指向哪个目录），所以拷完当场验一遍。
plain_dest="$(printf '%s\n' "$bundle_dest_table" | awk -F'\t' -v want='plain' '$1 == want { print $2 }')"
for gen_flavor in $gen_flavors; do
  gen_dest="$(printf '%s\n' "$bundle_dest_table" | awk -F'\t' -v want="$gen_flavor" '$1 == want { print $2 }')"
  if ! cmp -s "$plain_dest/package.json" "$gen_dest/package.json"; then
    echo "$gen_dest/package.json 与 plain 那一份不是逐字节相同 —— 四种味道的包名与清单必须一致，profile 的 dsh.profile.bundles 才能通用" >&2
    exit 1
  fi
done
pkg_name="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name)' "$plain_dest/package.json")"
if [ "$pkg_name" != "$bundle_name" ]; then
  echo "稳定目录里的包名是 $pkg_name，期望 $bundle_name（profile 的 dsh.profile.bundles 那一行按这个包名写）" >&2
  exit 1
fi

# ── 4. 插件：作为 bundle 拷到稳定位置（同上去掉仓库依赖）────────────────────────
# 部署集合六项 = package.json / cordis.patch.yml / src / examples / README.md / LICENSE
# （与插件 package.json 的 files 一致；test/ 与 INSTALL.md 不进部署）。
# cordis.patch.yml 是这一层的第六项：它就是挂载行本身，缺了它这个包只是普通依赖。
plugin_src="$here/plugin/$plugin_name"
rm -rf "$plugin_stable"
mkdir -p "$plugin_stable"
cp -R "$plugin_src/package.json" "$plugin_src/cordis.patch.yml" "$plugin_src/src" "$plugin_src/README.md" "$plugin_src/examples" "$plugin_src/LICENSE" "$plugin_stable/"

for name in $profiles; do
  profile_dir="$root/profiles/$name"
  manifest="$profile_dir/package.json"
  if [ ! -f "$manifest" ]; then
    echo "profile 不存在：$profile_dir" >&2
    exit 1
  fi

  # 4a. 依赖（等价于 `dsh plugin --profile <name> add link:<dir>`，那是一条 pnpm 直通命令）。
  # 用 link: 而不是把文件真拷进 node_modules：目标目录在 $DSH_HOME 下的稳定位置，
  # 重新生成 preset 之后不用重装就生效。
  # pnpm 在 **dsh 正在运行时**会失败：它发现 node_modules 不是自己管的（.modules.yaml 缺失）
  # 就想整目录重建，而文件被运行中的 dsh 占着（实测：os error 32 / ERR_PNPM_…_REMOVE_MODULES_DIR）。
  # 那要先关掉 dsh，重跑没用 —— 所以这里只报告，不中断后面的步骤。
  # 这个 profile 该拿哪一种味道的稳定目录（见上面第 0 节的 flavor_of / bundle_dir_of）。换味道也只在这一步发生：
  # 同一个包名 link: 到另一个目录，profile 的 dsh.profile.bundles 一行都不用改（四种味道包名相同）。
  flavor="$(flavor_of "$name")"
  want_bundle="$root/bundles/$(bundle_dir_of "$name")"
  pnpm_failed=0
  if command -v pnpm >/dev/null 2>&1; then
    if (cd "$profile_dir" && pnpm add "link:$want_bundle" "link:$plugin_stable"); then
      echo "  profile -> $name : 已 link $bundle_name（$flavor 味道）+ $plugin_name"
    else
      pnpm_failed=1
      echo "  profile -> $name : pnpm add 失败 —— 常见原因是 dsh 正在运行、node_modules 被占用；关掉 dsh 后重跑本脚本" >&2
    fi
  else
    pnpm_failed=1
    echo "  profile -> $name : 未找到 pnpm，跳过依赖安装 —— 请在该 profile 里执行 pnpm add link:$want_bundle link:$plugin_stable"
  fi

  # 4b. bundle 必须被选进 dsh.profile.bundles，否则它的 patch 层根本不会被读。
  # 但"选进列表"和"包装上了"必须同时成立：只写列表而包装不上，会让这个 profile 启动时报
  # 未安装的 bundle。所以先确认包真的解析得到，包不在就只报告、不写列表。
  if [ ! -f "$profile_dir/node_modules/$bundle_name/package.json" ]; then
    package_failed=1
    echo "  profile -> $name : $bundle_name 还没装进这个 profile 的 node_modules —— 未写入 dsh.profile.bundles"
    continue
  fi
  # pnpm 那一步失败、但包其实早就在位（例如上一次安装留下的）时不算失败，只说明本次没重装依赖。
  if [ "$pnpm_failed" -eq 1 ]; then
    echo "  profile -> $name : pnpm 那一步没成功，但 $bundle_name / $plugin_name 已在 node_modules 里 —— 本次安装不受影响"
  fi
  # 4b-1. 断言**已经链接进去的那一份**的味道，正是这个 profile 该拿的味道。
  # 判据不能是"包在不在"：四种味道的 package.json 逐字节相同、包名也一样，只有产物本体不同 ——
  # 所以让 tools/check-bundle-flavor.mjs 逐行验 9 个专家行的 allow 与 compaction-basic 的 auto
  # （四种味道各按自己的注入组断言：该有的全有、不该有的一个都不能出现）。
  # 这一格是本缺陷的"静默失效"出口：味道换错时一切看起来都正常，只有专家的工具目录少该有的名字。
  linked_patch="$profile_dir/node_modules/$bundle_name/cordis.patch.yml"
  flavor_ok=0
  flavor_report=""
  if [ -f "$linked_patch" ]; then
    flavor_report="$(node "$here/tools/check-bundle-flavor.mjs" "$linked_patch" "$flavor" 2>&1)" || flavor_ok=$?
  else
    flavor_ok=1
    flavor_report="$linked_patch 不存在"
  fi
  if [ "$flavor_ok" -eq 0 ]; then
    echo "  profile -> $name : 落点味道 = $flavor（tools/check-bundle-flavor.mjs 通过）"
  else
    echo "  profile -> $name : 落点味道 ≠ $flavor —— 链接到的还是另一种味道（换味道那一步没成功；专家的 allow 会少该有的注入名字，或多出这个 profile 没装的那个插件的名字）" >&2
    printf '%s\n' "$flavor_report" | while IFS= read -r flavor_line; do
      echo "      $flavor_line"
    done
    package_failed=1
  fi
  node -e '
    const fs = require("fs");
    const [manifest, bundleName] = process.argv.slice(1);
    const j = JSON.parse(fs.readFileSync(manifest, "utf8"));
    j.dsh = j.dsh || {}; j.dsh.profile = j.dsh.profile || {}; j.dsh.profile.bundles = j.dsh.profile.bundles || [];
    if (j.dsh.profile.bundles.includes(bundleName)) { console.log("present"); process.exit(0); }
    fs.writeFileSync(manifest + ".bak-adg-bundle", fs.readFileSync(manifest));
    j.dsh.profile.bundles.push(bundleName);
    fs.writeFileSync(manifest, JSON.stringify(j, null, 2) + "\n");
    console.log("added");' "$manifest" "$bundle_name" \
    | while read -r verdict; do
        case "$verdict" in
          added) echo "  profile -> $name : 已把 $bundle_name 加进 dsh.profile.bundles（原文件备份 $manifest.bak-adg-bundle）" ;;
          *) echo "  profile -> $name : $bundle_name 已在 dsh.profile.bundles 里" ;;
        esac
      done

  # 4c. 插件 bundle 同样要选进 dsh.profile.bundles —— 挂载行现在由包自己的 cordis.patch.yml
  # 提供（package.json 的 dsh.bundle.patch），profile 的 patch 层不再需要那条手贴的 insert 行。
  # 判据比"包在不在 node_modules 里"更严：装上的那份必须真的声明 dsh.bundle.patch。pnpm 失败时
  # 链接可能还指着旧落点 plugins/<plugin>/，那份 package.json 没有 dsh.bundle.patch，把它写进
  # 列表只会让 dsh 启动时选到一个没有 patch 层的 bundle。
  # 不动机器级的 $root/cordis.patch.yml：那一层套在每个 profile 上（web / headless / sdk / 自建），
  # 而这个插件只对 adg preset 的子代理生效，选进机器级等于让每个 profile 都去 import 它。
  patch_file="$profile_dir/cordis.patch.yml"
  hand_row=0
  if [ -f "$patch_file" ] && grep -Eq '^[[:space:]]*- id: adg-token-budget' "$patch_file"; then
    hand_row=1
    echo "  patch   -> $name : $patch_file 里还有旧机制手贴的挂载行 —— 请删掉，这一行现在由 bundle 层提供；不删则 profile 层会整块替换掉 bundle 行的 config"
  fi
  # 4c-1. 挂着 billion-context 的 profile **同样启用**这个插件（2026-10 用户决定，推翻此前的"挂了 bili
  # 就不启用"）：早先的理由是它按步数档位给子代理注入收敛提醒，而 bili 在同一个 profile 上也有自己的
  # 压缩 / nudge 指令，两套重复；用户判定步数检查点保留（bili 不做"按步数问一句要不要收尾"这件事），
  # 重复的代价由用户接受。所以这里不再按 profile 分叉，所有目标 profile 都走同一条"确保已选进
  # dsh.profile.bundles"的路径；旧版安装按 bili 移除过的 profile 会由此加回去。
  # 选中的做法不变、也不改塞一条 enabled:false/true 覆盖行 —— profile 层按 id 覆盖是**整块替换 config**，
  # 为了改一个键得把整份 config 重写一遍（AGENTS.md 红线 3 的同一理由）。
  mounts_bili="$(has_bili "$name")"
  verdict="$(node -e '
    const fs = require("fs");
    const [profileDir, pluginName] = process.argv.slice(1);
    const pkgPath = profileDir + "/node_modules/" + pluginName + "/package.json";
    let j = null;
    try { j = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { j = null; }
    if (!j) { console.log("absent"); process.exit(0); }
    if (!j.dsh || !j.dsh.bundle) { console.log("no-layer"); process.exit(0); }
    const layer = j.dsh.bundle.patch || "cordis.patch.yml";
    const manifest = profileDir + "/package.json";
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    m.dsh = m.dsh || {}; m.dsh.profile = m.dsh.profile || {}; m.dsh.profile.bundles = m.dsh.profile.bundles || [];
    if (m.dsh.profile.bundles.includes(pluginName)) { console.log("present:" + layer); process.exit(0); }
    fs.writeFileSync(manifest + ".bak-adg-token-budget", fs.readFileSync(manifest));
    m.dsh.profile.bundles.push(pluginName);
    fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + "\n");
    console.log("added:" + layer);' "$profile_dir" "$plugin_name")"
  case "$verdict" in
    absent)
      package_failed=1
      echo "  patch   -> $name : $plugin_name 还没装进这个 profile 的 node_modules —— 未写入 dsh.profile.bundles"
      continue
      ;;
    no-layer)
      package_failed=1
      echo "  patch   -> $name : 装上的 $plugin_name 没有声明 dsh.bundle.patch —— 未写入 dsh.profile.bundles（链接多半还指着旧落点 $plugin_legacy_stable；关掉 dsh 重跑本脚本）"
      continue
      ;;
    added:*)
      if [ "$mounts_bili" = "1" ]; then
        echo "  patch   -> $name : 已把 $plugin_name 加进 dsh.profile.bundles（挂载行来自 ${verdict#added:}，原文件备份 $manifest.bak-adg-token-budget）—— 这个 profile 挂着 billion-context：2026-10 起挂 bili 也启用它（旧版安装曾按 bili 移除过就由此加回）"
      else
        echo "  patch   -> $name : 已把 $plugin_name 加进 dsh.profile.bundles（挂载行来自 ${verdict#added:}，原文件备份 $manifest.bak-adg-token-budget）"
      fi
      ;;
    *)
      if [ "$mounts_bili" = "1" ]; then
        echo "  patch   -> $name : 这个 profile 挂着 billion-context，$plugin_name 保持启用（挂载行来自 ${verdict#present:}；2026-10 起挂 bili 也不停用）"
      else
        echo "  patch   -> $name : $plugin_name 已在 dsh.profile.bundles 里（挂载行来自 ${verdict#present:}）"
      fi
      ;;
  esac
done

# ── 5. 旧落点 plugins/<plugin>/ 的清理 ──────────────────────────────────────────
# 只有"没有任何 profile 的链接还指着它"时才删：pnpm 那一步失败时链接可能仍指向旧目录，
# 删掉会让那个 profile 启动时解析不到包。判据是 realpath 后的链接目标，不是"包在不在"。
# （用 node 取 realpath：macOS 的 readlink 不一定支持 -f，而本脚本本来就依赖 node。）
legacy_note='旧落点不存在'
if [ -d "$plugin_legacy_stable" ]; then
  want="$(node -e 'try{console.log(require("fs").realpathSync(process.argv[1]))}catch{console.log(process.argv[1])}' "$plugin_stable")"
  legacy_users=''
  for name in $profiles; do
    link="$root/profiles/$name/node_modules/$plugin_name"
    [ -e "$link" ] || continue
    target="$(node -e 'try{console.log(require("fs").realpathSync(process.argv[1]))}catch{console.log("")}' "$link")"
    if [ "$target" != "$want" ]; then legacy_users="$legacy_users $name"; fi
  done
  if [ -z "$legacy_users" ]; then
    rm -rf "$plugin_legacy_stable"
    legacy_note="已删除旧落点 $plugin_legacy_stable"
  else
    legacy_note="旧落点 $plugin_legacy_stable 未删除：$legacy_users 的链接还指着它（关掉 dsh 重跑本脚本）"
  fi
fi

echo "已安装到 dsh 用户根：$root"
echo "  skill   -> $root/skills/adg-add-agent"
for gen_flavor in $gen_flavors; do
  gen_dest="$(printf '%s\n' "$bundle_dest_table" | awk -F'\t' -v want="$gen_flavor" '$1 == want { print $2 }')"
  case "$gen_flavor" in
    plain) gen_note="不带任何注入的上下文工具（源文件原样）" ;;
    bili) gen_note="9 个专家的 allow 里带 bili 的四个上下文工具 + compaction-basic auto: false" ;;
    save-token) gen_note="9 个专家的 allow 里带 save-token 的 save_token_expand" ;;
    bili+save-token) gen_note="上述两组的并集（bili 四个上下文工具 + save_token_expand + auto: false）" ;;
    *) gen_note="" ;;
  esac
  echo "  bundle  -> $gen_dest（$gen_flavor 味道：$gen_note；生成物来自 preset/preset.yml + preset/agent.cordis.yml）"
done
echo "  plugin  -> $plugin_stable（bundle：挂载行来自它自己的 cordis.patch.yml）"
echo "  legacy  -> $legacy_note"
echo "  browser -> $browser_note"
echo ""
echo "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
echo "（preset 走的是一条独立的 patch 层：dsh --profile <name> --dump-config 能确认它被读到，"
echo "  但只有真的新建一个会话才算挂载成功 —— 静态文件与 --dump-config 都证明不了挂载。）"
echo "（插件行现在来自 bundle 层：没有任何东西 watch bundles/，单独改 bundles/$plugin_name/cordis.patch.yml"
echo "  不会自己触发重读 —— 以**重启 dsh** 为准。换过插件 src/ 里的代码同样必须重启（热重载不重新 import）。"
echo "  只想改本机这一份 config：在 Plugins 页保存，它写的是 profile 的 cordis.patch.yml，"
echo "  热重载立即生效；注意那条覆盖行整块替换 config、不是深合并，要留的键都得重写。）"
echo "（browser/ 工具链又是另一回事：用户根下的普通文件，重新跑本脚本即生效，不用重启 dsh。）"
if [ "$package_failed" -eq 1 ]; then
  echo ""
  echo "注意：至少有一步 pnpm 没成功，$bundle_name / $plugin_name 可能还没装进 profile（上面的 profile 与 patch 行里写明了）。" >&2
  echo "先关掉正在运行的 dsh（它占着 node_modules 里的文件，pnpm 无法重建目录），再重跑本脚本。" >&2
  exit 2
fi