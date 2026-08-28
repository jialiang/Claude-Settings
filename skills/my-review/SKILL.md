---
name: my-review
description: Personal multi-agent code review. Use whenever the user asks for "my-review", "my review", "a review", to "review" changes/a PR/a diff/a file/a branch. Inline: clarify scope, partition the branch into topics, ask the user which review lenses to run (checkbox with recommendations), then launch the review-workflow.js engine (lens × topic finders → CONFIRMED/PLAUSIBLE/REFUTED verify with an A–E/P action bucket + severity/impact → root-cause clustering). The main loop then triages the clusters, optionally live-tests UI with Claude in Chrome, and writes the report ordered by attention cost. Report-only.
---

# Review

A thorough, multi-agent review of code changes. **Report-only — this skill never edits or fixes code.**

It's a **hybrid**: the deterministic find→verify→dedup engine runs as a Workflow script (`review-workflow.js`, in this skill's directory); the parts that need conversation context or interactivity — scoping, topic partitioning, final triage, live testing, the report — run inline in the main loop. The steps below are the main-loop orchestration.

## 0. Scope — ask the user (inline)

What gets reviewed changes from run to run, so **do not assume the target. Ask the user to clarify scope before doing anything** — uncommitted working-tree changes, the unpushed diff against base, a specific branch/PR, a file, or a commit range. Only skip the question if the user already named the target.

Then prepare what the engine needs:

- Resolve the exact **diff command** for the scope (`git diff @{upstream}...HEAD`, `git diff HEAD`, `git diff main...<branch>`, etc.) and confirm it produces a non-empty diff.
- Read the changed files yourself — enough to know the blast radius, the entry points and which lenses apply (e.g. no UI → no live testing).
- **Read the GLOBAL (user-level) `~/.claude/CLAUDE.md` only** and pass it as a single `{ path, content }` entry. The engine inlines it verbatim into every finder + verify prompt so your personal rules are enforced everywhere. **Do NOT inline the project/repo (or ancestor) CLAUDE.md** — it can be huge and rides on every one of the dozens of agents, so the finders read it from disk themselves when a slice needs it. (They still know the project rules; you're only saving the fixed per-agent overhead.)

## 1. Partition into topics (inline)

Cluster the changed files into a handful of **coherent topics** (by feature, route, layer or concern). This is the dilution guard: a single agent told to review a whole branch spreads its attention thin and recall drops, so each finder owns a focused slice — never the entire branch.

For each topic decide its **resolution** and set the `split` flag explicitly — the engine refuses topics without one:

- **`split: true`** — risky or large topic: the engine runs _every chosen lens_ as its own agent over that slice. This is the run's cost multiplier (finders = split topics × lenses), so reserve it for slices where a missed bug is expensive.
- **`split: false`** — one combined finder agent runs all chosen lenses as a checklist over the slice. The right call for lower-risk topics.

**Cost check before you launch.** Finder count = (split:true topics × lenses) + (split:false topics), plus a handful of verify + one consolidate agent. Each finder runs ~50–90k tokens. So a 10-lens run over 4 split topics is ~40+ finders — multiple million tokens and tens of minutes. Size `split`/`lenses` to the diff and the caller's budget, and default to **`model: "sonnet"`** for large runs (it caught the same real bugs here at a fraction of Opus's cost); reserve Opus for small, high-stakes diffs.

`model` sets the **finders**, which are the bulk of the spend. `verifyModel` and `consolidateModel` override the two judgment stages independently (both default to `model`). So a high-stakes diff can buy Opus recall on the breadth pass and still settle verdicts on Sonnet, or the reverse: cheap finders feeding an Opus judge. Pick per run.

Trivial change? It's fine to run inline without the workflow at all — the engine earns its keep on multi-file or multi-topic reviews.

## 2. Choose lenses — ask the user (inline)

The lens set is the run's cost/coverage dial, so **let the user pick it — never choose silently.** You've read the diff (step 0) and partitioned it (step 1), so you know the blast radius and can recommend well. Ask with `AskUserQuestion` using **multi-select (checkbox)** questions, pre-marking the lenses you'd recommend for _this_ diff.

Skip the ask only when the user already named the lenses or asked for a named preset ("just correctness", "full review", "style pass") — then use those verbatim. A trivial change you're running inline (no workflow, per step 1) needs no lens question.

**How to ask.** `AskUserQuestion` caps a question at 4 options, so split the ten lenses across two multi-select questions:

