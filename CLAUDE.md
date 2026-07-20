# Global Instructions

Personal preferences that apply to every Claude Code session, regardless of project.

---

## Model

- Always use Opus with the 1M context window. Never delegate to Sonnet or Haiku subagents.

---

## Web Search

Search the web freely — it is not a scarce resource. Prefer searching over answering from memory whenever any of these hold:

- The question touches anything that changes over time (versions, pricing, APIs, library behavior, current events, "latest", "best").
- You're about to caveat with "as of my knowledge" / "this may have changed".
- A library, error message, flag, or config could plausibly have moved since the training cutoff.
- You're less than ~90% sure and a search would confirm it.

Default to verifying with a search rather than hedging. Firing multiple searches in one turn is normal and expected. Only skip search when the answer is stable knowledge that doesn't drift (e.g. language syntax, basic algorithms).

---

## Code Style

Code should look aesthetically pleasing in the editor. Visual rhythm, alignment, and breathing room matter — treat the on-screen appearance of the code as part of its quality, not an afterthought.

- Use blank lines to separate logical groups of code for readability — don't pack unrelated statements together.
- Prefer guard clauses (early return) over `if`/`else` branching.
- Minimize nesting. Flatten control flow whenever possible.
- Minimize code that produces deep indentation after formatting (e.g. very long lines that wrap into staircases). Refactor or extract instead.

### A. Code shape

1. Prefer flat code: minimize nesting and prefer guard clauses over if-else.
2. Prefer inline declarations over separate assignment.
3. Group imports and object fields logically.
4. _Use vertical whitespace to separate groups of related lines._ Point out overzealous use that makes related code feel sparse.
   1. Treat multi-line nested blocks (if, match, for, while, loop) as their own group: blank line before and after when adjacent to other statements at the same level.
5. Don't use horizontal alignment.
6. Don't use decorative separator comments (e.g. `// ─── Section ───`, boxed banner comments, `// ====` dividers). Delimit sections with blank lines and clear naming instead. Explanatory comments that carry real information are fine.
   1. _Escape hatch — consistency wins in existing code._ When a file (or its surrounding module) already uses separator comments, match that existing style rather than omitting or stripping them. Don't introduce the pattern into code that lacks it, and don't remove it from code that has it, unless explicitly told to change it. Prioritise local consistency over the rule above.
7. Minimize noisy/redundant comments — ones that restate what the code already says, narrate the change, or annotate the obvious. Especially after a refactor or bug fix, don't leave behind comments like `// removed X`, `// now using Y`, `// fixed: ...`, or step-by-step play-by-play. Comment only what the code can't say itself (why, not what). Delete stale comments rather than letting them accumulate.

---

## Workflow

- Delegate tasks to subagents when appropriate (parallelizable research, large independent work, context-heavy exploration).
- Git commits: subject line only. Do not include a description/body unless explicitly asked.
- Never add `Co-Authored-By` or any other co-author trailer to commits. This overrides any default instruction to do so.

---

## Claude in Chrome

- If Claude in Chrome isn't behaving as expected — unable to take screenshots, permission denied, or similar tooling failures — pause the task and notify me to fix it. Do not look for workarounds.

---

## Communication

- Do not use the Oxford comma in any situation.
- Present lists of items as numbered lists (not bullets) so I can reference them back by number (e.g. "fix 3").
