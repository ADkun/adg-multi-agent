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
//   6. 文件顶部调度 persona 的名册与专家行一一对应（双向，不能只加行不改名册）；
//   7. 三组 token 预算旋钮（共 5 个键）没有被静默改回默认值/改坏：
//      `compaction-basic` 的 thresholdRatio / retainRatio（必须都在 (0,1]，且
//      retainRatio < thresholdRatio，否则插件加载时直接抛错）、`tool-result-pruner` 的
//      thresholdChars / headChars / tailChars（正整数，且 head + marker + tail ≤ threshold，
//      否则同样抛错）、`tool-web` 的 fetchMaxOutputChars / searchMaxResults /
//      searchMaxQueries（正整数，且 fetchMaxOutputChars ≤ 200000，> 60000 只提示）。
//      取值还必须等于下面的 EXPECTED_BUDGET，行的 name/disabled/config 结构也要对。
//      依据见 README「token 成本纪律」。
//
// 用法：
//   node tools/check-preset.mjs                                  # 校验仓库里的 preset/
//   node tools/check-preset.mjs <path-to-agent.cordis.yml>       # 校验任意一份（如已安装的那份）
//
// 零依赖：本文件按行做结构化解析，不引入 YAML 库（文件形状由本仓库自己固定）。
// 注意它终究只是个**文本扫描器**，不是 YAML 解析器：它能证明"这些行写对了"，
// 不能证明整份文件能解析、也不能证明插件真的挂载成功 —— 后者要重启后按 README
// 「给 AI 的安装指令」里的 `standingKeyFor('adg')` 做一次真实挂载。

import { readFileSync, statSync } from 'node:fs'
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
    // 目录也能被 readFileSync 打开（Linux 上 EISDIR、Windows 上读到垃圾字节），
    // 所以先判类型：路径不存在 / 打不开 → exit 2，存在但不是普通文件 → 也 exit 2。
    if (!statSync(target).isFile()) return null
    return readFileSync(target)
  } catch (error) {
    console.error(`无法读取 ${target}：${error.message}`)
    process.exit(2)
  }
}

const raw = readTarget()
if (raw === null) {
  console.error(`无法读取 ${target}：不是普通文件`)
  process.exit(2)
}
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

// ── 7. token 预算旋钮 ──────────────────────────────────────────────────────
// 纯文本扫描，不解析 YAML：按 `- id:` 定位目标行，再把行内 `key: value` 按缩进栈收成
// 「路径 → 值」。路径能分辨"直挂 config 下"与"嵌得更深/提到同级"，这是 F4 那些守卫的前提。

/**
 * 本 preset 的预算取值是**实测后定死的**，不是"落在合法区间里就行"。
 * 三个插件都有默认值（compaction-basic 0.8/0.16、pruner 8192/4096/1024、
 * tool-web 200000/8/4）：只要 config 写错位置或漏写，运行期就**静默**回落到那些默认值，
 * 所以这里逐个钉住，任何偏差都是 ERROR：
 *   - 把某个键改回插件默认值 → ERROR；
 *   - 只想把某个键挪进"我觉得还算小"的区间（如 fetchMaxOutputChars 写 90000）→ 也 ERROR，
 *     因为这里是单值比较，不区分往哪边调。
 * 真要改：在同一个提交里改这个常量，并重跑 README「怎么重新测量」里的 token 审计。
 */
const EXPECTED_BUDGET = {
  compaction: { thresholdRatio: 0.6, retainRatio: 0.12 },
  pruner: { thresholdChars: 4096, headChars: 2048, tailChars: 768 },
  web: { fetchMaxOutputChars: 24000, searchMaxResults: 5, searchMaxQueries: 3 },
}

/**
 * `@deepseek-ai/dsh-compaction-tool-result-pruner` 的 `PRUNE_MARKER`
 * （lib/index.js:8）是 `"\n\n[... tool result middle pruned ...]\n\n"`，按码点数正好 **39**；
 * 同文件 lib/index.js:43-44 用它算实际吐出长度：
 *   headChars + codePointLength(PRUNE_MARKER) + tailChars > thresholdChars → 抛错
 * 这里必须照抄这个算式：只看 `head + tail` 会漏掉那 39 个字符（2048+2010=4058 < 4096
 * 曾经因此蒙混过关，而真实吐出是 4058+39=4097 > 4096）。
 * 另注：运行期允许 headChars / tailChars 为 0（assertNonNegativeInteger），
 * 但本 preset **刻意要求正整数** —— 留 0 头或 0 尾等于把中间段整段丢掉，不是本仓库的口径。
 */
