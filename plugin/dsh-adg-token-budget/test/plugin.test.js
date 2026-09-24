/**
 * Unit tests for dsh-adg-token-budget.
 *
 * The suite drives the plugin through a hand-built mock Cordis context so the
 * whole listener path — filtering, the step checkpoints, the calibration switch,
 * the state hygiene — is exercised without a harness. No dependency beyond
 * `node:test`: `npm test` must work in a checkout that has no `node_modules` at
 * all.
 *
 * The token soft stage and the hard cancel were removed from the plugin, so this
 * suite also pins the removal from the outside: the retired options are ignored
 * rather than honoured, `sessionProjections` is never consulted,
 * `agent.cancel` is never called, and no retired stage line can reach the log.
 *
 * @module dsh-adg-token-budget/test
 */

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { beforeEach } from 'node:test'

import * as budgetModule from '../src/budget.js'
import {
  delegationDepthOf,
  dueStepTier,
  isDelegatedChild,
  presetIsGoverned,
} from '../src/budget.js'
import { DEFAULT_CONFIG, MAX_STEP_TEXT_CHARS, MAX_STEP_TIERS, normalizeConfig } from '../src/config.js'
import * as pluginModule from '../src/plugin.js'
import {
  STEP_CHOICE_BODY,
  STEP_LAST_TAIL,
  activationLine,
  apply,
  createNudgeFactory,
  localCreateUserMessage,
  resetRegistrationStateForTests,
  stepNudgeText,
} from '../src/plugin.js'

// Registration bookkeeping is process-global on purpose — it has to survive
// across a hot reload, which is exactly what `apply` being idempotent is about —
// so every test starts from a clean slate instead of inheriting the registrations
// of the tests before it.
beforeEach(() => {
  resetRegistrationStateForTests()
})

/** The retired token-budget options. A row that still carries them must load. */
const RETIRED_CONFIG = Object.freeze({
  budgetTokens: 3_000_000,
  softRatio: 0.7,
  cacheReadWeight: 1,
  softNudge: true,
  hardDryRun: true,
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A log file inside a scratch directory this test owns. */
function createLogFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-adg-token-budget-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'budget.log')
}

/** Read the probe log, returning `''` while it does not exist yet. */
function readLog(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * The decision lines of a log file: everything except the single load-time
 * activation line, which every activation writes first.
 */
function decisionLines(path) {
  return readLog(path)
    .split('\n')
    .filter((line) => line !== '' && !line.includes('activation:'))
}

/** The two fields that make up the per-session checkpoint state. */
function entryFields(entry) {
  if (entry === undefined) return undefined
  return { steps: entry.steps, firedTiers: entry.firedTiers }
}

/**
 * A Cordis-context stand-in recording listeners, effects, and services.
 *
 * `on` returns a disposer that really unregisters the listener (as Cordis does),
 * so the idempotency tests can observe registration and disposal.
 *
 * @param services - the services `ctx.get(name)` resolves.
 */
function createFakeContext(services = {}) {
  const listeners = new Map()
  const effects = []
  const warnings = []
  const infos = []
  const ctx = {
    listeners,
    effects,
    warnings,
    infos,
    on(event, handler, options) {
      const bucket = listeners.get(event) ?? []
      const entry = { handler, options }
      bucket.push(entry)
      listeners.set(event, bucket)
      return () => {
        const index = bucket.indexOf(entry)
        if (index >= 0) bucket.splice(index, 1)
      }
    },
    get(serviceName) {
      return services[serviceName]
    },
    effect(callback) {
      effects.push(callback)
      return () => {}
    },
    logger: {
      info(message) {
        infos.push(String(message))
      },
      warn(message) {
        warnings.push(String(message))
      },
      error() {},
    },
  }
  return ctx
}

/** The listeners currently registered for one event (an empty array when none). */
function listenersFor(ctx, event) {
  return ctx.listeners.get(event) ?? []
}

/** Invoke one registered listener and return it. */
function listenerOf(ctx, event) {
  const bucket = ctx.listeners.get(event)
  assert.ok(bucket && bucket.length > 0, `no listener registered for ${event}`)
  return bucket[0].handler
}

/** `preset: ABSENT` means "the header field is absent", not "use a default". */
const ABSENT = Symbol('absent')

/**
 * A fake agent whose header/options the plugin actually reads, and which records
 * every `cancel` the plugin asks for. The plugin must never ask for one.
 *
 * @param overrides - the fields to set; omitted fields stay absent.
 */
function fakeAgent({ id = 'child-1', preset = ABSENT, headerDepth, subagentDepth = ABSENT } = {}) {
  const header = { id, cwd: 'D:\\work\\demo' }
  if (preset !== ABSENT) header.agentPreset = preset
  if (headerDepth !== undefined) header.delegationDepth = headerDepth
  const calls = { cancel: [] }
  return {
    id,
    options: subagentDepth === ABSENT ? {} : { subagentDepth },
    session: { header },
    cancel(cause, options) {
      calls.cancel.push({ cause, options })
    },
    calls,
  }
}

/** A delegated child of the governed `adg` preset. */
function fakeAdgChild(overrides = {}) {
  return fakeAgent({ preset: 'adg', ...overrides })
}

/** Activate the plugin against a fresh fake context and return the fixtures. */
function activate(config, services = {}) {
  const ctx = createFakeContext(services)
  apply(ctx, config)
  return ctx
}

/** A `next()` that records the call and resolves one `{kind:'enter'}` decision. */
function trackedNext(messages = []) {
  const next = async () => {
    next.calls += 1
    return { kind: 'enter', messages: [...messages] }
  }
  next.calls = 0
  return next
}

/**
 * A faithful model of Cordis's `waterfall` dispatch.
 *
 * Verbatim from `cordis/lib/index.js:317-325`:
 *
 * ```js
 * waterfall(...args) {
 *   const cbs = this.dispatch('waterfall', args)
 *   const inner = args.pop()
 *   const next = () => (cbs.shift() ?? inner)(...args)
 *   args.push(next)
 *   return next()
 * }
 * ```
 *
 * The point of modelling it rather than hand-writing a chain is the **shared
 * cursor**: every listener gets the *same* `next`, each call shifts one more
 * listener off `cbs`, and once `cbs` is empty `next()` calls the built-in
 * `inner` again. That is exactly how a second `next()` after a rejection turns
 * someone else's failure into a silent pass-through, so the model has to keep
 * the cursor and count `inner` calls.
 *
 * @param payload - the first listener argument.
 * @param listeners - the registered listeners, outermost first.
 * @param inner - the built-in behaviour `next()` falls back to.
 * @returns {{ run: () => Promise<unknown>, stats: { inner: number, listener: string[] } }} the dispatch and its counters.
 */
function createWaterfall(payload, listeners, inner) {
  const cbs = [...listeners]
  const stats = { inner: 0, listener: [] }
  const next = () => {
    const callback = cbs.shift()
    if (callback === undefined) {
      stats.inner += 1
      return inner(payload)
    }
    return callback(payload, next)
  }
  return { run: () => next(), stats }
}

/** Run the effects this plugin registered, the way Cordis disposes a fiber. */
function dispose(ctx) {
  for (const callback of ctx.effects) {
    const disposer = callback()
    if (typeof disposer === 'function') disposer()
  }
}

// ---------------------------------------------------------------------------
// src/budget.js — the pure decision logic
// ---------------------------------------------------------------------------

test('delegationDepthOf takes the deeper of the header and the runtime options', () => {
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: 2 } }, options: { subagentDepth: 1 } }), 2)
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: 1 } }, options: { subagentDepth: 3 } }), 3)
  assert.equal(delegationDepthOf({ session: { header: {} }, options: {} }), 0)
  assert.equal(delegationDepthOf(undefined), 0)
  assert.equal(delegationDepthOf(null), 0)
})

