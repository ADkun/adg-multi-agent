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
const outDir = resolve(process.argv[2] ?? join(repo, 'bundle', 'adg-preset'))

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

function fail(message) {
  process.stderr.write(`gen-preset-bundle: ${message}\n`)
  process.exit(1)
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

const patch = [
  '# 由 tools/gen-preset-bundle.mjs 从 preset/preset.yml + preset/agent.cordis.yml 生成。',
  '# 不要手改这个文件：改 preset/ 下的源文件后重新生成（install.ps1 / install.sh 每次安装都会重生成）。',
  '#',
  '# 它为什么长这样：dsh 0.1.7-rc.2 起不再发现 $DSH_HOME/.agent-presets/<id>/，一个 agent preset',
  '# 只能由某个 patch 层里的这一行声明；config.plugins 就是旧的 agent.cordis.yml 原样缩进。',
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
  ...agentList
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
process.stdout.write('  package.json      来自 preset/bundle.package.json\n')
process.stdout.write('下一步：把该目录装进 profile（plugin_manager install_bundle，或 dsh plugin --profile <p> add file:<tgz> + 选入 dsh.profile.bundles）。\n')