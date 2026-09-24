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
 * @module dsh-adg-token-budget/config
 */

/** Every option with its default, as one frozen reference object. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Master switch; `false` makes `apply` register nothing at all. */
  enabled: true,
  /** Agent-preset names whose delegated children this plugin governs. */
  presets: Object.freeze(['adg']),
  /** Cumulative token budget for one child agent session. */
  budgetTokens: 3_000_000,
  /** Soft stage threshold, as a fraction of `budgetTokens` in `[0, 1]`. */
  softRatio: 0.7,
  /** Multiplier applied to `cacheReadTokens` when folding cumulative usage. */
  cacheReadWeight: 1,
  /** Whether the soft stage appends a wrap-up instruction to the step. */
  softNudge: true,
  /**
   * Calibration switch: compute and log every decision, but take no action —
   * no message is injected and no `agent.cancel` is issued. The step is
   * delegated through `next()` even at the hard stage.
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

/** Clamp `value` into `[min, max]`. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Read a non-empty trimmed string, or `undefined` when there is none. */
function readText(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read a positive token budget.
 *
 * A non-positive or unusable budget falls back to the default: stopping every
 * child on its first step is never what a mistyped value means, and the default
 * is the only value the plugin can defend as deliberate.
 *
 * @param value - the raw value.
 * @param fallback - the default budget.
 * @returns a positive safe integer.
 */
function readBudgetTokens(value, fallback) {
  const resolved = readNumber(value, fallback)
  if (resolved < 1) return fallback
  return clamp(Math.round(resolved), 1, Number.MAX_SAFE_INTEGER)
}

/**
 * Read a finite number and clamp it into `[min, max]` without rounding.
 *
 * Used for a weight rather than a count: a fractional cache-read discount is a
 * legitimate configuration, and rounding it would silently change the meaning
 * of the value the operator wrote.
 *
 * @param value - the raw value.
 * @param fallback - the default to use when nothing usable is present.
 * @param min - the inclusive lower bound.
 * @param max - the inclusive upper bound.
 * @returns the resolved number.
 */
function readClampedNumber(value, fallback, min, max) {
  return clamp(readNumber(value, fallback), min, max)
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
 * Normalize one raw `config:` block into a complete option object.
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
    // A non-positive budget would stop every child on its first step, which is
    // never what a mistyped value means; fall back rather than arm a hair
    // trigger, and clamp the upper end so the fold stays in safe-integer range.
    budgetTokens: readBudgetTokens(input.budgetTokens, DEFAULT_CONFIG.budgetTokens),
    softRatio: clamp(readNumber(input.softRatio, DEFAULT_CONFIG.softRatio), 0, 1),
    cacheReadWeight: readClampedNumber(input.cacheReadWeight, DEFAULT_CONFIG.cacheReadWeight, 0, 100),
    softNudge: readBoolean(input.softNudge, DEFAULT_CONFIG.softNudge),
    dryRun: readBoolean(input.dryRun, DEFAULT_CONFIG.dryRun),
    // `null` (and any unusable value) means "no file logging".
    logFile: logFile ?? DEFAULT_CONFIG.logFile,
  }
}
