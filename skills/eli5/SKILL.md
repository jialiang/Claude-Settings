---
name: eli5
description: >-
  Restate my previous message as a plain-language wrap-up for a technically
  inclined project manager: outcome first, jargon dropped, no new work.
  Manual only, via /eli5.
argument-hint: "[optional: part to focus on]"
disable-model-invocation: true
---

Restate your own immediately preceding message for a different reader.

That message was written for someone deep in the task. This version is for a
technically inclined project manager: they know what a deploy, an API, a
database and a test suite are, they do not know this codebase, and they care
about outcome, risk and what happens next rather than how it was done.

Focus, may be empty, in which case cover the whole message: $ARGUMENTS

Shape:

1. Open with one sentence on the outcome: what was being done and whether it
   worked. If it partly failed or is still open, that goes here, not lower down.
2. Then 3 to 6 numbered points covering what actually changed and why it
   matters. One idea each.
3. If anything is unfinished, blocked or needs a decision, give it its own
   short numbered list under a "Still open" line. Skip the line entirely when
   nothing is open.
4. Close with one "so what" line: what this means for the user, or the next
   step.

Translating:

1. Keep the facts a manager needs: system and service names, numbers, counts,
   durations, costs, dates. Those are the substance, not the jargon.
2. Drop what only an implementer needs: file paths, function and symbol names,
   flags, stack traces, command lines, library versions. Name one only when it
   is the actual point of a sentence.
3. Replace domain shorthand with everyday words. If a term is the searchable
   name for the thing, keep it and gloss it in parentheses once.
4. Say plainly when something is a guess, a workaround or unverified. Confidence
   is part of the outcome, so do not smooth it away.

Constraints:

1. No tool calls, no file reads, no fresh investigation. This is a restatement
   of what is already on screen.
2. Add no findings, caveats or recommendations that were not in the original.
   If the original turns out to be wrong, say so in one line rather than
   quietly correcting it.
3. Target 400 words or fewer, and always shorter than the original. A long
   original means harder cutting, not a longer summary.
4. No code blocks. A named command or value inline is fine when it is the point.
5. No meta-commentary: do not explain the simplification, restate these rules,
   or apologize for how the first version read.
6. If there is no preceding message of yours, explain the topic named in the
   focus argument instead. With neither, ask what to summarize.