- **Q1 — Correctness & substantive** (multiSelect): `Correctness angles` · `Security` · `Spec & user-flow`
- **Q2 — Cosmetic / nits** (multiSelect): `Style (CLAUDE.md)` · `DRY / reuse` · `Dead code` · `Comments`

`Correctness angles` bundles the four search methods (`line-scan`, `removed-behavior`, `cross-file`, `lang-pitfalls`) — they're always run together. Map every checked box back to its exact lens key(s) for the `lenses` arg. The auto-added "Other" lets the user name individual keys or split the bundle. Keep the Q1/Q2 option lists in sync with `LENS_REGISTRY` in `review-workflow.js` (the source of truth for lens keys): a lens added there won't appear as a checkbox until it's added here too.

Lens keys carry no letter prefixes — **A–E/P are reserved for the triage buckets** (step 5), and reusing the letters for lenses made "a C finding from lens C" ambiguous in the report.

**What to recommend** — order recommended options first, append "(Recommended)" to the label and say _why_ in the question text ("Security recommended: this diff touches an API route + RLS"):

- **Always** recommend the correctness angles (all four).
- **Security** — when the diff touches a trust boundary: user input, auth, RLS/permissions, foreign-system data, secrets, PII.
- **Spec & user-flow** — when a spec exists under `docs/` for the changed area, or a user-facing flow/state changed.
- **Cosmetic lenses** — only when the user asked for a cleanup/style/nit pass. They dominate the noise on big branches and each one multiplies across every `split: true` topic.

Build the `lenses` array from the user's selection, then launch (step 3). If the user clears every box (nothing selected), don't fall through to the engine's missing-`lenses` error — confirm what they want or stop.

## 3. Launch the engine (Workflow)

Call the workflow with the prepared inputs:

```
Workflow({
  scriptPath: "~/.claude/skills/my-review/review-workflow.js",
  args: {
    target: "<verbatim user scope/instructions, or ''>",
    diffCommand: "<exact git diff command>",                    // REQUIRED
    model: "opus",                                              // REQUIRED — finders + fallback for the stages below; "inherit" = session model
    verifyModel: "sonnet",                                      // optional — verify stage only (defaults to model)
    consolidateModel: "sonnet",                                 // optional — consolidate stage only (defaults to model)
    lenses: ["line-scan", "removed-behavior", "cross-file", "lang-pitfalls", "security"],  // REQUIRED — built from the user's checkbox selection in step 2
    claudeMd: [                                                 // GLOBAL (~/.claude) CLAUDE.md ONLY — inlined into every finder/verify prompt
      { path: "~/.claude/CLAUDE.md", content: "<file contents>" }
    ],                                                          // do NOT add the project/repo CLAUDE.md — finders read it from disk
    topics: [
      { name: "escalations API", files: ["app/api/escalation/..."], summary: "...", split: true, ui: false },
      { name: "portal config UI", files: ["app/.../portal-config-hub.tsx", ...], summary: "...", split: false, ui: true }
    ]
  }
})
```

