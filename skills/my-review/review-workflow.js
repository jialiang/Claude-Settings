export const meta = {
  name: 'my-review-engine',
  description: 'Find→verify→cluster engine for my-review: fans out the caller-chosen lenses per topic, verifies each candidate with a CONFIRMED/PLAUSIBLE/REFUTED verdict ladder (+ severity/impact), clusters survivors by root cause, returns them for the main loop to triage',
  phases: [
    { title: 'Find', detail: 'lens × topic finders surface candidates' },
    { title: 'Verify', detail: 'one verdict + severity/impact per candidate; drop REFUTED' },
    { title: 'Consolidate', detail: 'cluster survivors by root cause' }
  ]
}

// Contract — args passed by the main loop (which has already asked the user
// for scope, partitioned the branch into topics and CHOSEN the lens set).
// NOTHING DEFAULTS SILENTLY: the engine refuses to run unless the caller
// spells out the diff command, the model, the lens set and a split decision
// for every topic. The cost of a run is lenses × split topics — that spend is
// a per-run decision the caller must own, not something a default picks.
//   {
//     target:      string,    // verbatim user scope/instructions, or ""
//     diffCommand: string,    // REQUIRED — exact git diff command a reviewer runs
//     model:       string,    // REQUIRED — model for every engine agent (e.g.
//                             // 'opus'), or 'inherit' for the session model
//     lenses:      string[],  // REQUIRED — lens keys to run, from LENS_REGISTRY
//     claudeMd:    string[],  // applicable CLAUDE.md paths (user + repo + ancestors)
//     topics: [{
//       name:   string,
//       files:  string[],     // changed files in this topic's slice
//       summary:string,
//       split:  boolean,      // REQUIRED — true: one agent PER lens over this
//                             // slice; false: one combined finder for the slice
//       ui?:    boolean       // hint only; live testing happens in the main loop
//     }]
//   }
// Returns: { findings, clusters, stats } — bucketing/report is the main loop's
// job. On a bad call returns { findings: [], clusters: [], stats, error }
// without spawning anything — fix the args and relaunch.

// Args may arrive as a real object or (depending on the caller) a JSON string —
// self-heal rather than silently reviewing nothing.
function parseArgs(a) {
  if (a && typeof a === 'object') return a
  if (typeof a === 'string') {
    try {
      return JSON.parse(a)
    } catch (err) {
      log(`args was a string but not valid JSON (${err.message}) — treating as empty`)
      return {}
    }
  }
  return {}
}

const A = parseArgs(args)
const TARGET = A.target || ''
const DIFF_CMD = A.diffCommand
const CLAUDE_MD = A.claudeMd || []
const TOPICS = A.topics || []
const LENS_KEYS = A.lenses
const MODEL = A.model === 'inherit' ? undefined : A.model

// Every lens the engine knows. The caller picks explicitly; there is no
// always-on tier and no auto-gating. Grouped for the caller's convenience:
// correctness angles (distinct search methods), substantive dimensions,
// cosmetic dimensions.
const LENS_REGISTRY = [
  {
    key: 'A:line-scan',
    text: 'Read every hunk line by line AND the enclosing function (bugs in unchanged lines of a touched function are in scope). For each line ask what input/state/timing/platform makes it wrong: inverted/wrong conditions, off-by-one, null/undefined deref, missing await, falsy-zero checks, wrong-variable copy-paste, errors swallowed in catch, unescaped regex metachars.'
  },
  {
    key: 'B:removed-behavior',
    text: 'For every line the diff DELETES or replaces, name the invariant or behavior it enforced, then find where the new code re-establishes it. If you cannot find it, that is a finding: a dropped guard, removed error path, narrowed validation, or a deleted test that covered a real case.'
  },
  {
    key: 'C:cross-file',
    text: 'For each function/symbol the diff changes, Grep its callers and check the change does not break them: a new return shape, a new thrown exception, changed nullability, or a timing/ordering dependency a parallel change introduced.'
  },
  {
    key: 'D:lang-pitfalls',
    text: "Scan for the classic footguns of this stack: JS falsy-zero, == coercion, closure-captured loop var, floating-point equality, timezone/DST drift, React hook-after-return / stale closure / missing useEffect cleanup. Flag any instance the diff introduces."
  },
  {
    key: 'security',
    text: 'Auth/authorization gaps, RLS/permission bypass, injection, unvalidated foreign-system payloads, secret leakage, PII in logs/analytics, missing boundary validation. Trace data flow from user input → sensitive sink; give an exploit scenario. Do NOT flag theoretical/no-impact issues (DOS/resource exhaustion, theoretical races, outdated deps, log spoofing, lack-of-hardening absent a concrete vuln).'
  },
  {
    key: 'spec-flow',
    text: 'Does the change match its spec (if one exists under docs/)? Does the user flow make sense end to end — states, transitions, empty/loading/error states, navigation, failure paths?'
  },
  {
    key: 'style',
    text: 'Conform to the CLAUDE.md files in scope, especially comments (no noise/restatement, no change-narration like "// removed X", no banner/separator comments, comment why not what, no stale comments) and vertical spacing (blank lines separate logical groups; nested blocks get a blank line before/after when adjacent to siblings; flag both packed AND overly-sparse code). Also guard clauses over if/else, flat control flow, no horizontal alignment, no Oxford comma. QUOTE THE RULE: only flag when you can quote the exact CLAUDE.md rule AND the exact line that breaks it.'
  },
  {
    key: 'dry',
    text: 'Duplicated logic and reimplemented utilities that already exist (formatters, UI primitives, hooks, shared helpers); copy-paste that should be extracted. Name the existing thing that should have been reused.'
  },
  {
    key: 'dead-code',
    text: 'Unused vars/imports/exports/branches, unreachable paths, leftover scaffolding, commented-out blocks, props/params nothing consumes.'
  },
  {
    key: 'file-size',
    text: 'Flag any file significantly over ~200 lines. For each, judge whether it SHOULD be broken down (distinct visual sections, mixed concerns, a .map() rendering complex cards) and whether it CAN be split cleanly (presentational extraction) vs tightly-coupled state where splitting just creates prop-drilling churn. Only flag when a clean, worthwhile split exists.'
  }
]

