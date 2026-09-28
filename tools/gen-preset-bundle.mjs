#!/usr/bin/env node
// 把本仓库的 preset 源文件（`preset/preset.yml` + `preset/agent.cordis.yml`）打包成
// dsh 0.1.7 起唯一认识的形状：一个由 bundle patch 声明的 agent preset 行。
//
// 为什么需要它（2026-09-28 实测，见 docs/evidence.md §14）：
//   dsh 0.1.7-rc.2 起，`$DSH_HOME/.agent-presets/<id>/`（`preset.yml` + `agent.cordis.yml`）
//   这套**目录发现机制被整体移除** —— 旧的 `@deepseek-ai/dsh-agent-presets`（复数）包在升级时
//   被挪走，取而代之的是 `@deepseek-ai/dsh-agent-preset`（单数，声明行插件）+
//   `@deepseek-ai/dsh-agent-preset-registry`（花名册）。目录还在、文件还在，但**没有任何东西读它**，
//   所以升级后 Adg 模式从选择列表里消失（旧安装脚本只拷贝那两个文件，等于什么都装不上）。
//   现在一个 preset 只能是一行 Loader 声明：`name: '@deepseek-ai/dsh-agent-preset'`，
//   `config.id` 是 preset 身份，`config.plugins` 是它的子插件条目列表（与旧的 agent.cordis.yml 同方言）。
//
// 用法：
//   node tools/gen-preset-bundle.mjs                 # 生成到 bundle/adg-preset（.gitignore 已忽略 bundle/）
//   node tools/gen-preset-bundle.mjs <outDir>        # 生成到指定目录
//   node tools/gen-preset-bundle.mjs --with-billion-context   # 追加 bili 的上下文工具（见下）
//
// `--with-billion-context`（构建期条件化，2026-10 加）：
//   挂了 billion-context 的 profile 里，专家需要看见它注册在全局层的上下文工具：allow 是真白名单
//   （`dsh-subagent/lib/types/child-agent.js:171` → `dsh-tools/lib/types/index.js:580-587` 的 visible
//   只从 inherited 里挑），而 bili 的注入段/nudge **只看 config、不看这个请求有没有那些工具**
//   （`server.ts:3335-3336` 的 injectTools 有 pluginMode 护栏，L3427 的系统段与 L3447 的 nudge 没有），
//   所以不给 = 专家收到"去调 compress/acp_status"的指令却没有工具。
//   反过来，没装 bili 的 profile 里这些名字**不存在**，写进 allow 会让每一次委派当场抛
//   `names unknown global tool "compress"`（AGENTS.md 红线 7）。因此名单只能出现在**生成物**里：
//   `preset/agent.cordis.yml` 保持中立（单一事实来源、对没装 bili 的人也成立），是否追加由安装期探测决定。
//   默认**不追加**（忘了加旗标 = 少个能力，不会装坏）。install.ps1 / install.sh 会探测目标 profile
//   有没有挂 billion-context，挂了才带这个旗标。
//
// 输入（相对仓库根）：
//   preset/preset.yml           name / description /（可选）order —— 只按 `key: value` 取顶层标量
//   preset/agent.cordis.yml     子插件条目列表，**原样**缩进进 config.plugins（单一事实来源）
//   preset/bundle.package.json  package.json 模板，原样拷贝
// 输出：
//   <outDir>/package.json       `dsh.bundle.patch` 指向同目录的 cordis.patch.yml
//   <outDir>/cordis.patch.yml   一行 `insert:`，插入 preset-adg
//
// 零依赖、只读源文件、不做网络：刻意不引入 YAML 库 —— `preset.yml` 的形状由本仓库自己固定
// （顶层 `key: value`），`agent.cordis.yml` 只需按行加缩进，两者都不需要真解析器。
// 「缩进嵌入」之所以成立：条目列表本来就是合法 YAML，整体右移一格缩进后仍是合法 YAML。
//
// 退出码：0 成功；1 输入缺失或形状不符（错误写到 stderr）。
//
// 能力边界：它只保证**生成物形状**正确（能被 YAML 解析成一行 insert），
// 证明不了 dsh 会挂载它 —— 那要装进 profile 后看 plugin_manager 里的 fiberPhase，
// 以及在新会话里真实组合一次（见 README「给 AI 的安装指令」）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

/** 已知旗标：拼错就报错退出，不要静默生成一份"其实没生效"的产物。 */
const KNOWN_FLAGS = new Set(['--with-billion-context'])
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const positional = argv.filter((arg) => !arg.startsWith('--'))
for (const flag of flags) {
  if (!KNOWN_FLAGS.has(flag)) fail(`不认识的旗标 ${flag}；可用：${[...KNOWN_FLAGS].join(' ')}`)
}
const WITH_BILLION_CONTEXT = flags.has('--with-billion-context')
const outDir = resolve(positional[0] ?? join(repo, 'bundle', 'adg-preset'))

