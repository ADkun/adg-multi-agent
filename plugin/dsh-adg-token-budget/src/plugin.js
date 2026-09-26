/**
 * dsh-adg-token-budget — a host-plane DSH/Cordis plugin that reminds the
 * **delegated children of an `adg` agent preset** to converge, once per
 * configured step checkpoint.
 *
 * It is a backstop, not a scheduler. It registers exactly one
 * `agent/pre-step` waterfall listener and decides on every proposed step of
 * every governed child, on one trigger:
 *
 * | Stage | Trigger | Action |
 * | --- | --- | --- |
 * | step | the child is entering its `stepTiers[n]`-th step | `next()` first, then append the nth convergence reminder to the returned `{kind:'enter'}` decision's `messages` — at most once per tier per residency epoch |
 *
 * The step stage exists because it is the one lever the dispatcher cannot pull
 * itself, and it is now the *only* place the reminder lives: the persona used to
 * tell the dispatcher to put a convergence scale in every delegation prompt and
 * not to poll for step counts, and both lines were deleted. The first duplicated
 * a signal this plugin already sends from `stepTiers` — and the two would drift,
 * since a tier change is a hot-reload while a persona change needs a restart.
 * The second is already stated by the `job_output` / `subagent` tool docs. What
 * remains genuinely belongs here: the dispatcher cannot see how many steps a
 * running child has taken, and polling for it re-sends the dispatcher's own
 * context (the largest in the run, 59% of the audited bill) once per poll, which
 * costs far more than the reminder saves. So the reminder is injected here,
 * deterministically and on the dispatcher's behalf. **At most one reminder
 * message is appended per step**, and cost is the reason: an injected message
 * stays in the child's context and is re-sent on every later step.
 *
 * ## What this plugin no longer does
 *
 * Earlier versions also read `ctx.get('sessionProjections')?.stateOf(
 * agent.session, 'tokenUsage')` and intervened on the cumulative figure: a
 * wrap-up instruction at `budgetTokens * softRatio`, and
 * `agent.cancel({ kind: 'parent' })` plus `{ kind: 'reject' }` at
 * `budgetTokens`. Both stages are gone, along with the `budgetTokens`,
 * `softRatio`, `cacheReadWeight`, `softNudge` and `hardDryRun` options.
 *
 * The reason is that a token budget is the wrong instrument for the tasks this
 * preset delegates. An output-shaped job — drafting a document, rendering a
 * report, digesting a long corpus — genuinely needs the tokens it needs, and a
 * threshold truncates the deliverable instead of saving anything; a large total
 * is not by itself evidence of a runaway loop. A **step** count measures the
 * thing that actually goes wrong (a child that keeps exploring without
 * converging), and the reminder it injects is a choice the child may disregard
 * rather than an order.
 *
 * So this plugin never calls `agent.cancel`, never rejects a step, never reads a
 * token projection, and has no destructive stage: `{kind:'reject'}` does not
 * appear anywhere in its code path.
 *
 * With `dryRun: true` every checkpoint decision is computed and logged but
 * nothing is injected; the step is delegated through `next()` as usual, and no
 * tier is consumed, so arming the plugin afterwards still delivers that
 * checkpoint. Steps are still counted, because "which step would have been
 * reminded" is the fact being calibrated.
 *
 * The step count needs no projection: it is the number of steps this listener
 * has watched the child enter.
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
 * double every decision — two reminders on the same checkpoint step. The entry
 * is removed again when the registration is disposed, so a legitimate remount
 * keeps working.
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
 * The built-in step-checkpoint body: a choice, not an order.
 *
 * This is deliberately *not* an instruction to stop. The measured distribution
 * of delegated children (median 39 steps, but a p10 of 6 and a quarter of them
 * at 14 or fewer) says most children are shorter than the average — which is
 * exactly the case for asking the question early. But an early checkpoint can
 * only be safe if it cannot push a child into under-delivering, so the body
 * does three things and no more:
 *
 * 1. says outright that it is optional and may be ignored, so continuing costs
 *    the child nothing;
 * 2. names both options symmetrically — wrap up once the goal can already be
 *    answered, or keep working and disregard the reminder — and leaves the
 *    choice to the task;
 * 3. asks for one sentence naming the choice, which is the only reason the
 *    message can change anything at all: it forces a decision the child would
 *    otherwise not stop to make.
 *
 * What it must never do is trade the result for tokens, so the body does not
 * prescribe *what* to report: the first branch only asks whether the goal can
 * already be answered and, if so, to wrap up. Which parts were delivered and
 * which were left unverified is the child's call — it is the only one that
 * knows. The suite pins all three properties, and the wording is overridable
 * through `stepText` for operators who want to tune it without a new package.
 */