// Fail fast on anything implicit. Refusing to guess is the point: the caller
// owns the spend decision, so a vague call gets an error, not a default.
const problems = []

if (!DIFF_CMD) problems.push('diffCommand is required — the exact git diff command for the scope')
if (!A.model) problems.push("model is required — e.g. 'opus', or 'inherit' for the session model")
if (!TOPICS.length) problems.push('topics is required — at least one topic slice')

if (!Array.isArray(LENS_KEYS) || !LENS_KEYS.length) {
  problems.push(`lenses is required — pick explicitly from: ${LENS_REGISTRY.map(l => l.key).join(', ')}`)
} else {
  const unknown = LENS_KEYS.filter(k => !LENS_REGISTRY.some(l => l.key === k))
  if (unknown.length) problems.push(`unknown lens key(s): ${unknown.join(', ')} — valid: ${LENS_REGISTRY.map(l => l.key).join(', ')}`)
}

const unsplit = TOPICS.filter(t => typeof t.split !== 'boolean')
if (unsplit.length) problems.push(`every topic needs an explicit split boolean; missing on: ${unsplit.map(t => t.name || '(unnamed)').join(', ')}`)

if (problems.length) {
  return {
    findings: [],
    clusters: [],
    stats: { topics: TOPICS.length, finders: 0, candidates: 0, survivors: 0, unverified: 0, finderFailures: 0, clusters: 0 },
    error: 'Refusing to run with implicit defaults:\n- ' + problems.join('\n- ')
  }
}

const ACTIVE_LENSES = LENS_KEYS.map(k => LENS_REGISTRY.find(l => l.key === k))

// split: true → one finder PER chosen lens; split: false → one combined finder
// running every chosen lens as a checklist over the slice.
function lensesForTopic(t) {
  if (t.split) return ACTIVE_LENSES
  return [{ key: 'all', text: ACTIVE_LENSES.map(l => `- ${l.key}: ${l.text}`).join('\n') }]
}

const FINDER_ITEMS = TOPICS.flatMap(t =>
  lensesForTopic(t).map(lens => ({ topic: t, lens }))
)

log(
  `${TOPICS.length} topic(s), ${FINDER_ITEMS.length} finder(s), lenses: [${LENS_KEYS.join(', ')}], model: ${A.model} over: ${DIFF_CMD}`
)

const SCOPE_BLOCK =
  `Diff command: ${DIFF_CMD}\n` +
  (TARGET ? `User scope/instructions (verbatim): "${TARGET}"\n` : '') +
  `Applicable CLAUDE.md: ${CLAUDE_MD.length ? CLAUDE_MD.join(', ') : '(none)'}\n`