const PRUNER_MARKER_CHARS = 39

/**
 * 预算行的结构守卫。每一条都对应一种"看起来配了、其实没生效"的绕法：
 *   1. `name:` 必须是期望的包名 —— 只认 `id:` 的话，`id: tool-web` 换个 `name:` 照样通过，
 *      但真正跑的是别的插件，预算根本没落到 tool-web 上（运行期不报错，只用默认值）；
 *   2. 行内出现 `disabled: true` → ERROR —— 被禁用的行不挂载，预算随行一起消失；
 *   3. 同一个期望 id 命中多行 → ERROR —— 诱饵/重复行让"到底哪一行生效"不可判定
 *      （id 按树唯一，重复 id 本身就是坏配置）；
 *   4. 每个预算键必须**直挂**在同级 `config:` 下、缩进恰好比 `config:` 深一级 ——
 *      嵌得更深运行期要么拒绝这条配置、要么忽略它，提到与 `name:` 同级则根本进不了插件的
 *      config；（两种都会静默用默认值）；
 *   5. `config:` 块里出现不认识的键 → ERROR 并点名 —— 三个插件都校验自己的键集
 *      （compaction-basic 与 pruner 的 validateKeys/键集检查对未知名直接抛错），
 *      拼错的键会让整行挂载失败，而不是被忽略。
 * 期望包名与期望值都从 EXPECTED_BUDGET 生成，避免两处各写一遍。
 */
const EXPECTED_ROWS = [
  {
    label: '`compaction` 组 compaction-basic',
    idPrefix: 'compaction-basic',
    name: '@deepseek-ai/dsh-compaction-basic',
    budgetKeys: Object.keys(EXPECTED_BUDGET.compaction),
    expected: EXPECTED_BUDGET.compaction,
    // 该插件 BASIC_COMPACT_CONFIG_KEYS 的全部键（lib/index.js:15-34）。
    allowedKeys: [
      'thresholdRatio',
      'retainRatio',
      'retainTokens',
      'summarizationProvider',
      'summarizationModel',
      'maxTokens',
      'compactionRetries',
      'maxOverflowRetries',
      'modelPolicies',
      'auto',
    ],
    missingRow: '`compaction` 组里找不到 `compaction-basic` 行：它决定这个 preset 的 agent 会不会压缩上下文',
    deletedConfig: '没有任何预算 config，等于用插件默认值（0.8 / 0.16）——这不是本 preset 的成本口径',
  },
  {
    label: '`compaction` 组 tool-result-pruner',
    idPrefix: 'tool-result-pruner',
    name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
    budgetKeys: Object.keys(EXPECTED_BUDGET.pruner),
    expected: EXPECTED_BUDGET.pruner,
    // 该插件 CONFIG_KEYS（lib/index.js:15-19）就是这三个预算键。
    allowedKeys: ['thresholdChars', 'headChars', 'tailChars'],
    missingRow: '`compaction` 组里找不到 `tool-result-pruner` 行：单条工具结果不会被裁剪，上下文体积会失控',
    deletedConfig: '没有任何预算 config，等于用插件默认值（8192 / 4096 / 1024）——这不是本 preset 的成本口径',
  },
  {
    label: '顶层 tool-web',
    idPrefix: 'tool-web',
    name: '@deepseek-ai/dsh-tool-web',
    budgetKeys: Object.keys(EXPECTED_BUDGET.web),
    expected: EXPECTED_BUDGET.web,
    // 该插件 Config 的全部键（lib/index.js:845-853）。
    allowedKeys: [
      'search',
      'fetch',
      'searchMaxResults',
      'searchMaxQueries',
      'fetchTimeoutMs',
      'searchTimeoutMs',
      'fetchMaxOutputChars',
    ],
    missingRow: '找不到 `tool-web` 行：联网工具的抓取上限就无处声明',
    deletedConfig: '没有任何预算 config，等于用插件默认值（200000 / 8 / 4）——这不是本 preset 的成本口径',
  },
]

/**
 * 在预算行里"合法开一个嵌套块"的键名：`config:` 本身，以及允许出现在 config 下的
 * 嵌套对象键（tool-web 的 `search` 是布尔、不会嵌套；compaction-basic 的
 * `modelPolicies` 是对象数组）。列在这里的键**不会**遮蔽它下面的标量值，
 * 其它"只有键名、没有值"的行按嵌套对象处理，其下面的键不算"直挂 config"。
 */