test('an out-of-contract header delegationDepth is no depth at all', () => {
  // Unlike the upstream helper this one never throws: a malformed header must
  // not be able to abort a live step.
  for (const value of ['1', -1, 1.5, Number.NaN, Infinity, null, {}, []]) {
    assert.equal(delegationDepthOf({ session: { header: { delegationDepth: value } }, options: {} }), 0, `depth ${String(value)}`)
  }
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: 2 } }, options: { subagentDepth: 'x' } }), 2)
})

test('isDelegatedChild is exactly depth > 0', () => {
  assert.equal(isDelegatedChild(fakeAdgChild({ headerDepth: 1 })), true)
  assert.equal(isDelegatedChild(fakeAgent({ preset: 'adg' })), false)
  assert.equal(isDelegatedChild(undefined), false)
})

test('presetIsGoverned fails open when the header carries no preset', () => {
  assert.equal(presetIsGoverned(fakeAgent({ preset: 'adg' }), ['adg']), true)
  assert.equal(presetIsGoverned(fakeAgent({ preset: 'standard' }), ['adg']), false)
  // An absent preset is NOT governed: guessing there would let the plugin touch
  // sessions it was never pointed at.
  assert.equal(presetIsGoverned(fakeAgent({}), ['adg']), false)
  assert.equal(presetIsGoverned(fakeAgent({ preset: 7 }), ['adg']), false)
  assert.equal(presetIsGoverned(undefined, ['adg']), false)
})

test('dueStepTier reports the lowest tier that is due and unfired', () => {
  const tiers = [4, 8, 12]
  assert.equal(dueStepTier({ tiers, stepCount: 3 }), undefined)
  assert.equal(dueStepTier({ tiers, stepCount: 4 }), 0)
  assert.equal(dueStepTier({ tiers, stepCount: 7 }), 0, 'the lowest unfired tier stays due until it is consumed')
  assert.equal(dueStepTier({ tiers, stepCount: 7, firedTiers: [0] }), undefined, 'tier 8 is not due at step 7')
  assert.equal(dueStepTier({ tiers, stepCount: 8, firedTiers: [0] }), 1)
  // Several tiers due at once: one per call, lowest first, so a caller that
  // evaluates once per step still fires every tier in order.
  assert.equal(dueStepTier({ tiers, stepCount: 20, firedTiers: [0] }), 1)
  assert.equal(dueStepTier({ tiers, stepCount: 20, firedTiers: [0, 1] }), 2)
  assert.equal(dueStepTier({ tiers, stepCount: 20, firedTiers: [0, 1, 2] }), undefined)
})

test('dueStepTier refuses out-of-contract input instead of throwing', () => {
  // This runs inside a live step, so junk input must yield "no nudge".
  assert.equal(dueStepTier(undefined), undefined)
  assert.equal(dueStepTier({ tiers: 'x', stepCount: 5 }), undefined)
  assert.equal(dueStepTier({ tiers: [1], stepCount: '5' }), undefined)
  assert.equal(dueStepTier({ tiers: [1], stepCount: Number.NaN }), undefined)
  assert.equal(dueStepTier({ tiers: [0, -1, 'x', Number.NaN], stepCount: 9 }), undefined)
  assert.equal(dueStepTier({ tiers: [2], stepCount: 3, firedTiers: 'x' }), 0)
})

test('the token-budget helpers are gone from budget.js', () => {
  // The removal is part of the contract: `decide`, `cumulativeUsageOf` and the
  // PASS/SOFT/HARD verdicts existed only for the two token stages.
  assert.deepEqual(Object.keys(budgetModule).sort(), [
    'delegationDepthOf',
    'dueStepTier',
    'isDelegatedChild',
    'presetIsGoverned',
  ])
})

// ---------------------------------------------------------------------------
// src/config.js — normalization
// ---------------------------------------------------------------------------