Pass `args` as a real object. (The engine self-heals a JSON-string `args` defensively, but don't rely on it.)

**Nothing defaults.** `diffCommand`, `model`, `lenses` and a boolean `split` on every topic are required. A call missing any of them returns `{ error }` without spawning a single agent — the spend level is an explicit per-run decision, never a default. Fix the args and relaunch.

The engine fans out **lens × topic** finders (every finding forced to carry a concrete `failure_scenario` via schema), dedups exact file:line collisions, runs a **one-verdict-per-candidate** verify pass (CONFIRMED / PLAUSIBLE / REFUTED, PLAUSIBLE-by-default — also tagging each survivor with an **A–E/P action `bucket`**, a `severity` and an `impact` class), then a **consolidation** pass that clusters survivors by root cause. It returns `{ findings, clusters, stats }`:

- **`clusters`** — survivors grouped by root cause (the same hole found by 5 lenses collapses to one cluster with `title`, `rootCause`, `bucket`, `severity`, `impact`, `fix`, `occurrences[]`). A cluster takes the most attention-demanding bucket among its members (B > D > E > C > A) and never mixes P with non-P. **Lead the report off clusters, not the flat list.**
- **`findings`** — the flat survivors. Both `findings` and each cluster's `occurrences` are **compact** (`file`, `line`, `summary`, `lens`, `verdict`, `bucket`, `severity`, `impact`, `why_not_abcd?`, `unverified?`) — enough to locate and rank. The **full per-finding `failure_scenario` + `evidence` live in the run's `journal.jsonl`**, not the return, so the payload stays under the tool-result cap; read the journal when you need a finding's full reasoning.
- **`stats`** — coverage-honest: `finderFailures` and `unverified` count agents that died (e.g. session limit). **If either is non-zero, coverage is incomplete — say so, and consider resuming the run (`resumeFromRunId`) before reporting.**

The lens definitions (and their exact keys) are the source of truth in `review-workflow.js`. What each lens does (step 2 covers how to pick and recommend them):

- **Correctness angles** (distinct _search methods_, complementary not overlapping): `line-scan` line-by-line incl. enclosing function · `removed-behavior` auditor (audits _deletions_) · `cross-file` tracer (greps callers) · `lang-pitfalls` language/framework footguns.
- **Substantive dimensions**: **security** (data-flow to sinks; skip theoretical noise) · **spec/user-flow**.
- **Cosmetic dimensions**: **style** (CLAUDE.md code shape, esp. vertical spacing; quote-the-rule) · **DRY** · **dead code** · **comments** (wordy/redundant/noisy/stale comments and change-narration; quote-the-rule).

To iterate on the engine, edit `review-workflow.js` and re-launch with the same `scriptPath`. To resume after an edit, pass `resumeFromRunId` from the prior run (unchanged finders return cached).

> **Resume gotcha — always re-pass `args`.** Resuming re-runs the whole wrapper script, but `resumeFromRunId` does **not** carry the original `args` (topics/diffCommand/etc.). If you resume with only `{ scriptPath, resumeFromRunId }`, the wrapper re-runs with `args === undefined` and the engine refuses with the missing-args `error`. **Resume with `{ scriptPath, resumeFromRunId, args: <the same args object> }`.** Cached agents still hit by prompt match, so only the failed finders re-run.

## 4. Live testing with Claude in Chrome (inline, when UI/flow changed)

For topics marked `ui: true`, verify the flow live rather than reasoning about it — this can't run inside the headless workflow.

- Drive **Claude in Chrome** to exercise the real flow — load the page, run the happy path and the obvious failure paths, watch console/network, take screenshots.
- **Read the console even on a flow that "looks fine"** — a clean-looking page can still log a hydration mismatch, a swallowed fetch error, or a thrown effect. These are exactly the bugs the static engine can't see (it doesn't run the code), so the console is where live testing earns its keep. Filter for `error|hydration|mismatch|failed`.
- **`file_upload` is currently broken** — it rejects host filesystem paths (and exposes no working alternative param), so you can't exercise a real file-picker upload end-to-end. Don't burn calls fighting it: verify the upload **endpoint** another way (it's usually a shared route already proven by a sibling component) and **state in the report that the picker UI itself wasn't exercised live.**
- **If Claude in Chrome misbehaves** — can't screenshot, permission denied or any tooling failure (incl. the `file_upload` case above) — **pause and notify the user. Do not work around it** (no JS-injection hacks, etc.). (Per global CLAUDE.md.) Note the gap honestly and continue with what you _can_ test.

## 5. Triage — you are the reviewer, the engine's findings are pre-verified, not final (inline)

The engine verified each finding and pre-grouped them into `clusters`, but **you, with full repo + conversation context, are the final judge.** Work from `clusters` (one entry per root cause), not the flat `findings`. Re-check anything that smells off — each verifier saw only its candidate and a slice; you see everything.

- **First, check coverage.** If `stats.finderFailures` or `stats.unverified` is non-zero, agents died (e.g. session limit) and the run is incomplete — resume it (`resumeFromRunId`) before triaging, or call out the gap explicitly. `unverified` findings are carried as PLAUSIBLE, not dropped — verify them yourself.
- **Trust the findings, distrust the severities** until re-read: the engine's `severity`/`impact` come from a slice-bound verifier. The three classic over-rates: a "missing guard" that actually lives in a sibling/render/RLS file; a path/param that looks unscoped but is re-derived safely downstream; and a **`cross-tenant` tag where every id is actually same-tenant** (e.g. an escalation/project/quote that belongs to one studio — that's `same-tenant` or plain `correctness`, not a cross-tenant leak). Re-read the full data flow, and name the two distinct tenants, before accepting a `high`.
- **Drop clusters that don't hold up**, and **merge clusters** the consolidator split (the same root cause can still surface under two topics).
- Fold in anything the engine structurally couldn't catch (cross-topic interactions, live-test results from step 4).