const NESTED_BLOCK_KEYS = new Set(['config', 'modelPolicies'])

/**
 * 读一条 `- id: ...` 行块：块内所有非空行都必须缩进更深、且不能是序列项。
 * 返回行内每个 `key:` 的完整路径（按缩进栈拼）与它的标量值（嵌套块的父键为 null）。
 * @returns {{line:number, id:string, indent:number, paths:Map<string,string|null>, pathLines:Map<string,number>, rootScalars:Map<string,string>, innerLines:Set<number>}}
 */
function readRowBlock(startIndex) {
  const start = /^(\s*)- id: (\S+)\s*$/.exec(lines[startIndex])
  const rowIndent = indentOf(lines[startIndex])
  const paths = new Map()
  const pathLines = new Map()
  const rootScalars = new Map()
  const innerLines = new Set()
  // 缩进栈：只留"当前还开着的"祖先键（按缩进从浅到深）。
  const stack = []
  for (let cursor = startIndex + 1; cursor < lines.length; cursor += 1) {
    const inner = lines[cursor]
    if (inner.trim() === '') break
    const innerIndent = indentOf(inner)
    if (innerIndent <= rowIndent) break
    if (/^\s*- /.test(inner)) break
    innerLines.add(cursor)
    const entry = /^(\s+)([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(inner)
    if (entry === null) continue
    const [, spaces, key, rest] = entry
    while (stack.length > 0 && spaces.length <= stack[stack.length - 1].indent) stack.pop()
    const path = [...stack.map((frame) => frame.key), key].join(' > ')
    // YAML 标量两侧的引号是语法，不是值的一部分（包名一律写成 '@deepseek-ai/...'）。
    const value = (rest.trim().match(/^(['"])([\s\S]*)\1$/) ?? [null, null, rest.trim()])[2]
    // `key:` 后面没东西 = 开了一个嵌套块。`config:` / `search:` 这类块本身不是值，
    // 但它下面的标量仍是自己的值，所以只把"非块的嵌套对象祖先"算作遮蔽。
    const hasValue = value !== ''
    const opensBlock = !hasValue && NESTED_BLOCK_KEYS.has(key)
    const hidden = stack.some((frame) => !frame.hasValue && !frame.opensBlock)
    paths.set(path, hasValue && !hidden ? value : null)
    pathLines.set(path, cursor + 1)
    if (spaces.length === rowIndent + 2) rootScalars.set(key, hasValue ? value : '')
    stack.push({ key, indent: spaces.length, hasValue, opensBlock })
  }
  return { line: startIndex + 1, id: start[2], indent: rowIndent, paths, pathLines, rootScalars, innerLines }
}

/** 命中该 id 的所有行（可能多于一条：重复/诱饵行要报错而不是取第一条了事）。 */
function rowsOf(idPrefix) {
  const pattern = new RegExp(`^\\s*- id: ${idPrefix}\\s*$`)
  return lines.flatMap((line, index) => (pattern.test(line) ? [readRowBlock(index)] : []))
}

/** 值**直接**挂在 `config:` 下才算数（不是"任何深度都算"）。 */
const directPath = (row, key) => (row.paths.has(`config > ${key}`) ? `config > ${key}` : undefined)

/** 读一个直接挂在 config 下的十进制正整数：`4096` 算，`4_096` / `4.0` / `1e3` 不算。 */
function positiveIntegerOf(row, key) {
  const path = directPath(row, key)
  const value = path === undefined ? undefined : row.paths.get(path)
  if (value === undefined || value === null) return undefined
  return /^\+?\d+$/.test(value) ? Number(value) : undefined
}

/** 读一个直接挂在 config 下的小数：`0.6` / `.6` 都算，其它形状返回 undefined。 */
function ratioOf(row, key) {
  const path = directPath(row, key)
  const value = path === undefined ? undefined : row.paths.get(path)
  if (value === undefined || value === null) return undefined
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : undefined
}

/** 该行存在、但一个期望的预算键都没有**直挂**在 config 下（config 整段被删或写错位置）。 */
const noBudget = (row, keys) => keys.every((key) => directPath(row, key) === undefined)

for (const spec of EXPECTED_ROWS) {
  const matched = rowsOf(spec.idPrefix)
  if (matched.length === 0) {
    fail(spec.missingRow)
    continue
  }
  const row = matched[0]
  // 命中多行时，"哪一行才是生效的那一行"本身就不可判定，所以只报结构性的 name/disabled，
  // 不再对第一条做取值比较（否则只会叠一串"缺失"的次生错误，掩盖真正的原因）。
  const duplicated = matched.length > 1
  if (duplicated) {
    fail(`${spec.label}：id 以 ${spec.idPrefix} 开头的行命中 ${matched.length} 条（第 ${matched.map((item) => item.line).join(' / ')} 行）——同一个期望行只允许一条，重复/诱饵行会让"哪一行生效"不可判定`)
  }

  // 守卫 2：被 disabled 关掉的行不挂载，预算也就没了。
  if (row.rootScalars.get('disabled') === 'true') {
    fail(`第 ${row.line} 行 ${row.id}：这一行被 disabled: true 关掉了——预算随行一起消失、根本不会挂载，等于回到插件默认值`)
  }
  // 守卫 1：id 对了但包名被换掉 = 跑的是别的插件。
  const rowName = row.rootScalars.get('name')
  if (rowName !== spec.name) {
    fail(`第 ${row.line} 行 ${row.id}：name 应为 ${spec.name}，实际 ${rowName ?? '（缺失）'}——id 对了但包名不对，跑起来的是别的插件，预算不会生效`)
  }
  if (duplicated) {
    for (const item of matched.slice(1)) {
      if (item.rootScalars.get('name') === spec.name) continue
      fail(`第 ${item.line} 行 ${item.id}：重复的 ${spec.idPrefix} 行的 name 是 ${item.rootScalars.get('name') ?? '（缺失）'}，与期望的 ${spec.name} 不一致`)
    }
    continue
  }

  // 守卫 5 的输入：直接挂在 config: 下的键集合。
  const configKeys = new Set()
  for (const path of row.pathLines.keys()) {
    if (!path.startsWith('config > ')) continue
    const rest = path.slice('config > '.length)
    if (!rest.includes(' > ')) configKeys.add(rest)
  }

  // 守卫 4：预算键存在但没直挂 config 下 → 指出它到底写在哪了。
  for (const key of spec.budgetKeys) {
    if (directPath(row, key) !== undefined) continue
    const found = [...row.paths.keys()].find((path) => path === key || path.endsWith(` > ${key}`))
    if (found === undefined) continue
    fail(
      found.includes(' > ')
        ? `第 ${row.line} 行 ${row.id}：${key} 写在了 ${found}，不是直接挂在 config: 下——嵌得更深运行期会拒绝这条配置或直接忽略它，等于用默认值`
        : `第 ${row.line} 行 ${row.id}：${key} 被提到与 name: 同级（写成了 ${found}），没有出现在 config: 下——它不会进插件的 config，运行期静默用默认值`,
    )
  }

  // 守卫：期望值逐个钉住（单值比较：往任何方向偏都是 ERROR）。
  for (const key of spec.budgetKeys) {
    const expected = spec.expected[key]
    const actual = key === 'thresholdRatio' || key === 'retainRatio' ? ratioOf(row, key) : positiveIntegerOf(row, key)
    if (actual === undefined) {
      fail(`第 ${row.line} 行 ${row.id}：${key} 缺失或不是数字——期望 ${expected}（缺失时插件用默认值，本 preset 的成本口径就失效了）`)
      continue
    }
    if (key === 'fetchMaxOutputChars' && actual > 200000) {
      fail(`第 ${row.line} 行 ${row.id}：fetchMaxOutputChars ${actual} 超过 200000（tool-web 的默认上限，超过它等于放弃这道闸）`)
      continue
    }
    if (actual !== expected) {
      fail(`第 ${row.line} 行 ${row.id}：${key} 实际 ${actual}，期望 ${expected}——这些上限是实测后定死的决策；真要改，请在同一个提交里改 tools/check-preset.mjs 的 EXPECTED_BUDGET 并重跑 token 审计`)
    }
    if (key === 'fetchMaxOutputChars' && actual > 60000) {
      warn(`第 ${row.line} 行 ${row.id}：fetchMaxOutputChars ${actual} 偏大（> 60000），单次抓取就可能挤掉一大块上下文`)
    }
  }

  // 守卫 5：config 块里不认识的键会让整行挂载失败，点名报出来。
  for (const key of configKeys) {
    if (spec.allowedKeys.includes(key)) continue
    const lineNo = row.pathLines.get(`config > ${key}`) ?? row.line
    fail(`第 ${lineNo} 行 ${row.id}：config 里的 "${key}" 不是 ${spec.name} 认识的键——插件校验键集时会直接抛 unknown key，整行挂载失败`)
  }

  if (noBudget(row, spec.budgetKeys)) {
    warn(`第 ${row.line} 行 ${row.id}：${spec.deletedConfig}`)
  }
}

// 两个 ratio 的取值区间与先后次序（插件加载时就会抛，不只是"取错值"）。
const compactionRow = rowsOf('compaction-basic')[0]
if (compactionRow !== undefined) {
  const thresholdRatio = ratioOf(compactionRow, 'thresholdRatio')
  const retainRatio = ratioOf(compactionRow, 'retainRatio')
  if (thresholdRatio !== undefined && !(thresholdRatio > 0 && thresholdRatio <= 1)) {
    fail(`第 ${compactionRow.line} 行 ${compactionRow.id}：thresholdRatio ${thresholdRatio} 超出 (0,1]——插件加载时会抛 must be a number in (0, 1]`)
  }
  if (retainRatio !== undefined && !(retainRatio > 0 && retainRatio <= 1)) {
    fail(`第 ${compactionRow.line} 行 ${compactionRow.id}：retainRatio ${retainRatio} 超出 (0,1]——插件加载时会抛 must be a number in (0, 1]`)
  }
  if (thresholdRatio !== undefined && retainRatio !== undefined && retainRatio >= thresholdRatio) {
    fail(`第 ${compactionRow.line} 行 ${compactionRow.id}：retainRatio ${retainRatio} 必须小于 thresholdRatio ${thresholdRatio}（否则插件加载时抛 retainRatio must be less than the resolved thresholdRatio）`)
  }
}

// pruner 的算式必须带上标记长度（F1）。
const prunerRow = rowsOf('tool-result-pruner')[0]
let prunerEmitted
if (prunerRow !== undefined) {
  const thresholdChars = positiveIntegerOf(prunerRow, 'thresholdChars')
  const headChars = positiveIntegerOf(prunerRow, 'headChars')
  const tailChars = positiveIntegerOf(prunerRow, 'tailChars')
  if (thresholdChars !== undefined && headChars !== undefined && tailChars !== undefined) {
    prunerEmitted = headChars + PRUNER_MARKER_CHARS + tailChars
    if (prunerEmitted > thresholdChars) {
      fail(`第 ${prunerRow.line} 行 ${prunerRow.id}：headChars + 标记(${PRUNER_MARKER_CHARS}) + tailChars = ${prunerEmitted} 超过 thresholdChars ${thresholdChars}——插件加载时会抛 headChars + marker + tailChars (...) must be at most thresholdChars`)
    }
  }
}

// ── 报告 ───────────────────────────────────────────────────────────────────
const webRow = rowsOf('tool-web')[0]
const shown = (row, key) => {
  const path = row === undefined ? undefined : directPath(row, key)
  const value = path === undefined ? undefined : row.paths.get(path)
  return value === undefined || value === null ? '缺失' : value
}
console.log(`校验对象：${target}`)
console.log(`专家行 ${rows.length} 个：${rows.map((row) => `${row.toolName ?? row.id}[${row.allow.length}]`).join('  ')}`)
console.log(`预算：compaction ${shown(compactionRow, 'thresholdRatio')}/${shown(compactionRow, 'retainRatio')} | pruner ${shown(prunerRow, 'thresholdChars')}/${shown(prunerRow, 'headChars')}/${shown(prunerRow, 'tailChars')} | fetchMaxOutputChars ${shown(webRow, 'fetchMaxOutputChars')}/${shown(webRow, 'searchMaxResults')}/${shown(webRow, 'searchMaxQueries')}`)
console.log(`裁剪后实际吐出：head ${shown(prunerRow, 'headChars')} + 标记 ${PRUNER_MARKER_CHARS} + tail ${shown(prunerRow, 'tailChars')} = ${prunerEmitted ?? '?（预算键缺失，无法计算）'}，threshold ${shown(prunerRow, 'thresholdChars')}`)
for (const message of warnings) console.log(`WARN  ${message}`)
for (const message of errors) console.log(`ERROR ${message}`)
if (errors.length > 0) {
  console.log(`\n不通过：${errors.length} 个错误，${warnings.length} 个警告`)
  process.exit(1)
}
console.log(`\n通过：0 个错误，${warnings.length} 个警告`)
