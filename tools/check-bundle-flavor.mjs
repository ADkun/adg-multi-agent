#!/usr/bin/env node
// 生成物自检：钉住 tools/gen-preset-bundle.mjs 的**产物**里，每个注入组的工具名有无，
// 以及 preset realm 那份 compaction-basic 的 `config.auto` 该不该在。
//
// 为什么单独一个脚本：根 AGENTS.md 红线 7 要求 allow 里只能是已注册的名字，红线 10 要求那些名字
// **只能出现在生成物里**。而 `tools/check-preset.mjs` 读的是**源文件**（`- id: agent-*` 在第 4 列），
// 生成物里它们被整体缩进到第 14 列 —— 同一套正则照搬过去会一行都匹配不到，于是"生成物没注入 / 注错 /
// 注成别的味道"这件事在质量门里是**盲区**。本脚本补的就是这一格：它只认生成物，且**自己探测缩进**，
// 这样 gen 脚本以后改缩进（ITEM_INDENT）也不会假绿。
//
// 味道（flavor）= 生成时带了哪些注入组，四种：`plain` / `bili` / `save-token` / `bili+save-token`。
// 组表、工具名、目录名都在 tools/flavors.mjs（单一事实来源）—— 本脚本不另抄一份清单，
// 抄了就会漂，而漂的后果是"委派全部抛 names unknown global tool"或"专家收到通知却没有工具"。
//
// 用法：
//   node tools/check-bundle-flavor.mjs <cordis.patch.yml> plain              # 断言：一个注入名都没有，且 compaction-basic 没有 config.auto
//   node tools/check-bundle-flavor.mjs <cordis.patch.yml> bili               # 断言：bili 四个名字全有，且 compaction-basic 是 config.auto: false
//   node tools/check-bundle-flavor.mjs <cordis.patch.yml> save-token         # 断言：save_token_expand 全有，且没有 config.auto
//   node tools/check-bundle-flavor.mjs <cordis.patch.yml> bili+save-token    # 两组的并集
// 退出码：0 通过 / 1 不通过 / 2 用法或文件错误。零依赖（按行扫，不解析 YAML）。
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import {
  GROUP_ORDER,
  INJECTION_GROUPS,
  autoCompactionOffFor,
  flavorKeys,
  notInjectedFor,
  parseFlavorKey,
} from './flavors.mjs'

const indentOf = (line) => line.length - line.replace(/^\s+/, '').length

const [file, flavor] = process.argv.slice(2)
if (!file || !flavor) {
  process.stderr.write(`用法：node tools/check-bundle-flavor.mjs <cordis.patch.yml> <${flavorKeys().join('|')}>\n`)
  process.exit(2)
}
let groups
try {
  groups = parseFlavorKey(flavor)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
}
if (!existsSync(file)) {
  process.stderr.write(`文件不存在：${file}\n`)
  process.exit(2)
}

const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
const errors = []
const report = []
/** 所有组里**故意不注入**的名字并集：出现在生成物里就该被看到（而不是被当成"注入清单没同步"）。 */
const NEVER_INJECTED = notInjectedFor(GROUP_ORDER)

// 专家行的形状：`<行缩进>- id: agent-<名>`，且这一行内部有 `toolName:`（`agent-instructions` 那行没有，靠它排除）。
// 缩进**自己探测**：源文件里专家行在第 4 列，生成物里被整体推进到第 14 列（gen 的 ITEM_INDENT）——
// 写死一个数字就是假绿：换文件时一行都匹配不到，却照样"通过"。
const rowRe = /^(\s*)- id: (agent-[a-z0-9-]+)\s*$/
const starts = []
for (let i = 0; i < lines.length; i += 1) {
  const m = rowRe.exec(lines[i])
  if (m) starts.push({ index: i, id: m[2], indent: m[1].length })
}
if (starts.length === 0) {
  process.stderr.write(`一个专家行都没找到：${file}（期望形如 "<缩进>- id: agent-xxx"）\n`)
  process.exit(1)
}

