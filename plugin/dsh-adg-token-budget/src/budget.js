/**
 * Pure decision helpers for dsh-adg-token-budget.
 *
 * Nothing in this module touches a Cordis context, the filesystem, or the
 * clock: every function is a total function of its arguments, which is what
 * makes the budget arithmetic — the part that decides whether a delegated
 * expert keeps running — directly testable without a framework.
 *
 * @module dsh-adg-token-budget/budget
 */

/** The cumulative counters a token-usage projection reports. */
const COUNTER_KEYS = Object.freeze([
  'uncachedInputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
])

/** Stage verdicts, in ascending severity. */
export const PASS = 'pass'
export const SOFT = 'soft'
export const HARD = 'hard'

/**
 * Read an agent's delegation depth, treating absence as top-level depth zero.
 *
 * This is a local re-implementation of
 * `@deepseek-ai/dsh-subagent`'s `delegationDepthOf` (documented at
 * `lib/types/depth.js:18-26`): the persisted session header is authoritative
 * and monotone, while the runtime `AgentOptions.subagentDepth` may only DEEPEN
 * the count. A resumed child arrives with fresh options, so counting it from
 * zero would let a resumed expert delegate as if it were top-level. The rule is
 * copied rather than imported on purpose — this plugin is deployed as a plain
 * directory under `$DSH_HOME/profiles/node_modules/`, where `dsh-subagent` is
 * not a dependency it may assume.
 *
 * Unlike the upstream helper this one never throws: an out-of-contract
 * `subagentDepth` is ignored instead of failing a live turn, because a
 * malformed header must not be able to abort someone's step.
 *
 * @param {object | undefined | null} agent - the agent whose header and options carry the depth.
 * @returns {number} its depth, or `0` when nothing usable is present.
 */
export function delegationDepthOf(agent) {
  const headerDepth = agent?.session?.header?.delegationDepth
  const runtimeDepth = agent?.options?.subagentDepth
  const header = Number.isSafeInteger(headerDepth) && headerDepth >= 0 ? headerDepth : 0
  const runtime = Number.isSafeInteger(runtimeDepth) && runtimeDepth >= 0 ? runtimeDepth : 0
  return Math.max(header, runtime)
}

/**
 * Whether an agent is a delegated child rather than a top-level dispatcher.
 *
 * @param {object | undefined | null} agent - the agent to classify.
 * @returns {boolean} `true` for depth > 0.
 */
export function isDelegatedChild(agent) {
  return delegationDepthOf(agent) > 0
}

/**
 * Whether the agent's session was started under one of the governed presets.
 *
 * Fail-open by contract: an absent `agentPreset` (a session that never recorded
 * one, or an older header shape) is NOT governed. Guessing there would let the
 * budget stop sessions this plugin was never pointed at.
 *
 * @param {object | undefined | null} agent - the agent to classify.
 * @param {readonly string[]} presets - the governed preset names.
 * @returns {boolean} `true` when the header names a governed preset.
 */
export function presetIsGoverned(agent, presets) {
  const preset = agent?.session?.header?.agentPreset
  if (typeof preset !== 'string') return false
  return Array.isArray(presets) && presets.includes(preset)
}

/**
 * Fold one `tokenUsage` projection state into the cumulative figure the budget
 * is spent against: `uncachedInputTokens + outputTokens + cacheReadTokens *
 * cacheReadWeight + cacheWriteTokens`.
 *
 * Every counter is read defensively: a missing or non-finite field counts as
 * zero rather than poisoning the total with `NaN`, which would make every
 * comparison false and silently disable the budget.
 *
 * @param {object | undefined | null} state - the projection state, or `undefined`.
 * @param {number} cacheReadWeight - multiplier applied to `cacheReadTokens`.
 * @returns {number | undefined} the cumulative figure, or `undefined` when the
 * projection reported no usable totals at all.
 */
export function cumulativeUsageOf(state, cacheReadWeight) {
  const totals = state?.totals
  if (typeof totals !== 'object' || totals === null) return undefined
  const weight = typeof cacheReadWeight === 'number' && Number.isFinite(cacheReadWeight) ? cacheReadWeight : 1
  let total = 0
  for (const key of COUNTER_KEYS) {
    const value = totals[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    total += key === 'cacheReadTokens' ? value * weight : value
  }
  return total
}

/**
 * Classify a cumulative figure against the two thresholds.
 *
 * Both thresholds are inclusive: a child exactly at the soft ratio is nudged,
 * and a child exactly at the budget is stopped. The hard stage is tested first,
 * so a configuration with `softRatio: 1` still stops rather than nudging
 * forever.
 *
 * @param {{ usage: number, budgetTokens: number, softRatio: number }} gate - the comparison inputs.
 * @returns {'pass' | 'soft' | 'hard'} the stage verdict.
 */
export function decide(gate) {
  const usage = gate?.usage
  const budget = gate?.budgetTokens
  if (typeof usage !== 'number' || !Number.isFinite(usage)) return PASS
  if (typeof budget !== 'number' || !Number.isFinite(budget)) return PASS
  // A non-positive budget is a misconfiguration, not a hair trigger: the plugin's
  // own normalization never produces one, and a caller that does gets pass-through
  // rather than every child stopped on its first step.
  if (budget <= 0) return PASS
  if (usage >= budget) return HARD
  const ratio = gate?.softRatio
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return PASS
  return usage >= budget * ratio ? SOFT : PASS
}

/**
 * The first step tier that is due and has not fired yet, as an index into
 * `tiers`, or `undefined` when there is none.
 *
 * The tiers are step numbers: with `stepCount` = the number of steps this child
 * has entered (so the step being decided is step `stepCount` itself), a tier is
 * due while `stepCount >= tier`. The lowest such tier wins, which matters
 * because a caller that only evaluates this once per step still fires every tier
 * in order even when several are due at once — the next call reports the next
 * index.
 *
 * A tier that is already in `firedTiers` is skipped. That list is the
 * once-per-tier record, and it is an index list rather than a value list so a
 * tier configured twice (normalization dedupes, but a caller is free not to) can
 * never be confused for a different one.
 *
 * Out-of-contract input yields `undefined` (no nudge) rather than throwing: this
 * runs inside a live step.
 *
 * @param {{ tiers: readonly number[], stepCount: number, firedTiers?: readonly number[] }} gate - the checkpoint inputs.
 * @returns {number | undefined} the index of the tier to fire, or `undefined`.
 */
export function dueStepTier(gate) {
  const tiers = gate?.tiers
  const stepCount = gate?.stepCount
  if (!Array.isArray(tiers)) return undefined
  if (typeof stepCount !== 'number' || !Number.isFinite(stepCount)) return undefined
  const fired = gate?.firedTiers
  const consumed = Array.isArray(fired) ? fired : []
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]
    if (typeof tier !== 'number' || !Number.isFinite(tier) || tier < 1) continue
    if (stepCount < tier) continue
    if (consumed.includes(index)) continue
    return index
  }
  return undefined
}
