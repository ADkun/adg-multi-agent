/**
 * dsh-adg-token-budget — a host-plane DSH/Cordis plugin that keeps the
 * **delegated children of an `adg` agent preset** from burning millions of
 * tokens in an unbounded exploration loop.
 *
 * It is a backstop, not a scheduler. It registers exactly one
 * `agent/pre-step` waterfall listener and decides on every proposed step of
 * every governed child, on two independent triggers:
 *
 * | Stage | Trigger | Action |
 * | --- | --- | --- |
 * | step | the child is entering its `stepTiers[n]`-th step | `next()` first, then append the nth convergence reminder to the returned `{kind:'enter'}` decision's `messages` — at most once per tier per residency epoch |
 * | soft | `usage >= budgetTokens * softRatio` | `next()` first, then append one wrap-up instruction to the returned `{kind:'enter'}` decision's `messages` — at most once per residency epoch |
 * | hard | `usage >= budgetTokens` | `agent.cancel({kind:'parent'})` and return `{kind:'reject'}` without calling `next()` |
 *
 * The step stage exists because it is the one lever the dispatcher cannot pull
 * itself. The dispatcher owns the *policy* — its persona tells it to put a
 * convergence target in every delegation prompt — but it cannot see how many
 * steps a running child has taken: polling for it re-sends the dispatcher's own
 * context (the largest in the run, 59% of the audited bill) once per poll, which
 * costs far more than the reminder saves. So the reminder is injected here,
 * deterministically and on the dispatcher's behalf. **At most one reminder
 * message is appended per step**, and cost is the reason: an injected message
 * stays in the child's context and is re-sent on every later step.
 *
 * With `dryRun: true` every decision is computed and logged but nothing is
 * injected and nothing is cancelled; the step is delegated through `next()`
 * even at the hard stage, so a budget can be calibrated against real traffic
 * before it is armed. `hardDryRun: true` does the same for the destructive
 * stage only, which is how the reminders can be armed for real while
 * `agent.cancel` is still being calibrated.
 *
 * Cumulative usage is
 * `uncachedInputTokens + outputTokens + cacheReadTokens * cacheReadWeight +
 * cacheWriteTokens`, read from `ctx.get('sessionProjections')?.stateOf(
 * agent.session, 'tokenUsage')`, whose `totals` are cumulative over the whole
 * session log. The step count needs no projection: it is the number of steps
 * this listener has watched the child enter.
 *
 * ## Two invariants this file is built around
 *
 * 1. **`next()` is called at most once, ever.** Cordis's waterfall advances one
 *    shared cursor (`next = () => (cbs.shift() ?? inner)(...)`,
 *    `cordis/lib/index.js:317-325`), and `dsh-agent-loop` dispatches
 *    `agent/pre-step` with the built-in step as that `inner`. Calling `next()`
 *    again after it rejected would re-enter the built-in behaviour and turn
 *    *another plugin's* failure into a silent pass-through. So the wrapper
 *    records `called`/`failed` around every `next()` call and **rethrows** what
 *    `next()` itself rejected, exactly as the harness behaves without this
 *    plugin. Nothing that runs after a *successful* `next()` may throw: the
 *    post-`next` work (state-map mutation, message construction, decision
 *    assembly) sits in its own `try`/`catch` that logs and returns the received
 *    decision unchanged.
 * 2. **`apply` never throws.** In Cordis, `apply` throwing with no declared
 *    schema fails the fiber, and `dsh` treats a failed entry as a **fatal
 *    startup error**: `@deepseek-ai/dsh-app-boot/lib/index.js:1434-1440,
 *    1465-1493` reports `plugin(s) failed to load; Cordis startup failed`. A
 *    hard `static inject` on a service that is not mounted is worse: the entry
 *    stays `pending` forever and `dsh-app-boot/lib/index.js:1483-1487` reports
 *    that as fatal too. So every entry point of this module is wrapped, there is
 *    no `static inject` and no static `import` of any `@deepseek-ai/*` package,
 *    and every per-event handler is contained.
 *
 * The plugin is deployed as a plain directory under
 * `$DSH_HOME/profiles/node_modules/`, where Node's normal ESM parent-walk does
 * reach the installation's dependency closure (`dsh-app-boot` documents that
 * `$DSH_HOME/profiles/node_modules` "supplies the installation dependency
 * closure through Node's ordinary parent-walk"), but the plugin still refuses
 * to depend on it at load time.
 *
 * @module dsh-adg-token-budget
 */

import { appendFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HARD,
  PASS,
  SOFT,
  cumulativeUsageOf,
  decide,
  delegationDepthOf,
  dueStepTier,
  isDelegatedChild,
  presetIsGoverned,
} from './budget.js'
import { normalizeConfig } from './config.js'

/** Stable plugin name; also the id a composed patch row refers to. */
export const name = 'dsh-adg-token-budget'

/** How many ancestor directories `resolveCreateUserMessage` walks at most. */
const MAX_ANCESTOR_WALK = 8

/**
 * Contexts that already registered this plugin's listeners.
 *
 * `apply` is idempotent per context: Cordis may apply the same entry more than
 * once (a hot reload, a re-composed row), and a second registration would
 * double every decision — two nudges on the soft path and two `cancel`s on the
 * hard path. The entry is removed again when the registration is disposed, so a
 * legitimate remount keeps working.
 */
let appliedContexts = new WeakSet()

/**
 * How many activations are registered right now, across all contexts. It is
 * incremented per registration and decremented by that registration's disposer.
 * A non-zero value while a *different* context applies means two live
 * registrations, which double-counts: that is reported loudly (and deliberately
 * not prevented, because a legitimate remount must keep working).
 */
