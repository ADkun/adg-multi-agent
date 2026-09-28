#!/usr/bin/env node
// 生成物自检：钉住 tools/gen-preset-bundle.mjs 的**产物**里 billion-context 那四个名字的有无。
//
// 为什么单独一个脚本：根 AGENTS.md 红线 7 要求 allow 里只能是已注册的名字，红线 11 要求那几个名字
// **只能出现在生成物里**。而 `tools/check-preset.mjs` 读的是**源文件**（`- id: agent-*` 在第 4 列），
// 生成物里它们被整体缩进到第 14 列 —— 同一套正则照搬过去会一行都匹配不到，于是"生成物没注入 / 注错"
// 这件事在质量门里是**盲区**。本脚本补的就是这一格：它只认生成物，且**自己探测缩进**，
// 这样 gen 脚本以后改缩进（ITEM_INDENT）也不会假绿。
//
// 用法：
//   node tools/check-bundle-flavor.mjs <cordis.patch.yml> plain   # 断言：九行里一个 bili 名字都没有
//   node tools/check-bundle-flavor.mjs <cordis.patch.yml> bili    # 断言：每个专家行四个名字全有
// 退出码：0 通过 / 1 不通过 / 2 用法或文件错误。零依赖（按行扫，不解析 YAML）。
import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

/** gen 脚本注入的那四个名字 —— 必须与 tools/gen-preset-bundle.mjs 的清单逐字一致。 */
const BILLION_CONTEXT_TOOLS = ['compress', 'decompress', 'search_context', 'acp_status']
/** 明确不注入的那个：账本诊断，归调度者。出现在生成物里就该被看到，而不是被当成"注入清单没同步"。 */
const NOT_INJECTED = ['acp_cache']

const indentOf = (line) => line.length - line.replace(/^\s+/, '').length

const [file, mode] = process.argv.slice(2)
if (!file || (mode !== 'plain' && mode !== 'bili')) {
  process.stderr.write('用法：node tools/check-bundle-flavor.mjs <cordis.patch.yml> <plain|bili>\n')
  process.exit(2)
}
if (!existsSync(file)) {
  process.stderr.write(`文件不存在：${file}\n`)
  process.exit(2)
}

const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
const errors = []
const report = []

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
  const have = BILLION_CONTEXT_TOOLS.filter((t) => items.includes(t))
  const state = have.length === BILLION_CONTEXT_TOOLS.length ? 'ALL' : have.length === 0 ? 'NONE' : 'PARTIAL'
  report.push(`${toolName}[${items.length}]=${state}`)
  if (mode === 'bili' && state !== 'ALL') {
    errors.push(`${row.id}（${toolName}）：bili 模式期望四个名字全有，实际 ${have.length ? have.join(' / ') : '一个都没有'}`)
  }
  if (mode === 'plain' && have.length > 0) {
    errors.push(`${row.id}（${toolName}）：plain 模式不该出现 bili 工具，实际有 ${have.join(' / ')}`)
  }
  const leaked = NOT_INJECTED.filter((t) => items.includes(t))
  if (leaked.length > 0) errors.push(`${row.id}（${toolName}）：${leaked.join(' / ')} 不在注入清单里（gen 脚本与本脚本的清单需对齐）`)
}

for (const line of report) process.stdout.write(`  ${line}\n`)
if (errors.length > 0) {
  for (const e of errors) process.stdout.write(`ERROR ${e}\n`)
  process.stdout.write(`不通过：${errors.length} 个错误（${mode} 模式 / ${report.length} 个专家行）\n`)
  process.exit(1)
}
process.stdout.write(`通过：${report.length} 个专家行，${mode} 模式断言成立\n`)
