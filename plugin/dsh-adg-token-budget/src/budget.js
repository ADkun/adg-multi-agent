/**
 * Pure decision helpers for dsh-adg-token-budget.
 *
 * Nothing in this module touches a Cordis context, the filesystem, or the
 * clock: every function is a total function of its arguments, which is what
 * makes the two questions this plugin asks — "is this a governed child?" and
 * "is a checkpoint due?" — directly testable without a framework.
 *
 * The module used to carry the token-budget arithmetic as well (`decide`,
 * `cumulativeUsageOf`). That whole layer is gone: the plugin no longer reads a
 * token projection, injects a wrap-up instruction at a threshold, or cancels a
 * child at a budget. See the package README, "What was removed".
 *
 * @module dsh-adg-token-budget/budget
 */

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