let activeRegistrations = 0

/**
 * Forget every context-level registration record.
 *
 * Test-only seam: the bookkeeping above is deliberately process-global (it has
 * to survive across a hot reload), which would otherwise make the idempotency
 * tests depend on the order they run in. Nothing in the runtime calls this — a
 * live host clears registrations through the disposer, per context.
 *
 * @returns {void}
 */
export function resetRegistrationStateForTests() {
  appliedContexts = new WeakSet()
  activeRegistrations = 0
}

/**
 * The instruction appended at the token soft stage: stop exploring, report now.
 */
export const NUDGE_TEXT = [
  '【令牌预算提醒】你已接近本次委派任务的累计 token 预算上限。',
  '',
  '请立刻停止继续探索：不要再启动新的调查方向、不要再扩大检索范围、不要为了"更完整"而继续读取更多文件或运行更多命令。',
  '',
  '请立即基于你已经掌握的证据，汇报当前的结论：',
  '1. 已经确认的结论，以及每条结论对应的证据（文件路径、行号、命令与输出要点）；',
  '2. 尚未解决、但你已经知道该从哪里入手的部分；',
  '3. 你明确没有验证过的部分——请直说未验证，不要推测成结论。',
].join('\n')

/**
 * The step-checkpoint bodies, in escalation order.
 *
 * A configured `stepTiers` list longer than this reuses the last body, which is
 * why the checkpoint ordinal ("第 N 个检查点，共 M 个") is built separately in
 * `stepNudgeText` rather than baked in here.
 *
 * Every body is written to protect the result, not just to save tokens. Each one
 * tells the child to (a) stop *non-essential* exploration, (b) still do the one
 * remaining action if it is **required** for the delivery, and (c) hand back what
 * it has *not* verified rather than guessing. A checkpoint that only said "stop
 * now" would trade tokens for a worse answer, which is the one trade this
 * feature is not allowed to make.
 */
export const STEP_NUDGE_TEXTS = Object.freeze([
  [
    '请先做一次收敛判断，再决定下一步做什么：',
    '- 已有的证据如果已经足以回答委派任务，就立刻停止探索、直接汇报，不要再做"更完整"的补充检索。',
    '- 如果还剩**对交付必需**的关键动作没做完，就只做那一个，做完立刻汇报；不要顺手扩大范围。',
    '- 这条提醒不是让你放弃必要的验证，而是不要为了完整继续加步数 —— 每一步都要重发整段上下文，步数本身就是成本。',
  ].join('\n'),

  [
    '你已经超出常规委派规模，现在请收敛：',
    '- 停止一切非必需的新探索：不新开调查线，不重复读同一文件或同一 URL，不为"再确认一下"重跑命令。',
    '- 委派要求的核心交付如果已经能给出，就直接汇报；只有当某一步是交付**必需**、而且你已经知道它是哪一步时，才做那一步。',
    '- 汇报格式：结论 + 每条证据（path:line 或 URL）+ 未解决项 + 你明确没有验证过的部分。',
  ].join('\n'),

  [
    '这已经远超常规委派规模，请立即停止探索并汇报：',
    '- 不要再调用探索类工具（检索、读取、抓取、命令），除非某个已确认必需的动作只差最后一步。',
    '- 用你手上的证据给出结论。宁可结论不完整，也要明确写出"哪些没验证、卡在哪里"。',
    '- 汇报格式：结论 + 每条证据（path:line 或 URL）+ 未解决项。',
  ].join('\n'),
])

/**
 * Build the Nth convergence reminder.
 *
 * The count is included because a concrete number is what makes the checkpoint
 * actionable ("this is step 24"), and the escalation index picks the body. The
 * builder is pure and total: out-of-contract input falls back to the first body
 * with a zero count instead of throwing inside a live step.
 *
 * @param {{ tierIndex?: number, tierCount?: number, stepCount?: number }} input - where the checkpoint sits and how many steps the child took.
 * @returns {string} the message text.
 */
export function stepNudgeText(input) {
  const tierIndex = Number.isInteger(input?.tierIndex) && input.tierIndex >= 0 ? input.tierIndex : 0
  const tierCount = Number.isInteger(input?.tierCount) && input.tierCount >= 1 ? input.tierCount : STEP_NUDGE_TEXTS.length
  const stepCount = typeof input?.stepCount === 'number' && Number.isFinite(input.stepCount)
    ? Math.max(0, Math.round(input.stepCount))
    : 0
  const body = STEP_NUDGE_TEXTS[Math.min(tierIndex, STEP_NUDGE_TEXTS.length - 1)]
  return `【收敛检查点 ${tierIndex + 1}／${tierCount}】调度代理提醒：这是你的第 ${stepCount} 步。\n\n${body}`
}

/**
 * The message source a plugin-authored user message carries; the variant is
 * `{kind:'plugin', plugin}` (`@deepseek-ai/dsh-llm/lib/types/message.d.ts:94-104`).
 */
const PLUGIN_SOURCE = Object.freeze({ kind: 'plugin', plugin: name })

/** Every listener this plugin registers sees events from any scope. */
const GLOBAL = Object.freeze({ global: true })

