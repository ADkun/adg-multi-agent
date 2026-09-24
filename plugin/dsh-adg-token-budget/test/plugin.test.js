/**
 * Unit tests for dsh-adg-token-budget.
 *
 * The suite drives the plugin through a hand-built mock Cordis context so the
 * whole listener path — filtering, the two stages, the cancel, the state
 * hygiene — is exercised without a harness. No dependency beyond `node:test`:
 * `npm test` must work in a checkout that has no `node_modules` at all.
 *
 * @module dsh-adg-token-budget/test
 */

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { beforeEach } from 'node:test'

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
} from '../src/budget.js'
import { DEFAULT_CONFIG, MAX_STEP_TIERS, normalizeConfig } from '../src/config.js'
import {
  NUDGE_TEXT,
  STEP_NUDGE_TEXTS,
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

/**
 * The three fields that make up the per-session guard state.
 *
 * The live entry also caches the resolved `sessionProjections` handle once it
 * exists, so comparing the entry itself would compare a live service too.
 */
function entryFields(entry) {
  if (entry === undefined) return undefined
  return { steps: entry.steps, nudged: entry.nudged, firedTiers: entry.firedTiers }
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
 * A fake agent whose header/options the plugin actually reads.
 *
 * @param overrides - the fields to set; omitted fields stay absent.
 */
function fakeAgent({ id = 'child-1', preset = ABSENT, headerDepth, subagentDepth = ABSENT, cancel } = {}) {
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
      if (typeof cancel === 'function') cancel(cause, options)
    },
    calls,
  }
}

/** A delegated child of the governed `adg` preset. */
function fakeAdgChild(overrides = {}) {
  return fakeAgent({ preset: 'adg', ...overrides })
}

/** A `sessionProjections` stand-in resolving one tokenUsage state. */
function fakeProjections(totalsOrStateOrThrow) {
  return {
    stateOf(session, key) {
      assert.equal(key, 'tokenUsage')
      assert.ok(session !== undefined, 'stateOf must be called with the agent session')
      if (totalsOrStateOrThrow instanceof Error) throw totalsOrStateOrThrow
      if (typeof totalsOrStateOrThrow === 'function') return totalsOrStateOrThrow()
      if (totalsOrStateOrThrow === undefined || totalsOrStateOrThrow === null) return totalsOrStateOrThrow
      if (totalsOrStateOrThrow.totals === undefined) return { totals: totalsOrStateOrThrow }
      return totalsOrStateOrThrow
    },
  }
}

/** Totals that fold to a known cumulative figure. */
function totalsOf(uncachedInputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0) {
  return { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
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
  assert.equal(delegationDepthOf({ session: { header: {} }, options: {} }), 0)
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: 2 } }, options: {} }), 2)
  assert.equal(delegationDepthOf({ session: { header: {} }, options: { subagentDepth: 3 } }), 3)
  // A resumed child has fresh options but a persisted header: the header wins.
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: 2 } }, options: { subagentDepth: 1 } }), 2)
  // Out-of-contract values are ignored instead of thrown: a bad header must not
  // be able to abort a live turn.
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: -1 } }, options: {} }), 0)
  assert.equal(delegationDepthOf({ session: { header: {} }, options: { subagentDepth: 1.5 } }), 0)
  assert.equal(delegationDepthOf(undefined), 0)
  assert.equal(delegationDepthOf(null), 0)
  assert.equal(delegationDepthOf({}), 0)
})

test('an out-of-contract header delegationDepth is no depth at all', () => {
  // The header is the authoritative, monotone signal, so it goes through
  // `Number.isSafeInteger(value) && value >= 0`. Everything else is "no depth":
  // not a coercion (`'1'` is not 1), not a truncation (`1.5` is not 1), not a
  // clamp (`-1` is not 0), and never a thrown error — a malformed header must
  // not be able to abort a live turn. `2**53` is the boundary case that a bare
  // `Number.isInteger` check would wave through.
  for (const headerDepth of ['1', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, true, null]) {
    const label = `header depth ${String(headerDepth)}`
    assert.equal(delegationDepthOf({ session: { header: { delegationDepth: headerDepth } }, options: {} }), 0, label)
    assert.equal(isDelegatedChild(fakeAgent({ headerDepth })), false, label)
    // A valid runtime depth still deepens the count, exactly as upstream does.
    assert.equal(delegationDepthOf(fakeAgent({ headerDepth, subagentDepth: 1 })), 1, label)
  }
})

