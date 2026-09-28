#!/usr/bin/env sh
# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： sh install.sh [profile ...]      不带参数 = 所有能装 preset 的 profile
#
# 2026-09-28 重写：dsh 0.1.7-rc.2 起 `$DSH_HOME/.agent-presets/<id>/` 那套目录发现机制已被移除，
# 旧的"拷 preset.yml + agent.cordis.yml"装法装出来的东西**没有任何组件会去读**。现在的形状是
# 一个 bundle：包清单声明 dsh.bundle.patch，patch 里 insert 一行 @deepseek-ai/dsh-agent-preset
# 声明（id/name/description/order/plugins）。本脚本：生成 bundle → 放到 $DSH_HOME/bundles/ →
# 装进目标 profile 的 node_modules 并写进该 profile 的 dsh.profile.bundles。
# 插件 dsh-adg-token-budget 自 2026-09-28 起是**同一个形状**：它的挂载行由包自己的
# cordis.patch.yml 提供（旧装法是把行手贴进 profile 的 patch 层，那条路已废弃，脚本只负责报告残留）。
set -eu

root="${DSH_HOME:-$HOME/.dsh}"
here="$(cd "$(dirname "$0")" && pwd)"
bundle_name='dsh-adg-preset'
plugin_name='dsh-adg-token-budget'
bundle_stable="$root/bundles/$bundle_name"
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
    plugin_stable="$root/bundles/$plugin_name"
    plugin_legacy_stable="$root/plugins/$plugin_name"
    ;;
esac

# ── 目标 profile ────────────────────────────────────────────────────────────────
# 默认：能装 preset 的所有 profile —— 判据是它的 bundle 列表里有 @deepseek-ai/dsh-web-app，
# 因为 agent-preset-registry（agentPresets 服务）正是这个 bundle 声明的（实测：dsh-base 和
# dsh-headless 都不声明它）。往缺 registry 的 profile 里塞声明行会让该 profile 启动失败。
profiles=""
package_failed=0
if [ "$#" -gt 0 ]; then
  profiles="$*"
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

# ── 3. preset bundle：生成 → 落到稳定位置 → 装进 profile ───────────────────────
# 源文件永远只有 preset/preset.yml + preset/agent.cordis.yml；bundle/adg-preset/ 是构建产物
# （在 .gitignore 里），每次安装都重新生成，所以没有人需要手改 patch。
node "$here/tools/gen-preset-bundle.mjs"

# $DSH_HOME/bundles/ 是稳定位置：profile 只引用这里，仓库可以随便挪/删。
rm -rf "$bundle_stable"
mkdir -p "$bundle_stable"
cp "$here/bundle/adg-preset/cordis.patch.yml" "$bundle_stable/cordis.patch.yml"
cp "$here/bundle/adg-preset/package.json" "$bundle_stable/package.json"

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
  pnpm_failed=0
  if command -v pnpm >/dev/null 2>&1; then
    if (cd "$profile_dir" && pnpm add "link:$bundle_stable" "link:$plugin_stable"); then
      echo "  profile -> $name : 已 link $bundle_name + $plugin_name"
    else
      pnpm_failed=1
      echo "  profile -> $name : pnpm add 失败 —— 常见原因是 dsh 正在运行、node_modules 被占用；关掉 dsh 后重跑本脚本" >&2
    fi
  else
    pnpm_failed=1
    echo "  profile -> $name : 未找到 pnpm，跳过依赖安装 —— 请在该 profile 里执行 pnpm add link:$bundle_stable link:$plugin_stable"
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
  if [ -f "$patch_file" ] && grep -Eq '^[[:space:]]*- id: adg-token-budget' "$patch_file"; then
    echo "  patch   -> $name : $patch_file 里还有旧机制手贴的挂载行 —— 请删掉，这一行现在由 bundle 层提供；不删则 profile 层会整块替换掉 bundle 行的 config"
  fi
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
      echo "  patch   -> $name : 已把 $plugin_name 加进 dsh.profile.bundles（挂载行来自 ${verdict#added:}，原文件备份 $manifest.bak-adg-token-budget）"
      ;;
    *)
      echo "  patch   -> $name : $plugin_name 已在 dsh.profile.bundles 里（挂载行来自 ${verdict#present:}）"
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
echo "  bundle  -> $bundle_stable（生成物来自 preset/preset.yml + preset/agent.cordis.yml）"
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