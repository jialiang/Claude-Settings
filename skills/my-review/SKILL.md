---
name: my-review
description: Personal multi-agent code review. Use whenever the user asks for "my-review", "my review", "a review", to "review" changes/a PR/a diff/a file/a branch. Inline: clarify scope, partition the branch into topics, ask the user which review lenses to run (checkbox with recommendations), then launch the review-workflow.js engine (lens × topic finders → CONFIRMED/PLAUSIBLE/REFUTED verify with severity/impact → root-cause clustering). The main loop then triages the clusters, optionally live-tests UI with Claude in Chrome, and writes the report. Report-only.
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

- **`split: true`** — risky or large topic: the engine runs *every chosen lens* as its own agent over that slice. This is the run's cost multiplier (finders = split topics × lenses), so reserve it for slices where a missed bug is expensive.
- **`split: false`** — one combined finder agent runs all chosen lenses as a checklist over the slice. The right call for lower-risk topics.

**Cost check before you launch.** Finder count = (split:true topics × lenses) + (split:false topics), plus a handful of verify + one consolidate agent. Each finder runs ~50–90k tokens. So a 10-lens run over 4 split topics is ~40+ finders — multiple million tokens and tens of minutes. Size `split`/`lenses` to the diff and the caller's budget, and default to **`model: "sonnet"`** for large runs (it caught the same real bugs here at a fraction of Opus's cost); reserve Opus for small, high-stakes diffs.

Trivial change? It's fine to run inline without the workflow at all — the engine earns its keep on multi-file or multi-topic reviews.

## 2. Choose lenses — ask the user (inline)

The lens set is the run's cost/coverage dial, so **let the user pick it — never choose silently.** You've read the diff (step 0) and partitioned it (step 1), so you know the blast radius and can recommend well. Ask with `AskUserQuestion` using **multi-select (checkbox)** questions, pre-marking the lenses you'd recommend for *this* diff.

Skip the ask only when the user already named the lenses or asked for a named preset ("just correctness", "full review", "style pass") — then use those verbatim. A trivial change you're running inline (no workflow, per step 1) needs no lens question.

**How to ask.** `AskUserQuestion` caps a question at 4 options, so split the ten lenses across two multi-select questions:

- **Q1 — Correctness & substantive** (multiSelect): `Correctness angles (A–D)` · `Security` · `Spec & user-flow`
- **Q2 — Cosmetic / nits** (multiSelect): `Style (CLAUDE.md)` · `DRY / reuse` · `Dead code` · `File size`

`Correctness angles (A–D)` bundles the four search methods (`A:line-scan`, `B:removed-behavior`, `C:cross-file`, `D:lang-pitfalls`) — they're always run together. Map every checked box back to its exact lens key(s) for the `lenses` arg. The auto-added "Other" lets the user name individual keys or split the bundle. Keep the Q1/Q2 option lists in sync with `LENS_REGISTRY` in `review-workflow.js` (the source of truth for lens keys): a lens added there won't appear as a checkbox until it's added here too.

**What to recommend** — order recommended options first, append "(Recommended)" to the label and say *why* in the question text ("Security recommended: this diff touches an API route + RLS"):

- **Always** recommend the correctness angles (A–D).
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
    model: "opus",                                              // REQUIRED — or "inherit" for the session model
    lenses: ["A:line-scan", "B:removed-behavior", "C:cross-file", "D:lang-pitfalls", "security"],  // REQUIRED — built from the user's checkbox selection in step 2
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

The engine fans out **lens × topic** finders (every finding forced to carry a concrete `failure_scenario` via schema), dedups exact file:line collisions, runs a **one-verdict-per-candidate** verify pass (CONFIRMED / PLAUSIBLE / REFUTED, PLAUSIBLE-by-default — now also tagging each survivor with `severity` and an `impact` class), then a **consolidation** pass that clusters survivors by root cause. It returns `{ findings, clusters, stats }`:

- **`clusters`** — survivors grouped by root cause (the same hole found by 5 lenses collapses to one cluster with `title`, `rootCause`, `severity`, `impact`, `fix`, `occurrences[]`). **Lead the report off clusters, not the flat list.**
- **`findings`** — the flat survivors. Both `findings` and each cluster's `occurrences` are **compact** (`file`, `line`, `summary`, `lens`, `verdict`, `severity`, `impact`, `unverified?`) — enough to locate and rank. The **full per-finding `failure_scenario` + `evidence` live in the run's `journal.jsonl`**, not the return, so the payload stays under the tool-result cap; read the journal when you need a finding's full reasoning.
- **`stats`** — coverage-honest: `finderFailures` and `unverified` count agents that died (e.g. session limit). **If either is non-zero, coverage is incomplete — say so, and consider resuming the run (`resumeFromRunId`) before reporting.**

The lens definitions (and their exact keys) are the source of truth in `review-workflow.js`. What each lens does (step 2 covers how to pick and recommend them):