test('normalizeConfig fills exactly the surviving keys from defaults for unusable input', () => {
  for (const raw of [undefined, null, 'garbage', 42, [], () => {}, { enabled: true }]) {
    assert.deepEqual(
      normalizeConfig(raw),
      {
        enabled: true,
        presets: ['adg'],
        stepNudge: true,
        stepTiers: [...DEFAULT_CONFIG.stepTiers],
        stepText: null,
        dryRun: false,
        logFile: null,
      },
      `raw ${JSON.stringify(raw)}`,
    )
  }
})

test('normalizeConfig ignores the retired token-budget keys', () => {
  // Live compositions still carry them, and a row must keep loading: the keys
  // are simply not part of the resolved object any more, so nothing downstream
  // can read a budget that is no longer enforced.
  const config = normalizeConfig({ ...RETIRED_CONFIG, stepTiers: [3] })
  assert.deepEqual(config, {
    enabled: true,
    presets: ['adg'],
    stepNudge: true,
    stepTiers: [3],
    stepText: null,
    dryRun: false,
    logFile: null,
  })
  for (const key of Object.keys(RETIRED_CONFIG)) {
    assert.equal(Object.hasOwn(config, key), false, `${key} must not survive normalization`)
  }
})

test('normalizeConfig accepts a bare preset string and de-duplicates', () => {
  assert.deepEqual(normalizeConfig({ presets: 'adg' }).presets, ['adg'])
  assert.deepEqual(normalizeConfig({ presets: ['adg', 'adg', ' ptc '] }).presets, ['adg', 'ptc'])
  // Nothing usable falls back to the default rather than disarming the plugin.
  assert.deepEqual(normalizeConfig({ presets: [] }).presets, ['adg'])
  assert.deepEqual(normalizeConfig({ presets: [7, ''] }).presets, ['adg'])
})

test('normalizeConfig reads the step switches and only booleans count', () => {
  assert.equal(normalizeConfig({ stepNudge: false }).stepNudge, false)
  assert.equal(normalizeConfig({ stepNudge: 'no' }).stepNudge, true)
  assert.equal(normalizeConfig({ dryRun: true }).dryRun, true)
  assert.equal(normalizeConfig({ dryRun: 1 }).dryRun, false)
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ enabled: 'yes' }).enabled, true)
})

test('the default ladder is early and dense, and within the tier cap', () => {
  const tiers = [...DEFAULT_CONFIG.stepTiers]
  assert.deepEqual(tiers, [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280])
  assert.ok(tiers.length <= MAX_STEP_TIERS)
  assert.deepEqual([...tiers].sort((left, right) => left - right), tiers, 'ascending')
  assert.equal(new Set(tiers).size, tiers.length, 'no duplicates')
  // Early gaps stay small through step 24, which is where the measured mass is;
  // the tail widens so a runaway keeps getting checked without a reminder every
  // single step.
  for (let index = 1; index < 5; index += 1) {
    assert.ok(tiers[index] - tiers[index - 1] <= 6, `gap ${index} is ${tiers[index] - tiers[index - 1]}`)
  }
  assert.ok(tiers[tiers.length - 1] - tiers[tiers.length - 2] > 6)
})

test('normalizeConfig reads a custom step body and refuses to be left wordless', () => {
  assert.equal(normalizeConfig({ stepText: '  自定义  ' }).stepText, '自定义')
  // Blank, absent or non-string falls back to the built-in body: a mistyped key
  // must not leave the checkpoint silent.
  assert.equal(normalizeConfig({ stepText: '   ' }).stepText, null)
  assert.equal(normalizeConfig({ stepText: 7 }).stepText, null)
  assert.equal(normalizeConfig({ stepText: {} }).stepText, null)
  // Merely too long is truncated rather than rejected.
  const long = normalizeConfig({ stepText: 'x'.repeat(MAX_STEP_TEXT_CHARS + 500) }).stepText
  assert.equal(long.length, MAX_STEP_TEXT_CHARS)
})

test('unusable step tiers fall back to the defaults, not to "off"', () => {
  for (const stepTiers of [[], 'x', [0, -1], [Number.NaN], [null], {}, '   ']) {
    assert.deepEqual(normalizeConfig({ stepTiers }).stepTiers, [...DEFAULT_CONFIG.stepTiers], `stepTiers ${JSON.stringify(stepTiers)}`)
  }
  // A bare number is a one-tier list, the way `presets: adg` is a one-name list.
  assert.deepEqual(normalizeConfig({ stepTiers: 12 }).stepTiers, [12])
  assert.deepEqual(normalizeConfig({ stepTiers: 12.4 }).stepTiers, [12])
  // Junk entries are dropped rather than clamped to something nobody wrote, and
  // the survivors are de-duplicated and sorted ascending.
  assert.deepEqual(normalizeConfig({ stepTiers: [9, 'x', 3, 3, 0, -2, 5.6] }).stepTiers, [3, 6, 9])
})

test('normalizeConfig bounds how many tiers it will honour', () => {
  const many = Array.from({ length: MAX_STEP_TIERS + 20 }, (_, index) => index + 1)
  const tiers = normalizeConfig({ stepTiers: many }).stepTiers
  assert.equal(tiers.length, MAX_STEP_TIERS)
  assert.deepEqual(tiers, many.slice(0, MAX_STEP_TIERS))
})

test('normalizeConfig keeps an unusable logFile out of the way', () => {
  assert.equal(normalizeConfig({ logFile: 'C:\\logs\\x.log' }).logFile, 'C:\\logs\\x.log')
  assert.equal(normalizeConfig({ logFile: '   ' }).logFile, null)
  assert.equal(normalizeConfig({ logFile: 42 }).logFile, null)
  assert.equal(normalizeConfig({ logFile: { path: 'x' } }).logFile, null)
})

// ---------------------------------------------------------------------------
// src/plugin.js — the message constructor
// ---------------------------------------------------------------------------