/** Whether a value can be a `WeakSet` key. */
function isWeakKey(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/**
 * Read `DSH_HOME` as a non-empty trimmed string.
 *
 * @returns {string | undefined} the configured dsh user root, when there is one.
 */
function dshHome() {
  const home = process.env.DSH_HOME
  return typeof home === 'string' && home.trim() !== '' ? home.trim() : undefined
}

/**
 * The directory the **running** profile was configured from, derived from
 * `ctx.baseUrl`.
 *
 * `dsh-app-boot` sets `ctx.baseUrl = pathToFileURL(dirname(absoluteConfigPath))
 * + '/'` (`lib/index.js:1529`) and Cordis contexts inherit it, so this names the
 * profile actually in charge (`web` under the GUI, `headless` under
 * `dsh headless`) instead of guessing. Read defensively: an absent or
 * non-`file:` value simply yields no anchor.
 *
 * @param {unknown} baseUrl - `ctx.baseUrl`, if the context exposes one.
 * @returns {string | undefined} an absolute directory, without a trailing separator.
 */
function profileDirOf(baseUrl) {
  try {
    if (typeof baseUrl !== 'string' || !baseUrl.startsWith('file:')) return undefined
    const dir = fileURLToPath(baseUrl)
    if (typeof dir !== 'string' || dir === '') return undefined
    return dir.endsWith(sep) ? dir.slice(0, -1) : dir
  } catch {
    return undefined
  }
}

/**
 * Resolve the harness's own `createUserMessage`.
 *
 * `createUserMessage` lives in `@deepseek-ai/dsh-llm`
 * (`lib/types/message.js:45-50`, re-exported by `lib/index.js`). That package
 * must not be imported statically: a plugin deployed under
 * `$DSH_HOME/profiles/node_modules/` that fails to resolve a static import
 * cannot load at all, and that is a fatal startup failure. Instead the specifier
 * is resolved at call time with `createRequire`, anchored in the order that
 * matches how `dsh` actually lays modules out on disk:
 *
 * 1. the `.dsh-module-fallback` of the **running profile**, read from
 *    `ctx.baseUrl` (so a `headless` run anchors on `headless`, not on `web`) —
 *    the profile name is reported in the strategy,
 * 2. every `$DSH_HOME/profiles/<profile>/.dsh-module-fallback` directory found
 *    on disk, for a context that does not expose `baseUrl` at all,
 * 3. `$DSH_HOME/profiles/` (the shared module root's parent),
 * 4. this module's own `import.meta.url`,
 * 5. a walk up this module's ancestors looking for the first
 *    `node_modules/@deepseek-ai/dsh-llm`.
 *
 * Anchors (4) and (5) are what succeed from the real deployed location
 * (`$DSH_HOME/profiles/node_modules/dsh-adg-token-budget/src/plugin.js`), since
 * Node's parent-walk reaches `$DSH_HOME/profiles/node_modules/@deepseek-ai/`.
 * Anchors (1)–(3) are derived rather than hardcoded to `web`. Every probe is
 * wrapped, so a missing package costs only the fallback constructor.
 *
 * @param {unknown} [baseUrl] - `ctx.baseUrl`, so the running profile wins.
 * @returns {{ create: ((input: object) => object) | undefined, strategy: string }} the resolved factory and the strategy that produced it.
 */
export function resolveCreateUserMessage(baseUrl) {
  const attempts = []
  const profileDir = profileDirOf(baseUrl)
  if (profileDir !== undefined) {
    const profile = basename(profileDir)
    if (profile !== '') attempts.push([`profile-fallback:${profile}`, join(profileDir, '.dsh-module-fallback', 'noop.js')])
  }
  const home = dshHome()
  if (home !== undefined) {
    for (const attempt of profileFallbackAnchors(home)) attempts.push(attempt)
    attempts.push(['dsh-home-profiles', join(home, 'profiles', 'noop.js')])
  }
  attempts.push(['import-meta', import.meta.url])
  for (const anchor of ancestorAnchors()) attempts.push(['ancestor-walk', anchor])

  for (const [strategy, anchor] of attempts) {
    try {
      const required = createRequire(anchor)
      const loaded = required('@deepseek-ai/dsh-llm')
      const factory = loaded?.createUserMessage ?? loaded?.default?.createUserMessage
      if (typeof factory === 'function') return { create: factory, strategy }
    } catch {
      // A failed probe is expected on most layouts; the next anchor is the point.
    }
  }
  return { create: undefined, strategy: 'local-fallback' }
}

/**
 * The `createRequire` anchors of every `$DSH_HOME/profiles/<profile>/` directory,
 * so a run under `headless` resolves the same way a run under `web` does.
 *
 * The profile list is read from disk instead of hardcoded: the anchor names the
 * profile that actually produced the resolution (`module-fallback:web`), which
 * is what the activation line reports. A missing or unreadable `profiles/`
 * directory simply yields no anchors — the caller still has its own and the
 * ancestor walk.
 *
 * @param {string} home - the dsh user root.
 * @returns {Array<[string, string]>} `[strategy, anchor]` pairs, sorted by profile name.
 */
function profileFallbackAnchors(home) {
  const anchors = []
  try {
    const profilesRoot = join(home, 'profiles')
    const names = readdirSync(profilesRoot).sort()
    for (const entry of names) {
      const fallback = join(profilesRoot, entry, '.dsh-module-fallback')
      try {
        // Only real directories: a stray file with that name is not an anchor
        // Node can resolve from, and `createRequire` would silently walk up.
        if (!statSync(fallback).isDirectory()) continue
      } catch {
        continue
      }
      anchors.push([`module-fallback:${entry}`, join(fallback, 'noop.js')])
    }
  } catch {
    // No readable `profiles/` directory: the remaining anchors are enough.
  }
  return anchors
}

/**
 * Candidate `createRequire` anchors between this module and the filesystem root,
 * preferring the first ancestor that actually carries `@deepseek-ai/dsh-llm`.
 *
 * @returns {string[]} absolute anchor paths, nearest first.
 */
function ancestorAnchors() {
  const anchors = []
  try {
    let cursor = dirname(fileURLToPath(import.meta.url))
    for (let step = 0; step < MAX_ANCESTOR_WALK; step += 1) {
      const candidate = join(cursor, 'node_modules', 'noop.js')
      anchors.push(candidate)
      const parent = dirname(cursor)
      if (parent === cursor || parent.length < cursor.length) break
      cursor = parent
    }
  } catch {
    // `import.meta.url` is always a file URL in this deployment; keep the list
    // short rather than failing the whole resolution.
  }
  return anchors
}

/**
 * Whether a candidate path looks like an absolute path we can hand to
 * `createRequire` — a cheap guard so a malformed environment value cannot make
 * an anchor resolve relative to the process working directory.
 *
 * @param value - the candidate path.
 * @returns {boolean} whether it is absolute.
 */
function isAbsolutePath(value) {
  return typeof value === 'string' && value.length > 0 && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith(`\\${sep}`))
}

