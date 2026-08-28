# Report template — how to fill it

`report-template.html` is the artifact form of step 6. It bakes in the palette, type and
the B → D → E → C → A → P ordering, so a run never re-designs the page. **Do not re-derive
the design or load `artifact-design` for a review report** — the calibration is already
done here. Reach for `artifact-design` only if the user asks for a different look.

## When to publish as an artifact

Publish when the report has enough entries that scrolling chat becomes the bottleneck
(roughly 5+ clusters), when the user asks for an artifact, or when the report is going to
be shared. A two-finding review stays in chat.

The chat message stays the summary: bucket counts, the one or two things that block the
branch, then the link. The artifact carries the full report — never make the user open it
to learn whether anything urgent was found.

## Filling it

1. Copy `report-template.html` to the scratchpad. Never edit the template in place.
2. Replace `<title>` with the scope as a name — `Escalations API and portal config`, not
   `Code Review Report`. It is the name in the artifact gallery, so it has to identify
   this run among many.
3. Header: `verdict-line` is the headline judgement in one or two sentences — what must be
   decided, and what is safe. The `runmeta` grid takes the scope, the exact diff command,
   the lens keys and the engine's `stats` counters.
4. Ledger tiles: one per bucket, counts from your triaged clusters (not the engine's raw
   `byBucket`, which is pre-triage). Keep a zero bucket as `data-empty="true"` when it was
   genuinely reviewed and came back clean; delete the tile only if the lens never ran.
5. Coverage banner: delete it when `finderFailures` and `unverified` are both 0. Otherwise
   name the dead slices, not just the count — the point is which code is under-reviewed.
6. Fill each section, delete every `EXAMPLE` block once its real entries exist, and delete
   whole sections for empty buckets (their tiles too).
7. Publish with `favicon: "🧾"`, and a one-sentence `description` naming the scope and the
   headline count. Keep both stable when redeploying the same review.

## Per-bucket rules

The bucket semantics live in `SKILL.md` step 5; this is only what each slot takes.

| Bucket | Shape         | Fields                                                                  |
| ------ | ------------- | ----------------------------------------------------------------------- |
| B      | Full entry    | Problem, then **Decision** — what there is to settle (see below)        |
| D      | Full entry    | Deviation, then **Case for the current behaviour** — both sides, always |
| E      | Full entry    | Observation, then **Why not A–D** — closest bucket and the disqualifier |
| C      | Compact entry | Trigger, then **Cost if it fires**, undiscounted by likelihood          |
| A      | Roll-up table | Location + one clause. No severity chip, no expansion                   |
| P      | Full entry    | Problem (state that it predates the branch), then fix as separate work  |

The `Decision` field lists the competing fixes and what each costs. That list is what makes
the entry a B: with only one fix on the table the cluster belongs in A (a defect whose fix
the code determines) or D (the current behaviour is defensible, so it is a judgement call).
The engine returns a single `fix` per cluster, so the alternatives are yours to supply —
if you cannot name a second one, re-bucket the cluster instead of padding the field.

Chips: one severity chip (`data-sev`), one impact chip (`data-kind="impact"`), and a
`data-kind="flag"` chip only for `plausible` or `unverified`. A entries get no chips.

`.where` holds the cluster's representative `file:line` first; roll the rest of
`occurrences` into a second span (`+2 more: …`) rather than listing every one.

Sort within B, D, E and P by severity, high first. A and C keep engine order.

## Optional live-testing section

When step 4 ran, add a section before bucket B using the same markup, and say what was
exercised and what was not (the `file_upload` gap belongs here):

```html
<section id="live">
  <div class="section-head">
    <span class="badge">▸</span>
    <h2>Exercised in the browser</h2>
    <span class="tally">3 flows</span>
  </div>
  <p class="section-note">
    What was clicked through, console included, and what was left untested.
  </p>
</section>
```

Screenshots need embedding as `data:` URIs (the artifact CSP blocks remote images) and
usually cost more than they add — describe what the console showed instead, unless the
user asked to see it.
