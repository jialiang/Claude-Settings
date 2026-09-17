# Model

1. Always explicitly use Opus with the 1M context window for subagents unless instructed otherwise.
2. A skill or workflow that recommends a model for its own agents overrides rule 1: follow its
   recommendation. Those recommendations are tuned to the run's shape (fan-out width, cost per
   agent, how much the task actually needs), which rule 1 can't see.
3. Say which model you picked and why when you deviate from rule 1, so the cost is a visible choice.

# Context window

1. Compaction is a last resort, not the plan: its summary drops detail unpredictably and neither of us can tell what went missing.
   The harness says a summary carries over so you needn't wrap up early or hand off mid-task. Override that.
2. When the window is running low mid-task, checkpoint instead. Write the current state to a resume document (what is done and verified, open threads, the next step, the paths involved) and tell me to start a fresh chat that reads it first.
3. Keep that document where the project already keeps one, otherwise follow the scratch-and-temp rules.

# Coding style preferences

The goal of these preferences is to make code appear aesthetically pleasing in the editor.

## A. Code shape

1. Prefer flat code: minimize nesting and prefer guard clauses over if-else.
2. Prefer inline declarations over separate assignment.
3. Group imports and object fields logically.
4. **Use vertical whitespace to separate groups of related lines.** Point out overzealous use that makes related code feel sparse.
   1. Treat multi-line nested blocks (`if`, `match`, `for`, `while`, `loop`) as their own group: blank line before and after when adjacent to other statements at the same level.
5. Treat ~200 lines as a file-size smell, not a hard limit. When a file grows past it, flag the file and evaluate whether it separates cleanly along an existing seam. Split only when the seam is genuinely clean (KISS): never fragment tightly-coupled code just to hit a number.

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
5. When `WebFetch` fails for a client-side reason (bot challenge, JS-only page, empty body), don't fall back to memory.
   Retry the page through `playwright-core` instead (see "Browser automation"): it runs a real browser engine, which is what these failures are missing.
6. A login wall is the exception: the browser route drives a scratch profile with no sessions in it, so it will fail the same way. Skip straight to rule 7.
7. If the browser route also fails, ask the user to fetch the content and paste it back. Say which URL and what part you need.

## I. Escape hatch

1. If a rule would harm clarity, skip it and say why.
2. If a deviation from these rules is the clearer choice, take it and say why.

# Git commits

1. `attribution` in `settings.json` empties the trailer the harness adds to commits and to PR descriptions. This rule covers what no setting can: never write authorship attribution into a commit message or a PR body yourself, in any form.
2. Write the commit message as a subject line only: no body or description, unless the user explicitly asks for one.

# Scratch and temp files

1. When you create files purely for your own use (intermediate work, captured tool output, exploration notes, one-off helper scripts), write them under the OS temp directory (`%TEMP%` on Windows, `$TMPDIR` or `/tmp` on Unix), not in the working directory.
   The working directory should only receive files that belong to the project.
2. This does not apply to files the user asked for at a specific path, or to project-mandated outputs (build artifacts, generated code, test fixtures, etc.).
3. Clean up scratch files when the task is done if they are large or sensitive. Otherwise let the OS reap them.
4. Feel free to `git clone` a repo into the temp directory when you need to read more than a couple of files from it (exploring an unfamiliar dependency, cross-referencing implementation details, vendoring for a one-off task).
   Cloning + local `Grep`/`Read` is faster and more reliable than fetching GitHub blobs one by one. It also keeps the working directory clean.

# Shell commands

1. Issue each command as its own standalone call with absolute, literal paths.
2. Don't chain `cd <dir> && <command>`. The Bash tool's working directory persists between calls, so the `cd` buys nothing and it turns the whole line into a compound the permission pre-check has to reject.
3. Keep write and delete targets absolute (`rm -rf "C:/Users/Jia Liang/Desktop/project/build"`, not `rm -rf build`).
   On Windows the pre-check resolves a relative target against the post-`cd` directory to rule out a Cygwin-emulated symlink escaping the allowed directories. When that directory is only known at runtime the check can't run, so the command falls through to a manual prompt.