test('a child whose header depth is out of contract is not governed by the budget', async () => {
  // The helper-level assertions above are not enough: this pins the guard
  // through the whole listener, where losing it would cancel a live child.
  const ctx = activate({ budgetTokens: 1000 }, { sessionProjections: fakeProjections(totalsOf(9_999_999)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  for (const headerDepth of ['1', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, true, null]) {
    const label = `header depth ${String(headerDepth)}`
    const agent = fakeAdgChild({ headerDepth })
    const next = trackedNext()
    assert.deepEqual(await handler({ agent }, next), { kind: 'enter', messages: [] }, label)
    assert.equal(next.calls, 1, label)
    assert.equal(agent.calls.cancel.length, 0, label)
  }
})

test('isDelegatedChild is exactly depth > 0', () => {
  assert.equal(isDelegatedChild(fakeAgent({ headerDepth: 0 })), false)
  assert.equal(isDelegatedChild(fakeAgent({ headerDepth: 1 })), true)
  assert.equal(isDelegatedChild(fakeAgent({ subagentDepth: 1 })), true)
  assert.equal(isDelegatedChild(fakeAgent({ headerDepth: 2, subagentDepth: 0 })), true)
})

test('presetIsGoverned fails open when the header carries no preset', () => {
  const presets = ['adg']
  assert.equal(presetIsGoverned(fakeAgent({ preset: 'adg' }), presets), true)
  assert.equal(presetIsGoverned(fakeAgent({ preset: 'standard' }), presets), false)
  assert.equal(presetIsGoverned(fakeAgent({ preset: undefined }), presets), false)
  assert.equal(presetIsGoverned(fakeAgent({}), presets), false)
  assert.equal(presetIsGoverned(fakeAgent({ preset: 'ADG' }), presets), false)
  assert.equal(presetIsGoverned(fakeAgent({ preset: 'adg' }), []), false)
  assert.equal(presetIsGoverned(undefined, presets), false)
})

test('cumulativeUsageOf applies the cache-read weight and ignores junk counters', () => {
  const totals = totalsOf(100, 50, 1000, 20)
  assert.equal(cumulativeUsageOf({ totals }, 1), 100 + 50 + 1000 + 20)
  assert.equal(cumulativeUsageOf({ totals }, 0.5), 100 + 50 + 500 + 20)
  assert.equal(cumulativeUsageOf({ totals }, 0), 100 + 50 + 0 + 20)
  // A missing or non-numeric counter counts as zero rather than NaN, which
  // would make every comparison false and silently disable the budget.
  assert.equal(cumulativeUsageOf({ totals: { uncachedInputTokens: 10, outputTokens: 'x' } }, 1), 10)
  assert.equal(cumulativeUsageOf({ totals: { uncachedInputTokens: Number.NaN } }, 1), 0)
  // A hostile weight falls back to 1 rather than poisoning the total.
  assert.equal(cumulativeUsageOf({ totals }, Number.NaN), 100 + 50 + 1000 + 20)
  assert.equal(cumulativeUsageOf(undefined, 1), undefined)
  assert.equal(cumulativeUsageOf({}, 1), undefined)
  assert.equal(cumulativeUsageOf({ totals: null }, 1), undefined)
})

test('decide classifies against both inclusive thresholds, hard first', () => {
  const gate = (usage, budgetTokens = 1000, softRatio = 0.7) => decide({ usage, budgetTokens, softRatio })
  assert.equal(gate(0), PASS)
  assert.equal(gate(699), PASS)
  assert.equal(gate(700), SOFT)
  assert.equal(gate(999), SOFT)
  assert.equal(gate(1000), HARD)
  assert.equal(gate(5000), HARD)
  // softRatio 1 disables the soft stage: nothing below the budget is nudged,
  // and the budget itself still stops.
  assert.equal(gate(999, 1000, 1), PASS)
  assert.equal(gate(1000, 1000, 1), HARD)
  // softRatio 0 nudges on the first step, and the hard threshold still wins.
  assert.equal(gate(0, 1000, 0), SOFT)
  assert.equal(gate(1000, 1000, 0), HARD)
  // A negative budget is a misconfiguration, not a hair trigger: pass.
  assert.equal(gate(10, -5, 0.7), PASS)
  // Non-finite inputs can only pass through.
  assert.equal(gate(Number.NaN), PASS)
  assert.equal(decide({ usage: 10, budgetTokens: Number.POSITIVE_INFINITY, softRatio: 0.5 }), PASS)
  assert.equal(decide({ usage: 10, budgetTokens: 100, softRatio: Number.NaN }), PASS)
  assert.equal(decide(undefined), PASS)
})

// ---------------------------------------------------------------------------
// src/budget.js — the step checkpoints (pure)
// ---------------------------------------------------------------------------

test('dueStepTier reports the lowest tier that is due and unfired', () => {
  const gate = { tiers: [12, 24, 40], stepCount: 1 }
  assert.equal(dueStepTier(gate), undefined)
  assert.equal(dueStepTier({ ...gate, stepCount: 11 }), undefined)
  // Inclusive: entering step 12 fires the tier configured as 12.
  assert.equal(dueStepTier({ ...gate, stepCount: 12 }), 0)
  assert.equal(dueStepTier({ ...gate, stepCount: 23, firedTiers: [0] }), undefined)
  assert.equal(dueStepTier({ ...gate, stepCount: 24, firedTiers: [0] }), 1)
  assert.equal(dueStepTier({ ...gate, stepCount: 40, firedTiers: [0, 1] }), 2)
  assert.equal(dueStepTier({ ...gate, stepCount: 99, firedTiers: [0, 1, 2] }), undefined)
  // Several due at once still resolve one call at a time, lowest first.
  assert.equal(dueStepTier({ tiers: [1, 2, 3], stepCount: 3 }), 0)
  assert.equal(dueStepTier({ tiers: [1, 2, 3], stepCount: 3, firedTiers: [0] }), 1)
})

test('dueStepTier refuses out-of-contract input instead of throwing', () => {
  const junk = [
    undefined,
    null,
    {},
    { tiers: 'x', stepCount: 5 },
    { tiers: [1], stepCount: '5' },
    { tiers: [1], stepCount: Number.NaN },
    { tiers: [1], stepCount: Number.POSITIVE_INFINITY },
  ]
  for (const gate of junk) assert.equal(dueStepTier(gate), undefined, JSON.stringify(gate))
  // A malformed entry inside an otherwise usable list is skipped, not fatal.
  assert.equal(dueStepTier({ tiers: ['x', 3], stepCount: 3 }), 1)
  // A non-positive tier can never be due.
  assert.equal(dueStepTier({ tiers: [0, -1, 3], stepCount: 1 }), undefined)
  // A non-array firedTiers list counts as "nothing has fired".
  assert.equal(dueStepTier({ tiers: [3], stepCount: 3, firedTiers: 'x' }), 0)
  assert.equal(dueStepTier({ tiers: [3], stepCount: 3, firedTiers: [0, 0] }), undefined)
})

// ---------------------------------------------------------------------------
// src/config.js
// ---------------------------------------------------------------------------

test('normalizeConfig fills every key from defaults for unusable input', () => {
  for (const raw of [undefined, null, {}, 'garbage', 42, [], { softRatio: 'x' }]) {
    const config = normalizeConfig(raw)
    assert.deepEqual(config.presets, ['adg'])
    assert.equal(config.enabled, true)
    assert.equal(config.budgetTokens, DEFAULT_CONFIG.budgetTokens)
    assert.equal(config.softRatio, DEFAULT_CONFIG.softRatio)
    assert.equal(config.cacheReadWeight, DEFAULT_CONFIG.cacheReadWeight)
    assert.equal(config.softNudge, true)
    assert.equal(config.stepNudge, true)
    assert.deepEqual(config.stepTiers, [12, 24, 40])
    assert.equal(config.dryRun, false)
    assert.equal(config.hardDryRun, false)
    assert.equal(config.logFile, null)
  }
  // A non-positive budget is a typo, not a hair trigger: it falls back to the
  // default rather than stopping every child on its first step.
  assert.equal(normalizeConfig({ budgetTokens: -1 }).budgetTokens, DEFAULT_CONFIG.budgetTokens)
  assert.equal(normalizeConfig({ budgetTokens: 0 }).budgetTokens, DEFAULT_CONFIG.budgetTokens)
})

test('normalizeConfig accepts a bare preset string and de-duplicates', () => {
  assert.deepEqual(normalizeConfig({ presets: 'adg' }).presets, ['adg'])
  assert.deepEqual(normalizeConfig({ presets: [' adg ', 'adg', 'other'] }).presets, ['adg', 'other'])
  assert.deepEqual(normalizeConfig({ presets: [] }).presets, ['adg'])
  assert.deepEqual(normalizeConfig({ presets: [1, null] }).presets, ['adg'])
})

test('normalizeConfig clamps out-of-range numbers', () => {
  assert.equal(normalizeConfig({ budgetTokens: 2.6 }).budgetTokens, 3)
  assert.equal(normalizeConfig({ budgetTokens: 1.4 }).budgetTokens, 1)
  assert.equal(normalizeConfig({ softRatio: 5 }).softRatio, 1)
  assert.equal(normalizeConfig({ softRatio: -5 }).softRatio, 0)
  assert.equal(normalizeConfig({ cacheReadWeight: -3 }).cacheReadWeight, 0)
  assert.equal(normalizeConfig({ cacheReadWeight: 1e9 }).cacheReadWeight, 100)
  // A weight is a multiplier, not a count: a fractional discount survives.
  assert.equal(normalizeConfig({ cacheReadWeight: 0.5 }).cacheReadWeight, 0.5)
  assert.equal(normalizeConfig({ budgetTokens: Number.NaN }).budgetTokens, DEFAULT_CONFIG.budgetTokens)
  assert.equal(normalizeConfig({ softRatio: 'x' }).softRatio, DEFAULT_CONFIG.softRatio)
  assert.equal(normalizeConfig({ logFile: '' }).logFile, null)
  assert.equal(normalizeConfig({ logFile: 'D:\\x.log' }).logFile, 'D:\\x.log')
  assert.equal(normalizeConfig({ enabled: 'yes' }).enabled, true)
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ softNudge: false }).softNudge, false)
  assert.equal(normalizeConfig({ dryRun: true }).dryRun, true)
  // Only a real boolean arms the calibration switch; a truthy string does not.
  assert.equal(normalizeConfig({ dryRun: 'yes' }).dryRun, false)
  assert.equal(normalizeConfig({ dryRun: 1 }).dryRun, false)
})