/**
 * Build a user message locally, matching `createUserMessage`'s output exactly.
 *
 * Measured against the real implementation (probe output recorded in the
 * package README): `createUserMessage({content, source})` spreads its input,
 * forces `role: 'user'`, mints `id` as `brandString(randomUUID())` — where
 * `brandString` is the identity function and `randomUUID` is a v4 UUID built
 * from `globalThis.crypto.getRandomValues` — and finally returns
 * `deepFreeze(structuredClone(message))`, i.e. a deep-frozen plain object with
 * exactly the keys `content`, `source`, `role`, `id`. No field is validated.
 *
 * The fallback therefore: mints a v4 UUID, deep-freezes the result, and uses a
 * plain `structuredClone` of the blocks. `structuredClone` is a global in Node
 * ≥ 17 and is exercised by this package's own tests.
 *
 * @param {{ content: object[], source: object }} input - the message body.
 * @returns {object} an immutable `UserMessage`.
 */
export function localCreateUserMessage(input) {
  const message = {
    content: structuredClone(input.content),
    source: { ...input.source },
    role: 'user',
    id: mintUuid(),
  }
  return deepFreeze(message)
}

/**
 * Mint a v4 UUID the way the harness does.
 *
 * `@deepseek-ai/dsh-util-crypto`'s `randomUUID` (read during the probe) is a v4
 * UUID over `globalThis.crypto.getRandomValues(16)`; `globalThis.crypto
 * .randomUUID()` produces the identical format, and is the standard Node API
 * for it. The manual form is kept as a fallback for a runtime without it.
 *
 * @returns {string} a lowercase v4 UUID.
 */
function mintUuid() {
  const standard = globalThis.crypto?.randomUUID
  if (typeof standard === 'function') return standard.call(globalThis.crypto)
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte, index) => {
    const value = index === 6 ? (byte & 15) | 64 : index === 8 ? (byte & 63) | 128 : byte
    return value.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Freeze a value and everything reachable from it, tolerating cycles and
 * already-frozen nodes. Mirrors `@deepseek-ai/dsh-util-values`'s `deepFreeze`
 * without importing it.
 *
 * @template T
 * @param {T} value - the value to freeze in place.
 * @returns {T} the same value.
 */
function deepFreeze(value) {
  const seen = new WeakSet()
  const pending = [value]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    for (const key of Object.keys(node)) pending.push(node[key])
  }
  return value
}

/**
 * Build the nudge-message factory once, so the resolution probes run at most
 * once per plugin activation.
 *
 * @param {unknown} [baseUrl] - `ctx.baseUrl`, used to anchor on the running profile first.
 * @returns {{ create: (text: string) => object, strategy: string, warning: string | undefined }} the factory, the winning strategy, and a one-line note when the local fallback was used.
 */
export function createNudgeFactory(baseUrl) {
  try {
    const resolved = resolveCreateUserMessage(baseUrl)
    if (typeof resolved.create === 'function') {
      return {
        strategy: resolved.strategy,
        warning: undefined,
        create: (text) => resolved.create({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }),
      }
    }
    return {
      strategy: 'local-fallback',
      warning: `${name}: @deepseek-ai/dsh-llm did not resolve; building the soft-nudge message with the local fallback constructor`,
      create: (text) => localCreateUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }),
    }
  } catch (error) {
    return {
      strategy: 'unavailable',
      warning: `${name}: nudge-message resolution failed (${renderThrown(error)}); the soft stage will log without nudging`,
      create: () => undefined,
    }
  }
}

