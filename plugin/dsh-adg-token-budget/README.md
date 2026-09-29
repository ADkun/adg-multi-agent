# dsh-adg-token-budget

A host-plane [DSH](https://github.com/deepseek-ai/dsh) / Cordis plugin that reminds the
**delegated child agents of the `adg` agent preset** to converge. It keeps exactly **one**
feature: **step convergence checkpoints** (`步数收敛检查点`) — an optional reminder injected on
a child's Nth *entered* step, once per configured tier per residency epoch.

One delegated expert can otherwise explore without converging for hundreds of steps. This
plugin is the backstop for that, and nothing else: it does not schedule work, does not pick
models, and does not touch top-level sessions.

The package name and the composed row id are now **historical**: `dsh-adg-token-budget` /
`adg-token-budget` no longer describe what the plugin does, because **no token budget is
enforced any more** （本次改动 removed the token stages — see
[What was removed, and why](#what-was-removed-and-why)). The name was kept on purpose: the row
id `adg-token-budget` — and therefore the hot-reload identity of that row — does not
change, and renaming it would be a deployment change with no behavioural benefit. The
**deployment path did change** (2026-09-28): the package
now lives at `$DSH_HOME/bundles/dsh-adg-token-budget/` — an installed **bundle**, on the same root
as `dsh-adg-preset` — is `link:`ed into each preset-capable profile and selected there by
`dsh.profile.bundles`, because the shared root `$DSH_HOME/profiles/node_modules/` is
**explicitly excluded** by this dsh version's module resolution (measured on this machine: a
package left there does not resolve, and the row never mounts). The mount row moved too: it is no
longer a `- insert:` entry pasted into `profiles/<profile>/cordis.patch.yml` —
the package ships it as its own **bundle patch layer** (`cordis.patch.yml` at the package root,
declared by `dsh.bundle.patch` in `package.json`).

## The one stage

The plugin registers exactly one `agent/pre-step` waterfall listener. It decides on every
proposed step of every governed child, on **one** trigger:

| Stage | Trigger | Action |
| --- | --- | --- |
| **step** | the child is entering its `stepTiers[n]`-th step | call `next()` first, then append the nth convergence reminder to the returned `{kind:'enter'}` decision's `messages` — at most once per tier per residency epoch. The reminder is an **optional choice** (converge, or continue and disregard it), never a stop order |

At most **one** reminder message is appended per step. Cost is the reason: an injected message
stays in the child's context and is re-sent on every later step, so paying for the same advice
twice is exactly the waste this plugin exists to prevent. There is no second trigger left for a
step checkpoint to collide with, so the old "folded into the token wrap-up" path is gone with it.

The step stage needs no projection at all — its count is the number of steps this listener has
watched the child enter. The plugin never calls `agent.cancel`, never returns `{kind:'reject'}`,
never reads `ctx.get('sessionProjections')`, and has no destructive stage: `{kind:'reject'}` does
not appear anywhere in its code path.

### What was removed, and why

Earlier versions also read `ctx.get('sessionProjections')?.stateOf(agent.session, 'tokenUsage')`
and intervened on the cumulative figure: a wrap-up instruction at `budgetTokens * softRatio`
(the **soft** stage) and `agent.cancel({kind:'parent'})` plus `{kind:'reject'}` at
`budgetTokens` (the **hard** stage). Both stages are gone （本次改动）, along with the
`budgetTokens`, `softRatio`, `cacheReadWeight`, `softNudge` and `hardDryRun` options. The
measured evidence those stages produced is kept in this file, but it is labelled as **history of
a removed feature** throughout, and none of it describes current behaviour.

设计理由（用户口径）：**输出型任务（写文档、生成报告、消化长语料）本身就需要那么多 token**，
按累计 token 阈值介入只会截断产出，省不下有意义的东西；**累计量大本身不是"跑飞了"的证据**。
步数才是那个真正出问题的信号（子代理反复探索不收敛），而且它的提醒是"二选一、可以直接无视"，
不是停止指令。

In other words, a token threshold is the wrong instrument for the tasks this preset delegates: an
output-shaped job genuinely needs the tokens it needs, and a budget truncates the deliverable
instead of saving anything. A large cumulative total is not by itself evidence of a runaway loop.
A **step** count measures the thing that actually goes wrong — a child that keeps exploring
without converging — and the reminder it injects is a choice the child may disregard rather than
an order.

**An older composed row still loads.** `normalizeConfig` is a total function of the keys it
knows: unknown keys — including all five removed ones — are silently ignored, and the row runs
with the step checkpoints only. That matters for operators, because live compositions written
before this change still carry `budgetTokens: 3000000`, `softRatio: 0.7`, `cacheReadWeight: 1`,
`softNudge: true` and `hardDryRun: true`; none of them is an error, and none of them has any
effect.

## The step checkpoints

The step trigger is the one lever a dispatcher cannot pull itself, and this plugin
is now the *only* place the reminder lives: the `adg` persona used to carry a
matching policy — tell each delegation roughly how many steps it should converge
in, and don't poll for step counts — and both lines were deleted from it. The
first restated a signal this plugin already sends from `stepTiers`, with a second
set of numbers that would silently drift out of sync (a tier change hot-reloads; a
persona change needs a restart). The second is already stated by the
`job_output` / `subagent` tool descriptions. What stays here is the part no prompt
can do: the dispatcher cannot see how
many steps a running child has taken.
Polling for it would re-send the dispatcher's own context — the largest in the run
(59% of the audited `adg` bill) — once per poll, costing far more than the
reminder saves, and a background child is not observable step-by-step in the
first place. So the reminder is injected here, deterministically, **on the
dispatcher's behalf**: every checkpoint message opens with
`【收敛检查点 n／N】调度代理提醒：这是你的第 N 步。` — "the dispatcher reminds you:
this is your step N".

A step is counted when the child **enters** it, so a step a downstream listener
rejected is never charged, and the count is strictly per child. The counter lives in one
per-session entry, `{ steps, firedTiers }`, allocated on the first entered step of a governed
child while the checkpoints are on. `firedTiers` holds the index of every tier already fired, so
a tier fires at most once per residency epoch, and a checkpoint that could not be delivered (the
step was not entered, or the message could not be built) stays owed to the child on a later step.

The default ladder is
**5 / 10 / 15 / … / 280** — every 5 steps, 56 tiers, one interval and no widening. The
cadence is flat by operator decision (2026-09-29): the checkpoint exists to keep the
child on the shortest path to its goal, and a widening interval is exactly a licence to
drift once a child is long. It is calibrated against the
measured *distribution* of delegated children rather than their average, because the
average was the wrong anchor. Re-running `audit-steps.mjs` over the live session logs
(37 delegated `adg` sessions, 1,913 child steps) gives:

| statistic | value |
| --- | --- |
| min / p10 / p25 | 1 / 6 / 14 |
| median / mean | **39** / 51.7 |
| p75 / p90 / max | 61 / 103 / **329** |

So a ladder anchored on the mean asks its first question after a quarter of the
population has already finished, and 6 of 37 children are done inside 6 steps — which is
why the flat ladder starts at step **5**, where the measured mass begins, and runs to
step 280, past p90, because the tail is where a child walks longest unchecked (a
329-step child passes all 56 tiers). **Coverage under the new ladder is not measured
yet.** The rows below were measured under the two EARLIER ladders and are kept as the
comparison that produced this one (the second row is the 14-tier ladder the flat one
replaces):

| ladder | children reached | messages injected | child steps after the 1st checkpoint | steps after the last tier |
| --- | --- | --- | --- | --- |
| `[12, 24, 40]` | 30/37 | 71 | 79.5% | 872 |
| `[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]` | 34/37 | 214 | 92.6% | 49 |

The literal reminder cost is what makes a dense ladder affordable: each message is
~180 characters and is re-sent once per later step. Under the 14-tier ladder all 214
messages across the whole corpus added up to roughly **0.5M token-equivalents** of input
against ~205M spent by those same children — about 0.25%. A flat 5-step ladder injects
more messages than that, and the figure has **not** been re-measured. The lever is the
share of steps that run *after* a child has been asked whether it is done (92.6% under
the 14-tier ladder).

The residency rule is worth stating plainly, because it is what makes a resumed child
re-eligible: `subagent/end` fires **once per residency epoch**, and a continuable child that is
resumed later starts a fresh epoch. So a resumed child starts its step count and its fired tiers
over, and CAN be reminded again for a tier it had already spent before going dormant. That is
intended rather than a leak: the resumed child has a new plan and a new chance to run away, and
it inherits no state from the earlier epoch. The bounded-state guarantee is unaffected — the
entry is created for the new epoch and released again on the next `subagent/end`.

Five details exist specifically so that the checkpoints do not make answers
worse:

- **Every reminder is a choice, not an order.** The body says outright that it is
  optional, that it may be **直接无视**, names both branches symmetrically
  (converge and report — or keep working without trimming the plan), and leaves the
  decision to the task. The only thing it requires is that the child say which branch
  it picked. The suite pins each of those clauses, plus the negative: the body must not
  contain an order to stop exploring.
  This is the property that makes a dense ladder safe. A checkpoint that said
  "stop now" would trade tokens for a worse answer, which is the one trade this feature
  is not allowed to make.
- **It does not prescribe what to report.** The converging branch only asks whether the
  goal can already be answered and, if so, to wrap up: which parts were delivered and
  which were left unverified is the child's call, and the suite pins that the body must
  *not* ask for them (no `没有验证` / `交付了什么` / `哪些部分`). An earlier wording did ask;
  it was removed. Naming holes is still what an honest report does, but the checkpoint
  does not get to define the report's shape.
- **The continue branch is asked for the shortest next step.** Since 2026-09-29 the body
  tells a child that keeps working to pick the next step *on the shortest path to the
  goal* (the one that makes the goal deliverable soonest — not the handiest, cheapest or
  busiest-looking one) and to say in one sentence why it is the shortest. That sentence is
  the whole mechanism: it forces one comparison of candidate steps, which is what keeps a
  long child on the fastest path instead of drifting. It constrains the **order** of the
  remaining work, never its scope — the same clause still forbids shrinking or rewriting
  the plan in response to the reminder, and the suite pins both halves together.
- **The bodies do not escalate.** Only the last tier adds a sentence, and that
  sentence is information (the reminders stop here; if you continue, say how many
  steps and what "done" means), not mounting pressure. A dense ladder whose messages
  got firmer every few steps would be a coercion engine; the unit test compares the
  body across tiers to keep it flat.
- **`stepNudge: false` turns the whole feature off**: nothing is counted, no per-session
  state is allocated, and the step passes straight through without an injection. There is no
  second switch left — the checkpoints are the only feature.

The wording is also the part most likely to be tuned, so it is overridable: a
`stepText` in `config:` replaces the built-in body entirely, and because `config:`
hot-reloads, a wording change needs neither a new package nor a dsh restart. The
activation line reports `stepText=builtin` or `stepText=custom`, so a mistyped key is
visible instead of silent.

### Filtering

A step is considered only when **all** of these hold, in this order:

1. `enabled` is true;
2. the agent is a **delegated child**, i.e. `delegationDepthOf(agent) > 0`. The
   depth is `Math.max(header, runtime)` where **each side is first put through
   `Number.isSafeInteger(value) && value >= 0`**, so an out-of-contract value is
   no depth at all rather than a coerced one:

   | header / runtime value | resolved depth | why |
   | --- | --- | --- |
   | `2` | `2` | a safe non-negative integer |
   | `'1'` (a string) | `0` | **not coerced** — a YAML/JSON round-trip that turns the number into a string must not silently arm (or deepen) the guard |
   | `1.5` | `0` | **not truncated** to 1 |
   | `-1` | `0` | **not clamped** to 0 |
   | `2 ** 53` | `0` | a bare `Number.isInteger` would wave this through; the fold is only safe in `Number.isSafeInteger` range |
   | `NaN`, `Infinity`, `true`, `null` | `0` | not a number at all |

   The persisted header is authoritative and monotone: a resumed child arrives
   with fresh options, so counting from `subagentDepth` alone would let a resumed
   expert delegate as if it were top-level. An out-of-contract value is ignored
   rather than thrown, because a malformed header must not be able to abort a
   live step — and the string case is the one that matters, since `'1' > 0` is
   true in JavaScript and a coercion would let a mistyped header govern a real child;
3. `session.header.agentPreset` is one of `presets`;
4. `stepNudge` is true — otherwise the step passes through and nothing is counted.

A top-level agent (depth 0) is never touched — in particular never the
dispatcher. A child whose header carries **no** `agentPreset` is never touched
either: that case fails *open*, not closed, because guessing there could govern
sessions this plugin was never pointed at.

There is no projection to be missing. The plugin reads no service at all, so the
`no budget data: passing through the token stages …` line that older builds could write no
longer exists.

## Configuration

Every key is optional. The plugin exports **no** Cordis `Config` schema: it
hand-normalizes the raw config object, so a malformed value falls back to its
default instead of failing the profile load. Unknown keys — including the five removed
token-budget keys — are silently ignored, which is what lets an older composed row keep
loading.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` registers nothing at all (the activation line is still written). |
| `presets` | `['adg']` | Preset names to govern. A bare string (`presets: adg`) reads as a one-name list. |
| `stepNudge` | `true` | Whether the step checkpoints run. `false` turns the whole feature off: nothing is counted, no per-session state is allocated, and the step passes straight through without an injection. |
| `stepTiers` | `[5, 10, 15, …, 275, 280]` (56 entries) | The step numbers a checkpoint fires on, ascending and de-duplicated. A bare number reads as a one-tier list. At most 56 tiers are honoured (`MAX_STEP_TIERS`, exactly this ladder's length, so the default is never truncated). An unusable value (`[]`, `'x'`, `[0]`) falls back to this default rather than silently switching the checkpoints off; use `stepNudge: false` for that. **Flat on purpose**: every 5 steps from step 5 through step 280, one interval, no widening (operator decision, 2026-09-29). See [The step checkpoints](#the-step-checkpoints) for the distribution this ladder is fitted to and why neither the average nor a widening tail was the right anchor. |
| `stepText` | `null` | Optional wording for a step checkpoint, replacing the built-in body entirely — including the sentence the built-in adds on the last tier. Blank or unusable values fall back to the built-in body rather than leaving the checkpoint wordless; anything over 4000 characters is truncated. This key exists so that tuning the wording is a `config:` edit (hot-reloaded) instead of a new package plus a dsh restart. The activation line reports `stepText=builtin` or `stepText=custom`, which is how a mistyped key becomes visible. |
| `dryRun` | `false` | Calibration switch for the checkpoints. Every due checkpoint logs exactly one line and injects nothing, and the step is delegated through `next()` as usual. Steps **are still counted** — that is the calibration — and **no tier is consumed**, so arming the plugin afterwards still delivers that checkpoint. |
| `logFile` | `null` | Absolute path; when set, the activation line plus one line per decision *event* is appended (see below). A relative path disables file logging with a warning. |

Step numbers are **inclusive**: a tier configured as `12` fires on the step the child
enters as its 12th.

### What actually reaches `logFile`

One ISO-8601-stamped line per **event**, not one per decision. A step that
passes through untouched (the common case) writes nothing at all, so the file
stays small even for a child that runs hundreds of steps. The complete list is:

| Event | Line |
| --- | --- |
| load | `activation: active createUserMessage=<strategy> presets=[adg] stepNudge=true stepTiers=[5, 10, 15, …, 280] stepText=builtin\|custom dryRun=false logFile='…'` — written on **every** `apply`, including `activation: inactive (enabled: false)`, so "the host loaded this plugin" is never invisible. **A stale line** — one carrying `budgetTokens=`, `softThreshold=`, `softRatio=`, `cacheReadWeight=`, `softNudge=` or `hardDryRun=`, or missing `stepText=` — was written by an older build still resident in the process, i.e. the restart has not happened yet |
| load | a registration note (`registration skipped: this context already applied the plugin`, `warning: N registration(s) are already active …`) |
| step | `step stage: nudged tier=<n>/<N> step=<S> label=…` — at most once per tier per residency epoch |
| step | `step stage (no nudge injected: decision kind=…) …` or `step stage (no nudge injected: nudge construction failed) …` — the tier stays unconsumed, so a later step may still deliver it |
| dry-run | `dry-run step stage: would nudge tier=… …`; `dry-run step stage: would not nudge (decision kind=…) …`; `dry-run step stage: would not nudge (nudge construction failed) …` |
| settle | `settled: released session state label=<agent.id>` |
| failure (host log) | `apply failed (…); the step checkpoints are inactive`, or `context has no event API; the step checkpoints are inactive` — either means the plugin degraded to a no-op |

**A dry-run checkpoint line is written per *step*, not per reminder.** Because
calibration consumes no tier, a due checkpoint reports itself again on every step
at or past it, so those counts mean "steps at which this checkpoint was due", not "children
that would have been touched" and not "messages that would have been sent" — an armed
run delivers each reminder exactly once.

A plain pass-through step is deliberately **not** logged. The first line ever written
through the decision sink is also echoed once to `ctx.logger.info`, so an armed
plugin is observable without flooding the host log at every step.

## Safety design

This plugin is written so that a bug in it cannot take down the GUI. That is not
a stylistic preference: in Cordis, `apply` throwing with no declared schema fails
the fiber, and `dsh` reports a failed entry as a **fatal startup error**. A hard
`static inject` on a service that is not mounted is worse — the entry stays
`pending` forever, which is also reported as fatal.

Concretely:

- **`apply` never throws.** Its whole body is wrapped; any failure is logged
  through `ctx.logger?.warn` and the plugin degrades to a no-op.
- **Every per-event handler is wrapped.** A bug in the checkpoint logic catches,
  logs once, and returns the decision `next()` produced — it cannot abort someone's turn.
- **No `static inject`.** The plugin reads **no service at all** — the removed token stages
  were the only reason it ever needed `sessionProjections`, and the step count comes from the
  listener's own state.
- **No static `import` of any `@deepseek-ai/*` package.** The plugin is deployed
  as a plain directory under `$DSH_HOME/bundles/dsh-adg-token-budget/` (installed as a bundle:
  linked into each profile's `node_modules` and selected in that profile's `dsh.profile.bundles`;
  **not** the shared `$DSH_HOME/profiles/node_modules/`
  root, which this dsh version's resolution excludes), so anything it
  needs from the harness is resolved at call time with `createRequire`, and every
  resolution failure is survivable (see below).
- **No top-level side effects**, no `process.exit`, no network, and no
  filesystem writes outside the configured `logFile`.
- **Bounded state.** Per-session state lives in a `Map` keyed by `agent.id`, one
  entry per live child, holding `{ steps, firedTiers }`. The allocation rule follows
  `stepNudge`: with the checkpoints on (the default) the first entered step of a governed
  child allocates its counter, because a step cannot be counted without somewhere to count
  it; with `stepNudge: false` no entry is ever allocated, and a passing step allocates
  nothing. `firedTiers` holds one index per tier already fired, so it is bounded by
  `stepTiers` (at most `MAX_STEP_TIERS` = 56 entries — the default ladder's own length). The whole entry is released on
  `subagent/end` and cleared wholesale by a `ctx.effect` disposer, so a long-lived host
  cannot accumulate children — only one small object per *concurrently running* child.

## The reminder messages, and why they may fall back

The single trigger injects one kind of object — the step checkpoint's
`stepNudgeText({tierIndex, tierCount, stepCount, body})` — as a `UserMessage`:
`{ id, role: 'user', content: ContentBlock[], source: { kind: 'plugin:dsh-adg-token-budget' } }`.
That `kind` is **load-bearing, not decoration**: session format v4 refuses the
retired `{kind:'plugin', plugin}` wrapper in the durable write path, so a message
carrying it makes the append throw and kills the whole delegated child (measured
incident and the admission rule: next subsection). First-party code builds these
with `createUserMessage` from
`@deepseek-ai/dsh-llm`, which this plugin cannot import statically.

So the plugin resolves it at call time, in this order:

1. `createRequire` anchored at the **running profile's** `.dsh-module-fallback`,
   where "running profile" is derived from `ctx.baseUrl` rather than hardcoded —
   under the GUI that is `web`, under `dsh headless` it is `headless`;
2. anchored at **every** `$DSH_HOME/profiles/<profile>/.dsh-module-fallback`
   directory found on disk (read with `readdirSync`, real directories only), so a
   context that does not expose `baseUrl` at all still resolves the way a real
   profile does;
3. anchored at `$DSH_HOME/profiles/` (the shared module root's parent). **Caveat
   (2026-09-28)**: that shared root is excluded by *dsh's own* module resolution;
   whether that also affects this `createRequire` anchor is **NOT observed** — the
   activation line's `createUserMessage=<strategy>` is what settles it on a real machine;
4. anchored at the plugin's own `import.meta.url`;
5. anchored at successive ancestors of the plugin file, looking for the first
   `node_modules/@deepseek-ai/dsh-llm`.

**Chosen design: anchors 1–3 are derived, not hardcoded.** The earlier draft only
had anchors 1 (hardcoded to `web`) and 3–5; the live run then reported
`createUserMessage=profile-fallback:web`. Rather than pin that string, the
resolution now takes the profile name from `ctx.baseUrl` and additionally scans
`$DSH_HOME/profiles/*` so a `headless`, `sdk`, or hand-made profile resolves the
same way. The strategy that wins is reported verbatim in the activation line
(`createUserMessage=<strategy>`), which is how the assumption stays observable
instead of buried.

**Measured on the deployment machine on 2026-09-25 — at the THEN-current deployment path**
(plugin file simulated at
`C:\Users\cenqian\.dsh\profiles\node_modules\dsh-adg-token-budget\src\plugin.js`):
**all five anchors resolve**, each to the same module instance inside the `dsh`
install tree, because `$DSH_HOME/profiles/node_modules/@deepseek-ai/*` were
symlinks into that tree and Node's ordinary parent-walk reached them from the
plugin directory. Anchor (1) wins — the live log line
`createUserMessage=profile-fallback:web` is that fact, recorded by the running
host — which is also the anchor that keeps working if a future profile layout
puts a plugin-private `@deepseek-ai` shadow in the fallback directory.

**Since 2026-09-28 the deployment path is `$DSH_HOME/bundles/dsh-adg-token-budget/`** (the
package is installed as a **bundle**: linked into each profile's `node_modules` and selected in
`dsh.profile.bundles`; the shared `$DSH_HOME/profiles/node_modules/` root is excluded by this dsh
version's module resolution, measured on this machine). Anchors 1–3 do not depend on where the
plugin sits, so they carry over. **真机实测（有日志为证）**: the first activation line written after
the hand-pasted profile row was deleted and the bundle installed still reads
`createUserMessage=profile-fallback:web` — anchor (1) winning, in a process whose only layer that
could supply the row was the bundle layer (`C:\Users\cenqian\.dsh\adg-token-budget.log`,
`2026-09-28T01:47:48.467Z`; that line also proves the shipped row's
`!!js dshHomePath('adg-token-budget.log')` evaluated back to the same file). **Whether anchors 4–5
still resolve from the new directory, and what the activation line looks like after a cold start on
the bundle layer, is NOT observed** — do not read the paragraph above as covering the new path. The
strategy that actually wins is reported verbatim in the activation line
(`createUserMessage=<strategy>`); check that line on the machine after deploying instead of
assuming `profile-fallback:<profile>`.

The real implementation, verbatim from
`@deepseek-ai/dsh-llm/lib/types/message.js` (identical code in `lib/index.js`):

```js
export function createMessage(input) {
    return freezeMessage({
        ...input,
        id: brandString(randomUUID()),
    });
}
export function createUserMessage(input) {
    return createMessage({
        ...input,
        role: 'user',
    });
}
export function freezeMessage(message) {
    return deepFreeze(structuredClone(message));
}
```

`brandString` is the identity function (`@deepseek-ai/dsh-brand`), and
`randomUUID` is a v4 UUID minted from `globalThis.crypto.getRandomValues(16)`
(`@deepseek-ai/dsh-util-crypto`). **No field is validated** — the function
spreads its input, forces the role, mints the id, and returns
`deepFreeze(structuredClone(message))`. A measured call produces exactly the keys
`content`, `source`, `role`, `id`, with the message, its `content` array, and
each block all frozen.

The plugin's local fallback constructor reproduces that precisely: a v4 UUID via
`crypto.randomUUID()` (with a manual `getRandomValues` path if that API is
absent), a `structuredClone` of the blocks, and the same `deepFreeze`. It is used
automatically when resolution fails, so a due checkpoint still gets its message. If even
that cannot be constructed, the failure is caught, the checkpoint is logged without an
instruction (`step stage (no nudge injected: nudge construction failed) …`), the tier stays
unconsumed, and the step still passes through — the plugin never lets a
nudge-construction failure escape the handler.

### The source kind is a v4 admission contract, and the old wrapper fails the child

Session format v4 **retired the `{kind:'plugin', plugin}` wrapper**. Only the bare
`plugin` label is refused, and it is refused in the **durable write path**:
`session.append('user/message', …)` throws
`SessionFormatError: format v4 message requires a producer-owned source kind`. The
append happens after this listener returned, so the plugin cannot catch it — the
whole delegated child fails, and the dispatcher reports
`Error: subagent run failed: Error: subagent run failed; dispose failed:
SessionFormatError: format v4 message requires a producer-owned source kind`.

**That is what happened on 2026-09-28, the day the session-format-v4 upgrade landed
here, and it is the reason this file documents the kind at all** (measured,
`docs/evidence.md` §15): on the 14-tier ladder the first checkpoint is step 4, and
every governed `adg` child that reached one died there — the plugin log shows
`step stage: nudged tier=1/14 step=4 label=adg/<id>` followed by `settled: released
session state label=<id>` on the same child **12–35 ms later**, and the child's own
`session.v4.jsonl.zstd` ends at the `step/end` of step 3, with no `turn/end` — the
checkpoint message itself never reached the log because the write that carried it
threw. The rule itself (`@deepseek-ai/dsh-session-format-v3-to-v4`, `source()`; the
same predicate is inlined in the JSONL writer) refuses a source whose `kind` is not a
string, is empty, or is exactly `'plugin'`. Two scopes of that rule are worth keeping
apart, because a probe measured both: at the **physical-row** layer the check is only
reached for a message that **already** carries the retired label (so an empty `kind`
is not refused there), while the full **logical-event** check refuses empty and absent
kinds too — that one is not exported, which is why the suite restates the rule rather
than calling it. `@deepseek-ai/dsh-llm`'s message-source doc states the axis as "there
is no shared catch-all `plugin` kind."

The kind this plugin stamps is `plugin:dsh-adg-token-budget` — the exact string the
harness's **own** V3→V4 conversion assigns to this plugin's historical records (an
unrecognized producer becomes `` `plugin:${plugin}` ``; see
`dsh-session-format-v3-to-v4/README.md`「Message-source conversion」, which also
says a direct source kind is preserved unchanged). Old and new records therefore
name the same producer, and the evidence greps in this file keep working across the
migration boundary.

Guard rails, and their exact reach:

- the suite pins the rule the source must satisfy —
  `the reminder source passes the session format v4 admission rule` (both the
  resolved and the local-fallback constructor);
- mutation **M18** restores the retired wrapper and is caught by **four**
  assertions (the two constructor tests, the new rule test, and the checkpoint
  injection test);
- the rule is **restated** from the harness source, so nothing here notices a future
  change in the harness by itself — I3 forbids importing it. Re-measure against a
  real install instead, with the probe this evidence came from:
  `node D:\dsh\.adg-step-mutations\verify-v4-source-admission.mjs`, which runs the
  plugin's real message through the installed `assertV4RowAdmission` and prints both
  outcomes (accepts the current kind; refuses the retired wrapper with the message
  above).

## Install and enable

```powershell
# 1. install the BUNDLE — recommended route: `plugin_manager` action `install_bundle`, with
#    `target` the absolute path of a stable copy of the package directory. It installs the
#    package AND selects it in that profile's `dsh.profile.bundles`; do not re-implement those
#    two steps in a shell.

# 2. the manual route, equivalent to step 1: copy the package to the STABLE bundle root —
#    NOT the shared $DSH_HOME\profiles\node_modules — then link it into the target profile and
#    select it there (install.ps1 / install.sh do all of this for every preset-capable profile):
Copy-Item -Recurse -Force `
  'D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget' `
  "$env:DSH_HOME\bundles\dsh-adg-token-budget"
#    cd "$env:DSH_HOME\profiles\web"; pnpm add "link:$env:DSH_HOME\bundles\dsh-adg-token-budget"
#    then add "dsh-adg-token-budget" to that profile's `dsh.profile.bundles`.
#    Nothing is pasted any more: the mount row ships with the package, as the
#    `cordis.patch.yml` at its root (the bundle patch layer). `examples/cordis.patch.yml`
#    is now the key reference plus the template for a per-profile override.

# 3. installed, inert:                   `enabled: false` — no longer the factory state, so it
#    takes a per-profile `- id: adg-token-budget` override row with EVERY key restated
# 4. calibrate against your own traffic: `enabled: true` + `dryRun: true`
# 5. arm the reminders for real:         `enabled: true` + `dryRun: false` — what the shipped
#    bundle row already is, so selecting the bundle is the act that arms the plugin
```

**The deployment root moved on 2026-09-28, and the old ones are the trap.** A package left under
`$DSH_HOME/profiles/node_modules/` (the "shared module root" older docs recommended) is
**excluded** by this dsh version's module resolution — measured on this machine: it does not
resolve and the row never mounts. The interim landing this file pointed at until the migration —
this package name sitting under `$DSH_HOME/plugins/` — went with it too: the package is a **bundle**,
so it deploys to `$DSH_HOME/bundles/dsh-adg-token-budget/` (the same root `dsh-adg-preset` uses) and
is selected per profile by `dsh.profile.bundles`. On this machine that interim directory has been
deleted, once no profile's link was left pointing at it. Deploy to the bundle root and let
`pnpm add link:` put the per-profile link in place — or let `plugin_manager install_bundle` do the
link and the selection for you. **Known limitation (measured)**: if `dsh` is
running, that `pnpm add` can fail outright (`os error 32` /
`ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR` — it wants to rebuild `node_modules` and the files
are held open); `install.ps1` / `install.sh` report that line truthfully and continue, and a
package that is already in place is not a failure. Close `dsh` first when you actually need the
dependency step to run.

**Delete the `- insert:` entry the hand-paste route left in the profile patch file.** A profile's
own `cordis.patch.yml` is applied **after** every bundle layer, and a patch that names an existing
id **replaces that row's whole `config` object** — never a deep merge. So a leftover `- insert:`
entry silently wins over the shipped row, and a `- id: adg-token-budget` override that restates one
key drops every other key back to `src/config.js`'s `DEFAULT_CONFIG`: an override has to restate
**all** the keys it wants to keep. `install.ps1` / `install.sh` now only **report** such a leftover
entry; they do not delete it, because they do not guess at a file the user has hand-edited. A
machine-level `$DSH_HOME/cordis.patch.yml` remains the one place this row must never appear — it is
applied to every profile on the machine and it blocks saving from the Plugins page (unchanged).

**真机实测（有日志为证，`C:\Users\cenqian\.dsh\adg-token-budget.log`，UTC；台账：仓库
`docs/evidence.md` §16.4 第 6 条）**: that takeover was measured by appending a **same-id**
`- insert:` entry to the profile's own `cordis.patch.yml` while the bundle layer already carried the
row, writing only `dryRun: true` and leaving every other key at its shipped value, letting the patch
hot-reload, then deleting it. With the leftover present:
`2026-09-28T02:31:45.335Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'`;
after it was deleted:
`2026-09-28T02:32:13.279Z activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'`.
Three conclusions, and none of them is "the row got mounted twice":

1. a leftover same-id `- insert:` row **does not add a second row** — `plugin_manager list_plugins`
   still counted **190** entries and the log gained exactly **one** `activation:` line;
2. it **takes over that row's entire `config:`** — `dryRun` came out `true`, which means **injection
   stopped on the spot while the activation line still read `active`**. That is the hard part to
   spot: the row looks healthy, and only the behaviour is gone;
3. it **takes the row out of management** — while the leftover existed, `list_plugins` showed this
   entry as `enabled: true` / `fiberPhase: active` with **`readOnlyReason: "unaddressable"`** and
   **no `patchId` field at all**, so neither the Plugins page nor `set_plugin` could reach it; the
   only way back was the patch file. Deleting the leftover restored
   `patchId: adg-token-budget` and dropped `readOnlyReason`.

**The check to run**: `list_bundles` **cannot see this leftover** — its `overrides` stayed `[]` — so
the fastest signal is whether this row still carries a `patchId` in `list_plugins`. Do **not** cite
this measurement as the §14.3 guardrail in `docs/evidence.md`: that one is about the **preset
declaration row** (`preset-adg`) — "one id gets one home per profile, bundle **or** profile patch" —
and it names the shape as dangerous without measuring what it does. What was measured here is the
other thing: a **cross-layer same-id merge of a plugin row**, which the Loader **accepts** and
resolves by replacing the whole `config` block.

**真机实测（有日志为证，`C:\Users\cenqian\.dsh\adg-token-budget.log`，UTC；台账见仓库
`docs/evidence.md` §16）**: deleting the
hand-pasted row and installing the bundle left the plugin mounted and applying —
`2026-09-28T01:47:48.467Z activation: active createUserMessage=profile-fallback:web presets=[adg]
stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]
stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'`. That line came
from a process started **before** the migration (`install_bundle` had just rewritten the profile
manifest), and by then the bundle layer was the only layer in that process able to supply the row,
so it measures three things at once: the shipped row really mounts and `apply`s; the shipped
`!!js dshHomePath('adg-token-budget.log')` evaluates to the same file the hand-pasted row wrote, so
the log stays continuous; and **bundle layers are not read only at startup** — editing a profile's
`cordis.patch.yml`, or that profile's manifest, re-reads the **whole patch stack** and the bundle
layer comes along with it, which is exactly the path `install_bundle` takes. Separately, adding a
profile-layer `- id: adg-token-budget` override (`stepTiers: [1, 2]`) and deleting it each
hot-reloaded without a restart — `2026-09-28T01:57:12.041Z` carries `stepTiers=[1, 2]`,
`2026-09-28T01:58:46.325Z` the factory ladder again.

What none of that licenses is promising **"this takes effect without a restart"**. **Nothing watches
`bundles/`**, so editing the bundle-layer `cordis.patch.yml` on its own triggers no re-read at all:
the accepted route for such an edit — and the acceptance criterion for this package — stays
**restarting `dsh`**, judged in a new session after the restart. Whether the bundle layer mounts
after a **cold start** is **未观测**; the way to measure it is to restart `dsh`, then check that
`plugin_manager list_bundles` still lists `dsh-adg-token-budget` while the log gains a fresh
`activation:` line.

Selecting the bundle is also what makes the row visible to the Plugin Manager: while the row was
only hand-pasted into a profile patch, `list_bundles` had no entry for it at all, which is the
direct reason the install "looked like it had not taken". Measured on this machine (2026-09-28)
after the install: `list_bundles` lists `dsh-adg-token-budget` `0.3.0` (`enabled: true`,
`installed: true`, `removable: true`) with row `adg-token-budget` (moduleName
`dsh-adg-token-budget`, entryId `include:adg-token-budget`) and `overrides: []`, and `list_plugins`
shows `include:adg-token-budget` `enabled: true` / `fiberPhase: active` / `patchId:
adg-token-budget` with the entry total unchanged at 190 before and after — no duplicated row.

**Step 5 is the end state.** With the cancel removed there is no `hardDryRun`, and nothing
left in calibration afterwards: the only remaining knobs are the wording (`stepText`) and the
ladder (`stepTiers`), both of which are `config:` edits. Step 4 is worth doing once on your own
traffic, because it turns `logFile` into a measurement of *which step* each of your children
would have been reminded on: the line shape is in
[What actually reaches `logFile`](#what-actually-reaches-logfile), and the same calibration
method on this machine is kept as history in
[Removed token stages: the dry-run calibration data](#removed-token-stages-the-dry-run-calibration-data-history).

Steps 3–5 are `config:` edits — at the **profile** layer now, since the shipped row lives in the
bundle layer — and this profile is `patchReload: live`, so they are
picked up **without restarting `dsh`** — the host re-applies the row and writes a
fresh `activation:` line. That is how the measured evidence in
[What has been observed live](#what-has-been-observed-live-and-what-has-not) was
produced, and the override-row lines above repeat it on the post-migration row.

**A code change is different, and this was measured rather than assumed:** the
live reload re-applies the row but does **not** re-`import` a module the process
already loaded. On 2026-09-25 the package directory was replaced with a build
carrying the step checkpoints and the row was pointed at a new `config` in the
same edit; the host re-applied the row (the new `dryRun` value appeared in a new
`activation:` line) but the line still had the **old shape** — no `stepNudge=`, no
`stepTiers=`, no `stepText=`. Node's ESM registry is keyed by resolved file
URL, and that URL had not changed. So:

- after changing **`config:` in a profile-layer override row** — no restart;
- after changing **the shipped mount row in the bundle layer**
  (`$DSH_HOME/bundles/dsh-adg-token-budget/cordis.patch.yml`) — **restart `dsh`**: **nothing
  watches `bundles/`, so editing that file on its own triggers no re-read**. Touching the
  profile's own `cordis.patch.yml` **or the profile manifest** re-reads the whole patch stack and
  the bundle layer comes along with it — 真机实测（有日志为证）, the `2026-09-28T01:47:48.467Z`
  line quoted above, written by a process started before the migration — so bundle layers are
  **not** read only at startup. That is a description of what re-reads, **not** permission to
  promise "no restart needed": the acceptance route stays the restart, and whether the bundle
  layer mounts after a cold start is **未观测** (measure: restart `dsh`, then check
  `plugin_manager list_bundles` still lists `dsh-adg-token-budget` and the log gains a fresh
  `activation:` line);
- after changing **any file under `src/`** — restart `dsh`, then confirm the new
  code is really loaded by checking that the `activation:` line carries the current fields
  (`stepNudge=`, `stepTiers=`, `stepText=`, `dryRun=`) and **none of the removed ones**
  (`budgetTokens=`, `softThreshold=`, `softRatio=`, `cacheReadWeight=`, `softNudge=`,
  `hardDryRun=`). The line doubling as a build identifier is what makes this check possible
  at all.

Two consequences worth stating plainly, because they are easy to get wrong when
you are rolling this out:

1. **Until the restart, the row is read by the OLD code.** Every key that build does not
   know is silently ignored — a new key, and equally the five keys this build removed.
   Changing the code and the config in the same step therefore arms a row whose
   meaning the loaded module does not share: deploy the code, restart, verify the new
   activation line, and only then touch `dryRun` / `stepTiers`. Because a checkpoint is
   injected on step counts rather than on money, the failure mode of doing this in the
   wrong order is a reminder in the wrong wording or on the wrong ladder, not a truncated
   child — which is exactly what the removal bought.
2. The row the **bundle** ships is **armed** (`enabled: true` + `dryRun: false`). The
   `enabled: false` in `examples/cordis.patch.yml` now says only that the *example file* is inert;
   it is no longer a statement about what selecting the bundle does.

To run the suite in a sandboxed shell that blocks piped stdio, use
`node --test --test-isolation=none test`: Node's default test runner spawns one
child per file with piped stdio, which such a sandbox rejects with `EPERM`. The
suite is unchanged either way; only the runner's process model differs.

The deployment set is `package.json`, `src/`, `README.md`, `examples/`,
`LICENSE` and `cordis.patch.yml` — six items, matching `files` in `package.json`, because
`cordis.patch.yml` **is** the mount row: without it the package is an ordinary dependency.
`test/` and `INSTALL.md` are repository-only and do not belong in
`$DSH_HOME`. `install.ps1` / `install.sh` copy that set to
`$DSH_HOME/bundles/dsh-adg-token-budget/` (the stable bundle root — **not** the shared
`profiles/node_modules`, and no longer the `plugins/` landing this file pointed at until the
bundle migration), link it into every preset-capable profile with
`link:$DSH_HOME/bundles/dsh-adg-token-budget` and select it in that profile's
`dsh.profile.bundles` (backing the profile's `package.json` up as
`package.json.bak-adg-token-budget`). They no longer insert a patch row, and a `- insert:` entry
left by the old hand-paste route they **only report** — they do not delete it, because they do not
guess at a file the user has hand-edited.

Model the `package.json` shape on `dsh-windows-notifier`: it is a valid ESM
package (`type: module`, `main: src/plugin.js`, an `exports` map, `files`,
`engines: {node: ">=20"}`, `license: MIT`) with **no runtime dependencies** — and
a `LICENSE` file that actually exists, which `npm pack --dry-run --json` lists.

## How to verify it is active

1. **The load-time activation line.** Every `apply` writes exactly one line, through
   `ctx.logger.info` **and** through `logFile`. It is the "the host loaded this plugin, with
   this configuration" marker, and it is written even when `enabled: false` (as
   `activation: inactive (enabled: false)`), so a successful load can never look like silence
   again. The current shape is
   `activation: active createUserMessage=<strategy> presets=[adg] stepNudge=true stepTiers=[…] stepText=builtin|custom dryRun=false logFile='…'`.
   The host log form is prefixed `dsh-adg-token-budget: `; the file form is bare. **If the
   line still carries `budgetTokens=` / `softNudge=` / `hardDryRun=` and has no `stepText=`,
   the old module is still resident — restart `dsh`.**
2. **The suite.** In the plugin directory, `node --test test` runs with no `node_modules` at
   all. It covers the surviving feature end to end: config normalization (including the tier
   reader's fallback / sort / dedupe / bound rules and the `stepText` reader), the pure decision
   helpers, the filters, one reminder per tier per epoch, entered-step-only counting,
   `stepNudge: false` zero-allocation, every `dryRun` branch, the choice wording, the activation
   line, and state release on `subagent/end` and disposal.
3. **No destructive path exists.** This is a source check, not a log check. The module
   comments *do* name the removed calls — deliberately, to explain what was removed — so
   strip comment lines first and scan what is left:

   ```powershell
   Get-ChildItem src\*.js | ForEach-Object { Get-Content -LiteralPath $_.FullName } |
     Where-Object { $_ -notmatch '^\s*(\*|//|/\*)' } |
     Select-String "agent\.cancel|sessionProjections|kind: 'reject'"
   ```

   It returns nothing: the only remaining mentions are the prose documenting the removal.
   That is the proof that the token stages are really gone.
4. **`logFile`.** With `logFile` set to an absolute path, the activation line and
   one line per decision *event* are appended — see
   [What actually reaches `logFile`](#what-actually-reaches-logfile). An armed checkpoint
   writes `step stage: nudged tier=… step=… label=…`; under `dryRun: true` the same due
   checkpoint writes `dry-run step stage: would nudge …` instead. A checkpoint is logged once
   per tier per residency epoch, not once per step, so the file stays small.
5. **The first decision** is echoed once to `ctx.logger.info` as
   `dsh-adg-token-budget: first decision: …`, so the host log shows activity
   without one line per step.
6. **Behaviour — the checkpoints.** A governed child at any of the `stepTiers`
   steps receives a `【收敛检查点 …】` message it did not get before, offering the
   choice between converging and continuing. The cheapest way to see one is to set
   `stepTiers: [1, 2]` on a scratch profile, where the first checkpoint lands on the
   child's first step — or to set `stepText` to a sentence you will recognise, which
   needs no restart at all. `step stage: nudged …` appears in `logFile` at the same
   moment.

## What has been observed live, and what has not

The plugin is **deployed and mounted** on this machine, mounted from the bundle patch layer
`C:\Users\cenqian\.dsh\bundles\dsh-adg-token-budget\cordis.patch.yml` — the hand-pasted entry in
`C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml` was deleted in the 2026-09-28 migration, and
the `activation:` line quoted in the Install section above is the measurement that the bundle-layer
row still mounts and applies — and a running `dsh` loaded it. The log file
`C:\Users\cenqian\.dsh\adg-token-budget.log` is the
measurement. **Path note (2026-09-28)**: the package now sits at
`C:\Users\cenqian\.dsh\bundles\dsh-adg-token-budget` (installed as a bundle: linked into the
profile and selected in `dsh.profile.bundles`), having passed through one interim landing under
`C:\Users\cenqian\.dsh\plugins\`; every log
excerpt and measurement below was produced while it sat at a path **older** than either —
`C:\Users\cenqian\.dsh\profiles\node_modules\dsh-adg-token-budget`. Read them as measurements
of the same code under an older directory layout — not as evidence about the current path.

### Removed token stages: the first live observation (history)

**已移除的 token 两档：历史证据，不代表当前行为。** These three lines were written by a build
that still had the token stages. The plugin no longer contains `budgetTokens`, a soft stage or
an `agent.cancel` call, so it can never write any of these lines again. They are kept because
they are the measurement that produced the removal — in particular the live `usage=7651807`:

```
2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
```

That block is evidence for five separate claims as of that build:

| Claim | Evidence |
| --- | --- |
| the host loads the row and does not fail the boot | `activation: inactive` was written while the row was `enabled: false` |
| the activation line works, and reports the resolved strategy | `activation: active createUserMessage=profile-fallback:web` |
| `agent/pre-step` really reaches this listener for a real delegated `adg` child | the `hard stage` line, whose `label` is a real `adg/<session-id>` |
| *(history)* `ctx.get('sessionProjections')` resolved and `stateOf(…,'tokenUsage')` returned usable `totals` | the same line carries `usage=7651807` — a real cumulative figure, not a default |
| *(history)* `agent.cancel({kind:'parent'})` was reached on a live child | `hard stage: cancel`, i.e. the branch that issued the cancel — a branch that no longer exists |

### The checkpoints now have live evidence, including the child's side of it

On 2026-09-25 the row was armed at `dryRun: false`, and **three real step checkpoints fired** —
the feature's first honest evidence, and it arrived in two parts: the plugin's log line, and the
message itself inside the delegated child's transcript. The lines below come from a build whose
log format still carried the (now removed) token fields, so they show `usage=` / `budget=`; the
current shape is `step stage: nudged tier=<n>/<N> step=<S> label=…`.

```
2026-09-24T17:45:49.845Z step stage: nudged tier=1/3 step=12 usage=124291 budget=3000000 label=adg/fdd55c65-4584-4082-83d2-618570604e5f
2026-09-24T17:55:04.609Z step stage: nudged tier=1/3 step=12 usage=104900 budget=3000000 label=adg/12bf2213-0322-4dfb-9c85-80e12066ab40
2026-09-24T18:22:13.725Z step stage: nudged tier=1/3 step=12 usage=142986 budget=3000000 label=adg/41c07ec8-a997-47e7-8bb1-9457ccf4bd89
```

Reading the same events out of each child's session log (`session.v3.jsonl.zstd`,
zstd frames) closes the loop. The first two children received the **old, directive**
wording, and this is the message as it sits in the transcript, one millisecond after
the log line — `role: user`, `source: {kind: 'plugin', plugin: 'dsh-adg-token-budget'}`.
**The excerpt is history and its source shape is the retired v3 one**: that wrapper is
what a v3 file stores, and a v4 reader converts it to `plugin:dsh-adg-token-budget`
(the same kind new records are stamped with directly — see「The source kind is a v4
admission contract」above), so nothing here needs re-reading as a different producer:

```json
{"type":"user/message","seq":113,"time":1790272504616,"data":{"content":[{"type":"text","text":"【收敛检查点 1／3】调度代理提醒：这是你的第 12 步。\n请先做一次收敛判断……"}],"source":{"kind":"plugin","plugin":"dsh-adg-token-budget"},"role":"user","id":"4da24f75-…"}}
```

and what the child did next:

| child | wording | the child's next message, opening words |
| --- | --- | --- |
| `fdd55c65` | old | *"I'm at step 12. I should converge. Let me assess what I have and what's missing."* |
| `12bf2213` | old | *"I have enough evidence. Let me 收敛 and report."* |
| `41c07ec8` | **new** | *"Let me assess. I have most of what I need. Remaining必需工作: 1. … 2. … 3. … Let me do 2 more fetches … then converge. I'll say I'm continuing briefly."* |

Three things follow, and the third is the point of the redesign:

1. **The injection path works end to end.** The message is in the transcript with this
   plugin's id as its source, at the step the log recorded, and the child reacts to it.
2. **The token price of asking early is small.** At step 12 these children had spent
   **124k / 105k / 143k** tokens. A checkpoint at step 4 costs a fraction of that —
   which is what makes an early, dense ladder affordable.
3. **The two wordings produced the two different behaviours they were written for.**
   Both children that received the directive wording said they would converge. The one
   child that received the choice wording took the **continue** branch — and said so
   explicitly, listing what it still considered necessary, instead of quietly trimming
   its plan. That is branch 2 of the new body working as designed: the reminder was
   read, considered, and legitimately declined.

With `n = 1` per wording and different tasks, this is an illustration, not a
measurement of the wording's effect; the honest comparison still needs the
before/after step quantiles from `audit-steps.mjs`. What it does establish is that
the message lands, is attributed correctly, and is acted on rather than ignored.

**The module-reload boundary was measured the hard way, and it still governs every rollout
here.** For about two minutes on 2026-09-25 the package directory held a new build while the
running host still held the **previous module instance**: the row was repointed at a new
`config` in the same edit that replaced the package, the host re-applied the row (a new
`activation:` line appeared) yet that line still had the old shape. Node's ESM registry is keyed
by resolved file URL, and that URL never changed — so a `config:` edit hot-reloads and a *code*
edit does not. Deploy the code, restart `dsh`, confirm the new activation line, and only then
touch `dryRun` / `stepTiers`.

### Removed token stages: the dry-run calibration data (history)

**已移除的 token 两档：历史证据，不代表当前行为。** The live row was left at `enabled: true` +
`dryRun: true` for about three hours while real delegations ran through it. As of
`2026-09-25T01:1x+08:00` the log held 479 lines / 64,995 bytes (it keeps growing — these are
snapshot counts, not constants). The per-child step counts quoted in
[The step checkpoints](#the-step-checkpoints) come from a separate, reproducible run
of `D:\dsh\.dsh-token-audit\audit-steps.mjs` (a copy of the audit with a distribution
block appended, writing to `audit-report.steps.txt` so the original baseline is
untouched).

| Line kind | Count |
| --- | --- |
| `activation: …` | 5 |
| `hard stage: cancel` (the one armed observation — history) | 1 |
| `dry-run soft stage: would nudge …` (history) | 36 |
| `dry-run hard stage: would cancel …` (history) | 437 |
| **`soft stage: nudged` (armed — history)** | **0** |
| **`step stage: nudged` / `dry-run step stage: …`** | **0** (that snapshot predates the restart that loaded the step stage) |
| **`settled: released session state …`** | **0** at that snapshot |

**Five** distinct `adg` children produced those dry-run lines, and every one of
them crossed the budget — which is the measurement that removed the budget:

| Child | `would cancel` lines | first crossing of 3,000,000 | peak cumulative usage |
| --- | --- | --- | --- |
| `adg/f7ee3039-24a6-4f7e-94c9-b120670f2289` | **297** | 3,121,660 | **48,992,135** |
| `adg/973aca1b-820c-4c6f-9877-8f75ac134725` | 92 | 3,065,764 | 16,607,867 |
| `adg/7cfa95ae-0dad-4e08-9058-ff38c901baa5` | 27 | 3,018,602 | 6,745,603 |
| `adg/2ec8cfe5-e5d9-4c17-bf0a-1388bdb8a65a` | 18 | 3,014,252 | 6,230,057 |
| `adg/5bee9ec3-5548-490a-9e8f-6111927727cd` | 3 | 3,083,933 | 3,361,608 |

Two things fall straight out of that table:

1. **3,000,000 sat inside the normal distribution** — 5 of 5 children crossed it, and the
   smallest child still reached 3.36M. Arming `agent.cancel` at this budget would have
   truncated ordinary work. That is the empirical half of the design reason above; the other
   half is that a cumulative total was measuring the wrong thing.
2. **Steps, not tokens, are the lever.** The 48.99M child alone produced 297
   `would cancel` lines, i.e. roughly **300 proposed steps above the budget**, in a
   corpus whose 37 measured children have a median of **39** steps and a mean of 51.7.
   Fourteen checkpoints are a rounding error beside 49M tokens — which is exactly what
   the step stage exists to exploit.

   That same child is also the unit cross-check for this whole section: the audit
   counts **329** model requests for session `f7ee3039-…`, and the plugin's (now removed)
   dry-run accounting counted ~297 steps above the budget for the same id. Two instruments
   built on different events agree to within the few steps the child spent below the budget,
   which is the evidence that the audit's "requests" and the plugin's "entered steps" are the
   same unit — a claim the ladder's calibration depends on.

Read the token counts as history of *your own* traffic, and mind the unit: a dry-run line was
written **per proposed step**, so `would cancel` counted steps-over-budget, not distinct
children. The armed step checkpoint, by contrast, delivers each reminder exactly once and
writes exactly one `step stage: nudged` line for it.

### What has still never been observed live

- **A checkpoint on any tier other than the first.** What is observed is three
  injections, all `tier=1/3 step=12`, under the older three-tier ladder. Under the **new**
  14-tier ladder no injection has been recorded yet, and no `dry-run step stage: would nudge`
  line has ever been produced on this machine, because the stage went from "no code" to
  "armed" without a calibrated state in between. (The removal of the folding path also means
  the old "checkpoint and token wrap-up on the same step" case no longer exists to observe.)
- **Whether an earlier, denser ladder helps or hurts.** The ladder was moved earlier
  on the argument that most children are far shorter than the average, and the wording
  was softened to make that safe. Both halves of that trade are **argued, not
  measured**: what is measured is the distribution the ladder is fitted to (37
  children), the fact that a checkpoint costs ~0.25% of the child bill, and that the
  three observed checkpoints cost only 105k–143k tokens of context. Whether a
  child that receives fourteen checkpoints converges in fewer steps than the same child
  would have without them is exactly the question the audit rerun below is for.
- **That an injected reminder changes a child's behaviour.** Still unmeasured as an
  *effect*: three children reacted to it (two said they would converge, one declined and
  continued with reasons), which shows the reminder is read and acted on, but three
  instances on three different tasks cannot show that it makes anything converge faster.
  The test-verified guardrails (the choice clauses, one message per step)
  bound what the reminder is allowed to *say*; they do not measure what it *does*.
  Watching this needs a before/after step count on comparable delegations: run
  `node D:\dsh\.dsh-token-audit\audit-steps.mjs "C:\Users\cenqian\.dsh\sessions"`
  (the audit plus a per-child distribution block) before and after, and compare the
  quantiles rather than the mean. That script prints
  `children=… min=… p10=… p25=… p50=… p75=… p90=… max=… mean=…`, the sorted list, a
  histogram, and what each candidate tier would have fired on.
- **The module-reload boundary from the inside.** What was measured is the
  *symptom* (an activation line without the new fields after replacing the
  package). Whether a row removal and re-insert, or a renamed package directory,
  would force a fresh import was **not** tried — the safe conclusion is "restart".
- **The settle edge.** ~~never observed~~ — **observed on 2026-09-25**:
  `2026-09-24T17:55:33.298Z settled: released session state label=12bf2213-0322-4dfb-9c85-80e12066ab40`,
  written 29 seconds after that child received its checkpoint and converged. The state release
  is confirmed rather than inferred.
- **A `subagent/end` → resumed-child re-nudge cycle.** Still never observed: the one
  settle line above is a child that simply finished.

Everything else in this file is a code-level fact or a unit-test result.

### Current live state

The step feature has been live since 2026-09-25; the token stages have since been removed
（本次改动）. The **current** activation-line shape — and therefore the thing to compare a live
line against — is:

```
activation: active createUserMessage=profile-fallback:web presets=[adg] stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

A live row written before this change still carries the five removed keys — on this machine
that is `budgetTokens: 3000000`, `presets: ['adg']`, `stepNudge: true`,
`stepTiers: [4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280]`, `softNudge: true`,
`dryRun: false`, `hardDryRun: true`, `stepText` unset. The new build **ignores** the removed
ones and runs the surviving options (`enabled`, `presets`, `stepNudge`, `stepTiers`, `stepText`,
`dryRun`); no error, no warning, no effect from the legacy keys.

The earlier activation lines below are **history**: every one of them was written by a build
that still carried the token stages, which is why they end with `cacheReadWeight=… softNudge=…`
and, in the later ones, `hardDryRun=…`. A line with those fields — or without `stepText=` —
means the **old module** is still the one in memory:

```
2026-09-24T17:12:18.463Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T18:25:14.773Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true stepNudge=true stepTiers=[4, 8, 12, 18, 24, 32, 42, 55, 72, 95, 125, 165, 215, 280] stepText=builtin dryRun=false hardDryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

Read the 17:12 line's tail against the source of `activationLine`: it stops after
`softNudge=…`, i.e. it is the old shape, written by a reload that had the new `config` and the
**old module**. The 18:25 line is a later build proving itself (`stepText=` appeared) with the
redesigned ladder arriving as a `config:`-only hot reload, **no restart** — and it still ends
in `hardDryRun=true`, because at that point the hard stage still existed. One caveat that comes
with any of these reloads: re-applying the row starts a fresh residency epoch, so a child that
is mid-run has its step count and its fired tiers reset. Its next step is counted as step 1
again, and it can be reminded for a tier it had already spent. That is inherent to the state
being per-application rather than per-session-log.

The lesson the lines encode is unchanged and is why the current shape above matters: the
`activation:` line is the only place the host states which build and which config it is
actually running.

## History: what 3,000,000 would have done (removed token stages)

**已移除的 token 两档：历史证据，不代表当前行为。** Nothing in this section is current
behaviour: the budget, the soft stage and the cancel were removed, and this section is the
measurement that justified removing them. The distribution below is measured, from
`D:\dsh\.dsh-token-audit\audit-report.txt` (32 `adg` sessions / 983 requests) plus
a full re-read of all 22 audited child sessions (the report's own top-15 table is
sorted by `in+out` and only lists 13 of them, so the extremes have to be
recomputed to be quoted):

| Observation | Measured value |
| --- | --- |
| average child session | **1,734,486** (≈1.73M) |
| largest child session in the audited snapshot | **5,217,983** (≈5.22M) = `228433 + 42094 + 4947456` |
| heaviest **observed** implementation delegation (history: the live hard cancel quoted above) | **7,651,807** (≈7.65M) |
| audited children at or above 3,000,000 | **5 of 22** |

The five children at or above the default budget in that snapshot were, in
descending order: 5,217,983 · 4,455,097 · 4,070,916 · 3,904,800 · 3,236,397.
The next one down is 2,204,189, so the boundary is not close.

**That is the finding that removed the budget: a 3,000,000 threshold sits well inside the
distribution and WILL curtail legitimate work.** One child in four of the audited set was
already over it, the average child is 1.73M, and the heaviest real delegation observed burned
2.5× the budget. It would have guarded the tail only at a higher number — and correlating a
budget with "acceptable cancellations" means picking a number above the bulk of your own
traffic, which is a number that, by construction, cuts ordinary output. The alternative this
plugin took instead is to remind on **steps**, which cost nothing to get wrong because the
child may disregard them.

Two framing notes worth holding on to before reading those numbers as a forecast:

- **The preset-side shape of the audited traffic is the one that ships now.** The
  five knob overrides described in the repository README were reverted to the
  plugins' factory defaults (pruner 8192/4096/1024, compaction 0.8 + 0.16,
  `tool-web` 200000 / 8 / 4) and the persona-side read/report budgets were
  removed: truncating tool output and compacting early traded information for
  tokens rather than removing work. So the corpus measures the current preset —
  but it predates this plugin being armed, so none of it was produced with the
  step checkpoints actually firing.
- **The corpus keeps growing.** A re-read of the same session directory after
  this documentation pass found 32 children (up from 22), a maximum of 17,022,627
  and an average of 3,942,185 — every number in the table is a floor. The live
  dry-run traffic in the previous section went further still: 5 of 5 governed
  children crossed the 3,000,000 budget, and one reached **48,992,135**.

**This machine's own dry-run snapshot is blunter than the audited corpus**, and it
is the reason the live row is not armed at 3,000,000: 5 of 5 governed children
crossed the budget (3.36M at the smallest, 48.99M at the largest), and the runaway
child alone spent ~300 steps above the budget. The full table is in
[Removed token stages: the dry-run calibration data](#removed-token-stages-the-dry-run-calibration-data-history).
That is why calibration is now a **step** measurement: with `dryRun: true` the file tells you
which step each of your children would have been reminded on, and there is no destructive
threshold left to pick.

## Tests

```powershell
cd D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget
node --test test
```

The suite has no dependencies beyond `node:test` and `node:assert`, so it runs in a
checkout that has no `node_modules` at all. It covers the surviving feature end to end:
config normalization for every wrong type, including the tier reader's
fallback/clamp/sort/dedupe/bound rules and the `stepText` reader (blank/unusable → built-in
body, over-long → truncated); the default ladder's shape (early, dense, still reaching the
tail, ascending, gaps never zero); the pure decision helpers directly (`dueStepTier`,
`delegationDepthOf`, `isDelegatedChild`, `presetIsGoverned`); the top-level, foreign-preset,
and absent-preset filters; the out-of-contract depth guard at both the helper and the
listener level; the zero-allocation pass-through of `stepNudge: false`; the checkpoints firing
exactly once per tier on the tier step, per child, counting only entered steps, keeping the
body flat across tiers, adding its closing sentence only on the last tier, and logging every
branch; the choice wording itself (optional, may be disregarded, both branches named,
decision requested, the shortest-path next step plus its one-sentence justification on the
continue branch, no prescription of what to report, no order to stop exploring); the flat
ladder itself (first tier = 5, last tier = 280, **every** gap = 5, tier count = the cap);
a configured `stepText` reaching the
child and replacing the built-in body entirely; the activation line reporting
`stepText=builtin|custom`; `dryRun` logging every due checkpoint while consuming no tier and
still counting steps; the delegation-first ordering, and a downstream failure being rethrown
rather than turned into a pass-through; a hostile logger and an unwritable `logFile`; and the
per-session map being released on both `subagent/end` and disposal. Since the mount row became
part of the package, the suite also pins the **deployment shape**: `package.json` declares
`dsh.bundle.patch` and that file really exists, `files` is exactly the six-item deploy set, the
bundle layer carries **one** mount row for this package and it ships armed (`enabled: true`), and
none of the retired token keys may reappear in the effective row. Measured here 2026-09-28:
`node --test --test-isolation=none test` → `tests 54 / pass 54 / fail 0` (51 before those three
cases; `testing-guide.md` 第 0 节 owns the command and its counts).

### Mutation verification (what the suite would NOT catch)

A passing suite is only evidence if it *fails* when the behaviour it pins is
broken. Every mutation below was applied to a **fresh copy** (never to this
checkout), one behaviour per copy, followed by the suite. The rows below target the
**surviving** feature, and every one of them is caught by at least one assertion. The removed
token stages had their own pass — `dryRun`-hard, `dryRun`-soft, the one-shot flag, the
soft/hard comparison, `hardDryRun` and the folding rule — and those mutations are history now
that the code they mutated is gone.

| # | Mutation | Caught? |
| --- | --- | --- |
| **M1** | count a step the downstream listener rejected | yes |
| **M2** | let a fired tier fire again (`dueStepTier` ignores `firedTiers`) | yes |
| **M6** | let `stepNudge: false` still count steps | yes |
| **M7** | evaluate the tier one step early (off-by-one) | yes |
| **M8** | treat every decision as an entry, so rejected steps count | yes |
| **M9** | stop sorting the tier list | yes |
| **M10** | stop de-duplicating the tier list | yes |
| **M11** | drop the closing sentence from the last tier | yes |
| **M12** | return `[]` instead of the fallback tiers for unusable input | yes |
| **M13** | invert the clause that lets a child disregard the reminder | yes |
| **M14** | make `dryRun` inject after all | yes |
| **M15** | ignore a configured `stepText` and always use the built-in body | yes |
| **M16** | stop truncating an over-long `stepText` | yes |
| **M17** | report `stepText=builtin` even when a custom body is set | yes |
| **M18** | stamp the retired `{kind:'plugin', plugin}` source again (session format v4 refuses it, so the child dies) | yes (4 assertions) |
| **M19** | widen the tail again (make the ladder geometric instead of every-5-steps) | yes |
| **M20** | drop the shortest-path clause from the continue branch | yes (2 assertions) |
| **D1b** | do not rethrow when `call.failed` (swallow a downstream failure, return a decision) | yes |
| **D1b-all** | neuter **both** rethrows (the failure becomes a silent pass-through, `next()` runs twice) | yes |
| **D2** | remove the `WeakSet` dedupe of same-context applies | yes |
| **D5-header** | remove `Number.isSafeInteger`/`>= 0` on the header depth | yes |
| **D5-runtime** | remove `Number.isSafeInteger`/`>= 0` on the runtime depth | yes |
| **B2-activation** | skip the activation line | yes |

M13 is the mutation that matters most for this feature's promise. The earlier
wording made that promise by permitting the one **必需** action; this wording makes
it by sanctioning "no" outright, so the mutation now inverts the clause that says the
reminder may be **直接无视**. If that clause is gone, the message still *names* both
branches while quietly withdrawing one of them — an order wearing a choice's clothes,
which is exactly the failure mode a dense early ladder cannot afford. It is caught by
exactly one assertion (the positive match on that clause, with the negative match
`doesNotMatch(/立即停止/)` guarding the other direction), which is the point: that
assertion exists so a future edit cannot turn "converge or continue" into "stop".

M15–M17 cover the `stepText` path, which is new surface with no behaviour other than
the words that reach the child: dropping the custom body, dropping its length cap, and
lying about it in the activation line are each caught by exactly the assertion that
exists for them.

M18 covers the message source, and it is the one mutation here whose failure mode is
not a wrong reminder but a **dead child**: under v4 the retired wrapper makes the
durable append throw, so no later stage of this plugin runs at all. It is caught by
**four** assertions because the source is asserted on both construction paths, on the
rule itself, and on the injected message.

**M19 and M20 are the 2026-09-29 additions**, and both were run in a fresh temp copy
(`$TEMP/adg-mut`), never in this checkout. M19 restores a widening tail — it replaces the
last six flat tiers with a geometric one — and the ladder test fails on the array itself
(`exit 1`); because that test asserts the first tier, the last tier, **every** gap and the
count against the cap, a "nearly flat" ladder is caught too, not just a wildly different
one. M20 removes the shortest-path clause the operator asked for: it fails both on the
literal body pin and on the dedicated `match(/通往目标的最短路径上的那一步/)`, so the clause
cannot be lost in a later wording tidy-up. The measured runs (2026-09-29) are
`M19 exit=1`, `M20 exit=1` against `pass 54 / fail 0` for the unmutated suite.

**Dated re-run (2026-09-28, same harness).** Re-running the harness against the current
code re-measured the older rows too, and five of them no longer apply: **M1**, **M3**,
**M4**, **M5** and **M6** report `NOT-APPLIED`, because their `from` strings describe
code the token-stage removal deleted (the two-trigger `else if` branch, the soft/hard
stages, the old `stepNudge` check inside `postStep`). That is **harness drift, not a
regression** — the surviving behaviour those rows targeted is pinned by M8 (every
decision counted as an entry) and M13, both still caught. The table above is the pass
that was actually run for those rows, against the code they mutated; the current
full-harness result is recorded in `docs/evidence.md` §15.

Four mutations are **not caught**, stated plainly rather than
buried:

1. **D1a** (`allow a second next()`: remove the `call.called` guard) — the guard is
   unreachable by construction, and no
   test drives a second call, so removing it changes nothing observable. The
   invariant "`next()` is called at most once" is instead enforced by the
   structure of the handler (one `callNext()` per path) and by D1b-all being
   caught.
2. **D1b-inner** (neuter the inner `call.failed` rethrow only) — after the inner rethrow is
   removed, execution still reaches
   the *second* line of defence (the `if (call.called) throw error` after it), so
   the error still propagates and the mutant is not reached. Only D1b-all, which
   removes both, is caught.
3. **B2-logger** and **B2-logfile** — measured with a dedicated probe rather than
   by the suite: a throwing `logger.info` and an unwritable `logFile` were driven
   through `apply` against the pristine sources and against both mutants. In all
   six runs `apply` returned without throwing, because the activation
   announcement sits in its own `try`/`catch` **inside** `apply`'s outer `try`.
   What changes is only the diagnostic: the pristine code logs the activation
   line and then fails silently in the writer; the mutants report
   `the activation line could not be written (Error: info exploded)` /
   `(Error: EISDIR: …)`. So these two mutations are **not behaviour-preserving
   but also not fatal** — they are caught by no assertion, and the "`apply` never
   throws" contract survives them. That is a gap in *test coverage*, not in the
   code: a future refactor that removes the outer `try` would make them fatal
   with no test to catch it.

The original harness, its per-mutation copies and the raw `node --test` output
lived under `%TEMP%\adg-token-budget-mutations\`. The step feature's pass used
`D:\dsh\.adg-step-mutations\run-mutations.ps1`, which rebuilds one mutant per
directory under `D:\dsh\.adg-step-mutations\cases\` and writes each run's raw
output beside it. Neither harness is part of this package.

## License

MIT. See `LICENSE` (also listed in `package.json`'s `files`).