test('normalizeConfig reads the step checkpoints and the hard-stage switch', () => {
  const defaults = normalizeConfig({})
  assert.equal(defaults.stepNudge, true)
  assert.deepEqual(defaults.stepTiers, [12, 24, 40])
  assert.equal(defaults.hardDryRun, false)

  // A bare number reads as a one-tier list, the way `presets: adg` reads as a
  // one-name list.
  assert.deepEqual(normalizeConfig({ stepTiers: 5 }).stepTiers, [5])
  // Sorted ascending and de-duplicated: the helper scans the list in order and
  // reports the first tier that is due.
  assert.deepEqual(normalizeConfig({ stepTiers: [24, 12, 24.4, 12] }).stepTiers, [12, 24])
  assert.deepEqual(normalizeConfig({ stepTiers: [2.6, 3.4] }).stepTiers, [3])
  // Only a real boolean arms either switch.
  assert.equal(normalizeConfig({ stepNudge: 'yes' }).stepNudge, true)
  assert.equal(normalizeConfig({ stepNudge: false }).stepNudge, false)
  assert.equal(normalizeConfig({ hardDryRun: true }).hardDryRun, true)
  assert.equal(normalizeConfig({ hardDryRun: 1 }).hardDryRun, false)
})

test('unusable step tiers fall back to the defaults, not to "off"', () => {
  const junk = [undefined, null, [], 'x', [0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['12'], [{}], [null]]
  for (const stepTiers of junk) {
    assert.deepEqual(normalizeConfig({ stepTiers }).stepTiers, [12, 24, 40], JSON.stringify(stepTiers))
  }
  // Turning them off is `stepNudge: false` — a deliberate switch, not a typo the
  // plugin has to guess at.
  assert.deepEqual(normalizeConfig({ stepNudge: false }).stepTiers, [12, 24, 40])
})

test('normalizeConfig bounds how many tiers it will honour', () => {
  const many = Array.from({ length: MAX_STEP_TIERS + 8 }, (_, index) => index + 1)
  const tiers = normalizeConfig({ stepTiers: many }).stepTiers
  assert.equal(tiers.length, MAX_STEP_TIERS)
  assert.equal(tiers[0], 1)
  assert.equal(tiers[MAX_STEP_TIERS - 1], MAX_STEP_TIERS)
  // The default list is itself within the bound, so the cap cannot be hiding a
  // default the plugin would never fire.
  assert.ok(DEFAULT_CONFIG.stepTiers.length <= MAX_STEP_TIERS)
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
  const message = factory.create(NUDGE_TEXT)
  assert.equal(typeof factory.strategy, 'string')
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-adg-token-budget' })
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[0].text, NUDGE_TEXT)
  // The nudge must actually carry the three required instructions.
  assert.match(NUDGE_TEXT, /\u9884\u7b97/u)
  assert.match(NUDGE_TEXT, /\u505c\u6b62/u)
  assert.match(NUDGE_TEXT, /\u672a\u9a8c\u8bc1/u)
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
    { budgetTokens: -1 },
    { softRatio: 'x' },
    { presets: 'adg' },
    { presets: 5 },
    { enabled: 'yes' },
    { cacheReadWeight: Number.NaN },
    { logFile: 42 },
    { logFile: '' },
    { logFile: 'relative.log' },
    { enabled: true, presets: null, budgetTokens: 'x', softRatio: [], cacheReadWeight: {}, softNudge: 'x', logFile: [] },
    { nested: { enabled: false } },
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

test('apply still works when ctx.get always returns undefined (no services at all)', async () => {
  const ctx = createFakeContext({})
  apply(ctx, {})
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext()
  const decision = await handler({ agent }, next)
  assert.deepEqual(decision, { kind: 'enter', messages: [] })
  assert.equal(next.calls, 1)
  assert.equal(agent.calls.cancel.length, 0)
})

test('enabled: false registers nothing at all', () => {
  const ctx = activate({ enabled: false })
  assert.equal(ctx.listeners.size, 0)
  assert.equal(ctx.effects.length, 0)
})

// ---------------------------------------------------------------------------
// src/plugin.js — apply() idempotency (a double registration doubles every
// decision: two nudges on the soft path, two cancels on the hard path)
// ---------------------------------------------------------------------------

test('applying the same context twice registers exactly one hook', () => {
  const ctx = createFakeContext({ sessionProjections: fakeProjections(totalsOf(800)) })
  apply(ctx, { budgetTokens: 1000, softRatio: 0.7 })
  assert.equal(listenersFor(ctx, 'agent/pre-step').length, 1)
  assert.equal(listenersFor(ctx, 'subagent/end').length, 1)
  assert.equal(ctx.effects.length, 1)

  apply(ctx, { budgetTokens: 1000, softRatio: 0.7 })

  assert.equal(listenersFor(ctx, 'agent/pre-step').length, 1, 'the duplicate apply must not register a second listener')
  assert.equal(listenersFor(ctx, 'subagent/end').length, 1)
  assert.equal(ctx.effects.length, 1)
  // The same-context case is the WeakSet guard, so it must say so and must NOT
  // be reported as a double mount.
  assert.ok(
    ctx.warnings.some((line) => line.includes('already applied the plugin')),
    ctx.warnings.join(' | '),
  )
  assert.equal(ctx.warnings.filter((line) => line.includes('mounted twice')).length, 0, ctx.warnings.join(' | '))
})

test('a re-apply after disposal registers again (the hot-reload path)', () => {
  const ctx = createFakeContext({ sessionProjections: fakeProjections(totalsOf(800)) })
  apply(ctx, { budgetTokens: 1000, softRatio: 0.7 })
  dispose(ctx)
  assert.equal(ctx.warnings.length, 0, ctx.warnings.join(' | '))

  apply(ctx, { budgetTokens: 1000, softRatio: 0.7 })

  assert.equal(listenersFor(ctx, 'agent/pre-step').length, 2, 'a legitimate re-apply after disposal must register again')
  assert.equal(ctx.warnings.some((line) => line.includes('already applied the plugin')), false)
  // The disposer decremented the active-registration count, so this is not
  // reported as two live registrations either.
  assert.equal(ctx.warnings.length, 0, ctx.warnings.join(' | '))
})

test('a second distinct context warns that the plugin is mounted twice', () => {
  apply(createFakeContext(), { budgetTokens: 1000 })
  const second = createFakeContext()
  apply(second, { budgetTokens: 1000 })

  const warnings = second.warnings.filter((line) => line.includes('mounted twice'))
  assert.equal(warnings.length, 1, second.warnings.join(' | '))
  assert.match(warnings[0], /counted twice/)
  // Deliberately not skipped: a legitimate remount must keep working.
  assert.equal(listenersFor(second, 'agent/pre-step').length, 1)
  assert.equal(second.effects.length, 1)
})

// ---------------------------------------------------------------------------
// src/plugin.js — the load-time activation line (B2)
// ---------------------------------------------------------------------------

test('apply always writes exactly one activation line, enabled or not', (t) => {
  const enabledLog = createLogFile(t)
  const enabledCtx = activate({
    enabled: true,
    budgetTokens: 3_000_000,
    softRatio: 0.7,
    logFile: enabledLog,
  })
  const enabledLines = readLog(enabledLog).trim().split('\n')
  assert.equal(enabledLines.length, 1, readLog(enabledLog))
  assert.match(enabledLines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z activation: active createUserMessage=\S+/)
  assert.match(
    enabledLines[0],
    /budgetTokens=3000000 softThreshold=2100000 softRatio=0\.7 presets=\[adg\] cacheReadWeight=1 softNudge=true stepNudge=true stepTiers=\[12, 24, 40\] dryRun=false hardDryRun=false logFile=/,
  )
  // The same line goes through the host log, so "the host loaded it" is visible
  // without opening the file.
  assert.ok(enabledCtx.infos.some((line) => line.includes('activation: active')), enabledCtx.infos.join(' | '))

  const disabledLog = createLogFile(t)
  const disabledCtx = activate({ enabled: false, logFile: disabledLog })
  const disabledLines = readLog(disabledLog).trim().split('\n')
  assert.equal(disabledLines.length, 1, readLog(disabledLog))
  assert.match(disabledLines[0], /activation: inactive \(enabled: false\)/)
  assert.match(disabledLines[0], /budgetTokens=3000000 softThreshold=2100000 softRatio=0\.7 presets=\[adg\]/)
  assert.match(disabledLines[0], /dryRun=false/)
  assert.equal(disabledCtx.listeners.size, 0)
  assert.ok(disabledCtx.infos.some((line) => line.includes('inactive (enabled: false)')), disabledCtx.infos.join(' | '))
})

test('a throwing logger or an unwritable logFile cannot break apply', (t) => {
  const hostileLogger = {
    info() {
      throw new Error('info exploded')
    },
    warn() {
      throw new Error('warn exploded')
    },
    error() {
      throw new Error('error exploded')
    },
  }
  // A directory is a legal absolute path that can never be appended to, and a
  // missing parent directory is the other way `appendFileSync` fails.
  const directory = mkdtempSync(join(tmpdir(), 'dsh-adg-token-budget-dir-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const configs = [
    { logFile: directory },
    { logFile: join(directory, 'missing-dir', 'budget.log') },
    { enabled: false, logFile: directory },
    {},
  ]
  for (const config of configs) {
    assert.doesNotThrow(() => {
      const ctx = createFakeContext({})
      ctx.logger = hostileLogger
      apply(ctx, config)
    }, `config ${JSON.stringify(config)}`)
  }
})

test('activationLine reports the resolved configuration on one line', () => {
  const line = activationLine(
    normalizeConfig({
      enabled: true,
      budgetTokens: 1000,
      softRatio: 0.5,
      presets: ['adg'],
      stepTiers: [5, 9],
      dryRun: true,
      hardDryRun: true,
      logFile: 'D:\\x.log',
    }),
    'module-fallback:web',
  )
  assert.match(line, /^activation: active createUserMessage=module-fallback:web /)
  assert.match(line, /budgetTokens=1000 softThreshold=500 softRatio=0\.5 presets=\[adg\]/)
  assert.match(line, /stepNudge=true stepTiers=\[5, 9\] dryRun=true hardDryRun=true logFile='D:\\x\.log'$/)
  assert.equal(line.includes('\n'), false)
  assert.match(activationLine(normalizeConfig({ enabled: false }), undefined), /^activation: inactive \(enabled: false\) /)
})

// ---------------------------------------------------------------------------
// src/plugin.js — the filters
// ---------------------------------------------------------------------------

test('a top-level agent far above the budget is never touched', async () => {
  const ctx = activate({}, { sessionProjections: fakeProjections(totalsOf(9_999_999)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  // Depth 0 via absence, via explicit 0, and via a top-level `adg` session.
  for (const agent of [fakeAgent({ headerDepth: 0 }), fakeAgent({ subagentDepth: 0 }), fakeAgent({ preset: 'adg' })]) {
    const next = trackedNext()
    const decision = await handler({ agent }, next)
    assert.deepEqual(decision, { kind: 'enter', messages: [] })
    assert.equal(next.calls, 1)
    assert.equal(agent.calls.cancel.length, 0)
  }
})

test('a child of another preset, or with no preset, is never touched', async () => {
  const ctx = activate({}, { sessionProjections: fakeProjections(totalsOf(9_999_999)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const cases = [
    ['standard', fakeAgent({ preset: 'standard', headerDepth: 2 })],
    ['absent', fakeAgent({ headerDepth: 2 })],
    ['undefined', fakeAgent({ preset: undefined, headerDepth: 2 })],
    ['ADG', fakeAgent({ preset: 'ADG', headerDepth: 2 })],
    ['adg-other', fakeAgent({ preset: 'adg-other', headerDepth: 2 })],
  ]
  for (const [label, agent] of cases) {
    const next = trackedNext()
    const decision = await handler({ agent }, next)
    assert.deepEqual(decision, { kind: 'enter', messages: [] }, `preset ${label}`)
    assert.equal(next.calls, 1)
    assert.equal(agent.calls.cancel.length, 0)
  }
})

test('a governed child below the soft threshold passes through', async () => {
  const ctx = activate({ budgetTokens: 1000, softRatio: 0.7 }, { sessionProjections: fakeProjections(totalsOf(600)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext([{ role: 'user' }])
  const decision = await handler({ agent }, next)
  assert.deepEqual(decision, { kind: 'enter', messages: [{ role: 'user' }] })
  assert.equal(next.calls, 1)
  assert.equal(agent.calls.cancel.length, 0)
  // Step checkpoints are on by default, so the step is counted. Nothing is
  // injected and no flag is consumed — the entry is a counter, not a reminder.
  assert.equal(handler.testState.sessions.size, 1)
  assert.deepEqual(entryFields(handler.testState.sessions.get('child-1')), { steps: 1, nudged: false, firedTiers: [] })
})

test('with stepNudge: false a passing step still allocates nothing', async () => {
  // The zero-allocation pass-through is a real property of the token stage, and
  // turning the step checkpoints off restores it exactly.
  for (const raw of [{ budgetTokens: 1000, softRatio: 0.7, stepNudge: false }, { budgetTokens: 1000, softRatio: 0.7, softNudge: false, stepNudge: false }]) {
    const ctx = activate(raw, { sessionProjections: fakeProjections(totalsOf(600)) })
    const handler = listenerOf(ctx, 'agent/pre-step')
    await handler({ agent: fakeAdgChild({ headerDepth: 1 }) }, trackedNext())
    assert.equal(handler.testState.sessions.size, 0, JSON.stringify(raw))
  }
})

// ---------------------------------------------------------------------------
// src/plugin.js — the soft stage
// ---------------------------------------------------------------------------

test('the soft stage delegates first, then appends exactly one nudge, once', async () => {
  const ctx = activate({ budgetTokens: 1000, softRatio: 0.7 }, { sessionProjections: fakeProjections(totalsOf(700)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const existing = { role: 'user', id: 'existing' }

  const first = trackedNext([existing])
  const firstDecision = await handler({ agent }, first)
  assert.equal(first.calls, 1, 'next() must be called on the soft path')
  assert.equal(firstDecision.kind, 'enter')
  assert.equal(firstDecision.messages.length, 2)
  assert.equal(firstDecision.messages[0], existing, 'the downstream messages must be preserved in order')
  const nudge = firstDecision.messages[1]
  assert.equal(nudge.role, 'user')
  assert.deepEqual(nudge.source, { kind: 'plugin', plugin: 'dsh-adg-token-budget' })
  assert.equal(nudge.content[0].text, NUDGE_TEXT)
  assert.match(nudge.id, /^[0-9a-f-]{36}$/)
  assert.ok(Object.isFrozen(nudge), 'the injected message must be immutable like a real UserMessage')
  assert.equal(handler.testState.sessions.has('child-1'), true)

  // A second step at the same level must NOT add a second nudge.
  const second = trackedNext([existing])
  const secondDecision = await handler({ agent }, second)
  assert.equal(second.calls, 1)
  assert.deepEqual(secondDecision, { kind: 'enter', messages: [existing] })

  // A third step is still nudged only once.
  const third = trackedNext([existing])
  const thirdDecision = await handler({ agent }, third)
  assert.equal(third.calls, 1)
  assert.equal(thirdDecision.messages.length, 1)
})

test('softNudge: false logs the soft stage once and consumes the one-shot flag', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, softNudge: false, logFile },
    { sessionProjections: fakeProjections(totalsOf(700)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const existing = { role: 'user', id: 'existing' }
  const next = trackedNext([existing])
  const decision = await handler({ agent }, next)
  assert.equal(next.calls, 1)
  assert.deepEqual(decision, { kind: 'enter', messages: [existing] })
  assert.match(readLog(logFile), /soft stage \(no nudge configured\)/)
  // With the instruction switched off, the single log line IS the one-shot
  // action, so it does consume the flag.
  assert.equal(handler.testState.sessions.get('child-1').nudged, true)
  await handler({ agent }, trackedNext([existing]))
  assert.equal(decisionLines(logFile).length, 1, readLog(logFile))
})

test('a downstream reject is honoured: the soft stage never invents messages', async () => {
  const ctx = activate({ budgetTokens: 1000, softRatio: 0.7 }, { sessionProjections: fakeProjections(totalsOf(800)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = async () => ({ kind: 'reject' })
  assert.deepEqual(await handler({ agent }, next), { kind: 'reject' })
})

test('a failing downstream listener is never swallowed, and next() is called once', async () => {
  // The reproduction of the worst defect: this listener sits in a Cordis
  // waterfall with the built-in step as the innermost `next`, and a downstream
  // `agent/pre-step` listener (there are ~15 globally, e.g. dsh-hooks-codex)
  // throws after it has delegated. Re-calling `next()` from the catch would shift
  // the shared cursor past the end and re-enter the built-in behaviour, turning
  // that listener's failure into a silent pass-through.
  const ctx = activate({ budgetTokens: 1000, softRatio: 0.7 }, { sessionProjections: fakeProjections(totalsOf(800)) })
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
  // is the contract: a budget guard must not change anyone else's failure.
  const plain = createWaterfall({ agent }, [downstream], inner)
  await assert.rejects(plain.run(), (error) => error === boom)
  assert.equal(plain.stats.inner, 1)
})

test('the once-per-session flag is set only after the nudge was delivered', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, logFile },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })

  // The first soft step ends in a downstream `reject`, so the child was told
  // nothing: the flag must stay unset, or the instruction is lost forever.
  const rejecting = async () => ({ kind: 'reject' })
  assert.deepEqual(await handler({ agent }, rejecting), { kind: 'reject' })
  assert.equal(handler.testState.sessions.has('child-1'), false, 'an undelivered nudge must not consume the one-shot flag')
  assert.match(readLog(logFile), /soft stage \(no nudge injected: decision kind=reject\)/)

  // A later soft step is entered, so the instruction is finally delivered.
  const next = trackedNext([{ role: 'user', id: 'existing' }])
  const decision = await handler({ agent }, next)
  assert.equal(next.calls, 1)
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[1].content[0].text, NUDGE_TEXT)
  assert.equal(handler.testState.sessions.get('child-1').nudged, true)
  assert.match(readLog(logFile), /soft stage: nudged usage=800 budget=1000 label=adg\/child-1/)
})

test('the decision log records the soft nudge exactly once per session', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, logFile },
    { sessionProjections: fakeProjections(totalsOf(750)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const first = await handler({ agent }, trackedNext())
  await handler({ agent }, trackedNext())
  await handler({ agent }, trackedNext())
  assert.equal(first.messages.length, 1)
  const lines = decisionLines(logFile)
  // One line per NUDGE, not one per step: a child that sits above the soft
  // threshold for a hundred steps must not write a hundred lines.
  assert.equal(lines.length, 1, `log was: ${JSON.stringify(readLog(logFile))}`)
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z soft stage: nudged usage=750 budget=1000 label=adg\/child-1$/)
})

test('the decision log records a hard stop', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, softNudge: false, logFile },
    { sessionProjections: fakeProjections(totalsOf(4000)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ id: 'child-hard', headerDepth: 1 })
  assert.deepEqual(await handler({ agent }, trackedNext()), { kind: 'reject' })
  assert.match(readLog(logFile), /hard stage: cancel usage=4000 budget=1000 label=adg\/child-hard/)
})

// ---------------------------------------------------------------------------
// src/plugin.js — dryRun: compute and log every decision, take no action
// ---------------------------------------------------------------------------

test('dryRun soft injects nothing and logs the nudge it would have made', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, dryRun: true, logFile },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const existing = { role: 'user', id: 'existing' }
  const next = trackedNext([existing])
  const decision = await handler({ agent }, next)

  assert.equal(next.calls, 1, 'dryRun still delegates through next()')
  assert.deepEqual(decision, { kind: 'enter', messages: [existing] }, 'dryRun must inject nothing')
  assert.equal(agent.calls.cancel.length, 0)
  assert.match(readLog(logFile), /dry-run soft stage: would nudge usage=800 budget=1000 label=adg\/child-1/)
  // A calibration run must not consume the once-per-epoch flags either. It DOES
  // count the step: that count is exactly what a step checkpoint is calibrated
  // against, so refusing to count would leave nothing to measure.
  const entry = handler.testState.sessions.get('child-1')
  assert.equal(entry.nudged, false)
  assert.deepEqual(entry.firedTiers, [])
  assert.equal(entry.steps, 1)
})

test('dryRun soft logs why it would not nudge', async (t) => {
  const rejectLog = createLogFile(t)
  const rejecting = activate(
    { budgetTokens: 1000, softRatio: 0.7, dryRun: true, logFile: rejectLog },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const agent = fakeAdgChild({ headerDepth: 1 })
  const decision = await listenerOf(rejecting, 'agent/pre-step')({ agent }, async () => ({ kind: 'reject' }))
  assert.deepEqual(decision, { kind: 'reject' })
  assert.match(readLog(rejectLog), /dry-run soft stage: would not nudge \(decision kind=reject\)/)

  const quietLog = createLogFile(t)
  const quiet = activate(
    { budgetTokens: 1000, softRatio: 0.7, dryRun: true, softNudge: false, logFile: quietLog },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  await listenerOf(quiet, 'agent/pre-step')({ agent }, trackedNext())
  assert.match(readLog(quietLog), /dry-run soft stage: would not nudge \(softNudge: false/)
})

test('dryRun hard does not cancel, does not reject, and delegates through next()', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, dryRun: true, logFile },
    { sessionProjections: fakeProjections(totalsOf(4000)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext([{ role: 'user' }])
  const decision = await handler({ agent }, next)

  assert.equal(next.calls, 1)
  assert.deepEqual(decision, { kind: 'enter', messages: [{ role: 'user' }] })
  assert.equal(agent.calls.cancel.length, 0, 'dryRun must not cancel a live child')
  assert.match(readLog(logFile), /dry-run hard stage: would cancel usage=4000 budget=1000 label=adg\/child-1/)
})

test('hardDryRun arms the reminders for real while the cancel stays in calibration', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, stepTiers: [1], dryRun: false, hardDryRun: true, logFile },
    { sessionProjections: fakeProjections(totalsOf(4000)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext([{ role: 'user', id: 'existing' }])
  const decision = await handler({ agent }, next)

  assert.equal(next.calls, 1, 'the hard stage must still delegate under hardDryRun')
  assert.equal(agent.calls.cancel.length, 0, 'hardDryRun must never cancel a live child')
  assert.equal(decision.kind, 'enter')
  // The checkpoint IS injected: that is the whole point of arming the reminders
  // without arming the destructive stage.
  assert.equal(decision.messages.length, 2)
  assert.match(decision.messages[1].content[0].text, /收敛检查点 1／1/)
  const lines = decisionLines(logFile).map((line) => line.replace(/^\S+ /, ''))
  assert.deepEqual(lines, [
    'dry-run hard stage: would cancel usage=4000 budget=1000 label=adg/child-1',
    'step stage: nudged tier=1/1 step=1 usage=4000 budget=1000 label=adg/child-1',
  ])

  // `dryRun` still outranks it: with both switches on, nothing is injected.
  const both = activate(
    { budgetTokens: 1000, softRatio: 0.7, stepTiers: [1], dryRun: true, hardDryRun: true },
    { sessionProjections: fakeProjections(totalsOf(4000)) },
  )
  const inert = await listenerOf(both, 'agent/pre-step')({ agent: fakeAdgChild({ headerDepth: 1 }) }, trackedNext())
  assert.deepEqual(inert, { kind: 'enter', messages: [] })
})

test('dryRun does not consume the one-shot flag, so arming still nudges', async (t) => {
  const dryLog = createLogFile(t)
  const dry = activate(
    { budgetTokens: 1000, softRatio: 0.7, dryRun: true, logFile: dryLog },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const dryHandler = listenerOf(dry, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await dryHandler({ agent }, trackedNext()), { kind: 'enter', messages: [] })
  }
  // Calibration counts the steps it watches, and consumes no flag they would
  // have set: `nudged` and `firedTiers` are still untouched after three steps.
  assert.deepEqual(entryFields(dryHandler.testState.sessions.get('child-1')), { steps: 3, nudged: false, firedTiers: [] })

  // Turning dryRun off is a config change (a fresh activation). Because the
  // calibration run consumed nothing, the first governed step is still nudged —
  // which is the whole point of being able to calibrate before arming.
  const armedLog = createLogFile(t)
  const armed = activate(
    { budgetTokens: 1000, softRatio: 0.7, dryRun: false, logFile: armedLog },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const decision = await listenerOf(armed, 'agent/pre-step')({ agent }, trackedNext())
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].content[0].text, NUDGE_TEXT)
  assert.match(readLog(armedLog), /soft stage: nudged usage=800 budget=1000/)
  assert.doesNotMatch(readLog(armedLog), /dry-run/)
})

// ---------------------------------------------------------------------------
// src/plugin.js — the step checkpoints
// ---------------------------------------------------------------------------

test('a checkpoint injects its reminder on the tier step, once per tier', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1_000_000, softRatio: 0.9, stepTiers: [2, 4], logFile },
    { sessionProjections: fakeProjections(totalsOf(10)) },
  )
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
  assert.ok(reminder.content[0].text.includes(STEP_NUDGE_TEXTS[0]))
  assert.ok(Object.isFrozen(reminder), 'the injected message must be immutable like a real UserMessage')

  // Step 3: the same tier must not fire twice.
  assert.deepEqual((await handler({ agent }, trackedNext())).messages.length, 0)

  // Step 4: tier 2, with the escalated body.
  const fourth = await handler({ agent }, trackedNext())
  assert.equal(fourth.messages.length, 1)
  assert.match(fourth.messages[0].content[0].text, /^【收敛检查点 2／2】调度代理提醒：这是你的第 4 步。/)
  assert.ok(fourth.messages[0].content[0].text.includes(STEP_NUDGE_TEXTS[1]))

  // Step 5: the list is exhausted, so the child is left alone.
  assert.deepEqual((await handler({ agent }, trackedNext())).messages.length, 0)

  const lines = decisionLines(logFile).map((line) => line.replace(/^\S+ /, ''))
  assert.deepEqual(lines, [
    'step stage: nudged tier=1/2 step=2 usage=10 budget=1000000 label=adg/child-1',
    'step stage: nudged tier=2/2 step=4 usage=10 budget=1000000 label=adg/child-1',
  ])
  assert.deepEqual(entryFields(handler.testState.sessions.get('child-1')), { steps: 5, nudged: false, firedTiers: [0, 1] })
})

test('only an entered step is counted, so a rejected step costs no tier', async () => {
  const ctx = activate(
    { budgetTokens: 1_000_000, softRatio: 0.9, stepTiers: [2] },
    { sessionProjections: fakeProjections(totalsOf(10)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  await handler({ agent }, trackedNext())
  // A downstream listener rejected this step, so no step opened: the child is
  // still on step 1 and the tier stays owed.
  assert.deepEqual(await handler({ agent }, async () => ({ kind: 'reject' })), { kind: 'reject' })
  assert.equal(handler.testState.sessions.get('child-1').steps, 1)
  assert.deepEqual(handler.testState.sessions.get('child-1').firedTiers, [])

  const decision = await handler({ agent }, trackedNext())
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /第 2 步/)
  assert.equal(handler.testState.sessions.get('child-1').steps, 2)
})

test('step counters are per child', async () => {
  const ctx = activate(
    { budgetTokens: 1_000_000, softRatio: 0.9, stepTiers: [2] },
    { sessionProjections: fakeProjections(totalsOf(10)) },
  )
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

test('dryRun checkpoints log every decision and consume nothing', async (t) => {
  const logFile = createLogFile(t)
  const dry = activate(
    { budgetTokens: 1_000_000, softRatio: 0.9, stepTiers: [2], dryRun: true, logFile },
    { sessionProjections: fakeProjections(totalsOf(10)) },
  )
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
    'dry-run step stage: would nudge tier=1/1 step=2 usage=10 budget=1000000 label=adg/child-1',
    'dry-run step stage: would nudge tier=1/1 step=3 usage=10 budget=1000000 label=adg/child-1',
  ])
  assert.deepEqual(entryFields(dryHandler.testState.sessions.get('child-1')), { steps: 3, nudged: false, firedTiers: [] })

  // A step that never opened is reported as such, and still leaves the tier owed.
  assert.deepEqual(await dryHandler({ agent }, async () => ({ kind: 'reject' })), { kind: 'reject' })
  assert.match(readLog(logFile), /dry-run step stage: would not nudge \(decision kind=reject\) tier=1\/1 step=3/)

  // Arming afterwards delivers that checkpoint, because calibration consumed
  // nothing on that session.
  const armed = activate(
    { budgetTokens: 1_000_000, softRatio: 0.9, stepTiers: [2] },
    { sessionProjections: fakeProjections(totalsOf(10)) },
  )
  const armedHandler = listenerOf(armed, 'agent/pre-step')
  await armedHandler({ agent }, trackedNext())
  const decision = await armedHandler({ agent }, trackedNext())
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /收敛检查点 1／1/)
})

test('when both triggers are due, one reminder is sent and the tier is spent', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, stepTiers: [1], logFile },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const decision = await handler({ agent }, trackedNext())

  // Exactly one message — the token wrap-up, which is the more urgent of the
  // two — rather than two near-identical reminders re-sent on every later step.
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].content[0].text, NUDGE_TEXT)
  const entry = handler.testState.sessions.get('child-1')
  assert.equal(entry.nudged, true)
  assert.deepEqual(entry.firedTiers, [0], 'the checkpoint is spent: the child was told to converge')
  assert.deepEqual(decisionLines(logFile).map((line) => line.replace(/^\S+ /, '')), [
    'soft stage: nudged usage=800 budget=1000 label=adg/child-1',
    'step stage: folded into the token wrap-up tier=1/1 step=1 usage=800 budget=1000 label=adg/child-1',
  ])

  // The next step carries nothing new.
  assert.deepEqual((await handler({ agent }, trackedNext())).messages.length, 0)
})

test('stepNudge: false turns the checkpoints off without touching the token stage', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, stepTiers: [1], stepNudge: false, logFile },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const decision = await handler({ agent }, trackedNext())
  // The token wrap-up is still delivered for real...
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].content[0].text, NUDGE_TEXT)
  // ...while the checkpoint is not injected, not logged, and not even counted.
  assert.equal(handler.testState.sessions.get('child-1').steps, 0)
  assert.deepEqual(handler.testState.sessions.get('child-1').firedTiers, [])
  assert.doesNotMatch(readLog(logFile), /step stage/)
})