/** Loader 行 id 与 preset 身份。改 id 会同时改掉插件 `presets: ['adg']` 的筛选口径。 */
const PRESET_ID = 'adg'
const LOADER_ROW_ID = `preset-${PRESET_ID}`
/** 名册排序缺省值：排在出厂 preset（standard=1 … cordis）之后。 */
const DEFAULT_ORDER = 20
/** `config.plugins:` 在生成的 YAML 里所在的列数；条目必须更深一格。 */
const PLUGINS_INDENT = 8
const ITEM_INDENT = PLUGINS_INDENT + 2
/** 单行标量一律用双引号（JSON 转义是合法 YAML 双引号转义），避免中文/冒号/引号踩坑。 */
const scalar = (text) => JSON.stringify(text)

const indentOf = (line) => line.length - line.trimStart().length

function fail(message) {
  process.stderr.write(`gen-preset-bundle: ${message}\n`)
  process.exit(1)
}

/**
 * billion-context 注册在**全局层**的上下文工具（`billion-context/dsh` 插件从代理的
 * `/__bili/plugin/manifest` 拿到清单后 `ctx.tools.register(...)`，见 `src/agent/dsh-native.ts:329-353`）。
 * 只取这 4 个：`acp_cache` 是纯缓存经济性诊断（调度者可以用 conversation_id 代读），
 * 给每个专家多挂一个 schema 只是白付 prefix。
 */
const BILLION_CONTEXT_TOOLS = Object.freeze(['compress', 'decompress', 'search_context', 'acp_status'])

/**
 * 给每个专家行的 `toolFilter.allow` 追加名字。只认本仓库自己固定的形状：
 *   `    - id: agent-xxx`（4 空格）→ `          allow:`（10 空格）→ `            - name`（12 空格）
 * 从后往前插，避免前面的插入改掉后面的行号。缺 allow 的专家行**直接失败**：新加专家忘了写 allow
 * 名单时静默漏注入，等于那个人群的 bili 专家收得到 nudge 却没有工具，而这正是本次改动要修的缺陷。
 */
function addToolsToExpertAllows(source, names) {
  const lines = source.replace(/\n+$/, '').split('\n')
  const touched = []
  const skipped = []
  for (let index = 0; index < lines.length; index += 1) {
    const start = /^ {4}- id: (agent-[a-z0-9-]+)\s*$/.exec(lines[index])
    if (start === null) continue
    const id = start[1]
    let allowAt = -1
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const inner = lines[cursor]
      if (/^ {4}- id: /.test(inner)) break
      if (inner.trim() !== '' && indentOf(inner) <= 4 && !inner.startsWith(' ')) break
      if (/^ {10}allow:\s*$/.test(inner)) {
        allowAt = cursor
        break
      }
    }
    if (allowAt < 0) {
      skipped.push(id)
      continue
    }
    const have = new Set()
    let last = allowAt
    for (let cursor = allowAt + 1; cursor < lines.length; cursor += 1) {
      const item = /^ {12}- (.+?)\s*$/.exec(lines[cursor])
      if (item !== null) {
        have.add(item[1].trim())
        last = cursor
        continue
      }
      if (lines[cursor].trim() === '' || lines[cursor].trimStart().startsWith('#')) continue
      break
    }
    const add = names.filter((name) => !have.has(name))
    if (add.length === 0) {
      touched.push({ id, added: [] })
      continue
    }
    lines.splice(last + 1, 0, ...add.map((name) => `            - ${name}`))
    touched.push({ id, added: add })
  }
  return { text: `${lines.join('\n')}\n`, touched, skipped }
}

function readSource(relative) {
  const path = join(repo, relative)
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    fail(`读不到 ${relative}：${error.message}`)
  }
}

/** 顶层 `key: value` 标量（本仓库 preset.yml 的固定形状），忽略注释与空行。 */
function parseTopLevelScalars(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf(': ')
    if (at < 0) continue
    const key = trimmed.slice(0, at).trim()
    const value = trimmed.slice(at + 2).trim()
    if (key && value) out[key] = value
  }
  return out
}

const presetYml = readSource(join('preset', 'preset.yml'))
const agentList = readSource(join('preset', 'agent.cordis.yml'))
const packageTemplate = readSource(join('preset', 'bundle.package.json'))

const meta = parseTopLevelScalars(presetYml)
if (!meta.name) fail('preset/preset.yml 里没有可用的 `name: <显示名>`')
if (meta.description === undefined) process.stderr.write('gen-preset-bundle: 警告：preset/preset.yml 没有 description:，花名册里不会有说明文字\n')

let order = DEFAULT_ORDER
if (meta.order !== undefined) {
  order = Number(meta.order)
  if (!Number.isFinite(order)) fail(`preset/preset.yml 的 order 不是数字：${meta.order}`)
}

