#!/usr/bin/env node
// PostToolUse / PostToolUseFailure reminder for the WebFetch tool.
//
// Rule H.5 of ~/.claude/CLAUDE.md says a WebFetch blocked for a client-side reason must
// be retried through the browser rather than answered from memory and it is the rule
// most often skipped: the failure arrives as one line in a long result and reads as a
// dead end. Feeding the reminder back as a blocking decision puts it where a tool error
// would be, so the next step is taken against the rule instead of around it.
//
// WebFetch reports an HTTP error as a *successful* tool result whose body explains the
// status, so most cases arrive on PostToolUse. Only transport and safety-check failures
// raise PostToolUseFailure. Both events are handled here.

// A missing page is missing in a browser too, so 404 stays quiet. These are the codes
// where running a real browser engine can change the answer, most often because the
// server served a challenge page rather than the document. Some of them (401, 407) are
// plain login walls that the browser route cannot solve either: the reason text below
// says so, rather than this list trying to guess which is which from the code alone.
const BLOCKED_CODES = new Set([401, 402, 403, 407, 429, 451])

// Transport and safety-check failures worth retrying. An interrupted fetch is the user
// stopping the turn and a bad URL is a typo, so neither is listed.
// Built from a list because the assembled expression would run past the line limit.
// prettier-ignore
const RETRYABLE_FAILURES = new RegExp([
  'unable to fetch', 'unable to verify', 'socket hang up', 'timeout',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
  'certificate', 'self.signed', 'TLS', 'network',
].join('|'), 'i')

function describeResponse(response) {
  const code = Number(response?.code)

  if (BLOCKED_CODES.has(code) || (code >= 500 && code <= 599)) {
    return `returned HTTP ${code} ${response?.codeText ?? ''}`.trim()
  }

  // A zero-length 200: the server answered and sent nothing at all. Only 200 counts,
  // because a 204 means "no content" on purpose and is just as empty in a browser.
  // This does not catch a script-rendered page, whose shell is several kilobytes.
  if (code === 200 && response?.bytes === 0) return 'returned an empty body'

  return ''
}

function describeFailure(input) {
  if (input?.is_interrupt) return ''
  if (!RETRYABLE_FAILURES.test(input?.error ?? '')) return ''

  return `failed with "${String(input.error).slice(0, 200)}"`
}

function describeSymptom(input) {
  if (input?.tool_name !== 'WebFetch') return ''
  if (input?.hook_event_name === 'PostToolUseFailure') return describeFailure(input)

  return describeResponse(input?.tool_response)
}

function buildReason(url, symptom) {
  return (
    `WebFetch on ${url || 'that URL'} ${symptom}, which is a client-side failure.\n\n` +
    'Per rule H.5 of ~/.claude/CLAUDE.md, do NOT fall back to remembered facts and do not ' +
    'present this as unavailable. Retry the same URL through `playwright-core`, following ' +
    'the "Browser automation" rules: it runs a real browser engine, which is what a bot ' +
    'challenge, a script-rendered page or an empty body is missing. If the browser shows ' +
    'a challenge or interstitial page, read it and follow what it says (rule H.6).\n\n' +
    'That browser drives a scratch profile holding no logins. If the page turns out to be ' +
    'a login wall (rule H.7) the retry fails the same way, so skip it and go to rule H.8: ' +
    'ask the user to fetch the page and paste it back, naming the URL and the part needed.'
  )
}

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

// A closed pipe surfaces here rather than in the catch below, where it would become an
// uncaught exception and break the silence the rest of the script is careful to keep.
process.stdout.on('error', () => {})

// Any failure here stays silent: a broken reminder must not disturb a working fetch.
try {
  const input = JSON.parse(await readStdin())
  const symptom = describeSymptom(input)

  if (symptom) {
    const url = input?.tool_input?.url || input?.tool_response?.url || ''
    const reason = buildReason(url, symptom)
    const isFailureEvent = input.hook_event_name === 'PostToolUseFailure'

    // `decision: block` is documented to feed the reason back on PostToolUse. The
    // failure event only documents additionalContext, so it gets both and lands the
    // reminder either way, without repeating it where one channel is enough.
    const output = isFailureEvent
      ? {
          decision: 'block',
          reason,
          hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: reason },
        }
      : { decision: 'block', reason }

    process.stdout.write(JSON.stringify(output))
  }
} catch {}
