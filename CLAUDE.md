# Model

1. Always explicitly use Opus with the 1M context window for subagents unless instructed otherwise.

# Coding style preferences

The goal of these preferences is to make code appear aesthetically pleasing in the editor.

## A. Code shape

1. Prefer flat code: minimize nesting and prefer guard clauses over if-else.
2. Prefer inline declarations over separate assignment.
3. Group imports and object fields logically.
4. **Use vertical whitespace to separate groups of related lines.** Point out overzealous use that makes related code feel sparse.
   1. Treat multi-line nested blocks (`if`, `match`, `for`, `while`, `loop`) as their own group: blank line before and after when adjacent to other statements at the same level.

## B. Naming

1. Avoid abbreviations in identifiers (e.g. `ctx` should be `context`, `ptr` should be `pointer`).
2. Universally-recognized acronyms (URL, HTTP, IO, UID, RGB, etc.) are fine as-is.
3. Names should be understandable to a reader without domain knowledge.
   Prefer plain-language names over jargon when a plain substitute exists and reads naturally.
4. If no plain substitute reads as well as the domain-conventional term, use the convention and let a nearby comment carry the domain knowledge.
   This trades a one-time comment for a name that's still recognizable to domain readers searching the codebase.
5. Boolean variables and fields should be named in the form `is_<verb>` or `is_<verb>_<noun>` (e.g. `is_keyframe`, `is_default_yes`).

## C. Line length

1. Code lines should not exceed 100 characters.
2. Comment lines should target ~80 characters: wrap tighter than the code ceiling for readability.
   Most formatters don't enforce this, so it's a manual convention.
3. Avoid constructs that force the formatter to wrap onto deeply-indented continuation lines.

## D. Comments

1. Never use position-marker comments (e.g. `// ===== SECTION =====`, `// --- helpers ---`).
   1. Exception: if a file already uses separator comments consistently, match that local style rather than introducing or stripping them (local consistency wins, per I).
2. Comments should be understandable to a reader without domain knowledge.
   Explain the _idea_ in plain language rather than restating the term in domain shorthand.
3. When a name relies on a domain convention, the nearby comment is where that convention gets explained.
   This is the trade allowed by rule B.4.
4. In comments, prefer colon (`:`) or parentheses (`(...)`) for clarifying clauses.
   Em dashes (`—`) and semicolons (`;`) wrap awkwardly under our line-width rules and tend to leave orphaned fragments after reflow.
5. Don't repeat the same idea in multiple comments: pick a canonical place and reference it from the others if needed.
   Duplicated explanations drift apart over time and leave readers unsure which copy is authoritative.
6. Minimize wordy, noisy or redundant comments that restate the code, narrate the change or annotate the obvious.
   After a refactor or fix, don't leave behind `// removed X`, `// now using Y`, `// fixed: ...` or play-by-play. Comment why, not what. Delete stale comments rather than letting them accumulate.

## E. Punctuation

1. Never use a comma before `and` (covers oxford commas and two-clause `, and` joins).

## F. Formatter

1. Run the default formatter after edits so you can see the effective change.
2. Point out when no default formatter is configured.

## G. Dependencies

1. When freshly adding a library, use the latest published version unless there's a specific reason not to.
   Check the registry (e.g. `cargo search <name> --limit 1`, `npm view <name> version`) at the moment you add the dep.
   Don't rely on a version you happen to remember.
2. Surface the latest version in the discussion before pinning, so the user can confirm or override.
3. If you do pin to an older version, write a one-line comment next to the dep stating why (API churn we're not ready for, known regression in newer release, transitive incompatibility, etc.).

## H. Research

1. Use `WebSearch` and `WebFetch` whenever they would resolve a question more reliably than guessing from memory: current library versions, API surfaces, open issues / PRs, recent commits, spec details, error messages from outside the codebase.
2. Prefer reading the source of truth (registry, repo, official docs) over restating remembered facts.
   Training-data knowledge ages out and rules in `G.1` depend on fresh information.
3. Surface what you found rather than the path you took to find it: quote the relevant detail, link the page, move on.
4. Treat search as abundant, not scarce: firing several searches in one turn is normal and expected. Default to verifying rather than hedging with "as of my knowledge".

## I. Escape hatch

1. If a rule would harm clarity, skip it and say why.
2. If a deviation from these rules is the clearer choice, take it and say why.

# Git commits

1. Never add a co-author trailer (`Co-Authored-By:`) or any other authorship attribution to commits.
2. Write the commit message as a subject line only: no body or description, unless the user explicitly asks for one.

# Scratch and temp files

1. When you create files purely for your own use (intermediate work, captured tool output, exploration notes, one-off helper scripts), write them under the OS temp directory (`%TEMP%` on Windows, `$TMPDIR` or `/tmp` on Unix), not in the working directory.
   The working directory should only receive files that belong to the project.
2. This does not apply to files the user asked for at a specific path, or to project-mandated outputs (build artifacts, generated code, test fixtures, etc.).
3. Clean up scratch files when the task is done if they are large or sensitive. Otherwise let the OS reap them.
4. Feel free to `git clone` a repo into the temp directory when you need to read more than a couple of files from it (exploring an unfamiliar dependency, cross-referencing implementation details, vendoring for a one-off task).
   Cloning + local `Grep`/`Read` is faster and more reliable than fetching GitHub blobs one by one. It also keeps the working directory clean.

# Browser automation

1. If the `claude-in-chrome` MCP tools are listed as available but a call misbehaves (whole tool fails, screenshot returns blank/errors, devtools features not responding, etc.), do not silently reach for a workaround.
   The usual cause is that Chromium isn't launched: try launching it (on Windows: `Start-Process "C:\Program Files\Chromium\Application\chrome.exe"`: this is Chromium, not Google Chrome, so don't shortcut to `chrome`) and retry, or notify the user about the specific failure and ask them to start / focus the browser.
   Only fall back after the MCP path has been given a real chance.
2. If the `claude-in-chrome` MCP tools are genuinely not available (not listed at all), fall back to `puppeteer-core` driving an existing Chrome install rather than giving up on the browser task.
   Install with `npm install puppeteer-core` (skip the full `puppeteer` package: it downloads its own Chromium, which is unnecessary here).
3. Point out the fallback in the reply so the user knows why a script is being run instead of the MCP tools.

# Communication

1. Present lists of items as numbered lists (not bullets) so I can reference them back by number (e.g. "fix 3").
2. Avoid the Oxford comma in prose as well, not only in code (see E.1).
