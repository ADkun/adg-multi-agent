/**
 * Configuration normalization for dsh-adg-token-budget.
 *
 * A composed patch row passes its `config:` block straight through, and this
 * module turns it into a fully-populated option object. The plugin deliberately
 * exports no Cordis `Config` schema: a schema-backed row would let a malformed
 * value fail the profile load, and a boot failure in `dsh` is fatal for the
 * whole GUI. Instead every unusable value falls back to its default here and is
 * reported through the plugin's own logger.
 *
 * There are no token-budget keys here. The plugin used to take `budgetTokens`,
 * `softRatio`, `cacheReadWeight`, `softNudge` and `hardDryRun`; the token
 * soft stage and the hard cancel they configured were removed, and a row that
 * still carries them is not an error — unknown keys are simply ignored, so an
 * older composition keeps loading and only the step checkpoints remain.
 *
 * @module dsh-adg-token-budget/config
 */

/**
 * The most step tiers the plugin will honour.
 *
 * A tier list is operator-authored, so its length is a bound on per-session
 * memory (`firedTiers` holds one index per tier) and on the work done per step.
 * Sixteen checkpoints in one child session is already far past useful.
 */
export const MAX_STEP_TIERS = 16

/**
 * The longest custom `stepText` the plugin will inject.
 *
 * The body rides in every later request of that child, so an accidentally huge
 * template is a per-step cost, not a one-off. Four thousand characters is far
 * past any reminder that could still be read as a reminder.
 */
export const MAX_STEP_TEXT_CHARS = 4_000

/** Every option with its default, as one frozen reference object. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Master switch; `false` makes `apply` register nothing at all. */
  enabled: true,
  /** Agent-preset names whose delegated children this plugin governs. */
  presets: Object.freeze(['adg']),
  /**
   * Whether the step checkpoints run: count the steps this child has entered,
   * and inject a convergence reminder when the count reaches each `stepTiers`
   * entry (once per tier per residency epoch).
   *
   * `false` turns the whole feature off — including the counting, so nothing is
   * allocated on a passing step. Use `dryRun` to keep counting while injecting
   * nothing.
   */
  stepNudge: true,
  /**
   * The step numbers a checkpoint fires on, ascending. An entered step is
   * counted as the child's Nth step, and a tier of N fires on that step.
   *
   * Early and dense on purpose. The measured child distribution (37 delegated
   * sessions) is min=1 p10=6 p25=14 median=39 p75=61 p90=103 max=329: most
   * delegations are far shorter than the mean, so a ladder anchored on the
   * average asks the question too late. These fire every 4–6 steps through step
   * 24, then widen geometrically so a runaway keeps getting checked without
   * every long child being interrupted on every step. A reminder costs a few
   * dozen tokens per later step, which is why frequency is affordable here.
   */
  stepTiers: Object.freeze([4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]),
  /**
   * The wording of a step checkpoint, overriding the built-in body.
   *
   * `null` (the default) uses the built-in choice body. This exists because the
   * wording is the part that gets tuned: it lives in `config:`, so a wording
   * change hot-reloads with the row instead of needing a new package and a dsh
   * restart. A configured body replaces the built-in one entirely, including
   * the extra sentence the built-in adds on the last tier.
   */
  stepText: null,
  /**
   * Calibration switch: compute and log every checkpoint decision, but inject
   * nothing and consume nothing. The step is delegated through `next()` either
   * way; only the message is withheld, and no tier is marked fired, so arming
   * the plugin afterwards still delivers that checkpoint. Steps are still
   * counted, because "which step would have been reminded" is the thing being
   * calibrated.
   */
  dryRun: false,
  /** Append one line per decision to this absolute path; `null` disables it. */
  logFile: null,
})