test('softNudge: false logs a due checkpoint once and spends its tier', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, stepTiers: [1], softNudge: false, logFile },
    { sessionProjections: fakeProjections(totalsOf(800)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  assert.deepEqual(await handler({ agent }, trackedNext()), { kind: 'enter', messages: [] })

  const lines = decisionLines(logFile).map((line) => line.replace(/^\S+ /, ''))
  assert.deepEqual(lines, [
    'soft stage (no nudge configured) usage=800 budget=1000 label=adg/child-1',
    'step stage (no nudge configured) tier=1/1 step=1 usage=800 budget=1000 label=adg/child-1',
  ])
  assert.deepEqual(handler.testState.sessions.get('child-1').firedTiers, [0])
  // A second step adds nothing: both flags are spent.
  await handler({ agent }, trackedNext())
  assert.equal(decisionLines(logFile).length, 2)
})

test('stepNudgeText escalates, reuses its last body, and is total', () => {
  const first = stepNudgeText({ tierIndex: 0, tierCount: 3, stepCount: 12 })
  const third = stepNudgeText({ tierIndex: 2, tierCount: 3, stepCount: 40 })
  assert.match(first, /^【收敛检查点 1／3】调度代理提醒：这是你的第 12 步。/)
  assert.ok(first.includes(STEP_NUDGE_TEXTS[0]))
  assert.ok(third.includes(STEP_NUDGE_TEXTS[2]))
  assert.notEqual(first, third)

  // Past the supplied bodies the firmest one is reused, and the ordinal still
  // tells the child where it is in its own escalation.
  const ninth = stepNudgeText({ tierIndex: 8, tierCount: 9, stepCount: 99 })
  assert.match(ninth, /^【收敛检查点 9／9】/)
  assert.ok(ninth.includes(STEP_NUDGE_TEXTS[STEP_NUDGE_TEXTS.length - 1]))

  // Junk input cannot throw inside a live step.
  assert.match(stepNudgeText(undefined), /^【收敛检查点 1／3】调度代理提醒：这是你的第 0 步。/)
  assert.match(stepNudgeText({ tierIndex: -1, tierCount: 0, stepCount: Number.NaN }), /^【收敛检查点 1／3】/)

  // Every body has to protect the result, not only the budget: each one must
  // still allow the work that is required for the delivery, and each one must
  // ask for a report. A checkpoint that only said "stop now" would trade tokens
  // for a worse answer.
  for (const body of STEP_NUDGE_TEXTS) {
    assert.match(body, /必需/, body)
    assert.match(body, /汇报/, body)
  }
})