/** Render a thrown value as one line. */
function renderThrown(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * The one line that records "this plugin was loaded by the host, with this
 * configuration".
 *
 * Written on **every** `apply`, before the `enabled` check, so `inactive
 * (enabled: false)` is visible evidence of a successful load rather than
 * silence. Kept to a single line so a reload cannot flood the file, and built
 * from already-normalized values only.
 *
 * @param {ReturnType<typeof normalizeConfig>} config - the resolved configuration.
 * @param {string | undefined} strategy - how `createUserMessage` resolved, when it was resolved at all.
 * @returns {string} the activation line, without a timestamp.
 */
export function activationLine(config, strategy) {
  const softThreshold = Math.round(config.budgetTokens * config.softRatio)
  const state = config.enabled ? `active createUserMessage=${strategy ?? 'unresolved'}` : 'inactive (enabled: false)'
  const logFile = config.logFile === null ? 'null' : `'${config.logFile}'`
  return [
    `activation: ${state}`,
    `budgetTokens=${config.budgetTokens}`,
    `softThreshold=${softThreshold}`,
    `softRatio=${config.softRatio}`,
    `presets=[${config.presets.join(', ')}]`,
    `cacheReadWeight=${config.cacheReadWeight}`,
    `softNudge=${config.softNudge}`,
    `stepNudge=${config.stepNudge}`,
    `stepTiers=[${config.stepTiers.join(', ')}]`,
    `dryRun=${config.dryRun}`,
    `hardDryRun=${config.hardDryRun}`,
    `logFile=${logFile}`,
  ].join(' ')
}

/**
 * Register the budget listener.
 *
 * Never throws: a failure here would fail the Cordis fiber, and `dsh` reports a
 * failed entry as a fatal startup error.
 *
 * Idempotent per context: the same context applied twice registers one hook,
 * while a re-apply after disposal (the hot-reload path) registers again.
 *
 * @param {object} ctx - the Cordis context owned by this plugin row.
 * @param {unknown} rawConfig - the row's `config:` block, untyped and untrusted.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  try {
    const config = normalizeConfig(rawConfig)
    const warn = (message) => {
      try {
        ctx?.logger?.warn?.(message)
      } catch {
        // A logger that throws must not escalate into a boot failure.
      }
    }
    const info = (message) => {
      try {
        ctx?.logger?.info?.(message)
      } catch {
        // Same contract as `warn`: a hostile logger cannot break the boot.
      }
    }

    // The logger exists BEFORE the enabled check, and exactly one activation
    // line is written on every apply — including a disabled one, so "the host
    // loaded this plugin" is never invisible again. This is boot-path code: the
    // announcement cannot throw, and the writer below swallows its own I/O
    // failures.
    const logger = createLogger(config.logFile, warn, info)
    // The resolution probes are skipped while disabled: they would load
    // `@deepseek-ai/dsh-llm` into the host for a plugin that does nothing.
    const factory = config.enabled ? createNudgeFactory(ctx?.baseUrl) : undefined
    if (factory?.warning !== undefined) warn(factory.warning)
    try {
      const line = activationLine(config, factory?.strategy)
      info(`${name}: ${line}`)
      logger.activation(line)
    } catch (error) {
      warn(`${name}: the activation line could not be written (${renderThrown(error)})`)
    }

    if (!config.enabled) return
    if (typeof ctx?.on !== 'function') {
      warn(`${name}: context has no event API; the token budget is inactive`)
      return
    }
    if (isWeakKey(ctx) && appliedContexts.has(ctx)) {
      warn(`${name}: this context already applied the plugin; the duplicate registration is skipped (two registrations would nudge and cancel twice)`)
      logger.activation('registration skipped: this context already applied the plugin')
      return
    }
    if (activeRegistrations > 0) {
      const note = `${activeRegistrations} registration(s) are already active — the plugin looks mounted twice and any child both registrations see will be counted twice. The duplicate is NOT skipped: a legitimate remount must keep working.`
      warn(`${name}: ${note}`)
      logger.activation(`warning: ${note}`)
    }

    // Per-session state, keyed by `agent.id` (the session id), one entry per
    // child residency epoch:
    //
    //   { steps, nudged, firedTiers }
    //
    // `steps` is the number of steps this listener has watched a governed child
    // enter, and it has to exist for a checkpoint to be countable — so with
    // `stepNudge` on (the default) the first governed step allocates it. With
    // `stepNudge: false` nothing here is allocated on a pass-through step, which
    // keeps the token stage's original zero-allocation property. `nudged` is the
    // token stage's once-per-epoch flag, set only once its instruction was
    // really delivered (or, with `softNudge: false`, once its single log line
    // was written). `firedTiers` holds the index of every step tier already
    // fired, so its length is bounded by the configured `stepTiers` (at most
    // MAX_STEP_TIERS).
    //
    // Entries are removed on `subagent/end` and cleared wholesale by a
    // `ctx.effect` disposer, so a long-lived host cannot accumulate children.
    const sessions = new Map()
    let handlerFailed = false
    let noBudgetDataLogged = false

    /**
     * Note — at most once per activation — that a governed child has no budget
     * data. Deliberately NOT kept in the per-session map: a child with no
     * projection has nothing to nudge or stop with, so remembering it there
     * would only give the map a second, unbounded growth path.
     *
     * The step stage does not need the projection, so this no longer means the
     * child is untouched — only that its token stages are inert.
     */
    const noteNoBudgetData = (agent) => {
      if (noBudgetDataLogged) return
      noBudgetDataLogged = true
      logger.log(`no budget data: passing through the token stages label=${labelOf(agent)}`)
    }

    /** The state shape for one child, so every writer touches the same keys. */
    const emptyEntry = () => ({ steps: 0, nudged: false, firedTiers: [] })

    /**
     * The state entry for one child.
     *
     * @param key - the session key, or `undefined` when the agent has no usable id.
     * @param create - whether a missing entry may be allocated.
     * @returns the live entry, or `undefined` when there is nothing to read.
     */
    const entryOf = (key, create) => {
      if (key === undefined) return undefined
      try {
        let entry = sessions.get(key)
        if (entry === undefined && create) {
          entry = emptyEntry()
          sessions.set(key, entry)
        }
        return entry
      } catch {
        // An unusable map costs one skipped reminder, never a failed step.
        return undefined
      }
    }

    /**
     * Record that this session has had its one-shot token soft stage. Skipped
     * while `dryRun` is on: a calibration run must not consume the flag, so the
     * real nudge still lands the first time the budget is armed on that session.
     */
    const markNudged = (key) => {
      const entry = entryOf(key, true)
      if (entry !== undefined) entry.nudged = true
    }

    /**
     * Count one *entered* step for a governed child, and return its entry.
     *
     * Only an entered step counts: a step a downstream listener rejected never
     * opened, so it is not charged against the child. Counting happens under
     * `dryRun` too — without it there would be nothing to calibrate — but it
     * consumes no flag, so arming afterwards still delivers that checkpoint.
     *
     * @param key - the session key.
     * @returns the entry carrying the new count, or `undefined`.
     */
    const markStep = (key) => {
      const entry = entryOf(key, true)
      if (entry === undefined) return undefined
      entry.steps = (typeof entry.steps === 'number' && Number.isFinite(entry.steps) ? entry.steps : 0) + 1
      return entry
    }

    /** Record that one step tier has fired, so it never fires twice per epoch. */
    const markTierFired = (key, index) => {
      const entry = entryOf(key, true)
      if (entry === undefined) return
      if (!Array.isArray(entry.firedTiers)) entry.firedTiers = []
      if (!entry.firedTiers.includes(index)) entry.firedTiers.push(index)
    }

    /**
     * Read the projection service lazily — never a hard `inject`, which would
     * leave the entry `pending` (a fatal boot error) if the service is absent.
     * A live handle wins; a previously resolved one is reused while it still
     * exposes `stateOf`, so a transient lookup failure does not lose the
     * service we already hold.
     *
     * @param {object | undefined} state - the session's state entry, used to cache the handle.
     * @returns {object | undefined} the registry, when one is reachable.
     */
    const projectionsOf = (state) => {
      try {
        const service = ctx.get?.('sessionProjections')
        if (service !== undefined && service !== null && typeof service.stateOf === 'function') {
          if (state !== undefined) state.projections = service
          return service
        }
      } catch {
        // Fall through to the cached handle below.
      }
      if (state?.projections !== undefined && typeof state.projections.stateOf === 'function') {
        return state.projections
      }
      return undefined
    }

    /**
     * Build one reminder message, or `undefined` when it cannot be constructed.
     *
     * @param text - the instruction text to wrap.
     * @returns {object | undefined} the message to append.
     */
    const buildNudge = (text) => {
      try {
        const message = factory?.create(text)
        return typeof message === 'object' && message !== null ? message : undefined
      } catch (error) {
        warn(`${name}: nudge construction failed (${renderThrown(error)}); continuing without the instruction`)
        return undefined
      }
    }

    /**
     * The reminder stages, run strictly AFTER a successful `next()`.
     *
     * Everything here is a no-throw zone on purpose: the decision returned by
     * `next()` is already the chain's answer, and re-entering `next()` is
     * forbidden, so a failure in this function must leave that decision alone.
     * The caller wraps it anyway.
     *
     * Two triggers are evaluated per step, and **at most one message is
     * appended**:
     *
     * - the **token** soft stage (`stage === SOFT`), once per residency epoch;
     * - the **step** checkpoint, once per configured tier per residency epoch.
     *
     * When both are due on the same step the token wrap-up wins: it is the more
     * urgent of the two (the budget is nearly spent), and adding a second
     * near-identical message to the same step would pay for the same advice
     * twice on every later step of the child. The step tier is consumed either
     * way — the child has been told to converge.
     *
     * A flag is only consumed once its instruction was *really delivered* (or,
     * with `softNudge: false`, once its single log line was written): a child
     * whose downstream listener rejected the step has NOT been told anything
     * yet, and must still be reminded on a later step.
     *
     * @param {{ agent: object, decision: object, usage: number | undefined, stage: string, key: string | undefined }} input - the step's outcome.
     * @returns {object} the decision to return, possibly carrying one reminder.
     */
    const postStep = ({ agent, decision, usage, stage, key }) => {
      const entered = decision?.kind === 'enter' && Array.isArray(decision.messages)
      const kind = decision?.kind ?? 'undefined'
      const summary = `usage=${usage} budget=${config.budgetTokens} label=${labelOf(agent)}`

      // Step accounting. With `stepNudge: false` nothing is allocated here, so
      // the token stage keeps its old zero-allocation pass-through.
      const entry = config.stepNudge && entered ? markStep(key) : entryOf(key, false)
      const stepCount = typeof entry?.steps === 'number' && Number.isFinite(entry.steps) ? entry.steps : 0
      const tokenDue = stage === SOFT && entry?.nudged !== true
      // Evaluated even when the step was not entered, so calibration can report
      // "a checkpoint was due, but the decision was not an entry" the same way
      // it does for the token stage. The flag is not consumed in that case.
      const tierIndex = config.stepNudge
        ? dueStepTier({ tiers: config.stepTiers, stepCount, firedTiers: entry?.firedTiers })
        : undefined
      const tierSummary = tierIndex === undefined
        ? undefined
        : `tier=${tierIndex + 1}/${config.stepTiers.length} step=${stepCount} ${summary}`

      if (config.dryRun) {
        // Calibration: report what an armed plugin would do, change nothing.
        if (stage === SOFT) {
          if (!config.softNudge) {
            logger.log(`dry-run soft stage: would not nudge (softNudge: false, would log once) ${summary}`)
          } else if (!entered) {
            logger.log(`dry-run soft stage: would not nudge (decision kind=${kind}) ${summary}`)
          } else if (buildNudge(NUDGE_TEXT) === undefined) {
            logger.log(`dry-run soft stage: would not nudge (nudge construction failed) ${summary}`)
          } else {
            logger.log(`dry-run soft stage: would nudge ${summary}`)
          }
        }
        if (tierSummary !== undefined) {
          if (!config.softNudge) {
            logger.log(`dry-run step stage: would not nudge (softNudge: false, would log once) ${tierSummary}`)
          } else if (!entered) {
            logger.log(`dry-run step stage: would not nudge (decision kind=${kind}) ${tierSummary}`)
          } else if (buildNudge(stepNudgeText({ tierIndex, tierCount: config.stepTiers.length, stepCount })) === undefined) {
            logger.log(`dry-run step stage: would not nudge (nudge construction failed) ${tierSummary}`)
          } else {
            logger.log(`dry-run step stage: would nudge ${tierSummary}`)
          }
        }
        return decision
      }

      let result = decision
      let delivered = false

      if (tokenDue) {
        if (!config.softNudge) {
          markNudged(key)
          logger.log(`soft stage (no nudge configured) ${summary}`)
        } else {
          const message = entered ? buildNudge(NUDGE_TEXT) : undefined
          if (message === undefined) {
            // The flag stays unset: nothing was delivered, so a later step may
            // still deliver the instruction.
            logger.log(`soft stage (no nudge injected: ${entered ? 'nudge construction failed' : `decision kind=${kind}`}) ${summary}`)
          } else {
            result = { ...result, messages: [...result.messages, message] }
            delivered = true
            markNudged(key)
            logger.log(`soft stage: nudged ${summary}`)
          }
        }
      }

      if (tierSummary !== undefined) {
        if (!config.softNudge) {
          markTierFired(key, tierIndex)
          logger.log(`step stage (no nudge configured) ${tierSummary}`)
        } else if (delivered) {
          // One reminder per step: this checkpoint rides the token wrap-up that
          // was just appended, and the tier is consumed because the child has
          // been told to converge.
          markTierFired(key, tierIndex)
          logger.log(`step stage: folded into the token wrap-up ${tierSummary}`)
        } else {
          const message = entered
            ? buildNudge(stepNudgeText({ tierIndex, tierCount: config.stepTiers.length, stepCount }))
            : undefined
          if (message === undefined) {
            logger.log(`step stage (no nudge injected: ${entered ? 'nudge construction failed' : `decision kind=${kind}`}) ${tierSummary}`)
          } else {
            result = { ...result, messages: [...result.messages, message] }
            delivered = true
            markTierFired(key, tierIndex)
            logger.log(`step stage: nudged ${tierSummary}`)
          }
        }
      }

      return result
    }

    // The payload is taken whole and destructured INSIDE the try: a malformed
    // payload must not be able to throw out of the listener. `call` tracks the
    // one `next()` call this listener is ever allowed to make.
    const handler = async (payload, next) => {
      const call = { called: false, failed: false }
      const callNext = () => {
        if (call.called) {
          // Unreachable by construction; a second `next()` would re-enter the
          // built-in step behaviour, so it fails loudly instead.
          return Promise.reject(new Error(`${name}: next() has already been called`))
        }
        call.called = true
        let result
        try {
          result = next()
        } catch (error) {
          call.failed = true
          throw error
        }
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
          return result.then(
            (value) => value,
            (error) => {
              call.failed = true
              throw error
            },
          )
        }
        return result
      }

      try {
        return await guard(payload?.agent, callNext)
      } catch (error) {
        if (call.failed) {
          // A downstream `agent/pre-step` listener threw. Propagate exactly as
          // the harness does without this plugin: never retried, never
          // converted into a silent pass-through.
          throw error
        }
        if (!handlerFailed) {
          handlerFailed = true
          warn(`${name}: pre-step handler failed (${renderThrown(error)}); passing the step through`)
        }
        if (call.called) {
          // A successful `next()` already produced the chain's decision and it
          // cannot be re-run; nothing may swallow this.
          throw error
        }
        return await callNext()
      }
    }

    /** The real body; every early exit delegates with `next()`. */
    const guard = async (agent, callNext) => {
      if (!isDelegatedChild(agent)) return callNext()
      if (!presetIsGoverned(agent, config.presets)) return callNext()

      const key = sessionKeyOf(agent)
      const state = entryOf(key, false)
      const projections = projectionsOf(state)
      let usage
      if (projections === undefined) {
        // "No budget data" is not "no budget": a missing service or a missing
        // projection must never stop a child. Reported at most once. The step
        // stage needs no projection, so it still runs.
        noteNoBudgetData(agent)
      } else {
        usage = cumulativeUsageOf(projections.stateOf(agent.session, 'tokenUsage'), config.cacheReadWeight)
        if (usage === undefined) noteNoBudgetData(agent)
      }

      const stage = usage === undefined
        ? PASS
        : decide({ usage, budgetTokens: config.budgetTokens, softRatio: config.softRatio })

      if (stage === HARD) {
        if (config.dryRun || config.hardDryRun) {
          // Calibration: nothing is cancelled and the step is delegated
          // through, but the line says exactly what would have happened. It is
          // the same line `dryRun` writes, because it is the same fact: the
          // destructive stage is running dry.
          logger.log(`dry-run hard stage: would cancel usage=${usage} budget=${config.budgetTokens} label=${labelOf(agent)}`)
        } else {
          // `cancel` aborts the in-flight turn so no further requests are
          // billed, and the `reject` guarantees the loop does not proceed to
          // derivation even if the abort lands late: the agent loop maps a
          // rejected pre-step to a `blocked` turn end without opening a step
          // (`@deepseek-ai/dsh-agent-loop/lib/index.js` `turn()`), so the child
          // surfaces to the dispatcher as a cancelled run **with its partial
          // output**, which the delegation tool appends
          // (`@deepseek-ai/dsh-tool-subagent/lib/index.js:305-323`). `next()` is
          // deliberately NOT called: the budget decision is final.
          logger.log(`hard stage: cancel usage=${usage} budget=${config.budgetTokens} label=${labelOf(agent)}`)
          try {
            agent.cancel({ kind: 'parent' })
          } catch (error) {
            warn(`${name}: agent.cancel failed (${renderThrown(error)})`)
          }
          return { kind: 'reject' }
        }
      }

      // The reminder stages must delegate first, because a reminder rides the
      // decision the rest of the chain produced (the first-party idiom in
      // `@deepseek-ai/dsh-hooks-codex/lib/index.js:224-230`).
      const decision = await callNext()
      // From here on, nothing may throw: `next()` has run, so its decision is
      // final and this listener must not re-enter the chain.
      try {
        return postStep({ agent, decision, usage, stage, key })
      } catch (error) {
        warn(`${name}: the reminder stages failed after next() (${renderThrown(error)}); returning the decision unchanged`)
        return decision
      }
    }

    ctx.on('agent/pre-step', handler, GLOBAL)

    // State hygiene: clean up on the child's settle edge when the lifecycle is
    // available, and unconditionally on disposal.
    try {
      ctx.on('subagent/end', (info2) => {
        try {
          // The subagent layer emits this once per residency epoch, so a
          // continuable child that is resumed later starts a fresh epoch and can
          // be nudged again — which is the intended behaviour: the resumed child
          // has a new plan and a new chance to run away with the budget.
          const id = typeof info2?.id === 'string' ? info2.id : undefined
          if (id === undefined) return
          if (sessions.delete(id)) logger.log(`settled: released session state label=${id}`)
        } catch {
          // A settle-edge bug must never disturb the runtime.
        }
      }, GLOBAL)
    } catch (error) {
      warn(`${name}: subagent/end is unavailable (${renderThrown(error)}); release relies on disposal only`)
    }

    if (isWeakKey(ctx)) appliedContexts.add(ctx)
    activeRegistrations += 1
    let disposed = false
    try {
      ctx.effect(() => () => {
        if (disposed) return
        disposed = true
        try {
          sessions.clear()
        } catch {
          // Nothing to do: an unusable map is already unreachable.
        }
        if (isWeakKey(ctx)) appliedContexts.delete(ctx)
        activeRegistrations = Math.max(0, activeRegistrations - 1)
      })
    } catch (error) {
      warn(`${name}: ctx.effect is unavailable (${renderThrown(error)}); the registration cannot be disposed and its per-session state lives until the host restarts`)
    }

    /**
     * Exposed for tests only: the live per-session map, the config actually in
     * force, and the resolved nudge strategy. Nothing in the runtime reads it.
     */
    Object.defineProperty(handler, 'testState', {
      value: { sessions, strategy: factory?.strategy, config },
      enumerable: false,
    })
  } catch (error) {
    // Degrade to a no-op rather than failing the fiber: an entry that throws
    // out of `apply` becomes `plugin(s) failed to load; Cordis startup failed`.
    try {
      ctx?.logger?.warn?.(`${name}: apply failed (${renderThrown(error)}); the token budget is inactive`)
    } catch {
      // Nothing left to report through.
    }
  }
}