**Then re-judge every kept cluster's `bucket`.** The buckets sort by _what the user has to do_, not by consequence — the point is to spend their attention only where a decision is actually needed. The engine pre-assigns one; you own the final call.

- **A — clearly an issue, fix is fully determined by the code.** No design choice, no API choice, no behavior change beyond restoring evident intent. **The test: if two reasonable fixes exist, it's B, not A.** These are meant to be fixed as one batch without being read individually, so a mis-file into A is the expensive error — when in doubt, promote to B. **Size never routes a cluster out of A**: a defect this branch introduced has to be fixed regardless of how large the fix is. A fix that's large _because_ the defect predates the branch and reaches code the diff never touched is P — that's the scope call, not an effort call.
- **B — clearly an issue, but the fix needs a decision.** Carries `severity`: this is where attention gets rationed.
- **C — real mechanism, only fires under a narrow set of unlikely conditions.** Carries `severity` meaning **cost if the trigger fires**, _not_ discounted by unlikeliness — a rare path that corrupts data is `high` and should be called out, not buried. Fixed last by default, but say when a C deserves to jump the queue.
- **D — deviates from spec or convention, but the code works and the alternative is defensible.** A judgement call for the user, not a defect. Carries `severity`.
- **E — none of A–D genuinely fit.** Exists so nothing gets shoehorned. Each E must say _why_ it isn't A–D (`why_not_abcd`); an E without a reason is a classification failure — re-bucket it yourself.
- **P — the defective code is untouched by this diff** (pre-existing, e.g. an unchanged line inside a function the diff touched). **Decide scope first: P wins over A–E**, because fixing it here would pollute the branch with unrelated changes. Carries `severity` so it can be prioritised as separate work.

`verdict` and `bucket` answer different questions and must not be collapsed: `verdict` is whether the claim is _true_, `bucket` is what to _do_ about it. A CONFIRMED finding can sit in any bucket, and **C is not a synonym for PLAUSIBLE** — C means "true, but rarely reachable", PLAUSIBLE means "might not be true at all". A cluster can legitimately be CONFIRMED/C or PLAUSIBLE/A.

The `impact` class stays a prior, not a verdict: a _confirmed_ `cross-tenant` leak is `high` severity, but only after you've verified it crosses two distinct tenants — a mistagged same-tenant id is usually just `correctness`.

## 6. Report (inline)

Present a single triaged report, **one entry per cluster** (not per raw finding). Lead with the count per bucket.

**Order the report by attention cost, not by severity: B → D → E → C → A → P.** Decisions first, the batch-fixable pile and out-of-scope work last. Within B, D, E and P, sort `high` → `medium` → `low`.

- **B, D, E, P** get a full entry each: representative `file:line` (cite the cluster's `occurrences`), severity, the problem, the suggested fix. For **B**, state the competing fixes and what each costs — B _is_ the two-reasonable-fixes bucket (step 5), so if only one fix is on the table the cluster is A (defect, fix determined by the code) or D (the current behaviour is defensible); re-bucket it rather than padding the entry. For **D**, state the deviation _and_ the case for what the code currently does — it's a choice, so present both sides. For **E**, include `why_not_abcd`. For **P**, say plainly that it predates the branch and is out of scope to fix here.
- **A collapses to a roll-up**: one line per cluster (`file:line` + one-clause summary) under a single heading with the total, no severity, no expanded reasoning. The user isn't reading these individually — the list exists so they can spot-check the batch and say go.
- **C** gets a compact entry each: the narrow trigger, and the cost if it fires. Flag any C whose severity is `high` explicitly rather than leaving it at the bottom of the list.

Mark any cluster the engine returned as **PLAUSIBLE** (rather than CONFIRMED) so the user knows the claim itself is uncertain — distinct from a C, where the claim is solid and the _trigger_ is narrow. Flag any **`unverified`** finding (verify didn't complete) plus any coverage gap from `stats`.

**Publishing as an artifact.** For a report big enough that chat scrolling gets in the way (~5+ clusters), or when the user asks for one, fill `report-template.html` from this skill's directory — the design, the bucket ordering and the per-slot rules are already settled there, so **don't design a page from scratch and don't load `artifact-design` for it.** `report-template.md` (same directory) is the fill guide. Copy the template to the scratchpad, fill it, publish. The chat message still carries the bucket counts and the blocking findings — the link never replaces the summary.

**Report only — never apply fixes, including bucket A.** A is a batch the user approves as a batch; the report ends with the offer, and fixing is a separate explicit step afterward so the whole report stays vettable in the main chat.