// ---------------------------------------------------------------------------
// src/plugin.js — the hard stage
// ---------------------------------------------------------------------------

test('the hard stage cancels exactly once and rejects without delegating', async (t) => {
  const logFile = createLogFile(t)
  const ctx = activate(
    { budgetTokens: 1000, softRatio: 0.7, logFile },
    { sessionProjections: fakeProjections(totalsOf(1000)) },
  )
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext()
  const decision = await handler({ agent }, next)
  assert.deepEqual(decision, { kind: 'reject' })
  assert.equal(next.calls, 0, 'the hard stage must not call next()')
  assert.equal(agent.calls.cancel.length, 1)
  assert.deepEqual(agent.calls.cancel[0].cause, { kind: 'parent' })
  assert.match(readLog(logFile), /hard stage: cancel usage=1000 budget=1000/)
})

test('a throwing agent.cancel still yields the hard reject', async () => {
  const ctx = activate({ budgetTokens: 1000 }, { sessionProjections: fakeProjections(totalsOf(1000)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({
    headerDepth: 1,
    cancel() {
      throw new Error('already settled')
    },
  })
  const next = trackedNext()
  assert.deepEqual(await handler({ agent }, next), { kind: 'reject' })
  assert.equal(next.calls, 0)
  assert.equal(agent.calls.cancel.length, 1)
  assert.ok(ctx.warnings.some((line) => line.includes('agent.cancel failed')))
})

test('a resumed child with only a header depth is still governed', async () => {
  const ctx = activate({ budgetTokens: 1000 }, { sessionProjections: fakeProjections(totalsOf(1000)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  // Fresh options (no subagentDepth) plus a persisted delegation depth: the
  // header is the authoritative, monotone signal.
  const agent = fakeAdgChild({ headerDepth: 1 })
  assert.deepEqual(await handler({ agent }, trackedNext()), { kind: 'reject' })
  assert.equal(agent.calls.cancel.length, 1)
})

// ---------------------------------------------------------------------------
// src/plugin.js — missing data and failures
// ---------------------------------------------------------------------------

test('missing sessionProjections passes through without crashing or cancelling', async () => {
  const ctx = activate({ budgetTokens: 1000 }, {})
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext()
  assert.deepEqual(await handler({ agent }, next), { kind: 'enter', messages: [] })
  assert.equal(next.calls, 1)
  assert.equal(agent.calls.cancel.length, 0)
  // A child with no projection has nothing to nudge or stop with on the token
  // path, so no token flag may be set. The step checkpoint does not need the
  // projection, so it still counts the step.
  assert.deepEqual(entryFields(handler.testState.sessions.get('child-1')), { steps: 1, nudged: false, firedTiers: [] })
})

test('with no projection, a step checkpoint still fires', async (t) => {
  // The step stage reads no service, so a broken projection must not disable it.
  const logFile = createLogFile(t)
  const ctx = activate({ budgetTokens: 1000, stepTiers: [2], logFile }, {})
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  assert.deepEqual(await handler({ agent }, trackedNext()), { kind: 'enter', messages: [] })
  const decision = await handler({ agent }, trackedNext())
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /收敛检查点 1／1/)
  assert.match(readLog(logFile), /step stage: nudged tier=1\/1 step=2 usage=undefined budget=1000 label=adg\/child-1/)
})

test('a projection without a mounted stateOf, or with no totals, passes through', async () => {
  const services = [
    {},
    { stateOf: 'not a function' },
    fakeProjections(undefined),
    fakeProjections(null),
    fakeProjections({ last: null }),
    { stateOf: () => undefined },
  ]
  for (const service of services) {
    const ctx = activate({ budgetTokens: 1000 }, { sessionProjections: service })
    const handler = listenerOf(ctx, 'agent/pre-step')
    const agent = fakeAdgChild({ headerDepth: 1 })
    const next = trackedNext()
    const decision = await handler({ agent }, next)
    assert.deepEqual(decision, { kind: 'enter', messages: [] })
    assert.equal(next.calls, 1)
    assert.equal(agent.calls.cancel.length, 0)
  }
})

test('a throwing stateOf is contained: next() decides and the failure is logged once', async () => {
  const ctx = activate({ budgetTokens: 1000 }, {
    sessionProjections: fakeProjections(new Error('projection exploded')),
  })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext([{ role: 'user' }])
  const decision = await handler({ agent }, next)
  assert.equal(next.calls, 1, "the handler must fall back to next()'s decision")
  assert.deepEqual(decision, { kind: 'enter', messages: [{ role: 'user' }] })
  assert.equal(agent.calls.cancel.length, 0)
  assert.ok(ctx.warnings.some((line) => line.includes('pre-step handler failed')), ctx.warnings.join(' | '))

  // The "logged once" contract: a second failure does not repeat the warning.
  const before = ctx.warnings.length
  await handler({ agent }, trackedNext())
  assert.equal(ctx.warnings.length, before)
})

test('a throwing ctx.get degrades to pass-through', async () => {
  const ctx = createFakeContext({})
  ctx.get = () => {
    throw new Error('service lookup exploded')
  }
  apply(ctx, { budgetTokens: 1000 })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const agent = fakeAdgChild({ headerDepth: 1 })
  const next = trackedNext()
  assert.deepEqual(await handler({ agent }, next), { kind: 'enter', messages: [] })
  assert.equal(next.calls, 1)
  assert.equal(agent.calls.cancel.length, 0)
})

test('a malformed payload is contained rather than propagating', async () => {
  const ctx = activate({ budgetTokens: 1000 }, { sessionProjections: fakeProjections(totalsOf(1)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  for (const payload of [undefined, null, {}, { agent: undefined }, { agent: {} }, { agent: { id: 42 } }]) {
    const next = trackedNext()
    const decision = await handler(payload, next)
    assert.deepEqual(decision, { kind: 'enter', messages: [] })
    assert.equal(next.calls, 1)
  }
})

// ---------------------------------------------------------------------------
// src/plugin.js — cacheReadWeight
// ---------------------------------------------------------------------------

test('cacheReadWeight actually moves a case across the budget', async () => {
  // 1_000_000 uncached + 3_000_000 cache-read; budget 3_000_000.
  const totals = totalsOf(1_000_000, 0, 3_000_000, 0)

  const under = activate({ budgetTokens: 3_000_000, cacheReadWeight: 0 }, { sessionProjections: fakeProjections(totals) })
  const underAgent = fakeAdgChild({ headerDepth: 1 })
  const underNext = trackedNext()
  const underDecision = await listenerOf(under, 'agent/pre-step')({ agent: underAgent }, underNext)
  assert.deepEqual(underDecision, { kind: 'enter', messages: [] })
  assert.equal(underNext.calls, 1)
  assert.equal(underAgent.calls.cancel.length, 0)

  const over = activate({ budgetTokens: 3_000_000, cacheReadWeight: 1 }, { sessionProjections: fakeProjections(totals) })
  const overAgent = fakeAdgChild({ headerDepth: 1 })
  const overNext = trackedNext()
  const overDecision = await listenerOf(over, 'agent/pre-step')({ agent: overAgent }, overNext)
  assert.deepEqual(overDecision, { kind: 'reject' })
  assert.equal(overNext.calls, 0)
  assert.equal(overAgent.calls.cancel.length, 1)

  // A fractional weight lands in the soft band: 1_000_000 + 1_500_000 =
  // 2_500_000, which is >= 0.7 * 3_000_000 and below the budget.
  const soft = activate(
    { budgetTokens: 3_000_000, cacheReadWeight: 0.5, softRatio: 0.7 },
    { sessionProjections: fakeProjections(totals) },
  )
  const softAgent = fakeAdgChild({ headerDepth: 1 })
  const softNext = trackedNext()
  const softDecision = await listenerOf(soft, 'agent/pre-step')({ agent: softAgent }, softNext)
  assert.equal(softNext.calls, 1)
  assert.equal(softDecision.messages.length, 1)
  assert.equal(softAgent.calls.cancel.length, 0)
})

test('a weight that flips an agent from soft to hard flips cancel accordingly', async () => {
  const totals = totalsOf(500_000, 0, 1_000_000, 0)

  const softCtx = activate(
    { budgetTokens: 1_000_000, softRatio: 0.5, cacheReadWeight: 0 },
    { sessionProjections: fakeProjections(totals) },
  )
  const softAgent = fakeAdgChild({ headerDepth: 1 })
  const softNext = trackedNext()
  const softDecision = await listenerOf(softCtx, 'agent/pre-step')({ agent: softAgent }, softNext)
  assert.equal(softNext.calls, 1)
  assert.equal(softDecision.messages.length, 1)
  assert.equal(softAgent.calls.cancel.length, 0)

  const hardCtx = activate(
    { budgetTokens: 1_000_000, softRatio: 0.5, cacheReadWeight: 1 },
    { sessionProjections: fakeProjections(totals) },
  )
  const hardAgent = fakeAdgChild({ headerDepth: 1 })
  const hardNext = trackedNext()
  const hardDecision = await listenerOf(hardCtx, 'agent/pre-step')({ agent: hardAgent }, hardNext)
  assert.deepEqual(hardDecision, { kind: 'reject' })
  assert.equal(hardNext.calls, 0)
  assert.equal(hardAgent.calls.cancel.length, 1)
})

// ---------------------------------------------------------------------------
// src/plugin.js — state hygiene
// ---------------------------------------------------------------------------

test('the per-session map is released on subagent/end', async () => {
  const ctx = activate({ budgetTokens: 1000, softRatio: 0.7 }, { sessionProjections: fakeProjections(totalsOf(800)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  const onEnd = listenerOf(ctx, 'subagent/end')
  assert.equal(typeof onEnd, 'function')

  const agent = fakeAdgChild({ id: 'child-abc', headerDepth: 1 })
  await handler({ agent }, trackedNext())
  assert.equal(handler.testState.sessions.has('child-abc'), true)

  onEnd({ runId: 'run-1', provider: 'in-process', id: 'child-abc', local: true, stopReason: 'completed' })
  assert.equal(handler.testState.sessions.has('child-abc'), false)

  // An unknown or malformed settle edge is harmless.
  assert.doesNotThrow(() => onEnd({}))
  assert.doesNotThrow(() => onEnd(undefined))
  assert.doesNotThrow(() => onEnd({ id: 42 }))
})

test('the disposal effect clears the map', async () => {
  const ctx = activate({ budgetTokens: 1000, softRatio: 0.7 }, { sessionProjections: fakeProjections(totalsOf(800)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  await handler({ agent: fakeAdgChild({ id: 'child-1', headerDepth: 1 }) }, trackedNext())
  await handler({ agent: fakeAdgChild({ id: 'child-2', headerDepth: 1 }) }, trackedNext())
  assert.equal(handler.testState.sessions.size, 2)

  assert.equal(ctx.effects.length, 1)
  const dispose = ctx.effects[0]()
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(handler.testState.sessions.size, 0)
})

test('with stepNudge: false a child that only passes through allocates nothing', async () => {
  const ctx = activate({ budgetTokens: 1000, stepNudge: false }, { sessionProjections: fakeProjections(totalsOf(10)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  for (let index = 0; index < 25; index += 1) {
    await handler({ agent: fakeAdgChild({ id: `child-${index}`, headerDepth: 1 }) }, trackedNext())
  }
  assert.equal(handler.testState.sessions.size, 0)
})

test('with step checkpoints on, each child gets exactly one counter entry', async () => {
  const ctx = activate({ budgetTokens: 1000 }, { sessionProjections: fakeProjections(totalsOf(10)) })
  const handler = listenerOf(ctx, 'agent/pre-step')
  for (let index = 0; index < 25; index += 1) {
    await handler({ agent: fakeAdgChild({ id: `child-${index}`, headerDepth: 1 }) }, trackedNext())
  }
  // Bounded by live children, not by steps: 25 children, 25 entries, one step each.
  assert.equal(handler.testState.sessions.size, 25)
  for (let index = 0; index < 25; index += 1) {
    assert.equal(handler.testState.sessions.get(`child-${index}`).steps, 1)
  }
})

// ---------------------------------------------------------------------------
// src/plugin.js — module shape
// ---------------------------------------------------------------------------

test('the module exposes the loader-facing shape', async () => {
  const module = await import('../src/plugin.js')
  assert.equal(module.name, 'dsh-adg-token-budget')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.Config, undefined, 'no Config schema: the plugin hand-normalizes')
  assert.equal(module.inject, undefined, 'no static inject: a pending entry is a fatal boot error')
  assert.equal(module.default, undefined)
})

test('the listeners are registered globally and exactly once', () => {
  const ctx = activate({})
  const preStep = ctx.listeners.get('agent/pre-step')
  assert.equal(preStep.length, 1, 'exactly one agent/pre-step listener')
  assert.deepEqual(preStep[0].options, { global: true })
  const end = ctx.listeners.get('subagent/end')
  assert.equal(end.length, 1)
  assert.deepEqual(end[0].options, { global: true })
  assert.equal(ctx.listeners.size, 2)
})