test('localCreateUserMessage matches createUserMessage output shape', () => {
  const message = localCreateUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'dsh-adg-token-budget' },
  })
  assert.deepEqual(Object.keys(message).sort(), ['content', 'id', 'role', 'source'])
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-adg-token-budget' })
  assert.deepEqual(message.content, [{ type: 'text', text: 'hi' }])
  assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // createUserMessage returns deepFreeze(structuredClone(...)): the message and
  // every reachable node must be immutable, and must not alias the input.
  assert.ok(Object.isFrozen(message))
  assert.ok(Object.isFrozen(message.content))
  assert.ok(Object.isFrozen(message.content[0]))
  assert.ok(Object.isFrozen(message.source))
  assert.throws(() => {
    message.content.push({ type: 'text', text: 'x' })
  }, TypeError)
  const input = { content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'x' } }
  const detached = localCreateUserMessage(input)
  input.content[0].text = 'mutated'
  assert.equal(detached.content[0].text, 'hi')
})

test('the running profile from ctx.baseUrl is the first createUserMessage anchor', (t) => {
  // A synthetic profile tree — `profiles/probe-profile/.dsh-module-fallback` plus
  // the shared module root above it — so the property holds in a bare checkout
  // with no DSH install and no DSH_HOME.
  const root = mkdtempSync(join(tmpdir(), 'dsh-adg-token-budget-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profilesRoot = join(root, 'profiles')
  const profileDir = join(profilesRoot, 'probe-profile')
  mkdirSync(join(profileDir, '.dsh-module-fallback'), { recursive: true })
  const packageDir = join(profilesRoot, 'node_modules', '@deepseek-ai', 'dsh-llm')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm', version: '0.0.0', main: 'index.js' }))
  writeFileSync(
    join(packageDir, 'index.js'),
    "module.exports.createUserMessage = (input) => ({ ...input, role: 'user', id: 'from-the-running-profile' })\n",
  )

  const factory = createNudgeFactory(pathToFileURL(`${profileDir}${sep}`).href)

  // Anchor (1) is the profile the context was configured from, not a hardcoded
  // `web`: a `headless` run must anchor on `headless`.
  assert.equal(factory.strategy, 'profile-fallback:probe-profile')
  const message = factory.create('hello')
  assert.equal(message.id, 'from-the-running-profile', 'the baseUrl anchor must be the one that resolved')
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-adg-token-budget' })
})

test('createNudgeFactory always yields a usable factory', () => {
  const factory = createNudgeFactory()
  const message = factory.create('hello')
  assert.equal(typeof factory.strategy, 'string')
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-adg-token-budget' })
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[0].text, 'hello')
})

// ---------------------------------------------------------------------------
// src/plugin.js — apply() robustness
// ---------------------------------------------------------------------------

test('apply never throws, for any config or context, and registers nothing without an event API', () => {
  const hostile = [
    undefined,
    null,
    {},
    'garbage',
    42,
    [],
    () => {},
    { enabled: 'yes' },
    { presets: 'adg' },
    { presets: 5 },
    { stepNudge: 'x' },
    { stepTiers: 'x' },
    { stepTiers: [] },
    { stepText: 42 },
    { dryRun: 'x' },
    { logFile: 42 },
    { logFile: '' },
    { logFile: 'relative.log' },
    { enabled: true, presets: null, stepNudge: {}, stepTiers: [], stepText: [], dryRun: [], logFile: [] },
    { nested: { enabled: false } },
    // A row carrying the retired keys must load like any other.
    RETIRED_CONFIG,
    { ...RETIRED_CONFIG, stepTiers: [1], enabled: true },
  ]
  for (const config of hostile) {
    assert.doesNotThrow(() => apply(createFakeContext(), config), `config ${JSON.stringify(config)} threw`)
  }
  // Contexts with nothing usable on them must degrade to a no-op.
  for (const config of hostile) {
    assert.doesNotThrow(() => apply({}, config))
    assert.doesNotThrow(() => apply({ get: () => undefined, logger: { warn() {} } }, config))
    assert.doesNotThrow(() => apply(undefined, config))
    assert.doesNotThrow(() => apply(null, config))
    assert.doesNotThrow(() => apply({ on: 'not a function', logger: null }, config))
  }
})

test('enabled: false registers nothing at all', () => {
  const ctx = activate({ enabled: false })
  assert.equal(ctx.listeners.size, 0)
  assert.equal(ctx.effects.length, 0)
})

test('applying the same context twice registers exactly one hook', () => {
  const ctx = createFakeContext()
  apply(ctx, {})
  apply(ctx, {})
  assert.equal(listenersFor(ctx, 'agent/pre-step').length, 1, 'a duplicate apply must not double the reminders')
  assert.equal(listenersFor(ctx, 'subagent/end').length, 1)
  assert.ok(ctx.warnings.some((line) => line.includes('already applied')))
})

test('a re-apply after disposal registers again (the hot-reload path)', () => {
  const ctx = createFakeContext()
  apply(ctx, {})
  dispose(ctx)
  assert.equal(ctx.warnings.length, 0, ctx.warnings.join(' | '))

  apply(ctx, {})

  assert.equal(listenersFor(ctx, 'agent/pre-step').length, 2, 'a legitimate re-apply after disposal must register again')
  assert.equal(ctx.warnings.some((line) => line.includes('already applied the plugin')), false)
  // The disposer decremented the active-registration count, so this is not
  // reported as two live registrations either.
  assert.equal(ctx.warnings.length, 0, ctx.warnings.join(' | '))
})

test('a second distinct context warns that the plugin is mounted twice', () => {
  const first = createFakeContext()
  const second = createFakeContext()
  apply(first, {})
  apply(second, {})
  assert.ok(second.warnings.some((line) => line.includes('already active')), second.warnings.join('\n'))
  assert.equal(listenersFor(second, 'agent/pre-step').length, 1, 'the second mount is reported, not skipped')
})

// ---------------------------------------------------------------------------
// src/plugin.js — the activation line
// ---------------------------------------------------------------------------

test('apply always writes exactly one activation line, enabled or not', (t) => {
  const logLines = (path) => readLog(path).split('\n').filter((line) => line !== '')

  const disabledLog = createLogFile(t)
  apply(createFakeContext(), { enabled: false, logFile: disabledLog })
  const disabled = logLines(disabledLog)
  assert.equal(disabled.length, 1)
  assert.match(disabled[0], /activation: inactive \(enabled: false\)/)

  const enabledLog = createLogFile(t)
  apply(createFakeContext(), { logFile: enabledLog })
  const enabled = logLines(enabledLog)
  assert.equal(enabled.length, 1)
  assert.match(enabled[0], /activation: active createUserMessage=\S+/)
})

test('a throwing logger or an unwritable logFile cannot break apply', (t) => {
  const hostile = {
    on() {
      throw new Error('no events for you')
    },
    effect() {
      throw new Error('no effects either')
    },
    get() {
      throw new Error('no services')
    },
    logger: {
      info() {
        throw new Error('boom')
      },
      warn() {
        throw new Error('boom')
      },
    },
  }
  assert.doesNotThrow(() => apply(hostile, { stepTiers: [1] }))
  const dir = mkdtempSync(join(tmpdir(), 'dsh-adg-token-budget-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // A directory is not a writable file: the append fails and is swallowed.
  assert.doesNotThrow(() => apply(createFakeContext(), { logFile: dir }))
})

test('activationLine reports the surviving configuration and none of the retired fields', () => {
  const line = activationLine(normalizeConfig({ ...RETIRED_CONFIG, stepTiers: [2, 4], stepText: 'x', dryRun: true }), 'profile-fallback:web')
  assert.match(line, /^activation: active createUserMessage=profile-fallback:web presets=\[adg\] /)
  assert.match(line, /stepNudge=true/)
  assert.match(line, /stepTiers=\[2, 4\]/)
  assert.match(line, /stepText=custom/)
  assert.match(line, /dryRun=true/)
  assert.match(line, /logFile=null$/)
  for (const retired of ['budgetTokens=', 'softThreshold=', 'softRatio=', 'cacheReadWeight=', 'softNudge=', 'hardDryRun=']) {
    assert.equal(line.includes(retired), false, `${retired} must not appear in the activation line`)
  }
  assert.match(activationLine(normalizeConfig({ enabled: false }), undefined), /^activation: inactive \(enabled: false\) /)
})

test('the module exposes the loader-facing shape, and no retired export', () => {
  assert.equal(pluginModule.name, 'dsh-adg-token-budget')
  assert.equal(typeof pluginModule.apply, 'function')
  assert.equal(typeof pluginModule.stepNudgeText, 'function')
  assert.equal('NUDGE_TEXT' in pluginModule, false, 'the token wrap-up text is gone')
})

// ---------------------------------------------------------------------------
// src/plugin.js — filtering
// ---------------------------------------------------------------------------

test('a top-level agent is never touched', async () => {
  const ctx = activate({ stepTiers: [1] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAgent({ preset: 'adg' })
  const next = trackedNext()
  assert.deepEqual(await handler({ agent }, next), { kind: 'enter', messages: [] })
  assert.equal(next.calls, 1)
  assert.equal(handler.testState.sessions.size, 0, 'a top-level agent must not allocate state')
})

test('a child of another preset, or with no preset, is never touched and allocates nothing', async () => {
  const ctx = activate({ stepTiers: [1] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  for (const agent of [fakeAgent({ preset: 'standard', headerDepth: 1 }), fakeAgent({ headerDepth: 1 }), fakeAgent({ preset: 'adg' })]) {
    const next = trackedNext()
    assert.deepEqual(await handler({ agent }, next), { kind: 'enter', messages: [] })
    assert.equal(next.calls, 1)
  }
  assert.equal(handler.testState.sessions.size, 0)
})

// ---------------------------------------------------------------------------
// src/plugin.js — the step checkpoints
// ---------------------------------------------------------------------------

test('a step below the first tier passes through and is counted', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepTiers: [2], logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  assert.deepEqual(await handler({ agent }, trackedNext()), { kind: 'enter', messages: [] })
  assert.deepEqual(entryFields(handler.testState.sessions.get('child-1')), { steps: 1, firedTiers: [] })
  // A step with no checkpoint due writes no decision line.
  assert.deepEqual(decisionLines(logFile), [])
})

test('a checkpoint injects its reminder on the tier step, once per tier', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepTiers: [2, 4], logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })

  // Step 1: the first tier is 2, so nothing happens yet.
  assert.deepEqual(await handler({ agent }, trackedNext()), { kind: 'enter', messages: [] })

  // Step 2: tier 1, with the downstream messages preserved in order.
  const second = await handler({ agent }, trackedNext([{ role: 'user', id: 'existing' }]))
  assert.equal(second.messages.length, 2)
  assert.equal(second.messages[0].id, 'existing')
  const reminder = second.messages[1]
  assert.equal(reminder.role, 'user')
  assert.deepEqual(reminder.source, { kind: 'plugin', plugin: 'dsh-adg-token-budget' })
  assert.match(reminder.content[0].text, /^【收敛检查点 1／2】调度代理提醒：这是你的第 2 步。/)
  assert.ok(reminder.content[0].text.includes(STEP_CHOICE_BODY))
  assert.ok(!reminder.content[0].text.includes(STEP_LAST_TAIL), 'only the last tier adds the closing sentence')
  assert.ok(Object.isFrozen(reminder), 'the injected message must be immutable like a real UserMessage')

  // Step 3: the same tier must not fire twice.
  assert.deepEqual((await handler({ agent }, trackedNext())).messages.length, 0)

  // Step 4: tier 2 — the last one, so the closing sentence is appended.
  const fourth = await handler({ agent }, trackedNext())
  assert.equal(fourth.messages.length, 1)
  assert.match(fourth.messages[0].content[0].text, /^【收敛检查点 2／2】调度代理提醒：这是你的第 4 步。/)
  assert.ok(fourth.messages[0].content[0].text.includes(STEP_CHOICE_BODY))
  assert.ok(fourth.messages[0].content[0].text.includes(STEP_LAST_TAIL))

  // Step 5: the list is exhausted, so the child is left alone.
  assert.deepEqual((await handler({ agent }, trackedNext())).messages.length, 0)

  const lines = decisionLines(logFile).map((line) => line.replace(/^\S+ /, ''))
  assert.deepEqual(lines, [
    'step stage: nudged tier=1/2 step=2 label=adg/child-1',
    'step stage: nudged tier=2/2 step=4 label=adg/child-1',
  ])
  assert.deepEqual(entryFields(handler.testState.sessions.get('child-1')), { steps: 5, firedTiers: [0, 1] })
})

test('a configured stepText is what actually reaches the child', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepTiers: [2], stepText: '自定义检查点正文：自己决定。', logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  await handler({ agent }, trackedNext())
  const decision = await handler({ agent }, trackedNext())
  const text = decision.messages[0].content[0].text
  assert.ok(text.endsWith('自定义检查点正文：自己决定。'), text)
  // A custom body replaces the built-in text entirely, closing sentence included.
  assert.ok(!text.includes(STEP_CHOICE_BODY), text)
  assert.ok(!text.includes(STEP_LAST_TAIL), text)
  assert.match(text, /^【收敛检查点 1／1】调度代理提醒：这是你的第 2 步。/)
  // The log still records the decision, not the wording.
  assert.match(readLog(logFile), /step stage: nudged tier=1\/1 step=2 /)
})

test('only an entered step is counted, so a rejected step costs no tier', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepTiers: [2], logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  await handler({ agent }, trackedNext())
  // A downstream listener rejected this step, so no step opened: the child is
  // still on step 1 and the tier stays owed.
  assert.deepEqual(await handler({ agent }, async () => ({ kind: 'reject' })), { kind: 'reject' })
  assert.equal(handler.testState.sessions.get('child-1').steps, 1)
  assert.deepEqual(handler.testState.sessions.get('child-1').firedTiers, [])
  // Tier 2 is still not due at step 1, so the rejected step writes no line at
  // all: the checkpoint neither fired nor was owed.
  assert.deepEqual(decisionLines(logFile), [])

  const decision = await handler({ agent }, trackedNext())
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /第 2 步/)
  assert.equal(handler.testState.sessions.get('child-1').steps, 2)
})

