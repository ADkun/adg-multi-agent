# dsh-adg-token-budget

A host-plane [DSH](https://github.com/deepseek-ai/dsh) / Cordis plugin that puts a
**two-stage cumulative token budget on the delegated child agents of the `adg`
agent preset**.

One delegated expert can otherwise burn millions of tokens in an unbounded
exploration loop. This plugin is the backstop for that, and nothing else: it does
not schedule work, does not pick models, and does not touch top-level sessions.

## The two stages

The plugin registers exactly one `agent/pre-step` waterfall listener and reads
the child's cumulative token usage on every proposed step.

| Stage | Trigger | Action |
| --- | --- | --- |
| **soft** | `usage >= budgetTokens * softRatio` | call `next()` first, then append one wrap-up instruction to the returned `{kind:'enter'}` decision's `messages` |
| **hard** | `usage >= budgetTokens` | `agent.cancel({kind:'parent'})` **and** return `{kind:'reject'}` — without calling `next()` |

Cumulative usage is

```
uncachedInputTokens + outputTokens + cacheReadTokens * cacheReadWeight + cacheWriteTokens
```

read from `ctx.get('sessionProjections')?.stateOf(agent.session, 'tokenUsage')`,
whose `totals` are cumulative over the whole session log.

The **soft** instruction (in Chinese, because the delegated experts it addresses
work in Chinese) tells the child that it is near its budget, that it must stop
exploring now and not open new lines of investigation, and that it must
immediately report its current conclusions with the evidence it already has —
including an explicit statement of what it has *not* verified. It is injected at
most **once per residency epoch of a child session**.

The distinction is real and deliberate. The once-per-session flag is released on
`subagent/end`, and the subagent layer emits that event **once per residency
epoch** — a continuable child that is resumed later starts a fresh epoch. So a
resumed child CAN be nudged a second time. That is arguably the desirable
behaviour rather than a leak: the resumed child has a new plan and a new chance
to run away with the budget, and the flag it would otherwise inherit was
consumed by an instruction that was delivered before the child went dormant.
The bounded-state guarantee is unaffected — the map entry is created for the new
epoch and released again on the next `subagent/end`.

The **hard** stage does both things on purpose. `cancel` aborts the in-flight
turn so no further requests are billed, and `reject` guarantees the loop does not
proceed to derivation even if the abort lands late: the agent loop maps a
rejected pre-step to a `blocked` turn end without opening a step, so the child
surfaces to the dispatcher as a cancelled run **with its partial output**, which
the delegation tool appends (as `Partial output before the run ended: …`). A
budget stop therefore loses the child's remaining plan, not its findings.

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
   true in JavaScript and a coercion would let a mistyped header cancel a real
   child;
3. `session.header.agentPreset` is one of `presets`.

A top-level agent (depth 0) is never touched — in particular never the
dispatcher. A child whose header carries **no** `agentPreset` is never touched
either: that case fails *open*, not closed, because guessing there could stop
sessions this plugin was never pointed at.

If the projection service is missing, or `stateOf(session, 'tokenUsage')` returns
nothing usable, the step passes through untouched (and the fact is logged at most
once). "No budget data" is not "no budget".

## Configuration

Every key is optional. The plugin exports **no** Cordis `Config` schema: it
hand-normalizes the raw config object, so a malformed value falls back to its
default instead of failing the profile load.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` registers nothing at all. |
| `presets` | `['adg']` | Preset names to govern. A bare string (`presets: adg`) reads as a one-name list. |
| `budgetTokens` | `3000000` | Cumulative budget per child session. A non-positive or unusable value falls back to this default. |
| `softRatio` | `0.7` | Soft threshold as a fraction of `budgetTokens`, clamped to `[0, 1]`. `1` disables the soft stage. |
| `cacheReadWeight` | `1` | Multiplier on `cacheReadTokens`, clamped to `[0, 100]`. Fractional values are kept as written. |
| `softNudge` | `true` | `false` logs the soft stage without injecting the instruction, and keeps the hard cap. The single log line IS the one-shot action, so it consumes the flag. |
| `dryRun` | `false` | Calibration switch. Computes and logs **every** decision it would make — the soft nudge and the hard cancel — and takes no action: no message is injected, `agent.cancel` is never called, and the hard stage still delegates through `next()`. It also **does not consume the once-per-nudge flag and does not allocate per-session state**, so arming the same session afterwards still delivers the instruction. |
| `logFile` | `null` | Absolute path; when set, the activation line plus one line per decision *event* is appended (see below). A relative path disables file logging with a warning. |

Both thresholds are **inclusive**: a child exactly at `budgetTokens * softRatio`
is nudged, and a child exactly at `budgetTokens` is stopped.

### What actually reaches `logFile`

One ISO-8601-stamped line per **event**, not one per decision. A step that
passes through untouched (the common case) writes nothing at all, so the file
stays small even for a child that runs hundreds of steps. The complete list is:

| Event | Line |
| --- | --- |
| load | `activation: active createUserMessage=<strategy> budgetTokens=… softThreshold=… softRatio=… presets=[…] cacheReadWeight=… softNudge=… dryRun=… logFile=…` — written on **every** `apply`, including `activation: inactive (enabled: false)`, so "the host loaded this plugin" is never invisible |
| load | a registration note (`registration skipped: this context already applied the plugin`, `warning: N registration(s) are already active …`) |
| soft | `soft stage: nudged …`, `soft stage (no nudge configured) …`, or `soft stage (no nudge injected: …) …` — at most once per residency epoch unless nothing was delivered |
| hard | `hard stage: cancel usage=… budget=… label=…` |
| dry-run | `dry-run soft stage: would nudge …` / `would not nudge (…) …`, `dry-run hard stage: would cancel …` |
| settle | `settled: released session state label=<agent.id>` |
| no data | `no budget data: passing through label=…` — at most once per activation |

A plain PASS step is deliberately **not** logged. The first line ever written
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
- **Every per-event handler is wrapped.** A bug in the budget logic catches,
  logs once, and returns `next()` — it cannot abort someone's turn.
- **No `static inject`.** `ctx.get('sessionProjections')` is read lazily inside
  the handler, and a missing service simply means pass-through.
- **No static `import` of any `@deepseek-ai/*` package.** The plugin is deployed
  as a plain directory under `$DSH_HOME/profiles/node_modules/`, so anything it
  needs from the harness is resolved at call time with `createRequire`, and every
  resolution failure is survivable (see below).
- **No top-level side effects**, no `process.exit`, no network, and no
  filesystem writes outside the configured `logFile`.
- **Bounded state.** Per-session state lives in a `Map` keyed by `agent.id`. The
  entry is created by the soft stage's one-shot action and by nothing else: the
  nudge delivery path (`markNudged`) and the `softNudge: false` log-line path
  both go through it, while a step that passes through, a hard stop, an
  undelivered nudge (a downstream `reject`, or a nudge that could not be
  constructed), and **every** `dryRun` step leave the map untouched. It is
  released on `subagent/end` and cleared wholesale by a `ctx.effect` disposer, so
  a long-lived host cannot accumulate children and a child that only passes
  through never allocates anything.

## The soft-nudge message, and why it may fall back

The injected instruction is a `UserMessage`:
`{ id, role: 'user', content: ContentBlock[], source: { kind: 'plugin', plugin } }`.
First-party code builds these with `createUserMessage` from
`@deepseek-ai/dsh-llm`, which this plugin cannot import statically.

So the plugin resolves it at call time, in this order:

1. `createRequire` anchored at the **running profile's** `.dsh-module-fallback`,
   where "running profile" is derived from `ctx.baseUrl` rather than hardcoded —
   under the GUI that is `web`, under `dsh headless` it is `headless`;
2. anchored at **every** `$DSH_HOME/profiles/<profile>/.dsh-module-fallback`
   directory found on disk (read with `readdirSync`, real directories only), so a
   context that does not expose `baseUrl` at all still resolves the way a real
   profile does;
3. anchored at `$DSH_HOME/profiles/` (the shared module root's parent);
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

**Measured on the deployment machine** (plugin file simulated at
`C:\Users\cenqian\.dsh\profiles\node_modules\dsh-adg-token-budget\src\plugin.js`):
**all five anchors resolve**, each to the same module instance inside the `dsh`
install tree, because `$DSH_HOME/profiles/node_modules/@deepseek-ai/*` are
symlinks into that tree and Node's ordinary parent-walk reaches them from the
plugin directory. Anchor (1) wins — the live log line
`createUserMessage=profile-fallback:web` is that fact, recorded by the running
host — which is also the anchor that keeps working if a future profile layout
puts a plugin-private `@deepseek-ai` shadow in the fallback directory.

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
automatically when resolution fails, so the soft stage keeps working. If even
that cannot be constructed, the nudge-construction failure is caught, the soft
decision is logged without an instruction, and the **hard cap still applies** —
the plugin never lets a nudge-construction failure escape the handler.

## Install and enable

```powershell
# 1. copy the package into the profile's module root
Copy-Item -Recurse -Force `
  'D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget' `
  "$env:DSH_HOME\profiles\node_modules\dsh-adg-token-budget"

# 2. add the row from examples/cordis.patch.yml to the profile patch file
#    $env:DSH_HOME\profiles\web\cordis.patch.yml
#    the example ships `enabled: false`, so pasting it as-is arms nothing

# 3. to calibrate first: set `enabled: true` and leave `dryRun: true`
# 4. to arm: set `dryRun: false`
```

Steps 3 and 4 are live edits: the shipped `web` profile is `patchReload: live`,
so the row and its `config:` are picked up without restarting `dsh`. **No restart
is needed** — the running host hot-loads the plugin module when the row is
activated, which is how the measured evidence in
[What has been observed live](#what-has-been-observed-live-and-what-has-not) was
produced. (The `examples/cordis.patch.yml` claim "`enabled: false` ships on
purpose" is true of the file as shipped.)

The deployment set is `package.json`, `src/`, `README.md`, `examples/` and
`LICENSE`; `test/` and `INSTALL.md` are repository-only and do not belong in
`$DSH_HOME`. `install.ps1` / `install.sh` do the copy and the row insertion
idempotently.

Model the `package.json` shape on `dsh-windows-notifier`: it is a valid ESM
package (`type: module`, `main: src/plugin.js`, an `exports` map, `files`,
`engines: {node: ">=20"}`, `license: MIT`) with **no runtime dependencies** — and
a `LICENSE` file that actually exists, which `npm pack --dry-run --json` lists.

## How to verify it is active

1. **The load-time activation line — this exists now.** Every `apply` writes
   exactly one line, through `ctx.logger.info` **and** through `logFile`. It is
   the "the host loaded this plugin, with this configuration" marker, and it is
   written even when `enabled: false` (as `activation: inactive (enabled:
   false)`), so a successful load can never look like silence again. The host log
   form is prefixed `dsh-adg-token-budget: `; the file form is bare.
2. **`logFile`.** With `logFile` set to an absolute path, the activation line and
   one line per decision *event* are appended — see
   [What actually reaches `logFile`](#what-actually-reaches-logfile). A soft nudge
   is logged once per residency epoch, not once per step, so the file stays small
   even for a child that sits above the ratio for a long time.
3. **The first decision** is echoed once to `ctx.logger.info` as
   `dsh-adg-token-budget: first decision: …`, so the host log shows activity
   without one line per step.
4. **Behaviour.** A governed child that crosses the ratio should wrap up and
   report instead of starting another investigation, and one that crosses the
   budget should come back to the dispatcher as a cancelled run whose result ends
   with `Partial output before the run ended: …`.

Set `softRatio` low (for example `0.05`) and `budgetTokens` small (for example
`20000`) on a scratch profile to exercise both stages quickly. To calibrate
without risking a real delegation, leave `dryRun: true`: every line above is
still written, and nothing is injected or cancelled.

## What has been observed live, and what has not

The plugin is **deployed and mounted** on this machine at
`C:\Users\cenqian\.dsh\profiles\node_modules\dsh-adg-token-budget`, mounted from
`C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml`, and a running `dsh`
hot-loaded it. The log file `C:\Users\cenqian\.dsh\adg-token-budget.log` is the
measurement, quoted verbatim:

```
2026-09-24T13:52:57.803Z activation: inactive (enabled: false) budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.437Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=false logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T13:53:20.487Z hard stage: cancel usage=7651807 budget=3000000 label=adg/2d4efc3d-3b5c-4746-8ac2-4f9395151859
```

That single block is evidence for five separate claims, and it is worth reading
slowly:

| Claim | Evidence |
| --- | --- |
| the host loads the row and does not fail the boot | `activation: inactive` was written while the row was `enabled: false` |
| the activation line works, and reports the resolved strategy | `activation: active createUserMessage=profile-fallback:web` |
| `agent/pre-step` really reaches this listener for a real delegated `adg` child | the `hard stage` line, whose `label` is a real `adg/<session-id>` |
| `ctx.get('sessionProjections')` resolves and `stateOf(…,'tokenUsage')` returns usable `totals` | the same line carries `usage=7651807` — a real cumulative figure, not a default |
| `agent.cancel({kind:'parent'})` is reached on a live child | `hard stage: cancel`, i.e. the branch that issues the cancel |

The dry-run lines in the next section extend this to three further claims:
`softRatio` is applied to the live cumulative figure (`would nudge` at 2,185,852
with a 2,100,000 threshold), the hard comparison is applied to the same figure
(`would cancel` at 3,065,764 against 3,000,000), and the guard is **not** armed —
no `agent.cancel` was issued for any of those children, which is precisely what
`dryRun` promises.

### Live calibration data (`dryRun: true`)

While this documentation was being written, the live row was left at
`enabled: true` + `dryRun: true` and real delegations ran through it. As of
`2026-09-24T22:19:40+08:00` the log held (it keeps growing - these are snapshot
counts, not constants):

| Line kind | Count |
| --- | --- |
| `activation: …` | 4 |
| `hard stage: cancel` (the one armed observation) | 1 |
| `dry-run soft stage: would nudge …` | 21 |
| `dry-run hard stage: would cancel …` | 90 |
| **`soft stage: nudged` (armed)** | **0** |
| **`settled: released session state …`** | **0** |

Three distinct `adg` children produced those dry-run lines, and the biggest
`usage` seen on a `would cancel` line was **9,824,410** against the 3,000,000
budget — more than 3× the budget, still running, because dry-run never stops
anything.

Read that as a measurement of *your own* traffic, and mind the unit: a dry-run
line is written **per proposed step**, so `would cancel` counts steps-over-budget,
not distinct children. It says "this child spent 90 steps past the budget"; it does
not say "90 children would have died". The armed plugin stops the child on the
first such step, which is why a real hard stop produces exactly one line.

**What has still never been observed live:**

- **A real (armed) soft nudge.** Every soft observation so far is a **dry-run**
  line: the instruction is never injected in that mode, so `soft stage: nudged`
  has never been written by a running host, and neither has the loop's acceptance
  of the injected message or its rendering in the child's transcript. The soft
  stage's *decision logic* is now live-measured; its *effect* is not.
- **A live `dryRun` hard stage reaching the end of a child** (no cancel was ever
  issued — which is itself the proof that dry-run guards the hard path).
- **What the dispatcher renders** on a real cancellation: the
  `Partial output before the run ended: …` contract is read from first-party
  source, not watched.
- **The settle edge.** `settled: released session state …` has never been
  observed, although children have now passed through the guard — the child
  cancelled at 13:53 never produced a settle line.
- **A `subagent/end` → resumed-child re-nudge cycle.**

Everything else in this file is a code-level fact or a unit-test result.

### Current live state

The live row is `enabled: true`, `budgetTokens: 3000000`, `dryRun: true` — armed
for calibration only. Its activation line is the fourth line of the log:

```
2026-09-24T13:55:30.327Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

Sample of the dry-run decisions that followed it (the full file is 116 lines):

```
2026-09-24T14:11:23.331Z dry-run soft stage: would nudge usage=2185852 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
2026-09-24T14:12:35.408Z dry-run hard stage: would cancel usage=3065764 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
2026-09-24T14:19:17.856Z dry-run hard stage: would cancel usage=9824410 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
```

## Calibration: what 3,000,000 would have done

The distribution below is measured, from
`D:\dsh\.dsh-token-audit\audit-report.txt` (32 `adg` sessions / 983 requests) plus
a full re-read of all 22 audited child sessions (the report's own top-15 table is
sorted by `in+out` and only lists 13 of them, so the extremes have to be
recomputed to be quoted):

| Observation | Measured value |
| --- | --- |
| average child session | **1,734,486** (≈1.73M) |
| largest child session in the audited snapshot | **5,217,983** (≈5.22M) = `228433 + 42094 + 4947456` |
| heaviest **observed** implementation delegation (live hard cancel above) | **7,651,807** (≈7.65M) |
| audited children at or above 3,000,000 | **5 of 22** |

The five children at or above the default budget in that snapshot were, in
descending order: 5,217,983 · 4,455,097 · 4,070,916 · 3,904,800 · 3,236,397.
The next one down is 2,204,189, so the boundary is not close.

**Read that as: a 3,000,000 budget sits well inside the distribution and WILL
curtail legitimate work.** One child in four of the audited set was already over
it, the average child is 1.73M, and the heaviest real delegation observed burned
2.5× the budget. It guards the tail only at a higher number; correlating budget
with "acceptable cancellations" means picking a number above the bulk of your own
traffic, not above the average.

Two reasons the picture is *pessimistic* rather than optimistic, both worth
holding on to:

- **The preset-side caps (the 5 knobs in the repository README's "三组预算旋钮")
  only take effect after a `dsh` restart.** The corpus above was produced before
  they took effect, so it measures the old, fatter traffic.
- **The corpus keeps growing.** A re-read of the same session directory after
  this documentation pass found 32 children (up from 22), a maximum of 17,022,627
  and an average of 3,942,185 — every number in the table is a floor. The live
  dry-run traffic in the previous section independently reached 9,824,410 on a
  single child.

That is exactly why `dryRun` exists: **calibrate against your own traffic before
arming.** With `dryRun: true`, every soft/hard decision the plugin would make is
written to `logFile` and nothing is injected or cancelled, so the file becomes a
measurement of your own distribution. Arm only once the line count at your
chosen budget is a number you can live with — and remember that the count is in
*steps*, not children (see the unit note above).

## Tests

```powershell
cd D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget
node --test test
```

**51 tests, 51 passing, 0 failing.** No dependencies beyond `node:test` and
`node:assert`, so the suite runs in a checkout that has no `node_modules` at all.
They cover: config normalization for every wrong type; the pure decision helpers
directly; the top-level, foreign-preset, and absent-preset filters; the
out-of-contract depth guard at both the helper and the listener level; the
below-threshold passthrough; the soft stage's call-`next()`-first ordering,
single-nudge rule, and downstream-`reject` handling; the once-per-session flag
being consumed only after delivery; the hard stage's single
`cancel({kind:'parent'})` and `reject` with no `next()`; missing/broken/absent
projection data; a thrown `stateOf`; a downstream listener that throws after
delegating, and the fact that this plugin does not turn it into a pass-through;
`cacheReadWeight` flipping a case across each threshold; `dryRun` for both
stages, including that it consumes no state; the load-time activation line in
both the enabled and the disabled case; a hostile logger and an unwritable
`logFile`; and the per-session map being released on both `subagent/end` and
disposal.

### Mutation verification (what the suite would NOT catch)

A passing suite is only evidence if it *fails* when the behaviour it pins is
broken. Every mutation below was applied to a **fresh copy in `%TEMP%`** (never to
this checkout), one behaviour per copy, followed by `node --test test`:

| # | Mutation | Failing tests |
| --- | --- | --- |
| D1a | allow a second `next()` (remove the `call.called` guard) | **0 — not caught** |
| D1b | do not rethrow when `call.failed` (swallow a downstream failure, return a decision) | 2 |
| D1b-inner | neuter the inner `call.failed` rethrow only | **0 — not caught** |
| D1b-all | neuter **both** rethrows (the failure becomes a silent pass-through, `next()` runs twice) | 1 |
| D2 | remove the `WeakSet` dedupe of same-context applies | 1 |
| D3 | consume the one-shot flag before the nudge can be appended | 1 |
| D3-early | consume it even when nothing was delivered | 1 |
| dryRun-hard | make the hard stage cancel anyway | 1 |
| dryRun-soft | make the soft stage inject anyway | 3 |
| dryRun-flag | make `dryRun` consume the one-shot flag | 2 |
| B2-activation | skip the activation line | 1 |
| B2-logger | remove the `try`/`catch` around the `warn`/`info` sinks | **0 — not caught** |
| B2-logfile | remove the `try`/`catch` around the `logFile` append | **0 — not caught** |
| D5-header | remove `Number.isSafeInteger`/`>= 0` on the header depth | 2 |
| D5-runtime | remove `Number.isSafeInteger`/`>= 0` on the runtime depth | 1 |

The D5 pair is the one that previously escaped: the guard is now pinned at both
the helper level (`delegationDepthOf` directly) and through the whole listener
(an out-of-contract header must not cancel a live child).

Four mutations are **not caught**, stated plainly rather than buried:

1. **D1a** — the second-`next()` guard is unreachable by construction, and no
   test drives a second call, so removing it changes nothing observable. The
   invariant "`next()` is called at most once" is instead enforced by the
   structure of the handler (one `callNext()` per path) and by D1b-all being
   caught.
2. **D1b-inner** — after the inner rethrow is removed, execution still reaches
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

The harness, the per-mutation copies, and the raw `node --test` output live under
`%TEMP%\adg-token-budget-mutations\` and are not part of this package.

## License

MIT. See `LICENSE` (also listed in `package.json`'s `files`).