export const STEP_CHOICE_BODY = [
  '这是一条**可选**提醒，不是停止指令。请你自己判断，二选一：',
  '- **如果现有产出已经能回答委派目标，就收尾汇报。**',
  '- **继续**：如果确实还有必须做完的工作，就继续做，**直接无视这条提醒**，不要为了回应它而缩减或改写计划。',
  '选哪个由任务本身决定，不是由这条提醒决定。请在下一条消息开头用一句话说明你的选择，然后按你的选择继续。',
].join('\n')

/**
 * The sentence the built-in body adds on the last tier only.
 *
 * The ladder stops reminding after this one, so a child that keeps going gets
 * asked to commit to a bound. It is information for the child, not pressure:
 * there is nothing left to escalate to.
 */
export const STEP_LAST_TAIL = [
  '',
  '这是本轮的最后一个检查点，后面不会再提醒。如果选择继续，请顺便写一句预计还需要多少步、以及完成标准是什么。',
].join('\n')

/**
 * Build the Nth convergence reminder.
 *
 * The count is included because a concrete number is what makes the checkpoint
 * actionable ("this is step 12"), and the ordinal tells the child how many
 * checkpoints it has passed. The builder is pure and total: out-of-contract
 * input falls back to the first tier with a zero count instead of throwing
 * inside a live step.
 *
 * A `body` replaces the built-in text *entirely*, including the last-tier
 * sentence — a custom body is the operator's wording, and appending to it would
 * be editing it.
 *
 * @param {{ tierIndex?: number, tierCount?: number, stepCount?: number, body?: string|null }} input - where the checkpoint sits, how many steps the child took, and an optional custom body.
 * @returns {string} the message text.
 */
