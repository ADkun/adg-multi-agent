#!/usr/bin/env sh
# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： sh install.sh [profile ...]      不带参数 = 所有能装 preset 的 profile
#
# 2026-09-28 重写：dsh 0.1.7-rc.2 起 `$DSH_HOME/.agent-presets/<id>/` 那套目录发现机制已被移除，
# 旧的"拷 preset.yml + agent.cordis.yml"装法装出来的东西**没有任何组件会去读**。现在的形状是
# 一个 bundle：包清单声明 dsh.bundle.patch，patch 里 insert 一行 @deepseek-ai/dsh-agent-preset
# 声明（id/name/description/order/plugins）。本脚本：生成 bundle → 放到 $DSH_HOME/bundles/ →
# 装进目标 profile 的 node_modules 并写进该 profile 的 dsh.profile.bundles。
#
# 2026-09-28 追加：preset 的生成物有**两种味道**（plain / 注入版），各自占一个稳定目录 ——
#   $DSH_HOME/bundles/dsh-adg-preset        plain（gen 不带旗标）
#   $DSH_HOME/bundles/dsh-adg-preset-bili   注入版（专家的 allow 里带 bili 的四个上下文工具）
# 两份的**包名都是 dsh-adg-preset**，所以 profile 的 dsh.profile.bundles 那一行两种味道通用，
# 差别只在它 node_modules 里的那个 link 指向哪一个目录。每个 profile 按**自己的**探测结果选，
# 于是混装（一个 profile 挂 bili、另一个没挂）也能各拿对的形状。
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
# 两种味道两个稳定落点（包名相同，见文件头）：plain = bundle_stable（沿用旧路径，老链接不用动），
# bili = bundle_bili_stable。每个 profile 只 link 其中一个。
bundle_stable="$root/bundles/$bundle_name"
bundle_bili_stable="$root/bundles/$bundle_name-bili"
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
    bundle_stable="$root/bundles/$bundle_name"
    bundle_bili_stable="$root/bundles/$bundle_name-bili"
    plugin_stable="$root/bundles/$plugin_name"
    plugin_legacy_stable="$root/plugins/$plugin_name"
    ;;
esac

# ── 目标 profile ────────────────────────────────────────────────────────────────
# 默认：能装 preset 的所有 profile —— 判据是它的 bundle 列表里有 @deepseek-ai/dsh-web-app，
# 因为 agent-preset-registry（agentPresets 服务）正是这个 bundle 声明的（实测：dsh-base 和
# dsh-headless 都不声明它）。往缺 registry 的 profile 里塞声明行会让该 profile 启动失败。
#
# billion-context 协同（与 install.ps1 同一份判据 tools/has-billion-context.mjs）：
#   1) 每个 profile 链接**自己该拿的**那份味道的生成物（plain / bili 两个稳定目录，见文件头）：
#      bili 版给专家的 toolFilter.allow 追加 bili 那几个上下文工具（不注入 = 专家收到 bili 的压缩
#      指令却没工具可调；给没挂 bili 的 profile 注入 = 每一次委派抛 names unknown global tool，
#      所以两种形状必须分开装，不能"宁可少给"一刀切）。--billion-context=on|off 是整体覆盖。
#   2) （2026-10 起**不再**有这一半）早先挂着 bili 的 profile 不启用配套插件 dsh-adg-token-budget，
#      理由是两套收敛/压缩提醒重复；用户决定推翻：挂着 bili 也一律启用（见 4c）。
# 覆盖：--billion-context=auto|on|off，或环境变量 ADG_BILLION_CONTEXT（默认 auto）。
billion_context_mode="${ADG_BILLION_CONTEXT:-auto}"
positional=""
has_positional=0
for arg in "$@"; do
  case "$arg" in
    --billion-context=*) billion_context_mode="${arg#--billion-context=}" ;;
    --billion-context)
      echo "--billion-context 需要值：--billion-context=auto|on|off" >&2
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

# ── 0. billion-context 探测（与 install.ps1 共用 tools/has-billion-context.mjs 那一份判据）────
# 两张名单：
#   bili_on  = 挂着 bili 的 profile —— 只决定它拿哪份生成物（注入版）；**不再**决定 token-budget 插件
#              启不启用（2026-10 用户决定：挂着 bili 也一律启用，此前那一半已推翻，见 4c）
#   bili_off = 没挂的 profile —— 它拿 plain 生成物
# shellcheck disable=SC2086
bili_map="$(node "$here/tools/has-billion-context.mjs" "$root/profiles" $profiles)"
tab="$(printf '\t')"
bili_on=""
bili_off=""
while IFS="$tab" read -r bili_name bili_flag; do
  [ -n "$bili_name" ] || continue
  if [ "$bili_flag" = "1" ]; then bili_on="$bili_on $bili_name"; else bili_off="$bili_off $bili_name"; fi
done <<EOF
$bili_map
EOF
# has_bili <profile> → 打印 0/1（4c 只用它给提示语加一句"挂着 bili 也照样启用"的说明）
has_bili() {
  printf '%s\n' "$bili_map" | awk -F'\t' -v want="$1" '$1 == want { print $2 }'
}
# 每个目标 profile 要哪一种味道：auto = 它自己的探测结果；on / off = 全部强制同一种。
flavor_of() {
  case "$billion_context_mode" in
    on) echo bili ;;
    off) echo plain ;;
    *)
      if [ "$(has_bili "$1")" = "1" ]; then echo bili; else echo plain; fi
      ;;
  esac
}
bili_flavor_profiles=""
plain_flavor_profiles=""
for name in $profiles; do
  if [ "$(flavor_of "$name")" = "bili" ]; then
    bili_flavor_profiles="$bili_flavor_profiles $name"
  else
    plain_flavor_profiles="$plain_flavor_profiles $name"
  fi
