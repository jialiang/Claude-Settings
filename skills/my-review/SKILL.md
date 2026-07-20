---
name: my-review
description: Personal multi-agent code review. Use whenever the user asks for "my-review", "my review", "a review", to "review" changes/a PR/a diff/a file/a branch. Inline: clarify scope, partition the branch into topics, then launch the review-workflow.js engine (lens × topic finders → CONFIRMED/PLAUSIBLE/REFUTED verify with severity/impact → root-cause clustering). The main loop then triages the clusters, optionally live-tests UI with Claude in Chrome, and writes the report. Report-only.
---

# Review

A thorough, multi-agent review of code changes. **Report-only — this skill never edits or fixes code.**

It's a **hybrid**: the deterministic find→verify→dedup engine runs as a Workflow script (`review-workflow.js`, in this skill's directory); the parts that need conversation context or interactivity — scoping, topic partitioning, final triage, live testing, the report — run inline in the main loop. The steps below are the main-loop orchestration.

## 0. Scope — ask the user (inline)

What gets reviewed changes from run to run, so **do not assume the target. Ask the user to clarify scope before doing anything** — uncommitted working-tree changes, the unpushed diff against base, a specific branch/PR, a file, or a commit range. Only skip the question if the user already named the target.

Then prepare what the engine needs:

- Resolve the exact **diff command** for the scope (`git diff @{upstream}...HEAD`, `git diff HEAD`, `git diff main...<branch>`, etc.) and confirm it produces a non-empty diff.
- Read the changed files yourself — enough to know the blast radius, the entry points and which lenses apply (e.g. no UI → no live testing).
- List the applicable **CLAUDE.md** files (user-level `~/.claude/CLAUDE.md`, repo-root, plus any in an ancestor dir of a changed file).

## 1. Partition into topics (inline)

Cluster the changed files into a handful of **coherent topics** (by feature, route, layer or concern). This is the dilution guard: a single agent told to review a whole branch spreads its attention thin and recall drops, so each finder owns a focused slice — never the entire branch.

For each topic decide its **resolution** and set the `split` flag explicitly — the engine refuses topics without one:

- **`split: true`** — risky or large topic: the engine runs *every chosen lens* as its own agent over that slice. This is the run's cost multiplier (finders = split topics × lenses), so reserve it for slices where a missed bug is expensive.
- **`split: false`** — one combined finder agent runs all chosen lenses as a checklist over the slice. The right call for lower-risk topics.

Trivial change? It's fine to run inline without the workflow at all — the engine earns its keep on multi-file or multi-topic reviews.

## 2. Launch the engine (Workflow)

Call the workflow with the prepared inputs:

```
Workflow({
  scriptPath: "~/.claude/skills/my-review/review-workflow.js",
  args: {
    target: "<verbatim user scope/instructions, or ''>",
    diffCommand: "<exact git diff command>",                    // REQUIRED
    model: "opus",                                              // REQUIRED — or "inherit" for the session model
    lenses: ["A:line-scan", "B:removed-behavior", "C:cross-file", "D:lang-pitfalls", "security"],  // REQUIRED — pick per run, see below
    claudeMd: ["~/.claude/CLAUDE.md", "<repo>/CLAUDE.md", ...],
    topics: [
      { name: "escalations API", files: ["app/api/escalation/..."], summary: "...", split: true, ui: false },
      { name: "portal config UI", files: ["app/.../portal-config-hub.tsx", ...], summary: "...", split: false, ui: true }
    ]
  }
})
```