export function stepNudgeText(input) {
  const tierIndex = Number.isInteger(input?.tierIndex) && input.tierIndex >= 0 ? input.tierIndex : 0
  const tierCount = Number.isInteger(input?.tierCount) && input.tierCount >= 1 ? input.tierCount : 1
  const stepCount = typeof input?.stepCount === 'number' && Number.isFinite(input.stepCount)
    ? Math.max(0, Math.round(input.stepCount))
    : 0
  const custom = typeof input?.body === 'string' && input.body.trim() !== '' ? input.body : undefined
  const body = custom ?? (tierIndex >= tierCount - 1 ? STEP_CHOICE_BODY + STEP_LAST_TAIL : STEP_CHOICE_BODY)
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
      warning: `${name}: @deepseek-ai/dsh-llm did not resolve; building the checkpoint message with the local fallback constructor`,
      create: (text) => localCreateUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }),
    }
  } catch (error) {
    return {
      strategy: 'unavailable',
      warning: `${name}: nudge-message resolution failed (${renderThrown(error)}); a due checkpoint will log without nudging`,
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
  const state = config.enabled ? `active createUserMessage=${strategy ?? 'unresolved'}` : 'inactive (enabled: false)'
  const logFile = config.logFile === null ? 'null' : `'${config.logFile}'`
  return [
    `activation: ${state}`,
    `presets=[${config.presets.join(', ')}]`,
    `stepNudge=${config.stepNudge}`,
    `stepTiers=[${config.stepTiers.join(', ')}]`,
    // A custom body is a wording change with no other visible trace, and a
    // mistyped `stepText` key would silently fall back to the built-in one. The
    // marker is one word rather than the text itself: the line stays one line.
    `stepText=${config.stepText === null ? 'builtin' : 'custom'}`,
    `dryRun=${config.dryRun}`,
    `logFile=${logFile}`,
  ].join(' ')
}

/**
 * Register the checkpoint listener.
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
      warn(`${name}: context has no event API; the step checkpoints are inactive`)
      return
    }
    if (isWeakKey(ctx) && appliedContexts.has(ctx)) {
      warn(`${name}: this context already applied the plugin; the duplicate registration is skipped (two registrations would inject two reminders for the same checkpoint)`)
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
    //   { steps, firedTiers }
    //
    // `steps` is the number of steps this listener has watched a governed child
    // enter, and it has to exist for a checkpoint to be countable — so with
    // `stepNudge` on (the default) the first governed step allocates it. With
    // `stepNudge: false` nothing here is allocated at all. `firedTiers` holds
    // the index of every step tier already fired, so its length is bounded by
    // the configured `stepTiers` (at most MAX_STEP_TIERS).
    //
    // Entries are removed on `subagent/end` and cleared wholesale by a
    // `ctx.effect` disposer, so a long-lived host cannot accumulate children.
    const sessions = new Map()
    let handlerFailed = false

    /** The state shape for one child, so every writer touches the same keys. */
    const emptyEntry = () => ({ steps: 0, firedTiers: [] })

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
     * The checkpoint stage, run strictly AFTER a successful `next()`.
     *
     * Everything here is a no-throw zone on purpose: the decision returned by
     * `next()` is already the chain's answer, and re-entering `next()` is
     * forbidden, so a failure in this function must leave that decision alone.
     * The caller wraps it anyway.
     *
     * One trigger is evaluated per step, and **at most one message is
     * appended**: the step checkpoint, once per configured tier per residency
     * epoch. A tier is only consumed once its reminder was *really delivered*:
     * a child whose downstream listener rejected the step has NOT been told
     * anything yet, and must still be reminded on a later step.
     *
     * @param {{ agent: object, decision: object, key: string | undefined }} input - the step's outcome.
     * @returns {object} the decision to return, possibly carrying one reminder.
     */
    const postStep = ({ agent, decision, key }) => {
      const entered = decision?.kind === 'enter' && Array.isArray(decision.messages)
      const kind = decision?.kind ?? 'undefined'
      const label = labelOf(agent)

      // Step accounting: only an entered step is counted, and a step the child
      // never entered costs no tier. Counting happens under `dryRun` too —
      // without it there would be nothing to calibrate.
      const entry = entered ? markStep(key) : entryOf(key, false)
      const stepCount = typeof entry?.steps === 'number' && Number.isFinite(entry.steps) ? entry.steps : 0
      // Evaluated even when the step was not entered, so a rejected step can
      // never silently spend a checkpoint it did not deliver: the tier stays owed
      // until an entered step actually carries the reminder.
      const tierIndex = dueStepTier({ tiers: config.stepTiers, stepCount, firedTiers: entry?.firedTiers })
      const tierSummary = tierIndex === undefined
        ? undefined
        : `tier=${tierIndex + 1}/${config.stepTiers.length} step=${stepCount} label=${label}`

      if (tierSummary === undefined) return decision

      if (config.dryRun) {
        // Calibration: report what an armed plugin would do, change nothing.
        if (!entered) {
          logger.log(`dry-run step stage: would not nudge (decision kind=${kind}) ${tierSummary}`)
        } else if (buildNudge(stepNudgeText({ tierIndex, tierCount: config.stepTiers.length, stepCount, body: config.stepText })) === undefined) {
          logger.log(`dry-run step stage: would not nudge (nudge construction failed) ${tierSummary}`)
        } else {
          logger.log(`dry-run step stage: would nudge ${tierSummary}`)
        }
        return decision
      }

      const message = entered
        ? buildNudge(stepNudgeText({ tierIndex, tierCount: config.stepTiers.length, stepCount, body: config.stepText }))
        : undefined
      if (message === undefined) {
        // The tier stays unconsumed: nothing was delivered, so a later step may
        // still deliver the reminder.
        logger.log(`step stage (no nudge injected: ${entered ? 'nudge construction failed' : `decision kind=${kind}`}) ${tierSummary}`)
        return decision
      }
      markTierFired(key, tierIndex)
      logger.log(`step stage: nudged ${tierSummary}`)
      return { ...decision, messages: [...decision.messages, message] }
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
      // With the checkpoints off there is nothing to decide and nothing to
      // count, so the step passes straight through without allocating state.
      if (!config.stepNudge) return callNext()

      const key = sessionKeyOf(agent)
      // The reminder must delegate first, because it rides the decision the rest
      // of the chain produced (the first-party idiom in
      // `@deepseek-ai/dsh-hooks-codex/lib/index.js:224-230`).
      const decision = await callNext()
      // From here on, nothing may throw: `next()` has run, so its decision is
      // final and this listener must not re-enter the chain.
      try {
        return postStep({ agent, decision, key })
      } catch (error) {
        warn(`${name}: the checkpoint stage failed after next() (${renderThrown(error)}); returning the decision unchanged`)
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
      ctx?.logger?.warn?.(`${name}: apply failed (${renderThrown(error)}); the step checkpoints are inactive`)
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
 * `logFile`: load-time lines, a step checkpoint event, a settle, a dry-run
 * decision and a "nudge could not be delivered" note — a step with no
 * checkpoint due logs nothing. The first line written
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
export { delegationDepthOf, dueStepTier, isDelegatedChild, presetIsGoverned }
