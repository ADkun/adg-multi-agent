#!/usr/bin/env node
// 校验 Adg preset 的 `agent.cordis.yml`（以及安装到本机的那一份）。
//
// 检查项来自技能 `adg-add-agent` 的硬约束与实测事实：
//   1. LF 行尾 + 文件末尾有换行（仓库 .gitattributes 保证跨平台逐字节一致）；
//   2. 每个专家行都齐全：provider / toolName / backgroundMode / persona / toolFilter.allow；
//   3. toolName 全局唯一，且形如 `agent_<name>`；
//   4. allow 名单只写"已注册的工具名"—— dsh-tools 的 restrict() 遇到未知名会直接抛错
//      （`names unknown global tool ...`），所以这里提前拦下来；条件性注册的名字
//      （bash / read_image）与策略越界（workflow / ralph）只给提示 —— 判错只留给
//      "这次委派必然抛错"的情形；
//   5. 不存在通用 `subagent` / `subagent_fork` 委派行；
//   6. 文件顶部调度 persona 的名册与专家行一一对应（双向，不能只加行不改名册）。
//
// 用法：
//   node tools/check-preset.mjs                                  # 校验仓库里的 preset/
//   node tools/check-preset.mjs <path-to-agent.cordis.yml>       # 校验任意一份（如已安装的那份）
//
// 零依赖：本文件按行做结构化解析，不引入 YAML 库（文件形状由本仓库自己固定）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(process.argv[2] ?? join(here, '..', 'preset', 'agent.cordis.yml'))

/**
 * 本 preset 组合里注册过的工具名（专家 allow 名单的合法取值）。
 * 依据：本文件的 `role/preset` 行 + 专家名册自身。改 composition 的 tool 行时同步这里。
 * 刻意不含 `subagent` / `subagent_fork` / `workflow` / `ralph`：它们不该出现在专家名单里
 * （前两个是硬约束，后两个只留给调度智能体）。
 */
const KNOWN_TOOLS = new Set([
  // shell（tool-bash / tool-pwsh，按平台二选一）
  'bash',
  'pwsh',
  // filesystem（tool-fs / tool-fs-search）
  'read',
  'write',
  'edit',
  'read_image',
  'glob',
  'grep',
  // background jobs（tool-jobs）
  'job_list',
  'job_output',
  'job_kill',
  // skills / goals / plan mode
  'skill',
  'create_goal',
  'get_goal',
  'update_goal',
  // delegation control（tool-subagent-control）
  'list_agents',
  'send_message',
  'interrupt_agent',
  // remaining model-facing rows
  'ask_user_question',
  'todo_write',
  'web_search',
  'web_fetch',
  'present',
])

/**
 * 条件性注册的名字：通常都在，但缺条件时根本没注册，写进 allow 会让那一次委派直接抛
 * `names unknown global tool`。静态检查求值不了 `!!js`，也判断不了服务是否挂载，所以只提示。
 */
const CONDITIONAL_TOOLS = new Map([
  ['bash', 'Windows 上 tool-bash 被 disabled 行关掉（只在非 win32 注册）'],
  ['read_image', '依赖 attachments 服务（base 组合里恒有），服务缺失时不注册'],
  ['subagent_codex', '对应的 disabled 行没启用时不注册'],
  ['subagent_claude_code', '对应的 disabled 行没启用时不注册'],
])

/**
 * 只对调度智能体开放：专家拿到它就能绕开名册再开一个不受限的子代理。
 * 注意这是策略问题而不是"必然抛错"——这两个名字在本组合里确实注册了，restrict() 会接受。
 */
const SCHEDULER_ONLY = new Set(['workflow', 'ralph'])

const errors = []
const warnings = []
const fail = (message) => errors.push(message)
const warn = (message) => warnings.push(message)
const indentOf = (line) => line.length - line.trimStart().length

function readTarget() {
  try {
    return readFileSync(target)
  } catch (error) {
    console.error(`无法读取 ${target}：${error.message}`)
    process.exit(2)
  }
}

const raw = readTarget()
const text = raw.toString('utf8')
// 解析用归一化后的行：CRLF 文件要先把 `\r` 去掉，否则 `.` 不匹配 `\r`，
// 所有 `key: value` 正则都会静默失效（实测踩过）。行尾问题由下面的检查单独报。
const lines = text.replace(/\r\n/g, '\n').split('\n')

// ── 1. 行尾与末尾换行 ──────────────────────────────────────────────────────
if (text.includes('\r')) fail('出现 CR（\\r）：文件必须只用 LF 行尾')
if (!text.endsWith('\n')) fail('文件末尾缺少换行（LF）')
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fail('文件带 UTF-8 BOM：composition 不应带 BOM')