test('step counters are per child', async () => {
  const ctx = activate({ stepTiers: [2] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const first = fakeAdgChild({ id: 'child-a', headerDepth: 1 })
  const second = fakeAdgChild({ id: 'child-b', headerDepth: 1 })
  await handler({ agent: first }, trackedNext())
  await handler({ agent: second }, trackedNext())
  const decision = await handler({ agent: first }, trackedNext())
  assert.equal(decision.messages.length, 1, "child-a's own second step fires its tier")
  assert.match(decision.messages[0].content[0].text, /第 2 步/)
  assert.equal(handler.testState.sessions.get('child-a').steps, 2)
  assert.equal(handler.testState.sessions.get('child-b').steps, 1, "child-b's count is untouched")
  assert.deepEqual(handler.testState.sessions.get('child-b').firedTiers, [])
})

test('a failing downstream listener is never swallowed, and next() is called once', async () => {
  // The reproduction of the worst defect: this listener sits in a Cordis
  // waterfall with the built-in step as the innermost `next`, and a downstream
  // `agent/pre-step` listener (there are ~15 globally, e.g. dsh-hooks-codex)
  // throws after it has delegated. Re-calling `next()` from the catch would shift
  // the shared cursor past the end and re-enter the built-in behaviour, turning
  // that listener's failure into a silent pass-through.
  const ctx = activate({ stepTiers: [1] })
  const plugin = listenerOf(ctx, 'agent/pre-step')
  const boom = new Error('downstream listener exploded')
  let downstreamCalls = 0
  const downstream = async (payload, next) => {
    downstreamCalls += 1
    waterfall.stats.listener.push('downstream')
    await next()
    throw boom
  }
  const inner = async () => ({ kind: 'enter', messages: [] })
  const agent = fakeAdgChild({ headerDepth: 1 })
  const waterfall = createWaterfall({ agent }, [plugin, downstream], inner)

  await assert.rejects(waterfall.run(), (error) => error === boom)
  assert.equal(downstreamCalls, 1, 'the downstream listener must run once')
  assert.equal(waterfall.stats.inner, 1, 'the built-in pre-step behaviour must run exactly once')
  assert.deepEqual(waterfall.stats.listener, ['downstream'])
  // The same dispatch without this plugin installed behaves identically, which
  // is the contract: a checkpoint guard must not change anyone else's failure.
  const plain = createWaterfall({ agent }, [downstream], inner)
  await assert.rejects(plain.run(), (error) => error === boom)
  assert.equal(plain.stats.inner, 1)
})

test('a downstream reject is honoured: the checkpoint stage never invents messages', async () => {
  const ctx = activate({ stepTiers: [1] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = async () => ({ kind: 'reject' })
  assert.deepEqual(await handler({ agent }, next), { kind: 'reject' })
})

test('a resumed child with only a header depth is still governed', async () => {
  const ctx = activate({ stepTiers: [1] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  // `subagentDepth` is absent — the persisted header is what survives a resume.
  const agent = fakeAgent({ preset: 'adg', headerDepth: 3 })
  const decision = await handler({ agent }, trackedNext())
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /收敛检查点/)
})

test('a malformed payload is contained rather than propagating', async () => {
  const ctx = activate({ stepTiers: [1] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const next = trackedNext()
  assert.deepEqual(await handler(undefined, next), { kind: 'enter', messages: [] })
  assert.deepEqual(await handler({ agent: null }, next), { kind: 'enter', messages: [] })
  assert.deepEqual(await handler({ agent: { id: 7, session: null } }, next), { kind: 'enter', messages: [] })
})

// ---------------------------------------------------------------------------
// src/plugin.js — dryRun: compute and log every decision, inject nothing
// ---------------------------------------------------------------------------

test('dryRun checkpoints inject nothing, log every decision and consume nothing', async (t) => {
  const logFile = createLogFile(t)
  const dry = activate({ stepTiers: [2], dryRun: true, logFile })
  const dryHandler = listenerOf(dry, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await dryHandler({ agent }, trackedNext()), { kind: 'enter', messages: [] })
  }
  // Because calibration consumes no flag, a due tier keeps reporting itself on
  // every step at or past it. The unit matters when counting lines: this is
  // "steps a checkpoint was due", not "checkpoints that would have fired" — an
  // armed run fires each of them exactly once, on the step it becomes due.
  assert.deepEqual(decisionLines(logFile).map((line) => line.replace(/^\S+ /, '')), [
    'dry-run step stage: would nudge tier=1/1 step=2 label=adg/child-1',
    'dry-run step stage: would nudge tier=1/1 step=3 label=adg/child-1',
  ])
  assert.deepEqual(entryFields(dryHandler.testState.sessions.get('child-1')), { steps: 3, firedTiers: [] })

  // A step that never opened is reported as such, and still leaves the tier owed.
  assert.deepEqual(await dryHandler({ agent }, async () => ({ kind: 'reject' })), { kind: 'reject' })
  assert.match(readLog(logFile), /dry-run step stage: would not nudge \(decision kind=reject\) tier=1\/1 step=3/)

  // Nothing was cancelled and nothing was rejected by this plugin: `dryRun` only
  // withholds the message.
  assert.equal(agent.calls.cancel.length, 0)
})

test('dryRun counts the steps it watches and spends no tier', async (t) => {
  const logFile = createLogFile(t)
  const dry = activate({ stepTiers: [2], dryRun: true, logFile })
  const dryHandler = listenerOf(dry, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(await dryHandler({ agent }, trackedNext()), { kind: 'enter', messages: [] })
  }
  // The count is exactly what a checkpoint is calibrated against, so it is kept;
  // the tier is NOT consumed, which is what lets the same configuration deliver
  // that reminder for real once `dryRun` is turned off.
  assert.deepEqual(entryFields(dryHandler.testState.sessions.get('child-1')), { steps: 5, firedTiers: [] })
  // A calibration run that consumed a tier would be able to hide it forever;
  // every later step past it therefore keeps reporting it as still owed.
  const lines = decisionLines(logFile)
  assert.equal(lines.length, 4, `log was: ${JSON.stringify(readLog(logFile))}`)
  assert.match(lines[3], /dry-run step stage: would nudge tier=1\/1 step=5 /)
  assert.equal(agent.calls.cancel.length, 0)
})

// ---------------------------------------------------------------------------
// src/plugin.js — stepNudge: the whole feature off
// ---------------------------------------------------------------------------

test('stepNudge: false turns the whole feature off and allocates nothing', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepNudge: false, stepTiers: [1], logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext()
  // No reminder, no counting, no state, no log line.
  assert.deepEqual(await handler({ agent }, next), { kind: 'enter', messages: [] })
  assert.equal(next.calls, 1)
  assert.equal(handler.testState.sessions.size, 0, 'nothing may be allocated with the checkpoints off')
  assert.deepEqual(decisionLines(logFile), [])
})

// ---------------------------------------------------------------------------
// src/plugin.js — the removed token layer
// ---------------------------------------------------------------------------

test('no token projection is ever consulted, even when the service is present', async (t) => {
  const logFile = createLogFile(t)
  let lookups = 0
  const ctx = createFakeContext({
    sessionProjections: {
      stateOf() {
        throw new Error('the token projection must never be read')
      },
    },
  })
  const originalGet = ctx.get
  ctx.get = (name) => {
    lookups += 1
    return originalGet(name)
  }
  apply(ctx, { stepTiers: [1], logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const decision = await handler({ agent }, trackedNext())
  assert.equal(lookups, 0, 'the plugin must not look up any service')
  assert.equal(decision.messages.length, 1, 'the checkpoint still fires without a projection')
  assert.match(decision.messages[0].content[0].text, /收敛检查点/)
})

test('a child is never cancelled, however many steps it takes', async (t) => {
  const logFile = createLogFile(t)
  // A projection that would have reported a usage far past any budget the old
  // soft/hard thresholds could have had, so nothing here depends on arithmetic.
  const ctx = activate({ stepTiers: [1, 2, 3], logFile }, {
    sessionProjections: { stateOf: () => ({ totals: { uncachedInputTokens: 50_000_000, outputTokens: 10_000_000 } }) },
  })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  for (let index = 0; index < 10; index += 1) {
    const decision = await handler({ agent }, trackedNext())
    assert.equal(decision.kind, 'enter', 'the plugin never rejects a step of its own accord')
  }
  assert.equal(agent.calls.cancel.length, 0, 'the plugin has no destructive stage any more')
})

test('the decision log never carries a retired stage line', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepTiers: [1], dryRun: false, logFile }, {
    sessionProjections: { stateOf: () => ({ totals: { uncachedInputTokens: 99_000_000 } }) },
  })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  await handler({ agent }, trackedNext())
  await handler({ agent }, trackedNext())
  listenersFor(ctx, 'subagent/end')[0].handler({ id: 'child-1' })

  const log = readLog(logFile)
  for (const retired of ['soft stage', 'hard stage', 'would cancel', 'budget=', 'usage=', 'no budget data']) {
    assert.equal(log.includes(retired), false, `the log must not contain "${retired}": ${log}`)
  }
})

// ---------------------------------------------------------------------------
// src/plugin.js — state hygiene
// ---------------------------------------------------------------------------

test('the per-session map is released on subagent/end', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate({ stepTiers: [1], logFile })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  await handler({ agent }, trackedNext())
  assert.equal(handler.testState.sessions.size, 1)

  const [settle] = listenersFor(ctx, 'subagent/end')
  assert.ok(settle, 'a subagent/end listener must be registered')
  assert.deepEqual(settle.options, { global: true })
  settle.handler({ id: 'child-1' })
  assert.equal(handler.testState.sessions.size, 0)
  assert.match(readLog(logFile), /settled: released session state label=child-1/)

  // An event without a usable id is ignored, not a crash.
  settle.handler({})
  settle.handler(undefined)
  assert.equal(handler.testState.sessions.size, 0)
})

test('the disposal effect clears the map', async () => {
  const ctx = activate({ stepTiers: [1] })
  const handler = listenerOf(ctx, 'agent/pre-step')
  await handler({ agent: fakeAdgChild({ headerDepth: 1 }) }, trackedNext())
  assert.equal(handler.testState.sessions.size, 1)
  dispose(ctx)
  assert.equal(handler.testState.sessions.size, 0)
})

test('the listeners are registered globally and exactly once', () => {
  const ctx = activate({})
  const preStep = listenersFor(ctx, 'agent/pre-step')
  assert.equal(preStep.length, 1)
  assert.deepEqual(preStep[0].options, { global: true })
  assert.equal(listenersFor(ctx, 'subagent/end').length, 1)
  assert.equal(ctx.effects.length, 1, 'exactly one disposal effect')
})

// ---------------------------------------------------------------------------
// src/plugin.js — the checkpoint wording is part of the behaviour
// ---------------------------------------------------------------------------

test('the built-in checkpoint wording is unchanged', () => {
  // The wording is what makes an early, dense ladder safe: an optional,
  // symmetric choice the child may disregard. It is pinned literally so a
  // refactor cannot quietly turn it into an order.
  assert.equal(STEP_CHOICE_BODY, [
    '这是一条**可选**提醒，不是停止指令。请你自己判断，二选一：',
    '- **收敛**：如果现有产出已经能回答委派目标，就收尾汇报——交付了什么、还有哪些部分没有验证。',
    '- **继续**：如果确实还有必须做完的工作，就继续做，**直接无视这条提醒**，不要为了回应它而缩减或改写计划。',
    '选哪个由任务本身决定，不是由这条提醒决定。请在下一条消息开头用一句话说明你的选择，然后按你的选择继续。',
  ].join('\n'))
  assert.equal(STEP_LAST_TAIL, [
    '',
    '这是本轮的最后一个检查点，后面不会再提醒。如果选择继续，请顺便写一句预计还需要多少步、以及完成标准是什么。',
  ].join('\n'))
})

test('stepNudgeText offers a choice, marks the last tier, takes a custom body, and is total', () => {
  const bodyOf = (text) => text.slice(text.indexOf('\n\n') + 2)
  const first = stepNudgeText({ tierIndex: 0, tierCount: 3, stepCount: 4 })
  const last = stepNudgeText({ tierIndex: 2, tierCount: 3, stepCount: 32 })
  assert.match(first, /^【收敛检查点 1／3】调度代理提醒：这是你的第 4 步。/)
  assert.equal(bodyOf(first), STEP_CHOICE_BODY)
  assert.equal(bodyOf(last), STEP_CHOICE_BODY + STEP_LAST_TAIL)

  // The body does not escalate across tiers. The ladder is dense on purpose, so
  // the checkpoints must not stack into mounting pressure — only the last one
  // says anything extra, and that extra is information, not a firmer order.
  const middle = stepNudgeText({ tierIndex: 1, tierCount: 3, stepCount: 8 })
  assert.equal(bodyOf(middle), STEP_CHOICE_BODY)
  assert.match(middle, /^【收敛检查点 2／3】调度代理提醒：这是你的第 8 步。/)

  // A custom body replaces the built-in text entirely, last-tier sentence
  // included; a blank one falls back instead of leaving the checkpoint silent.
  const custom = stepNudgeText({ tierIndex: 2, tierCount: 3, stepCount: 32, body: '自定义正文' })
  assert.ok(custom.endsWith('自定义正文'))
  assert.ok(!custom.includes(STEP_LAST_TAIL))
  assert.ok(stepNudgeText({ tierIndex: 0, tierCount: 1, stepCount: 4, body: '   ' }).includes(STEP_CHOICE_BODY))
  assert.ok(stepNudgeText({ tierIndex: 0, tierCount: 1, stepCount: 4, body: 7 }).includes(STEP_CHOICE_BODY))

  // Junk input cannot throw inside a live step.
  assert.match(stepNudgeText(undefined), /^【收敛检查点 1／1】调度代理提醒：这是你的第 0 步。/)
  assert.match(stepNudgeText({ tierIndex: -1, tierCount: 0, stepCount: Number.NaN }), /^【收敛检查点 1／1】/)

  // Each property exists because the alternative is the trade this feature is
  // not allowed to make: an early, frequent checkpoint that pushes a child into
  // under-delivering.
  assert.match(STEP_CHOICE_BODY, /可选/)
  assert.match(STEP_CHOICE_BODY, /不是停止指令/)
  assert.match(STEP_CHOICE_BODY, /直接无视这条提醒/)
  assert.match(STEP_CHOICE_BODY, /收敛/)
  assert.match(STEP_CHOICE_BODY, /继续/)
  assert.match(STEP_CHOICE_BODY, /由任务本身决定/)
  assert.match(STEP_CHOICE_BODY, /没有验证/)
  assert.match(STEP_CHOICE_BODY, /用一句话说明你的选择/)
  // It must not read as an order to stop exploring: "继续" has to be a real
  // option a child can take without penalty.
  assert.doesNotMatch(STEP_CHOICE_BODY, /立即停止/)
  assert.doesNotMatch(STEP_CHOICE_BODY, /不要再调用探索类工具/)
  assert.doesNotMatch(STEP_CHOICE_BODY, /请立即停止探索并汇报/)
})
