#!/usr/bin/env sh
# 安装 Adg 多智能体模式 preset + 配套技能 + 步数收敛检查点插件到本机 dsh 用户根。
# 用法： sh install.sh [profile ...]      不带参数 = 所有能装 preset 的 profile
#
# 2026-09-28 重写：dsh 0.1.7-rc.2 起 `$DSH_HOME/.agent-presets/<id>/` 那套目录发现机制已被移除，
# 旧的"拷 preset.yml + agent.cordis.yml"装法装出来的东西**没有任何组件会去读**。现在的形状是
# 一个 bundle：包清单声明 dsh.bundle.patch，patch 里 insert 一行 @deepseek-ai/dsh-agent-preset
# 声明（id/name/description/order/plugins）。本脚本：生成 bundle → 放到 $DSH_HOME/bundles/ →
# 装进目标 profile 的 node_modules 并写进该 profile 的 dsh.profile.bundles。
set -eu

root="${DSH_HOME:-$HOME/.dsh}"
here="$(cd "$(dirname "$0")" && pwd)"
bundle_name='dsh-adg-preset'
plugin_name='dsh-adg-token-budget'
bundle_stable="$root/bundles/$bundle_name"
plugin_stable="$root/plugins/$plugin_name"

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
    plugin_stable="$root/plugins/$plugin_name"
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

# ── 4. 插件：拷到稳定位置（同上去掉仓库依赖），挂载行写进 profile 自己的 patch 层 ──
plugin_src="$here/plugin/$plugin_name"
rm -rf "$plugin_stable"
mkdir -p "$plugin_stable"
cp -R "$plugin_src/package.json" "$plugin_src/src" "$plugin_src/README.md" "$plugin_src/examples" "$plugin_src/LICENSE" "$plugin_stable/"

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

  # 4c. 挂载行写进该 profile 自己的 patch 层（热重载），不动机器级的 $root/cordis.patch.yml：
  # 机器级那一层套在每个 profile 上（web / headless / sdk / 自建），而这个插件只对 adg preset 的
  # 子代理生效，装到机器级等于让每个 profile 都去 import 它。要全机生效就把同一行搬过去。
  # 同一个判据管插件行：包不在 node_modules 里就只报告、不写挂载行。
  if [ ! -f "$profile_dir/node_modules/$plugin_name/package.json" ]; then
    echo "  patch   -> $name : $plugin_name 还没装进这个 profile 的 node_modules —— 未注册挂载行"
    continue
  fi
  patch_file="$profile_dir/cordis.patch.yml"
  if [ ! -f "$patch_file" ]; then
    echo "  patch   -> $name : 未找到 $patch_file，跳过挂载行注册（请手工把 plugin/$plugin_name/examples/cordis.patch.yml 的行贴上去）"
    continue
  fi
  if grep -q "$plugin_name" "$patch_file"; then
    echo "  patch   -> $name : 挂载行已在 cordis.patch.yml 里（未改动；enabled 的值以该文件为准）"
    continue
  fi
  cp "$patch_file" "$patch_file.bak-adg-token-budget"
  # 全新 profile 的 patch 层是空数组字面量 `[]`：把它换成我们的块。已被手工改过的文件
  # （末行不是 `[]`）就按追加处理，不再要求"末行必须是 []"。
  {
    if [ "$(tail -n 1 "$patch_file" | tr -d '[:space:]')" = '[]' ]; then
      sed '$d' "$patch_file"
    else
      cat "$patch_file"
    fi
    printf '%s\n' \
      '# 步数收敛检查点：按 4/8/12/…/280 的阶梯给 Adg 专家子代理注入可选收敛提醒。' \
      '# 提醒是"自己选：收尾汇报 or 继续做完必需的工作"，不是停止指令——阶梯提前加密度就是靠这一点才安全。' \
      '# 按累计 token 介入的两档（软档收尾提醒 + 硬档 agent.cancel）已整体移除：输出型任务本来就需要那么多 token，' \
      '#   按阈值砍只会截断产出。插件现在既不注入任何 token 触发的消息，也从不 agent.cancel（详见 README）。' \
      '# enabled: false 表示已挂载但不动作。改 config: 热重载立即生效；但换过 src/ 里的代码之后必须重启 dsh' \
      '# （已实测：热重载只重放 config，不会重新 import 已经加载过的模块）。' \
      '# 推荐上线顺序：enabled: true + dryRun: true 校准 → dryRun: false（提醒真的注入）。没有硬档要武装了。' \
      '# 想调措辞：写 stepText（config: 改动，热重载、不用重启）；激活行会写 stepText=builtin|custom。' \
      '- insert:' \
      '    - id: adg-token-budget' \
      "      name: '$plugin_name'" \
      '      config:' \
      '        enabled: false' \
      "        presets: ['adg']" \
      '        stepNudge: true' \
      '        stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]' \
      "        logFile: '$root/adg-token-budget.log'"
  } > "$patch_file.tmp-adg-token-budget"
  mv "$patch_file.tmp-adg-token-budget" "$patch_file"
  echo "  patch   -> $name : 已加入挂载行（enabled: false），原文件备份为 $patch_file.bak-adg-token-budget"
done

echo "已安装到 dsh 用户根：$root"
echo "  skill   -> $root/skills/adg-add-agent"
echo "  bundle  -> $bundle_stable（生成物来自 preset/preset.yml + preset/agent.cordis.yml）"
echo "  plugin  -> $plugin_stable"
echo "  browser -> $browser_note"
echo ""
echo "下一步：重启 dsh，然后在新建对话里选择「Adg 多智能体模式」。"
echo "（preset 走的是一条独立的 patch 层：dsh --profile <name> --dump-config 能确认它被读到，"
echo "  但只有真的新建一个会话才算挂载成功 —— 静态文件与 --dump-config 都证明不了挂载。）"
echo "（插件行是另一回事：profile 的 cordis.patch.yml 改 config: 热重载、不用重启；"
echo "  但换过插件 src/ 里的代码之后必须重启 —— 热重载不会重新 import 已加载的模块。）"
echo "（browser/ 工具链又是另一回事：用户根下的普通文件，重新跑本脚本即生效，不用重启 dsh。）"
if [ "$package_failed" -eq 1 ]; then
  echo ""
  echo "注意：至少有一步 pnpm 没成功，preset bundle 可能还没装进 profile（上面的 profile 行里写明了）。" >&2
  echo "先关掉正在运行的 dsh（它占着 node_modules 里的文件，pnpm 无法重建目录），再重跑本脚本。" >&2
  exit 2
fi