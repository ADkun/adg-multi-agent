#!/usr/bin/env node
// tools/has-billion-context.mjs —— 一个 profile 到底算不算"挂着 billion-context"，两处安装脚本共用一份判据。
//
// 为什么单独一个文件：这条判据决定安装侧的两件事 ——
//   1. preset 生成物要不要给专家的 toolFilter.allow 追加 bili 的上下文工具（见 gen-preset-bundle.mjs）；
//   2. 这个 profile 该拿 plain 还是 bili 那份生成物（两处安装脚本按 profile 选味道）。
// **它不再决定"要不要启用配套插件 dsh-adg-token-budget"**：2026-10 用户决定挂着 bili 也一律启用
// （此前"挂了 bili 就不启用"已推翻）。所以现在的口径是**单向**的，不存在"方向相反的两个决策"。
// 判据写成两份（install.ps1 一份、install.sh 一份）迟早会漂，漂了的后果不是"少个能力"就是"专家一委派
// 就抛 names unknown global tool"，所以两边都调这里。
//
// 用法：node tools/has-billion-context.mjs <profilesDir> <profile> [<profile> ...]
// 输出：每个 profile 一行 `<name>\t<0|1>`（1 = 挂着）。退出码恒 0（读不到清单就是 0，不报错）：
// 装不装得下去由调用方决定，这里只回答事实。
//
// 判据两条都要成立：
//   - 包名在 `dsh.profile.bundles` 里（只有 node_modules 里的包而没被选中 = dsh 根本不读它的 patch 层；
//     只有列表没有包 = dsh 启动时报"未安装的 bundle"）；
//   - 装上的那份包里真的有 `dsh.bundle.patch.yml`（挂载行由那一层提供，缺了它这个包只是普通依赖，
//     里面也就没有任何工具被注册）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [profilesDir, ...profiles] = process.argv.slice(2)
if (!profilesDir || profiles.length === 0) {
  process.stderr.write('用法：node tools/has-billion-context.mjs <profilesDir> <profile> [...]\n')
  process.exit(2)
}

for (const name of profiles) {
  let selected = false
  try {
    const json = JSON.parse(readFileSync(join(profilesDir, name, 'package.json'), 'utf8'))
    const bundles = (json.dsh && json.dsh.profile && json.dsh.profile.bundles) || []
    selected = Array.isArray(bundles) && bundles.includes('billion-context')
  } catch {
    selected = false
  }
  const hasPatchLayer = existsSync(join(profilesDir, name, 'node_modules', 'billion-context', 'dsh.bundle.patch.yml'))
  process.stdout.write(`${name}\t${selected && hasPatchLayer ? 1 : 0}\n`)
}