- **Correctness angles** (distinct *search methods*, complementary not overlapping): **A** line-by-line scan incl. enclosing function · **B** removed-behavior auditor (audits *deletions*) · **C** cross-file tracer (greps callers) · **D** language/framework pitfalls.
- **Substantive dimensions**: **security** (data-flow to sinks; skip theoretical noise) · **spec/user-flow**.
- **Cosmetic dimensions**: **style** (CLAUDE.md, esp. comments + vertical spacing; quote-the-rule) · **DRY** · **dead code** · **file-size/structure** (flag files ≫200 lines that should *and* can split cleanly).

To iterate on the engine, edit `review-workflow.js` and re-launch with the same `scriptPath`. To resume after an edit, pass `resumeFromRunId` from the prior run (unchanged finders return cached).

> **Resume gotcha — always re-pass `args`.** Resuming re-runs the whole wrapper script, but `resumeFromRunId` does **not** carry the original `args` (topics/diffCommand/etc.). If you resume with only `{ scriptPath, resumeFromRunId }`, the wrapper re-runs with `args === undefined` and the engine refuses with the missing-args `error`. **Resume with `{ scriptPath, resumeFromRunId, args: <the same args object> }`.** Cached agents still hit by prompt match, so only the failed finders re-run.

## 4. Live testing with Claude in Chrome (inline, when UI/flow changed)

For topics marked `ui: true`, verify the flow live rather than reasoning about it — this can't run inside the headless workflow.

- Drive **Claude in Chrome** to exercise the real flow — load the page, run the happy path and the obvious failure paths, watch console/network, take screenshots.
- **Read the console even on a flow that "looks fine"** — a clean-looking page can still log a hydration mismatch, a swallowed fetch error, or a thrown effect. These are exactly the bugs the static engine can't see (it doesn't run the code), so the console is where live testing earns its keep. Filter for `error|hydration|mismatch|failed`.
- **`file_upload` is currently broken** — it rejects host filesystem paths (and exposes no working alternative param), so you can't exercise a real file-picker upload end-to-end. Don't burn calls fighting it: verify the upload **endpoint** another way (it's usually a shared route already proven by a sibling component) and **state in the report that the picker UI itself wasn't exercised live.**
- **If Claude in Chrome misbehaves** — can't screenshot, permission denied or any tooling failure (incl. the `file_upload` case above) — **pause and notify the user. Do not work around it** (no JS-injection hacks, etc.). (Per global CLAUDE.md.) Note the gap honestly and continue with what you *can* test.

## 5. Triage — you are the reviewer, the engine's findings are pre-verified, not final (inline)

The engine verified each finding and pre-grouped them into `clusters`, but **you, with full repo + conversation context, are the final judge.** Work from `clusters` (one entry per root cause), not the flat `findings`. Re-check anything that smells off — each verifier saw only its candidate and a slice; you see everything.

- **First, check coverage.** If `stats.finderFailures` or `stats.unverified` is non-zero, agents died (e.g. session limit) and the run is incomplete — resume it (`resumeFromRunId`) before triaging, or call out the gap explicitly. `unverified` findings are carried as PLAUSIBLE, not dropped — verify them yourself.
- **Trust the findings, distrust the severities** until re-read: the engine's `severity`/`impact` come from a slice-bound verifier. The three classic over-rates: a "missing guard" that actually lives in a sibling/render/RLS file; a path/param that looks unscoped but is re-derived safely downstream; and a **`cross-tenant` tag where every id is actually same-tenant** (e.g. an escalation/project/quote that belongs to one studio — that's `same-tenant` or plain `correctness`, not a cross-tenant leak). Re-read the full data flow, and name the two distinct tenants, before accepting a HIGH.
- **Drop clusters that don't hold up**, and **merge clusters** the consolidator split (the same root cause can still surface under two topics).
- Fold in anything the engine structurally couldn't catch (cross-topic interactions, live-test results from step 4).
- **Sort every kept cluster into one of three buckets** (the `impact` class is a prior, not a verdict: a *confirmed* `cross-tenant` leak is High, but only after you've verified it crosses two distinct tenants — a mistagged same-tenant id is usually just `correctness`):
  - **High** — security/auth gaps, data loss, broken core flow, correctness bugs, spec violations.
  - **Medium** — DRY/reuse problems, dead code, real code-style violations.
  - **Low** — minor polish and nits.

## 6. Report (inline)

Present a single triaged report, grouped High → Medium → Low, **one entry per cluster** (not per raw finding). Lead with the count per bucket, then each issue — representative file:line (cite the cluster's `occurrences`), the problem, the suggested fix. Mark any finding the engine returned as **PLAUSIBLE** (rather than CONFIRMED) so the user knows the trigger is uncertain, and flag any **`unverified`** finding (verify didn't complete) plus any coverage gap from `stats`.

**Report only — never apply fixes.** This skill surfaces findings; fixing is a separate, explicit step the user requests afterward.