for (const [n, row] of starts.entries()) {
  const stop = n + 1 < starts.length ? starts[n + 1].index : lines.length
  const body = lines.slice(row.index, stop)
  const toolName = body.map((l) => /^\s+toolName:\s*(\S+)/.exec(l)).find(Boolean)?.[1]
  if (!toolName) continue // 不是名册行（例如 agent-instructions）
  const allowIdx = body.findIndex((l) => /^\s+allow:\s*$/.test(l))
  if (allowIdx < 0) {
    errors.push(`${row.id}（${toolName}）没有 toolFilter.allow 名单`)
    continue
  }
  const allowIndent = indentOf(body[allowIdx])
  const items = []
  for (const l of body.slice(allowIdx + 1)) {
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue
    if (indentOf(l) <= allowIndent) break
    const m = /^\s*-\s*(.+?)\s*$/.exec(l)
    if (!m) break
    items.push(m[1])
  }

  // 逐组断言：该在的组必须**全有**（少一个 = 专家收到"去调它"的指令却没有工具），
  // 不该在的组必须**一个都没有**（多一个 = 那个 profile 里每一次委派当场抛 unknown global tool）。
  const marks = []
  for (const group of GROUP_ORDER) {
    const spec = INJECTION_GROUPS[group]
    const have = spec.tools.filter((t) => items.includes(t))
    const state = have.length === spec.tools.length ? 'ALL' : have.length === 0 ? 'NONE' : 'PARTIAL'
    if (groups.includes(group)) {
      marks.push(`${group}:${state}`)
      if (state !== 'ALL') {
        errors.push(`${row.id}（${toolName}）：味道 ${flavor} 要求 ${group} 组的 ${spec.tools.join(' / ')} 全有，实际 ${have.length ? have.join(' / ') : '一个都没有'}`)
      }
    } else if (have.length > 0) {
      marks.push(`${group}:LEAK`)
      errors.push(`${row.id}（${toolName}）：味道 ${flavor} 不含 ${group} 组，不该出现 ${have.join(' / ')}`)
    }
  }
  report.push(`${toolName}[${items.length}]=${marks.length > 0 ? marks.join(' ') : 'NONE'}`)

  const leaked = NEVER_INJECTED.filter((t) => items.includes(t))
  if (leaked.length > 0) errors.push(`${row.id}（${toolName}）：${leaked.join(' / ')} 不在任何注入清单里（gen 脚本与 tools/flavors.mjs 的清单需对齐）`)
}

// ── compaction：挂 bili 时 preset realm 里的自动压缩必须被关掉 ──────────────────
// 判据用的是 bili 自己的键 `config.auto`（billion-context 的 dsh.bundle.patch.yml 就是这么写的，
// 它打的是 profile 层；本 preset 的 compaction 三行活在 isolate 出来的 realm 里，是**另一份实例**，
// 所以生成物里要再写一遍）。值必须恰好是 `false`：
//   - 要求关的组在（bili）：`auto: false` 在 ⇒ 关掉自动压缩与溢出恢复（手动 /compact 仍可用）；
//                缺这个键 ⇒ 专家一边被 bili 的 nudge 催着压缩，一边 dsh 还在自己折叠同一段历史。
//   - 不含该组（plain / save-token）：绝对不能有 ⇒ 那两种 profile 里，dsh 自带的自动压缩是**唯一**
//                的压缩手段，关掉等于让上下文无限增长（这正是"多种味道"必须分开断言的原因）。
// 缩进同样自探测：源文件/生成物里这一行的列数不同，写死就是假绿。
const compRe = /^(\s*)- id: compaction-basic\s*$/
let compIndex = -1
let compIndent = 0
for (let i = 0; i < lines.length; i += 1) {
  const m = compRe.exec(lines[i])
  if (m) {
    compIndex = i
    compIndent = m[1].length
    break
  }
}
const autoExpected = autoCompactionOffFor(groups)
if (compIndex < 0) {
  errors.push('找不到 `- id: compaction-basic` 行：compaction 组被改动或那一行被删了')
} else {
  let auto = null
  for (let i = compIndex + 1; i < lines.length; i += 1) {
    const l = lines[i]
    if (l.trim() === '') continue
    if (indentOf(l) <= compIndent) break
    if (l.trimStart().startsWith('#')) continue
    const m = /^\s*auto:\s*(\S+)\s*$/.exec(l)
    if (m) auto = m[1].replace(/^["']|["']$/g, '')
  }
  report.push(`compaction-basic[auto=${auto ?? '未写'}]`)
  if (autoExpected && auto !== 'false') {
    errors.push(`compaction-basic：味道 ${flavor} 要求 config.auto: false（挂 bili 时关掉 dsh 自带自动压缩），实际 ${auto === null ? '没有这个键' : `auto: ${auto}`}`)
  }
  if (!autoExpected && auto !== null) {
    errors.push(`compaction-basic：味道 ${flavor} 不该有 config.auto（没挂 bili 时它是唯一的压缩手段），实际 auto: ${auto}`)
  }
}

for (const line of report) process.stdout.write(`  ${line}\n`)
if (errors.length > 0) {
  for (const e of errors) process.stdout.write(`ERROR ${e}\n`)
  process.stdout.write(`不通过：${errors.length} 个错误（${flavor} 味道 / ${report.length} 行报告）\n`)
  process.exit(1)
}
process.stdout.write(`通过：${report.length} 行报告，${flavor} 味道断言成立（注入组：${groups.length > 0 ? groups.join(' + ') : '无'}）\n`)