// 形状自检：条目列表的第一条有效行必须是数组项，否则说明喂错了文件。
const firstEntry = agentList.split('\n').find((line) => line.trim() && !line.trim().startsWith('#'))
if (!firstEntry || !firstEntry.startsWith('- ')) {
  fail('preset/agent.cordis.yml 的第一条有效行不是 `- ` 开头的数组项（顶层必须是一个条目列表）')
}
if (agentList.includes('\t')) fail('preset/agent.cordis.yml 里出现了制表符：YAML 缩进不允许 tab，请换空格')
if (agentList.includes('\r')) fail('preset/agent.cordis.yml 含 CR 行尾：本仓库要求 LF（见 .gitattributes），否则生成的缩进块会带 \\r')

// 构建期条件化：--with-billion-context 时把 bili 的上下文工具追加进每个专家行的 allow 名单。
// 源文件（preset/agent.cordis.yml）保持中立 —— 它必须对没装 billion-context 的人也成立，
// 而那些名字在未挂载时**不存在**，写进 allow 会让每一次委派当场抛 unknown global tool。
let entrySource = agentList
let biliTouched = 0
if (WITH_BILLION_CONTEXT) {
  const result = addToolsToExpertAllows(agentList, [...BILLION_CONTEXT_TOOLS])
  if (result.skipped.length > 0) {
    fail(`这些专家行没有 \`          allow:\` 块，追加无处可插：${result.skipped.join(', ')}。先给它们写 allow 名单，或去掉 --with-billion-context。`)
  }
  if (result.touched.length === 0) {
    fail('一个专家行都没找到（形如 `    - id: agent-xxx` 且带 `          allow:`），--with-billion-context 无意义：检查是否喂错了文件')
  }
  biliTouched = result.touched.length
  entrySource = result.text
}

const patch = [
  '# 由 tools/gen-preset-bundle.mjs 从 preset/preset.yml + preset/agent.cordis.yml 生成。',
  '# 不要手改这个文件：改 preset/ 下的源文件后重新生成（install.ps1 / install.sh 每次安装都会重生成）。',
  '#',
  '# 它为什么长这样：dsh 0.1.7-rc.2 起不再发现 $DSH_HOME/.agent-presets/<id>/，一个 agent preset',
  '# 只能由某个 patch 层里的这一行声明；config.plugins 就是旧的 agent.cordis.yml 原样缩进。',
  ...(WITH_BILLION_CONTEXT
    ? [
        '#',
        `# 本次生成带了 --with-billion-context：${biliTouched} 个专家行的 toolFilter.allow 追加了 ${BILLION_CONTEXT_TOOLS.join(' / ')}`,
        '# （billion-context 的 DSH 插件把这几个名字注册在全局层，allow 是白名单，不写专家就看不见；',
        '#  没挂 billion-context 的 profile 要用**不带**这个旗标的生成物，否则委派会抛 unknown global tool。）',
      ]
    : []),
  '',
  '- insert:',
  `    - id: ${LOADER_ROW_ID}`,
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  `        id: ${PRESET_ID}`,
  `        name: ${scalar(meta.name)}`,
  ...(meta.description === undefined ? [] : [`        description: ${scalar(meta.description)}`]),
  `        order: ${order}`,
  '        plugins:',
  ...entrySource
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.length === 0 ? '' : ' '.repeat(ITEM_INDENT) + line)),
  '',
].join('\n')

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'cordis.patch.yml'), patch, 'utf8')
writeFileSync(join(outDir, 'package.json'), packageTemplate.endsWith('\n') ? packageTemplate : packageTemplate + '\n', 'utf8')

const rows = patch.split('\n').filter((line) => /^\s{10}- id: /.test(line)).length
process.stdout.write(`gen-preset-bundle: ${outDir}\n`)
process.stdout.write(`  cordis.patch.yml  ${Buffer.byteLength(patch, 'utf8')} 字节 / ${rows} 个顶层子插件条目（preset id=${PRESET_ID}, order=${order}）\n`)
process.stdout.write(
  WITH_BILLION_CONTEXT
    ? `  billion-context   已注入：${biliTouched} 个专家行 + ${BILLION_CONTEXT_TOOLS.length} 个工具名（${BILLION_CONTEXT_TOOLS.join(' / ')}）\n`
    : '  billion-context   未注入（缺省）。挂了该 bundle 的 profile 要用 --with-billion-context 重新生成，否则专家看不见 compress / acp_status 等工具。\n',
)
process.stdout.write('  package.json      来自 preset/bundle.package.json\n')
process.stdout.write('下一步：把该目录装进 profile（plugin_manager install_bundle，或 dsh plugin --profile <p> add file:<tgz> + 选入 dsh.profile.bundles）。\n')