4. In any command that writes, avoid shell variables, `$(...)`, subshells and heredocs.
   Each of these is a runtime-only value, which makes the command statically unanalysable and forces the same manual prompt.
5. Splitting a long `&&` chain into separate calls is preferred anyway: read the output of each step instead of assuming the chain reached the end.
6. If a chain genuinely has to be atomic, keep it and accept the prompt. Say why it can't be split.

# Permissions

1. When the auto-mode permission classifier denies a tool call, prefer asking me for permission over working around it.
2. Say which call was blocked and why it is needed, then let me decide. A denial is a decision point, not an obstacle to route around.
3. Rewriting a command to slip past the check is the worst option: it defeats the guardrail and usually produces a worse command than the one that was blocked.
4. The same applies when I deny a tool call at the permission prompt: pause and surface it instead of adjusting the call and trying again.
   A deliberate deny means I have something to say about the approach. An accidental one I still want to see, not have quietly routed around.
   The harness says a denied call means I declined it and you should adjust rather than retry verbatim. Override that: don't adjust either.

# Browser automation

1. `playwright-core` is the browser route: there is no Claude in Chrome extension here (removed deliberately), so don't hunt for `claude-in-chrome` MCP tools or offer to reinstall it unless I ask. Never the full `playwright` package either: its install downloads browser builds we don't need.
2. It is a tracked dependency of `~/.claude`, so scripts under `~/.claude/scripts/` can `import { chromium } from 'playwright-core'`. A script in the temp directory can't, because node resolves `node_modules` from the script's own location, so import it by path:
   `await import(pathToFileURL('C:/Users/Jia Liang/.claude/node_modules/playwright-core/index.mjs').href)`
3. One browser per session, shared by every script in it, so a login or a half-finished flow carries across them. Probe `http://127.0.0.1:9222/json/version` first: an answer means attach to what is already up, no answer means start one, which is also the recovery path for when I have closed it by hand.
   `Start-Process "C:\Program Files\Chromium\Application\chrome.exe" -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:\Users\JIALIA~1\AppData\Local\Temp\claude-browser-profile','--no-first-run','--no-default-browser-check'`
   Start it detached like that, outside node, so playwright never owns its lifetime. Keep the short `JIALIA~1` form: `-ArgumentList` splits on spaces, so `Jia Liang` breaks the flag in half and Chromium never starts.
4. Launch headed for anything out on the internet: headless announces itself in its user agent (`HeadlessChrome/152.0.0.0` where headed says plain `Chrome/152.0.0.0`), which is the first thing bot detection reads. `--headless` is only for localhost or the LAN.
5. Attach with `chromium.connectOverCDP('http://127.0.0.1:9222')`, which hands back the full playwright API (locators, auto-waiting, `page.route`, emulation) because the protocol is only transport: never drop to raw CDP.
   Never `launch()` or `launchServer()` for session work. Both tie the browser to the node process, so even a hard kill takes it down. `launchServer` also gives each client an empty view, silently losing the shared state.
6. End every script with `browser.close()`: over CDP that only detaches (the browser stays up) and it is what releases node's event loop. Forgetting it leaks no browser, it hangs the script.
   Leave the browser running when a task ends and shut it down only when I ask, or offer once the session's browser work is clearly over.
7. `browser.contexts()[0]` carries whatever the last script left behind, so open a fresh page rather than trusting `pages()[0]`. Use `newContext()` when a task needs viewport, userAgent, locale or permissions: those apply at creation and can't be retrofitted onto an adopted context.
8. That profile is scratch space whose debugging port lets any local process drive the browser, so never sign it into anything that matters. My real browsing is Firefox Developer Edition, which playwright can't drive: if a task needs a genuinely authenticated session, ask me. Say in the reply when a browser script runs.

# Communication

1. Present lists of items as numbered lists (not bullets) so I can reference them back by number (e.g. "fix 3").
2. Avoid the Oxford comma in prose as well, not only in code (see E.1).