Pass `args` as a real object. (The engine self-heals a JSON-string `args` defensively, but don't rely on it.)

**Nothing defaults.** `diffCommand`, `model`, `lenses` and a boolean `split` on every topic are required. A call missing any of them returns `{ error }` without spawning a single agent — the spend level is an explicit per-run decision, never a default. Fix the args and relaunch.

The engine fans out **lens × topic** finders (every finding forced to carry a concrete `failure_scenario` via schema), dedups exact file:line collisions, runs a **one-verdict-per-candidate** verify pass (CONFIRMED / PLAUSIBLE / REFUTED, PLAUSIBLE-by-default — now also tagging each survivor with `severity` and an `impact` class), then a **consolidation** pass that clusters survivors by root cause. It returns `{ findings, clusters, stats }`:

- **`clusters`** — survivors grouped by root cause (the same hole found by 5 lenses collapses to one cluster with `title`, `rootCause`, `severity`, `impact`, `fix`, `occurrences[]`). **Lead the report off clusters, not the flat list.**
- **`findings`** — the flat pre-verified survivors (each with `verdict`/`severity`/`impact`; `unverified: true` when verify couldn't run).
- **`stats`** — coverage-honest: `finderFailures` and `unverified` count agents that died (e.g. session limit). **If either is non-zero, coverage is incomplete — say so, and consider resuming the run (`resumeFromRunId`) before reporting.**

**Choosing lenses — you decide, per run.** There is no always-on set and no auto-gating. Match the set to what the user asked for:

- Logic/correctness review → the four correctness angles (`A:line-scan`, `B:removed-behavior`, `C:cross-file`, `D:lang-pitfalls`); add `security` only when the change touches a trust boundary (user input, auth, external data).
- Full review → correctness angles + `security` + `spec-flow`.
- Cleanup/style pass → `style`, `dry`, `dead-code`, `file-size`. These dominate the noise on big branches — include them only when the user actually wants nits, and remember every one multiplies across every `split: true` topic.

The lens definitions (and their exact keys) are the source of truth in `review-workflow.js`. Conceptually:

- **Correctness angles** (distinct *search methods*, complementary not overlapping): **A** line-by-line scan incl. enclosing function · **B** removed-behavior auditor (audits *deletions*) · **C** cross-file tracer (greps callers) · **D** language/framework pitfalls.
- **Substantive dimensions**: **security** (data-flow to sinks; skip theoretical noise) · **spec/user-flow**.
- **Cosmetic dimensions**: **style** (CLAUDE.md, esp. comments + vertical spacing; quote-the-rule) · **DRY** · **dead code** · **file-size/structure** (flag files ≫200 lines that should *and* can split cleanly).

To iterate on the engine, edit `review-workflow.js` and re-launch with the same `scriptPath`. To resume after an edit, pass `resumeFromRunId` from the prior run (unchanged finders return cached).

> **Resume gotcha — always re-pass `args`.** Resuming re-runs the whole wrapper script, but `resumeFromRunId` does **not** carry the original `args` (topics/diffCommand/etc.). If you resume with only `{ scriptPath, resumeFromRunId }`, the wrapper re-runs with `args === undefined` and the engine refuses with the missing-args `error`. **Resume with `{ scriptPath, resumeFromRunId, args: <the same args object> }`.** Cached agents still hit by prompt match, so only the failed finders re-run.

## 3. Live testing with Claude in Chrome (inline, when UI/flow changed)

For topics marked `ui: true`, verify the flow live rather than reasoning about it — this can't run inside the headless workflow.

- Drive **Claude in Chrome** to exercise the real flow — load the page, run the happy path and the obvious failure paths, watch console/network, take screenshots.
- **Read the console even on a flow that "looks fine"** — a clean-looking page can still log a hydration mismatch, a swallowed fetch error, or a thrown effect. These are exactly the bugs the static engine can't see (it doesn't run the code), so the console is where live testing earns its keep. Filter for `error|hydration|mismatch|failed`.
- **`file_upload` is currently broken** — it rejects host filesystem paths (and exposes no working alternative param), so you can't exercise a real file-picker upload end-to-end. Don't burn calls fighting it: verify the upload **endpoint** another way (it's usually a shared route already proven by a sibling component) and **state in the report that the picker UI itself wasn't exercised live.**
- **If Claude in Chrome misbehaves** — can't screenshot, permission denied or any tooling failure (incl. the `file_upload` case above) — **pause and notify the user. Do not work around it** (no JS-injection hacks, etc.). (Per global CLAUDE.md.) Note the gap honestly and continue with what you *can* test.

## 4. Triage — you are the reviewer, the engine's findings are pre-verified, not final (inline)

The engine verified each finding and pre-grouped them into `clusters`, but **you, with full repo + conversation context, are the final judge.** Work from `clusters` (one entry per root cause), not the flat `findings`. Re-check anything that smells off — each verifier saw only its candidate and a slice; you see everything.

- **First, check coverage.** If `stats.finderFailures` or `stats.unverified` is non-zero, agents died (e.g. session limit) and the run is incomplete — resume it (`resumeFromRunId`) before triaging, or call out the gap explicitly. `unverified` findings are carried as PLAUSIBLE, not dropped — verify them yourself.
- **Trust the findings, distrust the severities** until re-read: the engine's `severity`/`impact` come from a slice-bound verifier. The two classic over-rates are a "missing guard" that actually lives in a sibling/render/RLS file, and a path/param that looks unscoped but is re-derived safely downstream. Re-read the full data flow before accepting a HIGH.
- **Drop clusters that don't hold up**, and **merge clusters** the consolidator split (the same root cause can still surface under two topics).
- Fold in anything the engine structurally couldn't catch (cross-topic interactions, live-test results from step 3).
- **Sort every kept cluster into one of three buckets** (use the `impact` class as a strong prior — `cross-tenant` is almost always High):
  - **High** — security/auth gaps, data loss, broken core flow, correctness bugs, spec violations.
  - **Medium** — DRY/reuse problems, dead code, real code-style violations.
  - **Low** — minor polish and nits.

## 5. Report (inline)

Present a single triaged report, grouped High → Medium → Low, **one entry per cluster** (not per raw finding). Lead with the count per bucket, then each issue — representative file:line (cite the cluster's `occurrences`), the problem, the suggested fix. Mark any finding the engine returned as **PLAUSIBLE** (rather than CONFIRMED) so the user knows the trigger is uncertain, and flag any **`unverified`** finding (verify didn't complete) plus any coverage gap from `stats`.

**Report only — never apply fixes.** This skill surfaces findings; fixing is a separate, explicit step the user requests afterward.