/**
 * The map key for one agent. `Agent.id` is the session id
 * (`@deepseek-ai/dsh-agent/lib/types/types.d.ts:11-13`), which is also the
 * `id` a `subagent/end` notification carries, so the settle edge can find the
 * entry it must release.
 *
 * @param {object | undefined} agent - the agent.
 * @returns {string | undefined} the key, or `undefined` when there is none.
 */
function sessionKeyOf(agent) {
  const id = agent?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** A short human-readable label for one agent, used only in log lines. */
function labelOf(agent) {
  const preset = agent?.session?.header?.agentPreset
  const id = sessionKeyOf(agent)
  return `${typeof preset === 'string' ? preset : 'unknown'}/${id ?? 'unknown'}`
}

/**
 * Build the log writer.
 *
 * `activation` writes a load-time line (the activation line itself, or a
 * registration note such as "this context already applied the plugin") to the
 * file only; `log` writes one line per decision event. Only these events reach
 * `logFile`: load-time lines, a token soft stage event, a step checkpoint
 * event, a hard stop, a settle, a dry-run decision and the at-most-once "no
 * budget data" note — a plain PASS step logs nothing. The first line written
 * through `log` also goes to the host log once, so an armed plugin is
 * observable without flooding `ctx.logger` at every step.
 *
 * A relative `logFile` disables file logging with a warning (the row is composed
 * from YAML, where a relative path would silently resolve against the host's
 * working directory). Nothing here can throw: an unwritable file or a hostile
 * logger is swallowed.
 *
 * @param {string | null} logFile - the configured absolute path, or `null`.
 * @param {(message: string) => void} warn - the plugin's warn sink.
 * @param {(message: string) => void} info - the plugin's info sink.
 * @returns {{ activation: (message: string) => void, log: (message: string) => void }} the writer.
 */
function createLogger(logFile, warn, info) {
  if (logFile !== null && !isAbsolutePath(logFile)) {
    warn(`${name}: logFile is not an absolute path; file logging is disabled`)
    logFile = null
  }
  const write = (message) => {
    if (logFile === null) return
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8')
    } catch {
      // A log file we cannot write is never a reason to disturb a turn.
    }
  }
  let decisions = 0
  return {
    activation: (message) => write(message),
    log: (message) => {
      if (decisions === 0) info(`${name}: first decision: ${message}`)
      decisions += 1
      write(message)
    },
  }
}

/** Re-exported so a caller can build a standalone decision without this file. */
export { decide, cumulativeUsageOf, delegationDepthOf, dueStepTier, isDelegatedChild, presetIsGoverned }