done
echo "billion-context 探测：$([ -n "$bili_on" ] && echo "已挂载 [${bili_on# }]" || echo "没有任何目标 profile 挂载") / 未挂载 $([ -n "$bili_off" ] && echo "[${bili_off# }]" || echo "无")"
for name in $profiles; do
  flavor="$(flavor_of "$name")"
  if [ "$flavor" = "bili" ]; then
    echo "  味道 -> $name : bili（专家的 allow 里带 bili 的四个上下文工具）"
  else
    echo "  味道 -> $name : plain（不带 bili 工具）"
  fi
done
# 覆盖开关与探测结果对不上时必须明说：判断错的那一方不是少个能力就是每次委派都挂（红线 7）。
forced_onto_off=""
forced_off_of_on=""
for name in $bili_flavor_profiles; do
  if [ "$(has_bili "$name")" != "1" ]; then forced_onto_off="$forced_onto_off $name"; fi
done
for name in $plain_flavor_profiles; do
  if [ "$(has_bili "$name")" = "1" ]; then forced_off_of_on="$forced_off_of_on $name"; fi
done
if [ "$billion_context_mode" = "on" ] && [ -z "$bili_flavor_profiles" ]; then
  echo "  注意：--billion-context=on 但按名单没有任何 profile 挂着 billion-context —— 仍按 on 装注入版，" >&2
  echo "    请确认这些 profile 之后会装上 billion-context（否则委派给专家会失败：names unknown global tool）。" >&2
fi
if [ -n "$forced_onto_off" ]; then
  echo "  注意：--billion-context=on 强制注入，但这些目标 profile 没挂 bili：${forced_onto_off# } ——" >&2
  echo "    它们每一次委派都会抛 names unknown global tool \"compress\"（要么装上 bili，要么改回 auto）。" >&2
fi
if [ -n "$forced_off_of_on" ]; then
  echo "  注意：--billion-context=off 强制不注入，但这些目标 profile 挂着 bili：${forced_off_of_on# } ——" >&2
  echo "    它们的专家会收到 bili 的压缩指令却没有工具可调（改回 auto 才会按 profile 选味道）。" >&2
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

# ── 3. preset bundle：两种味道各生成 → 各落到自己的稳定位置（每 profile 只 link 一份）──
# 源文件永远只有 preset/preset.yml + preset/agent.cordis.yml；bundle/adg-*/ 是构建产物
# （在 .gitignore 里），每次安装都重新生成，所以没有人需要手改 patch。
# bili 的上下文工具只进生成物、不进源文件：源文件得对没装 billion-context 的人也成立（见 --with-billion-context 说明）。
# **两份都无条件生成**：省掉"这一跑要不要重建那一份"的判断，稳定目录里的形状永远等于它该有的形状。
# outDir 传绝对路径：gen 脚本用的是 process.cwd()，不能跟着"用户从哪个目录调用本脚本"漂。
node "$here/tools/gen-preset-bundle.mjs" "$here/bundle/adg-plain"
node "$here/tools/gen-preset-bundle.mjs" "$here/bundle/adg-preset" --with-billion-context

# $DSH_HOME/bundles/ 是稳定位置：profile 只引用这里，仓库可以随便挪/删。
rm -rf "$bundle_stable"
mkdir -p "$bundle_stable"
cp "$here/bundle/adg-plain/cordis.patch.yml" "$bundle_stable/cordis.patch.yml"
cp "$here/bundle/adg-plain/package.json" "$bundle_stable/package.json"
rm -rf "$bundle_bili_stable"
mkdir -p "$bundle_bili_stable"
cp "$here/bundle/adg-preset/cordis.patch.yml" "$bundle_bili_stable/cordis.patch.yml"
cp "$here/bundle/adg-preset/package.json" "$bundle_bili_stable/package.json"

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
  # 这个 profile 该拿哪一种味道的稳定目录（见上面第 0 节的 flavor_of）。换味道也只在这一步发生：
  # 同一个包名 link: 到另一个目录，profile 的 dsh.profile.bundles 一行都不用改（两种味道包名相同）。
  flavor="$(flavor_of "$name")"
  if [ "$flavor" = "bili" ]; then want_bundle="$bundle_bili_stable"; else want_bundle="$bundle_stable"; fi
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
  # 判据不能是"包在不在"：两种味道的 package.json 逐字节相同、包名也一样，只有产物本体不同 ——
  # 所以让 tools/check-bundle-flavor.mjs 逐行验 9 个专家行的 allow 与 compaction-basic 的 auto。
  # 这一格是本缺陷的"静默失效"出口：味道换错时一切看起来都正常，只有专家的工具目录少四个名字。
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
    echo "  profile -> $name : 落点味道 ≠ $flavor —— 链接到的还是另一种味道（换味道那一步没成功；专家会看不到或看不见 bili 的上下文工具）" >&2
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
echo "  bundle  -> $bundle_stable（plain：生成物来自 preset/preset.yml + preset/agent.cordis.yml，不带 bili 工具）"
echo "  bundle  -> $bundle_bili_stable（注入版：9 个专家的 allow 里带 bili 的四个上下文工具 + compaction-basic auto: false）"
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