# dsh-adg-token-budget

A host-plane [DSH](https://github.com/deepseek-ai/dsh) / Cordis plugin that keeps
the **delegated child agents of the `adg` agent preset** from burning millions of
tokens in an unbounded exploration loop. It puts two things on those children:
**step checkpoints** (a convergence reminder every N steps) and a **two-stage
cumulative token budget** (a wrap-up instruction, then a hard stop).

One delegated expert can otherwise burn millions of tokens in an unbounded
exploration loop. This plugin is the backstop for that, and nothing else: it does
not schedule work, does not pick models, and does not touch top-level sessions.

## The three stages

The plugin registers exactly one `agent/pre-step` waterfall listener. It decides
on every proposed step of every governed child, on two independent triggers:

| Stage | Trigger | Action |
| --- | --- | --- |
| **step** | the child is entering its `stepTiers[n]`-th step | call `next()` first, then append the nth convergence reminder to the returned `{kind:'enter'}` decision's `messages` — at most once per tier per residency epoch |
| **soft** | `usage >= budgetTokens * softRatio` | call `next()` first, then append one wrap-up instruction to the returned `{kind:'enter'}` decision's `messages` — at most once per residency epoch |
| **hard** | `usage >= budgetTokens` | `agent.cancel({kind:'parent'})` **and** return `{kind:'reject'}` — without calling `next()` |

At most **one** reminder message is appended per step. When the soft stage and a
step checkpoint fall on the same step the soft wrap-up wins — it is the more
urgent of the two — and the checkpoint is spent, logged as
`step stage: folded into the token wrap-up …`. Cost is the reason: an injected
message stays in the child's context and is re-sent on every later step, so
paying for the same advice twice is exactly the waste this plugin exists to
prevent.

Cumulative usage is

```
uncachedInputTokens + outputTokens + cacheReadTokens * cacheReadWeight + cacheWriteTokens
```

read from `ctx.get('sessionProjections')?.stateOf(agent.session, 'tokenUsage')`,
whose `totals` are cumulative over the whole session log. The **step** stage
needs no projection at all — it counts the steps this listener watched the child
enter — so a broken projection disables the token stages, not the checkpoints.

## The step checkpoints

The step trigger is the one lever a dispatcher cannot pull itself. The dispatcher
owns the *policy*: its persona tells it to put a convergence target in every
delegation prompt. But it cannot see how many steps a running child has taken.
Polling for it would re-send the dispatcher's own context — the largest in the run
(59% of the audited `adg` bill) — once per poll, costing far more than the
reminder saves, and a background child is not observable step-by-step in the
first place. So the reminder is injected here, deterministically, **on the
dispatcher's behalf**: every checkpoint message opens with
`【收敛检查点 n／N】调度代理提醒：这是你的第 N 步。` — "the dispatcher reminds you:
this is your step N".

A step is counted when the child **enters** it, so a step a downstream listener
rejected is never charged, and the count is strictly per child. The counter lives
in the same per-session state as the token flags and is released on
`subagent/end`, so a resumed child starts a fresh epoch — the same residency rule
the token soft stage uses.

The default tiers are **12 / 24 / 40**, calibrated against the audited corpus: the
22 delegated `adg` children in `D:\dsh\.dsh-token-audit\audit-report.txt` averaged
**23.4** model requests each (range 10..54). The first checkpoint therefore lands
near half of an average child and only the long tail reaches the third. The point
is to cut the tail, not to hurry the middle.

Three details exist specifically so that the checkpoints do not make answers
worse:

- **Every reminder still permits the work that is required.** Each body tells the
  child to stop *non-essential* exploration, to still perform the one remaining
  action if it is **必需** for the delivery, and to report what it has **not**
  verified rather than guessing. A checkpoint that only said "stop now" would
  trade tokens for a worse answer, which is the one trade this feature is not
  allowed to make: the unit test `stepNudgeText escalates, reuses its last body,
  and is total` pins that every body contains a 必需 clause and a 汇报 clause, so
  a future edit cannot quietly turn them into "stop".
- **The escalation is real but bounded.** Three bodies ship; the third is reused
  for any later tier while the header still reports the child's real ordinal.
  Each body is ~200–300 characters and is injected at most once per tier per
  epoch, so a child pays roughly three extra messages in total — a rounding error
  against the millions a runaway child spends.
- **`stepNudge: false` turns them off completely**, counting included, and
  restores the token stage's zero-allocation pass-through. The checkpoints are a
  separate switch from `softNudge`, which is the master switch for injection.

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
nothing usable, no token decision is made — nothing is injected or cancelled on
the token path, and the fact is logged once as
`no budget data: passing through the token stages label=…`. "No budget data" is
not "no budget". The **step** checkpoints keep working in that case, because they
read no service at all; only a test asserts that, and the live behaviour is worth
watching for on a machine whose projection service is broken.

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
| `softNudge` | `true` | Master switch for injection. `false` makes **both** reminder triggers log once instead of injecting a message (`soft stage (no nudge configured)` / `step stage (no nudge configured)`), and keeps the hard cap. The single log line IS the one-shot action, so it consumes the flag. |
| `stepNudge` | `true` | Whether the step checkpoints run. `false` disables them completely — no counting, no injection, no per-session allocation for them — leaving the token stages exactly as they were. |
| `stepTiers` | `[12, 24, 40]` | The step numbers a checkpoint fires on, ascending and de-duplicated. A bare number reads as a one-tier list. At most 16 tiers are honoured. An unusable value (`[]`, `'x'`, `[0]`) falls back to this default rather than silently switching the checkpoints off; use `stepNudge: false` for that. |
| `dryRun` | `false` | Calibration switch. Computes and logs **every** decision it would make — the soft nudge, the step checkpoints and the hard cancel — and takes no action: no message is injected, `agent.cancel` is never called, and the hard stage still delegates through `next()`. It also **consumes no once-per-epoch flag**, so arming the same session afterwards still delivers every reminder. It *does* count steps, because that count is what a checkpoint is calibrated against. |
| `hardDryRun` | `false` | Calibration switch for the destructive stage only. With `dryRun` off, the hard stage logs `dry-run hard stage: would cancel …` and delegates through, while the reminders are injected for real. This is the "arm the reminders, keep the cancels on paper" setting. Ignored while `dryRun` is on, which already covers every stage. |
| `logFile` | `null` | Absolute path; when set, the activation line plus one line per decision *event* is appended (see below). A relative path disables file logging with a warning. |

Every threshold is **inclusive**: a child exactly at `budgetTokens * softRatio`
is nudged, a child exactly at `budgetTokens` is stopped, and a tier configured as
`12` fires on the step the child enters as its 12th.

### What actually reaches `logFile`

One ISO-8601-stamped line per **event**, not one per decision. A step that
passes through untouched (the common case) writes nothing at all, so the file
stays small even for a child that runs hundreds of steps. The complete list is:

| Event | Line |
| --- | --- |
| load | `activation: active createUserMessage=<strategy> budgetTokens=… softThreshold=… softRatio=… presets=[…] cacheReadWeight=… softNudge=… stepNudge=… stepTiers=[…] dryRun=… hardDryRun=… logFile=…` — written on **every** `apply`, including `activation: inactive (enabled: false)`, so "the host loaded this plugin" is never invisible |
| load | a registration note (`registration skipped: this context already applied the plugin`, `warning: N registration(s) are already active …`) |
| soft | `soft stage: nudged …`, `soft stage (no nudge configured) …`, or `soft stage (no nudge injected: …) …` — at most once per residency epoch unless nothing was delivered |
| step | `step stage: nudged tier=<n>/<N> step=<n> usage=… budget=… label=…`, or `step stage: folded into the token wrap-up …` when the soft stage took the same step, or `step stage (no nudge configured) …`, or `step stage (no nudge injected: …) …` — at most once per tier per residency epoch unless nothing was delivered |
| hard | `hard stage: cancel usage=… budget=… label=…` |
| dry-run | `dry-run soft stage: would nudge …` / `would not nudge (…) …`, `dry-run step stage: would nudge …` / `would not nudge (…) …`, `dry-run hard stage: would cancel …` |
| settle | `settled: released session state label=<agent.id>` |
| no data | `no budget data: passing through the token stages label=…` — at most once per activation |

**A dry-run reminder line is written per *step*, not per reminder.** Because
calibration consumes no flag, a due checkpoint reports itself again on every step
at or past it, and a child over its budget reports `would cancel` on every step
until it happens to stop. So those counts mean "steps at which this decision was
due", not "children that would have been touched" and not "messages that would
have been sent" — an armed run delivers each reminder exactly once.

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
- **Bounded state.** Per-session state lives in a `Map` keyed by `agent.id`, one
  entry per live child, holding `{ steps, nudged, firedTiers }`. Its allocation
  rule is the one thing `stepNudge` changes: with the checkpoints on (the
  default) the first entered step of a governed child allocates its counter,
  because a step cannot be counted without somewhere to count it; with
  `stepNudge: false` the map is touched only by the token stage's one-shot
  action, so a pass-through step allocates nothing at all. `firedTiers` holds one
  index per tier already fired, so it is bounded by `stepTiers` (at most
  `MAX_STEP_TIERS` = 16 entries). The whole entry is released on `subagent/end`
  and cleared wholesale by a `ctx.effect` disposer, so a long-lived host cannot
  accumulate children — only one small object per *concurrently running* child.

## The reminder messages, and why they may fall back

Both triggers inject the same kind of object — the step checkpoint's
`stepNudgeText({tierIndex, tierCount, stepCount})` and the soft stage's
`NUDGE_TEXT` — as a `UserMessage`:
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

# 3. to calibrate everything first: `enabled: true`, leave `dryRun: true`
# 4. to arm the REMINDERS only:      `dryRun: false` + `hardDryRun: true`
# 5. to arm everything:              `dryRun: false` + `hardDryRun: false`
```

Step 4 is the recommended steady state until the hard cap has been calibrated on
your own traffic: the checkpoints and the token wrap-up are injected for real
while `agent.cancel` stays on paper. Step 5 should follow only once the
`would cancel` lines have been read and the budget raised above the bulk of your
own distribution — see
[Calibration: what 3,000,000 would have done](#calibration-what-3000000-would-have-done).

Steps 3–5 are `config:` edits, and this profile is `patchReload: live`, so they are
picked up **without restarting `dsh`** — the host re-applies the row and writes a
fresh `activation:` line. That is how the measured evidence in
[What has been observed live](#what-has-been-observed-live-and-what-has-not) was
produced.

**A code change is different, and this was measured rather than assumed:** the
live reload re-applies the row but does **not** re-`import` a module the process
already loaded. On 2026-09-25 the package directory was replaced with a build
carrying the step checkpoints and the row was pointed at a new `config` in the
same edit; the host re-applied the row (the new `dryRun: false` appeared in a new
`activation:` line) but the line still had the **old shape** — no `stepNudge=`,
no `stepTiers=`, no `hardDryRun=`. Node's ESM registry is keyed by resolved file
URL, and that URL had not changed. So:

- after changing **`config:` only** — no restart;
- after changing **any file under `src/`** — restart `dsh`, then confirm the new
  code is really loaded by checking that the `activation:` line carries the newer
  fields (add a field to the line whenever you add a feature; the line doubling as
  a build identifier is what makes this check possible at all).

Two consequences worth stating plainly, because they are easy to get wrong when
you are rolling this out:

1. **Until the restart, the row is read by the OLD code.** Every key the old build
   does not know is silently ignored — including a new safety key. Arming
   reminders by setting `dryRun: false` in the same edit that adds `hardDryRun:
   true` therefore arms the *cancel* on the still-loaded old build, because that
   build has never heard of `hardDryRun`. Change the code and the config in
   separate steps: deploy the code, restart, verify the new activation line, and
   only then turn `dryRun` off.
2. The `examples/cordis.patch.yml` claim "`enabled: false` ships on purpose" is
   true of the file as shipped.

To run the suite in a sandboxed shell that blocks piped stdio, use
`node --test --test-isolation=none test`: Node's default test runner spawns one
child per file with piped stdio, which such a sandbox rejects with `EPERM`. The
suite is unchanged either way; only the runner's process model differs.

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
   or a step checkpoint is logged once per residency epoch, not once per step, so
   the file stays small even for a child that sits above the ratio for a long
   time.
3. **The first decision** is echoed once to `ctx.logger.info` as
   `dsh-adg-token-budget: first decision: …`, so the host log shows activity
   without one line per step.
4. **Behaviour — the checkpoints.** A governed child at step 12 / 24 / 40
   receives a `【收敛检查点 …】` message it did not get before; the cheapest way to
   see one is to set `stepTiers: [1, 2]` on a scratch profile, where the first
   checkpoint lands on the child's first step. `step stage: nudged …` appears in
   `logFile` at the same moment.
5. **Behaviour — the token stages.** A governed child that crosses the ratio
   should wrap up and report instead of starting another investigation, and one
   that crosses the budget should come back to the dispatcher as a cancelled run
   whose result ends with `Partial output before the run ended: …`.

Set `softRatio` low (for example `0.05`) and `budgetTokens` small (for example
`20000`) on a scratch profile to exercise the token stages quickly. To calibrate
without risking a real delegation, leave `dryRun: true`: every line above is
still written, and nothing is injected or cancelled. To arm the reminders while
keeping the cancel on paper, use `dryRun: false` with `hardDryRun: true`: the
checkpoint lines appear as `step stage: nudged …` (not `dry-run …`) while the
hard stage still only writes `dry-run hard stage: would cancel …`.

## What has been observed live, and what has not

The plugin is **deployed and mounted** on this machine at
`C:\Users\cenqian\.dsh\profiles\node_modules\dsh-adg-token-budget`, mounted from
`C:\Users\cenqian\.dsh\profiles\web\cordis.patch.yml`, and a running `dsh`
loaded it. The log file `C:\Users\cenqian\.dsh\adg-token-budget.log` is the
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
`softRatio` is applied to the live cumulative figure (`would nudge` at 2,128,454
with a 2,100,000 threshold), the hard comparison is applied to the same figure
(`would cancel` at 3,014,252 against 3,000,000), and the guard is **not** armed —
no `agent.cancel` was issued for any of those children, which is precisely what
`dryRun` promises.

**The step checkpoints have no live *injection* observation, and the reason for the
gap was measured rather than assumed.** For about two minutes on 2026-09-25 the
package directory held the build documented here while the running host still held
the **previous module instance**: the row was repointed at a new `config` in the
same edit that replaced the package, the host re-applied the row (the new `dryRun`
value shows up in a new `activation:` line) yet that line still had the old shape —
no `stepNudge=`, no `stepTiers=`, no `hardDryRun=`. Node's ESM registry is keyed by
resolved file URL and that URL never changed, so a config edit hot-reloads and a
*code* edit does not. Hence, until the restart: **`step stage: nudged` had never
been written by a running host**, and neither had a `dry-run step stage: would
nudge` line, because the loaded code had no step stage at all.

That gap in the *load* is now closed — the restart at 2026-09-25T01:37:18 loaded the
new build (its activation line carries all three new fields) and the row is armed at
`dryRun: false` + `hardDryRun: true` as of 01:38:47. What remains unobserved is the
injection itself, because no governed child has run since: **the log still holds 0
lines of either step-stage kind**. A real `adg` child reaching step 12 will be the
first honest evidence, and it has not happened yet. See
[Install and enable](#install-and-enable) for the rollout this forces.

### Live calibration data (`dryRun: true`)

The live row was left at `enabled: true` + `dryRun: true` for about three hours
while real delegations ran through it. As of `2026-09-25T01:1x+08:00` the log held
479 lines / 64,995 bytes (it keeps growing — these are snapshot counts, not
constants):

| Line kind | Count |
| --- | --- |
| `activation: …` | 5 |
| `hard stage: cancel` (the one armed observation) | 1 |
| `dry-run soft stage: would nudge …` | 36 |
| `dry-run hard stage: would cancel …` | 437 |
| **`soft stage: nudged` (armed)** | **0** |
| **`step stage: nudged` / `dry-run step stage: …`** | **0** (that snapshot predates the restart that loaded the step stage) |
| **`settled: released session state …`** | **0** |

**Five** distinct `adg` children produced those dry-run lines, and every one of
them crossed the budget:

| Child | `would cancel` lines | first crossing of 3,000,000 | peak cumulative usage |
| --- | --- | --- | --- |
| `adg/f7ee3039-24a6-4f7e-94c9-b120670f2289` | **297** | 3,121,660 | **48,992,135** |
| `adg/973aca1b-820c-4c6f-9877-8f75ac134725` | 92 | 3,065,764 | 16,607,867 |
| `adg/7cfa95ae-0dad-4e08-9058-ff38c901baa5` | 27 | 3,018,602 | 6,745,603 |
| `adg/2ec8cfe5-e5d9-4c17-bf0a-1388bdb8a65a` | 18 | 3,014,252 | 6,230,057 |
| `adg/5bee9ec3-5548-490a-9e8f-6111927727cd` | 3 | 3,083,933 | 3,361,608 |

Two things fall straight out of that table, and they are the two arguments for how
this plugin is configured on this machine:

1. **3,000,000 sits inside the normal distribution** — 5 of 5 children crossed it,
   and the smallest child still reached 3.36M. Arming `agent.cancel` at this
   budget would truncate ordinary work. Hence `hardDryRun: true`.
2. **Steps, not tokens, are the lever.** The 48.99M child alone produced 297
   `would cancel` lines, i.e. roughly **300 proposed steps above the budget**,
   against an audited corpus average of **23.4 requests per child** (range 10..54).
   Three checkpoints are a rounding error beside 49M tokens — which is exactly what
   the step stage exists to exploit.

Read the counts as a measurement of *your own* traffic, and mind the unit: a
dry-run line is written **per proposed step**, so `would cancel` counts
steps-over-budget, not distinct children. It says "this child spent 297 steps past
the budget"; it does not say "297 children would have died". The armed plugin
stops the child on the first such step, which is why a real hard stop produces
exactly one line.

### What has still never been observed live

- **A real (armed) soft nudge.** Every soft observation so far is a **dry-run**
  line: the instruction is never injected in that mode, so `soft stage: nudged`
  has never been written by a running host, and neither has the loop's acceptance
  of the injected message or its rendering in the child's transcript. The soft
  stage's *decision logic* is live-measured; its *effect* is not. (The stage is
  armed since 01:38:47, but no governed child has crossed 2,100,000 since.)
- **Any step checkpoint, armed or dry.** The build that has it is loaded and the
  row is armed, but no governed child has passed step 12 since the restart, so the
  log holds **0** lines of either step-stage kind. Until one appears, the evidence
  for this stage is the suite and the mutation pass, nothing more.
- **That an injected reminder changes a child's behaviour.** This is the whole
  point of the feature and it is unmeasured: no line in this file, and no test,
  can show that a child which receives `【收敛检查点 …】` converges faster. The
  test-verified guardrails (the 必需 clause, the 汇报 clause, one message per step)
  bound what the reminder is allowed to *say*; they do not measure what it *does*.
  Watching this needs a before/after step count on comparable delegations — which
  is exactly what the `step stage: nudged` lines plus the audit rerun would give.
- **The module-reload boundary from the inside.** What was measured is the
  *symptom* (an activation line without the new fields after replacing the
  package). Whether a row removal and re-insert, or a renamed package directory,
  would force a fresh import was **not** tried — the safe conclusion is "restart".
- **A live `dryRun` hard stage reaching the end of a child** (no cancel was ever
  issued — which is itself the proof that dry-run guards the hard path).
- **What the dispatcher renders** on a real cancellation: the
  `Partial output before the run ended: …` contract is read from first-party
  source, not watched.
- **The settle edge.** `settled: released session state …` has never been
  observed, although children have now passed through the guard — the child
  cancelled at 13:53 never produced a settle line, and neither did the five
  dry-run children.
- **A `subagent/end` → resumed-child re-nudge cycle.**

Everything else in this file is a code-level fact or a unit-test result.

### Current live state

**Armed for real on 2026-09-25T01:38:47+08:00, after the restart that loaded this
build.** The live row is `enabled: true`, `budgetTokens: 3000000`,
`presets: ['adg']`, `stepNudge: true`, `stepTiers: [12, 24, 40]`, `softNudge: true`,
**`dryRun: false`**, **`hardDryRun: true`** — i.e. the step checkpoints and the token
wrap-up are injected for real, and the only stage still on paper is `agent.cancel`.

The restart is what made this safe, and the pair of activation lines is the whole
story. Before the restart, with the new package already on disk:

```
2026-09-24T17:12:18.463Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true dryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

Read its tail against the source of `activationLine`: it stops after `softNudge=…`.
That line was written by a reload that had the new `config` and the **old module** —
which is why `dryRun` had to stay `true` (the old build ignores `hardDryRun`, so
turning `dryRun` off would have armed its cancel). After the restart, the same row
was re-applied by the new build:

```
2026-09-24T17:37:18.586Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true stepNudge=true stepTiers=[12, 24, 40] dryRun=true hardDryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
2026-09-24T17:38:47.549Z activation: active createUserMessage=profile-fallback:web budgetTokens=3000000 softThreshold=2100000 softRatio=0.7 presets=[adg] cacheReadWeight=1 softNudge=true stepNudge=true stepTiers=[12, 24, 40] dryRun=false hardDryRun=true logFile='C:\Users\cenqian\.dsh\adg-token-budget.log'
```

The 17:37 line is the new build proving itself: `stepNudge=`, `stepTiers=[12, 24, 40]`
and `hardDryRun=` are present, so the step stage exists, `stepTiers` parsed into
three tiers rather than falling back, and `hardDryRun` parsed as true. The 17:38
line is the config-only hot reload that followed — **no restart**, which is the
other half of the contrast above.

What this does *not* prove: that any reminder has been injected. Load-time parsing
and arming are now measured; the injection still is not (see the previous section).

One sample of the dry-run decisions that produced the table above, including the
first line this machine ever wrote above a budget and the last line the runaway
child wrote:

```
2026-09-24T14:11:23.331Z dry-run soft stage: would nudge usage=2185852 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
2026-09-24T14:12:35.408Z dry-run hard stage: would cancel usage=3065764 budget=3000000 label=adg/973aca1b-820c-4c6f-9877-8f75ac134725
2026-09-24T14:32:48.510Z dry-run soft stage: would nudge usage=2128454 budget=3000000 label=adg/f7ee3039-24a6-4f7e-94c9-b120670f2289
2026-09-24T14:34:32.852Z dry-run hard stage: would cancel usage=3121660 budget=3000000 label=adg/f7ee3039-24a6-4f7e-94c9-b120670f2289
2026-09-24T15:10:53.160Z dry-run hard stage: would cancel usage=48992135 budget=3000000 label=adg/f7ee3039-24a6-4f7e-94c9-b120670f2289
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
  dry-run traffic in the previous section went further still: 5 of 5 governed
  children crossed the 3,000,000 budget, and one reached **48,992,135**.

That is exactly why `dryRun` exists: **calibrate against your own traffic before
arming.** With `dryRun: true`, every soft/hard decision the plugin would make is
written to `logFile` and nothing is injected or cancelled, so the file becomes a
measurement of your own distribution. Arm only once the line count at your
chosen budget is a number you can live with — and remember that the count is in
*steps*, not children (see the unit note above).

**This machine's own dry-run snapshot is blunter than the audited corpus**, and it
is the reason the live row is not armed at 3,000,000: 5 of 5 governed children
crossed the budget (3.36M at the smallest, 48.99M at the largest), the runaway
child alone spent ~300 steps above the budget, and `soft stage: nudged` stayed at
0 because everything was dry. The full table is in
[Live calibration data](#live-calibration-data-dryrun-true). **If your own log
looks like that, raise `budgetTokens` first, and arm the reminders
(`dryRun: false` + `hardDryRun: true`) before you ever arm the cancel.**

## Tests

```powershell
cd D:\dsh\adg-multi-agent\plugin\dsh-adg-token-budget
node --test test
```

**68 tests, 68 passing, 0 failing.** No dependencies beyond `node:test` and
`node:assert`, so the suite runs in a checkout that has no `node_modules` at all.
They cover: config normalization for every wrong type, including the step
checkpoints and their fallback/clamp/sort/dedupe rules; the pure decision helpers
directly (`decide` and `dueStepTier`); the top-level, foreign-preset, and
absent-preset filters; the out-of-contract depth guard at both the helper and the
listener level; the below-threshold passthrough and the zero-allocation property
of `stepNudge: false`; the soft stage's call-`next()`-first ordering,
single-nudge rule, and downstream-`reject` handling; the once-per-session flag
being consumed only after delivery; the step checkpoints firing exactly once per
tier on the tier step, per child, counting only entered steps, escalating through
their bodies, and logging every branch; the "at most one message per step" rule
and which trigger wins; `stepNudge: false` and `softNudge: false`; the hard
stage's single `cancel({kind:'parent'})` and `reject` with no `next()`;
`hardDryRun` arming the reminders while leaving the cancel dry; missing/broken/
absent projection data (where the checkpoints still work); a thrown `stateOf`; a
downstream listener that throws after delegating, and the fact that this plugin
does not turn it into a pass-through; `cacheReadWeight` flipping a case across
each threshold; `dryRun` for every stage, including that it consumes no flag but
does count steps; the load-time activation line in both the enabled and the
disabled case; a hostile logger and an unwritable `logFile`; and the per-session
map being released on both `subagent/end` and disposal.

### Mutation verification (what the suite would NOT catch)

A passing suite is only evidence if it *fails* when the behaviour it pins is
broken. Every mutation below was applied to a **fresh copy** (never to this
checkout), one behaviour per copy, followed by the suite:

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
| **M1** | count a step the downstream listener rejected | 3 |
| **M2** | let a fired tier fire again (`dueStepTier` ignores `firedTiers`) | 5 |
| **M3** | inject both reminders when both triggers are due | 1 |
| **M4** | let the step checkpoint win over the token wrap-up | 2 |
| **M5** | make `hardDryRun` cancel anyway | 1 |
| **M6** | let `stepNudge: false` still count steps | 3 |
| **M7** | evaluate the tier one step early (off-by-one) | 13 |
| **M8** | treat every decision as an entry, so rejected steps count | 4 |
| **M9** | stop sorting the tier list | 1 |
| **M10** | stop de-duplicating the tier list | 1 |
| **M11** | always inject the first checkpoint body (no escalation) | 2 |
| **M12** | return `[]` instead of the fallback tiers for unusable input | 4 |
| **M13** | drop the "必需" (required-work) clause from a checkpoint body | 1 |
| **M14** | make `dryRun` inject after all | 5 |

The fifteen `D*` rows are the pre-existing table (run under
`%TEMP%\adg-token-budget-mutations\`); the fourteen `M*` rows are the step
feature's own pass, run under `D:\dsh\.adg-step-mutations\` with
`node --test --test-isolation=none test`, and **every one of them is caught**.

M13 is the mutation that matters most for this feature's promise: it removes the
sentence that tells a child to still do the one remaining action it **needs** for
the delivery. It is caught by exactly one assertion — `stepNudgeText escalates,
reuses its last body, and is total` checks that every body contains both a 必需
clause and a 汇报 clause — which is the point: that assertion exists so a future
edit cannot quietly turn "converge" into "stop".

Four mutations from the older table are **not caught**, stated plainly rather than
buried:

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

The original harness, its per-mutation copies and the raw `node --test` output
lived under `%TEMP%\adg-token-budget-mutations\`. The step feature's pass used
`D:\dsh\.adg-step-mutations\run-mutations.ps1`, which rebuilds one mutant per
directory under `D:\dsh\.adg-step-mutations\cases\` and writes each run's raw
output beside it. Neither harness is part of this package.

## License

MIT. See `LICENSE` (also listed in `package.json`'s `files`).