// ── 2/3/4. 专家行 ──────────────────────────────────────────────────────────
/** @type {{id:string,line:number,toolName?:string,allow:string[],hasPersona:boolean,personaChars:number,provider?:string,backgroundMode?:string}[]} */
const rows = []
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]
  const start = /^ {4}- id: (agent-[a-z0-9-]+)\s*$/.exec(line)
  if (start === null) continue
  const row = {
    id: start[1],
    line: index + 1,
    allow: [],
    hasPersona: false,
    personaChars: 0,
  }
  const rowIndent = indentOf(line)
  let allowIndent = -1
  let personaIndent = -1
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const inner = lines[cursor]
    if (inner.trim() === '') continue
    const innerIndent = indentOf(inner)
    if (innerIndent <= rowIndent && inner.trimStart().startsWith('- id:')) break
    if (innerIndent <= rowIndent && !inner.startsWith(' ')) break
    if (personaIndent >= 0 && innerIndent > personaIndent) {
      row.personaChars += inner.trim().length
      continue
    }
    personaIndent = -1
    if (allowIndent >= 0 && /^\s+- \S/.test(inner) && innerIndent > allowIndent) {
      row.allow.push(inner.trim().replace(/^- /, ''))
      continue
    }
    allowIndent = -1
    const key = /^(\s+)([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(inner)
    if (key === null) continue
    const [, spaces, name, rest] = key
    const base = innerIndent
    if (name === 'toolName') row.toolName = rest.trim()
    else if (name === 'provider') row.provider = rest.trim()
    else if (name === 'backgroundMode') row.backgroundMode = rest.trim()
    else if (name === 'persona') {
      row.hasPersona = rest.trim() === '|-' || rest.trim() === '|'
      personaIndent = base
    } else if (name === 'allow') {
      allowIndent = base
      void spaces
    }
  }
  rows.push(row)
}

if (rows.length === 0) fail('没有解析到任何专家行（期望形如 `    - id: agent-file`）')

const seen = new Map()
for (const row of rows) {
  if (row.toolName === undefined) fail(`第 ${row.line} 行 ${row.id}：缺少 toolName`)
  else if (!/^agent_[a-z0-9_]+$/.test(row.toolName)) fail(`第 ${row.line} 行 ${row.id}：toolName "${row.toolName}" 不符合 agent_<name> 约定`)
  if (row.toolName !== undefined) {
    if (seen.has(row.toolName)) fail(`toolName "${row.toolName}" 重复（第 ${seen.get(row.toolName)} 行与第 ${row.line} 行）：每个委派工具名必须全局唯一`)
    else seen.set(row.toolName, row.line)
  }
  if (row.provider !== 'spawn') fail(`第 ${row.line} 行 ${row.id}：provider 应为 spawn，实际 ${String(row.provider)}`)
  if (row.backgroundMode !== 'continuable') warn(`第 ${row.line} 行 ${row.id}：backgroundMode 不是 continuable（专家默认后台接续）`)
  if (!row.hasPersona) fail(`第 ${row.line} 行 ${row.id}：缺少 persona`)
  else if (row.personaChars < 60) warn(`第 ${row.line} 行 ${row.id}：persona 只有 ${row.personaChars} 字，可能没写清边界与越界处理`)
  if (row.allow.length === 0) fail(`第 ${row.line} 行 ${row.id}：toolFilter.allow 为空`)
  for (const tool of row.allow) {
    if (SCHEDULER_ONLY.has(tool)) {
      warn(`第 ${row.line} 行 ${row.id}：allow 里的 "${tool}" 是策略越界——它只留给调度智能体（restrict() 会接受它、不会让委派失败，但专家拿到就能绕开名册开任意代理）`)
      continue
    }
    if (KNOWN_TOOLS.has(tool)) {
      const reason = CONDITIONAL_TOOLS.get(tool)
      if (reason !== undefined) {
        warn(`第 ${row.line} 行 ${row.id}：allow 里的 "${tool}" 是条件性注册的名字（${reason}）——条件不满足时这一次委派会抛 names unknown global tool`)
      }
      continue
    }
    // 允许把别的专家的 `agent_*` 名字写进 allow：这是"让某个专家能直接转交"的官方开关。
    if (seen.has(tool)) continue
    fail(`第 ${row.line} 行 ${row.id}：allow 里的 "${tool}" 不是本组合注册过的工具名——restrict() 会抛 "names unknown global tool"`)
  }
}

// ── 5. 通用委派行 ──────────────────────────────────────────────────────────
for (const [index, line] of lines.entries()) {
  const generic = /^\s+toolName:\s*(subagent|subagent_fork)\s*$/.exec(line)
  if (generic !== null) fail(`第 ${index + 1} 行出现通用委派工具 "${generic[1]}"：专家会绕过自己的范围再开不受限子代理`)
}

// ── 6. 调度名册 ↔ 专家行 ──────────────────────────────────────────────────
const declared = [...seen.keys()]
const prefixStart = lines.findIndex((line) => /^\s+prefix: \|-/.test(line))
if (prefixStart < 0) fail('没找到顶部 persona 的 prefix: |- block（调度名册应当写在这里）')
else {
  const block = []
  for (let cursor = prefixStart + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line.trim() !== '' && indentOf(line) <= indentOf(lines[prefixStart])) break
    block.push(line)
  }
  const roster = block.join('\n')
  for (const toolName of declared) {
    if (!roster.includes(toolName)) fail(`调度名册里没有 ${toolName}：专家行加了但 persona 名册没同步（调度智能体不会知道它存在）`)
  }
  for (const mention of new Set(roster.match(/agent_[a-z0-9_]+/g) ?? [])) {
    if (!declared.includes(mention)) fail(`调度名册提到 ${mention}，但没有对应的专家行（名册与实现不一致）`)
  }
}

// ── 报告 ───────────────────────────────────────────────────────────────────
console.log(`校验对象：${target}`)
console.log(`专家行 ${rows.length} 个：${rows.map((row) => `${row.toolName ?? row.id}[${row.allow.length}]`).join('  ')}`)
for (const message of warnings) console.log(`WARN  ${message}`)
for (const message of errors) console.log(`ERROR ${message}`)
if (errors.length > 0) {
  console.log(`\n不通过：${errors.length} 个错误，${warnings.length} 个警告`)
  process.exit(1)
}
console.log(`\n通过：0 个错误，${warnings.length} 个警告`)