/** @returns {boolean} whether `value` is a plain object. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a boolean, falling back when the value is absent or of another type. */
function readBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** Read a finite number, falling back when the value is absent or invalid. */
function readNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Read a non-empty trimmed string, or `undefined` when there is none. */
function readText(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read a non-empty list of trimmed, de-duplicated names.
 *
 * A bare string is accepted as a one-name list, so `presets: adg` — the way a
 * YAML scalar reads — behaves the same as `presets: ['adg']` instead of
 * silently disabling the plugin.
 *
 * @param value - the raw value.
 * @param fallback - the defaults to use when nothing usable is present.
 * @returns the names to match against `session.header.agentPreset`.
 */
function readNames(value, fallback) {
  const source = Array.isArray(value) ? value : [value]
  const names = []
  for (const entry of source) {
    const name = readText(entry)
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names.length === 0 ? [...fallback] : names
}

/**
 * Read a custom step-checkpoint body.
 *
 * `undefined` (absent, or not a string, or blank after trimming) means "use the
 * built-in body", which is the safe direction: a mistyped value must not leave
 * the checkpoint silently wordless. Anything longer than
 * `MAX_STEP_TEXT_CHARS` is truncated rather than rejected, because a body that
 * is merely too long still says what it says.
 *
 * @param value - the raw value.
 * @returns {string|null} the body to inject, or `null` for the built-in one.
 */
function readStepText(value) {
  const text = readText(value)
  if (text === undefined) return null
  return text.length > MAX_STEP_TEXT_CHARS ? text.slice(0, MAX_STEP_TEXT_CHARS) : text
}

/**
 * Read the step-checkpoint tiers.
 *
 * A bare number reads as a one-tier list, the way `presets: adg` reads as a
 * one-name list. Each entry is rounded to an integer and must be positive: a
 * fraction of a step and a zero/negative step are both meaningless, so they are
 * dropped rather than clamped to something the operator did not write. The
 * result is de-duplicated and sorted ascending, because the decision helper
 * scans it in order and reports the first tier that is due.
 *
 * When nothing usable survives — `[]`, `'x'`, `[0, -1]` — the fallback tiers are
 * used, matching the rest of this module: a mistyped value must not silently
 * turn the checkpoints off. Use `stepNudge: false` to turn them off on purpose.
 *
 * @param value - the raw value.
 * @param fallback - the default tiers.
 * @returns {number[]} ascending, de-duplicated, positive integer tiers.
 */
function readStepTiers(value, fallback) {
  const source = Array.isArray(value) ? value : [value]
  const tiers = []
  for (const entry of source) {
    if (tiers.length >= MAX_STEP_TIERS) break
    const resolved = readNumber(entry, Number.NaN)
    if (!Number.isFinite(resolved)) continue
    const tier = Math.min(Math.round(resolved), Number.MAX_SAFE_INTEGER)
    if (tier < 1 || tiers.includes(tier)) continue
    tiers.push(tier)
  }
  if (tiers.length === 0) return [...fallback]
  return tiers.sort((left, right) => left - right)
}

/**
 * Normalize one raw `config:` block into a complete option object.
 *
 * Unknown keys — including the removed token-budget keys — are ignored: this is
 * a total function of the keys it knows, so an older row still loads.
 *
 * @param {unknown} raw - the row's configuration, as composed from YAML.
 * @returns {typeof DEFAULT_CONFIG} every option resolved to a usable value.
 */
export function normalizeConfig(raw) {
  const input = isPlainObject(raw) ? raw : {}
  const logFile = readText(input.logFile)
  return {
    enabled: readBoolean(input.enabled, DEFAULT_CONFIG.enabled),
    presets: readNames(input.presets, DEFAULT_CONFIG.presets),
    stepNudge: readBoolean(input.stepNudge, DEFAULT_CONFIG.stepNudge),
    stepTiers: readStepTiers(input.stepTiers, DEFAULT_CONFIG.stepTiers),
    // `null` (and any unusable value) means "use the built-in body".
    stepText: readStepText(input.stepText),
    dryRun: readBoolean(input.dryRun, DEFAULT_CONFIG.dryRun),
    // `null` (and any unusable value) means "no file logging".
    logFile: logFile ?? DEFAULT_CONFIG.logFile,
  }
}
