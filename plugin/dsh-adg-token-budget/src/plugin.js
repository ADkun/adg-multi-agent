/**
 * dsh-adg-token-budget — a host-plane DSH/Cordis plugin that puts a two-stage
 * cumulative token budget on the **delegated children of an `adg` agent
 * preset**.
 *
 * One delegated expert can otherwise burn millions of tokens in an unbounded
 * exploration loop; this plugin is the backstop, not a scheduler. It registers
 * exactly one `agent/pre-step` waterfall listener and decides on every proposed
 * step of every governed child:
 *
 * | Stage | Trigger | Action |
 * | --- | --- | --- |
 * | soft | `usage >= budgetTokens * softRatio` | `next()` first, then append one wrap-up instruction to the returned `{kind:'enter'}` decision's `messages` |
 * | hard | `usage >= budgetTokens` | `agent.cancel({kind:'parent'})` and return `{kind:'reject'}` without calling `next()` |
 *
 * With `dryRun: true` both decisions are computed and logged but nothing is
 * injected and nothing is cancelled; the step is delegated through `next()`
 * even at the hard stage, so a budget can be calibrated against real traffic
 * before it is armed.
 *
 * Cumulative usage is
 * `uncachedInputTokens + outputTokens + cacheReadTokens * cacheReadWeight +
 * cacheWriteTokens`, read from `ctx.get('sessionProjections')?.stateOf(
 * agent.session, 'tokenUsage')`, whose `totals` are cumulative over the whole
 * session log.
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

/** The instruction appended at the soft stage: stop exploring, report now. */
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
    `dryRun=${config.dryRun}`,
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

    // Per-session state, keyed by `agent.id` (the session id). An entry is
    // created only when the soft stage delivers its one-shot action (the nudge,
    // or the single log line when `softNudge` is false), and removed on
    // `subagent/end`, so a long-lived host cannot accumulate children.
    const sessions = new Map()
    let handlerFailed = false
    let noBudgetDataLogged = false

    /**
     * Note — at most once per activation — that a governed child has no budget
     * data. Deliberately NOT kept in the per-session map: a child with no
     * projection has nothing to nudge or stop, so remembering it there would
     * only give the map a second, unbounded growth path.
     */
    const noteNoBudgetData = (agent) => {
      if (noBudgetDataLogged) return
      noBudgetDataLogged = true
      logger.log(`no budget data: passing through label=${labelOf(agent)}`)
    }

    /**
     * Record that this session has had its one-shot soft stage. Skipped while
     * `dryRun` is on: a calibration run must not consume the flag, so the real
     * nudge still lands the first time the budget is armed on that session.
     */
    const markNudged = (key) => {
      if (key === undefined) return
      try {
        const entry = sessions.get(key) ?? { nudged: false }
        entry.nudged = true
        sessions.set(key, entry)
      } catch {
        // An unusable map costs one repeated log line, never a failed step.
      }
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
     * Build the wrap-up message, or `undefined` when it cannot be constructed.
     *
     * @returns {object | undefined} the message to append.
     */
    const buildNudge = () => {
      try {
        const message = factory?.create(NUDGE_TEXT)
        return typeof message === 'object' && message !== null ? message : undefined
      } catch (error) {
        warn(`${name}: nudge construction failed (${renderThrown(error)}); continuing without the instruction`)
        return undefined
      }
    }

    /**
     * The soft stage, run strictly AFTER a successful `next()`.
     *
     * Everything here is a no-throw zone on purpose: the decision returned by
     * `next()` is already the chain's answer, and re-entering `next()` is
     * forbidden, so a failure in this function must leave that decision alone.
     * The caller wraps it anyway.
     *
     * The once-per-session flag is only set once the instruction is really
     * appended to an entering decision (or, with `softNudge: false`, once its
     * single log line has been written): a child whose downstream listener
     * rejected the step has NOT been told anything yet, and must still be
     * nudged on a later step.
     *
     * @param {{ agent: object, decision: object, usage: number, alreadyNudged: boolean, key: string | undefined }} input - the step's outcome.
     * @returns {object} the decision to return, possibly carrying the nudge.
     */
    const softStage = ({ agent, decision, usage, alreadyNudged, key }) => {
      if (alreadyNudged) return decision
      const label = labelOf(agent)
      const summary = `usage=${usage} budget=${config.budgetTokens} label=${label}`
      const kind = decision?.kind ?? 'undefined'
      const deliverable = decision?.kind === 'enter' && Array.isArray(decision.messages)

      if (config.dryRun) {
        // Calibration: report what an armed plugin would do, change nothing.
        if (!config.softNudge) {
          logger.log(`dry-run soft stage: would not nudge (softNudge: false, would log once) ${summary}`)
          return decision
        }
        if (!deliverable) {
          logger.log(`dry-run soft stage: would not nudge (decision kind=${kind}) ${summary}`)
          return decision
        }
        if (buildNudge() === undefined) {
          logger.log(`dry-run soft stage: would not nudge (nudge construction failed) ${summary}`)
          return decision
        }
        logger.log(`dry-run soft stage: would nudge ${summary}`)
        return decision
      }

      if (!config.softNudge) {
        markNudged(key)
        logger.log(`soft stage (no nudge configured) ${summary}`)
        return decision
      }
      const message = deliverable ? buildNudge() : undefined
      if (message === undefined) {
        // The flag stays unset: nothing was delivered, so a later step may still
        // deliver the instruction.
        logger.log(`soft stage (no nudge injected: ${deliverable ? 'nudge construction failed' : `decision kind=${kind}`}) ${summary}`)
        return decision
      }
      const nudged = { ...decision, messages: [...decision.messages, message] }
      markNudged(key)
      logger.log(`soft stage: nudged ${summary}`)
      return nudged
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
      const state = key === undefined ? undefined : sessions.get(key)
      const projections = projectionsOf(state)
      if (projections === undefined) {
        // "No budget data" is not "no budget": a missing service or a missing
        // projection must never stop a child. Reported at most once.
        noteNoBudgetData(agent)
        return callNext()
      }

      const usage = cumulativeUsageOf(projections.stateOf(agent.session, 'tokenUsage'), config.cacheReadWeight)
      if (usage === undefined) {
        noteNoBudgetData(agent)
        return callNext()
      }

      const stage = decide({ usage, budgetTokens: config.budgetTokens, softRatio: config.softRatio })
      if (stage === PASS) return callNext()

      if (stage === HARD) {
        if (config.dryRun) {
          // Calibration: nothing is cancelled and the step is delegated
          // through, but the line says exactly what would have happened.
          logger.log(`dry-run hard stage: would cancel usage=${usage} budget=${config.budgetTokens} label=${labelOf(agent)}`)
          return callNext()
        }
        // `cancel` aborts the in-flight turn so no further requests are billed,
        // and the `reject` guarantees the loop does not proceed to derivation
        // even if the abort lands late: the agent loop maps a rejected pre-step
        // to a `blocked` turn end without opening a step
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

      // Soft stage: this listener must delegate first, because the nudge rides
      // the decision the rest of the chain produced (the first-party idiom in
      // `@deepseek-ai/dsh-hooks-codex/lib/index.js:224-230`).
      const alreadyNudged = state?.nudged === true
      const decision = await callNext()
      // From here on, nothing may throw: `next()` has run, so its decision is
      // final and this listener must not re-enter the chain.
      try {
        return softStage({ agent, decision, usage, alreadyNudged, key })
      } catch (error) {
        warn(`${name}: the soft stage failed after next() (${renderThrown(error)}); returning the decision unchanged`)
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
 * `logFile`: load-time lines, a soft stage event, a hard stop, a settle, a
 * dry-run decision and the at-most-once "no budget data" note — a plain PASS
 * step logs nothing. The first line written through `log` also goes to the host
 * log once, so an armed plugin is observable without flooding `ctx.logger` at
 * every step.
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
export { decide, cumulativeUsageOf, delegationDepthOf, isDelegatedChild, presetIsGoverned }