const CANDIDATES_SCHEMA = {
  type: 'object',
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'summary', 'failure_scenario'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string', description: 'one-sentence statement of the problem' },
          failure_scenario: { type: 'string', description: 'concrete inputs/state → wrong output/crash, OR the concrete cost / exact rule broken for non-runtime findings' },
          fix: { type: 'string', description: 'suggested fix' }
        }
      }
    }
  }
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'severity', 'impact', 'evidence'],
  properties: {
    verdict: { enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    severity: { enum: ['high', 'medium', 'low'], description: 'high=security/data-loss/broken-core/correctness; medium=DRY/dead-code/real-style; low=polish' },
    impact: { enum: ['cross-tenant', 'same-tenant', 'correctness', 'style'], description: 'blast radius class of the failure' },
    evidence: { type: 'string', description: 'the line(s) that confirm or disprove it' }
  }
}

const CLUSTER_SCHEMA = {
  type: 'object',
  required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'impact', 'members'],
        properties: {
          title: { type: 'string', description: 'short name for the root-cause issue' },
          rootCause: { type: 'string', description: 'the single underlying cause the members share' },
          severity: { enum: ['high', 'medium', 'low'], description: 'highest severity among the members' },
          impact: { enum: ['cross-tenant', 'same-tenant', 'correctness', 'style'] },
          fix: { type: 'string', description: 'the one fix that resolves all members' },
          members: { type: 'array', items: { type: 'number' }, description: 'indexes into the findings list that share this root cause' }
        }
      }
    }
  }
}

function findPrompt(item) {
  return (
    `You are a code-review finder. Review only the "${item.topic.name}" slice of this change.\n\n` +
    `${SCOPE_BLOCK}\n` +
    `Files in this slice:\n${item.topic.files.map(f => `  - ${f}`).join('\n')}\n` +
    `Slice summary: ${item.topic.summary}\n\n` +
    `Run the diff command (or read the files directly) and apply this lens:\n${item.lens.text}\n\n` +
    `Every candidate MUST carry a concrete failure_scenario — the specific input/state/timing that makes it wrong and the resulting wrong output/crash. For non-runtime findings, state the concrete cost or quote the exact rule broken. Drop anything you cannot give a failure_scenario for. Return structured output only; do not edit anything.`
  )
}

function verifyPrompt(c) {
  return (
    `Verify this code-review candidate against the actual code. Read the cited file and its context.\n\n` +
    `${SCOPE_BLOCK}\n` +
    `Candidate: ${c.file}${c.line ? ':' + c.line : ''} — ${c.summary}\n` +
    `Claimed failure: ${c.failure_scenario}\n\n` +
    `BEFORE you confirm, trace the data flow BOTH directions across files: for any "missing X" finding (missing validation/guard/sanitize/ownership-check), Grep for X in the sibling routes, the render/consumer side, the RLS policies and the shared helpers. A guard that lives in another file REFUTES the finding — the finder only saw one slice and cannot see it.\n\n` +
    `Return exactly one verdict, plus a severity and an impact class:\n` +
    `- CONFIRMED — you can name the inputs/state that trigger it and the wrong output/crash. Quote the line.\n` +
    `- PLAUSIBLE — the mechanism is real but the trigger is uncertain (timing, env, config, rare-but-reachable path). State what would confirm it.\n` +
    `- REFUTED — factually wrong (code doesn't say that) or already guarded elsewhere (quote the guard you found). \n\n` +
    `severity: high (security/auth, data loss, broken core flow, correctness bug, spec violation) | medium (DRY/reuse, dead code, real style violation) | low (polish/nit).\n` +
    `impact: cross-tenant (one tenant reaches another's data/actions) | same-tenant (within-tenant integrity/privilege) | correctness (wrong output/crash, single user) | style (no observable runtime effect).\n\n` +
    `PLAUSIBLE is the default, NOT REFUTED. Do not refute for being "speculative" when the state is realistic (concurrency races, null on a rare path, falsy-zero, off-by-one on a boundary the code doesn't exclude, a regex/allowlist that lost an anchor). REFUTE only when you can construct the disproof from the code: factually wrong (quote the line), provably impossible (show the type/constant/invariant), already handled (cite the guard you found by tracing across files), or pure style with no observable effect.`
  )
}

function consolidatePrompt(survivors) {
  const list = survivors
    .map((s, i) => `[${i}] (${s.verdict}/${s.severity}/${s.impact}) ${s.file}${s.line ? ':' + s.line : ''} — ${s.summary}`)
    .join('\n')
  return (
    `These are the verified survivors of a code review. Many describe the SAME underlying problem found from different angles or at adjacent lines (e.g. one cross-tenant hole flagged by 5 lenses).\n\n` +
    `Cluster them by ROOT CAUSE — one cluster per distinct issue a developer would fix in one place. Every finding index must appear in exactly one cluster. A cluster's severity is the HIGHEST among its members. Give each cluster a short title, the shared root cause, the single fix that resolves all members, and the list of member indexes.\n\n` +
    `Findings:\n${list}\n\n` +
    `Return structured output only.`
  )
}

