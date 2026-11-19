---
name: prose
description: |
  Rules for prose the user will read later or pass on: notes, docs, READMEs,
  summaries, emails plus the shape of long code comments. Load before writing or
  editing any of these, including a code comment longer than about four lines.
---

# Prose

This covers prose I'll read later or pass on: notes, docs, READMEs, summaries, emails.
Code comments follow D in `~/.claude/CLAUDE.md` instead, except that a comment longer than about four lines also takes the shape in rule 10.

1. Write for easy reading over compactness. Dense, clause-packed sentences full of shorthand are the main thing to avoid.
   1. Readability is the goal. The rules here and in D are guardrails. Text that breaks no rule but reads densely still fails this one.
2. Lead with the conclusion. Put sources, method and background at the end.
   1. For status summaries, use a takeaway / why it was reviewed / why it changes or doesn't shape where it fits.
3. Use plain words. Spell out jargon, abbreviations and internal shorthand the first time (e.g. "net asset value (NAV)", "2× headroom" as "double the cushion needed").
4. Prefer everyday wording over formal or technical phrasing (e.g. "without changing habits", not "with no change in behaviour").
5. Keep sentences short: one idea each. Prefer full stops over semicolons and long chains of clauses.
6. Write notes about me in the third person.
7. Don't use em dashes.
8. Keep every number, date, name and link exact: readability never changes a fact.
   Don't add what the source doesn't say (e.g. a direction on "moved 0.4%").
9. Avoid Claudisms: habits that mark text as written by Claude. Say the point plainly instead.
   1. Contrasts against a claim nobody made ("It's not X, it's Y", "not just X but Y").
   2. Staged openers that announce the point instead of making it ("Here's the thing:", "The short answer:", "Great question").
   3. Punchy one-line closers that repeat what was already said ("That's the whole trick.").
   4. Rhetorical questions answered straight away ("The result? Faster builds.").
   5. Forced groups of three, where the list exists for rhythm rather than because there are three things.
   6. Inflated or stock words: "crucial", "robust", "seamless", "comprehensive", "delve", "leverage", "landscape", "nuanced", "genuinely", "honestly".
   7. Filler signposts: "It's worth noting", "Importantly", "In essence", "At its core".
   8. A bold label on every list item ("**Speed:** it's faster") when the labels add nothing.
   9. Closing pleasantries and offers ("Hope this helps", "Let me know if you'd like...").
10. Give anything longer than a short paragraph a shape the reader can scan, long code comments included:
    1. A one-line summary first.
    2. The reason in its own labelled part, when it isn't obvious. Label it with a colon ("Why a separate port:"), never a question.
    3. Steps that happen in order as a numbered list.

    A short comment stays a sentence or two. Example of the long shape:

    ```js
    /**
     * Runs the render worker for the e2e suite, with a readiness port of its own.
     *
     * Why a separate port:
     * `supabase start` serves every edge function as soon as it boots (the render
     * worker included), but without their secrets. If the suite probed the
     * worker's usual URL, it would see it answering and skip starting its own.
     *
     * How it works:
     * 1. Runs `supabase functions serve` with the suite's env file.
     * 2. Waits until the CLI says the worker is serving.
     * 3. Opens READY_PORT, the address the suite probes.
     */
    ```