phase('Find')
const found = await parallel(
  FINDER_ITEMS.map(item => () =>
    agent(findPrompt(item), {
      label: `find:${item.topic.name}:${item.lens.key}`,
      phase: 'Find',
      model: MODEL,
      schema: CANDIDATES_SCHEMA
    })
      .then(r =>
        r && r.candidates
          ? { failed: false, items: r.candidates.map(c => ({ ...c, topic: item.topic.name, lens: item.lens.key })) }
          : { failed: true, items: [] }
      )
      .catch(() => ({ failed: true, items: [] }))
  )
)

const safeFound = found.map(f => f || { failed: true, items: [] })
const finderFailures = safeFound.filter(f => f.failed).length
const rawCandidates = safeFound.flatMap(f => f.items)

// Dedup across ALL finders before the (more expensive) verify — collapse exact
// file+line collisions to the most concrete one. Root-cause clustering happens
// later, after verify, where severity/impact are known.
const byKey = new Map()
for (const c of rawCandidates) {
  const key = `${c.file}::${c.line || 0}`
  const existing = byKey.get(key)
  if (!existing || (c.failure_scenario || '').length > (existing.failure_scenario || '').length) {
    byKey.set(key, c)
  }
}
const candidates = Array.from(byKey.values())
log(`${rawCandidates.length} candidates → ${candidates.length} after dedup (${finderFailures} finder(s) failed)`)

phase('Verify')
const verified = await parallel(
  candidates.map(c => () =>
    agent(verifyPrompt(c), {
      label: `verify:${c.file}`,
      phase: 'Verify',
      model: MODEL,
      schema: VERDICT_SCHEMA
    })
      .then(v =>
        v
          ? { ...c, verdict: v.verdict, severity: v.severity, impact: v.impact, evidence: v.evidence }
          : { ...c, verdict: 'PLAUSIBLE', severity: 'unknown', impact: 'unknown', unverified: true, evidence: 'verification did not complete (agent error or session limit)' }
      )
      .catch(() => ({ ...c, verdict: 'PLAUSIBLE', severity: 'unknown', impact: 'unknown', unverified: true, evidence: 'verification threw' }))
  )
)

// Keep CONFIRMED/PLAUSIBLE (unverified are carried as PLAUSIBLE so a real bug is
// never silently dropped when verify can't run); drop only explicit REFUTED.
const survivors = verified.filter(Boolean).filter(f => f.verdict !== 'REFUTED')
const unverified = survivors.filter(f => f.unverified).length
log(`${survivors.length} survivor(s), ${unverified} unverified`)

// Cluster survivors by root cause so the report leads with distinct issues, not
// the same hole repeated per lens. Falls back to one-cluster-per-finding so a
// failed clustering pass never loses data.
let clusters = []
if (survivors.length) {
  phase('Consolidate')
  const res = await agent(consolidatePrompt(survivors), {
    label: 'consolidate',
    phase: 'Consolidate',
    model: MODEL,
    schema: CLUSTER_SCHEMA
  }).catch(() => null)

  const raw = res && res.clusters ? res.clusters : []
  const referenced = new Set()
  clusters = raw
    .map(cl => {
      const members = (cl.members || []).filter(i => Number.isInteger(i) && i >= 0 && i < survivors.length)
      members.forEach(i => referenced.add(i))
      return {
        title: cl.title,
        rootCause: cl.rootCause || '',
        severity: cl.severity || 'unknown',
        impact: cl.impact || 'unknown',
        fix: cl.fix || '',
        occurrences: members.map(i => survivors[i])
      }
    })
    .filter(c => c.occurrences.length)

  survivors.forEach((s, i) => {
    if (referenced.has(i)) return
    clusters.push({
      title: s.summary,
      rootCause: '',
      severity: s.severity || 'unknown',
      impact: s.impact || 'unknown',
      fix: s.fix || '',
      occurrences: [s]
    })
  })
  log(`${survivors.length} survivor(s) → ${clusters.length} root-cause cluster(s)`)
}

return {
  findings: survivors,
  clusters,
  stats: {
    topics: TOPICS.length,
    finders: FINDER_ITEMS.length,
    finderFailures,
    candidates: candidates.length,
    survivors: survivors.length,
    unverified,
    clusters: clusters.length,
    lenses: LENS_KEYS
  }
}
