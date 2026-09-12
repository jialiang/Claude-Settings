// Black-box tests for the WebFetch browser-fallback reminder: each case is fed through
// the script the way the hook feeds it, so the JSON contract is covered along with the
// trigger set. The response shapes are copied from real transcript results.
//
// Run with `node --test "C:/Users/Jia Liang/.claude/scripts/webfetch-browser-fallback.test.mjs"`.
// Name the file: `node --test <directory>` resolves the directory as a module and fails
// on the Node version installed here.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const HOOK = fileURLToPath(new URL('./webfetch-browser-fallback.mjs', import.meta.url))
const URL_UNDER_TEST = 'https://www.sgpbusiness.com/company/Itcan-Pte-Limited'

function run(payload) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })

  assert.equal(result.stderr, '', 'hook wrote to stderr')
  if (!result.stdout.trim()) return { isReminded: false, reason: '' }

  const output = JSON.parse(result.stdout)
  assert.equal(output.decision, 'block')

  return { isReminded: true, reason: output.reason, output }
}

function response({ code, bytes = 0, codeText = '' }) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'WebFetch',
    tool_input: { url: URL_UNDER_TEST, prompt: 'summarise' },
    tool_response: { bytes, code, codeText, result: '...', durationMs: 492, url: URL_UNDER_TEST },
  }
}

function failure(error, extra = {}) {
  return {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'WebFetch',
    tool_input: { url: URL_UNDER_TEST },
    error,
    ...extra,
  }
}

function reminds(name, payload) {
  test(`reminds on ${name}`, () => {
    const { isReminded, reason } = run(payload)
    assert.equal(isReminded, true, `stayed quiet for ${name}`)
    assert.match(reason, /claude-in-chrome/)
    assert.match(reason, /H\.5/)
  })
}

function quiet(name, payload) {
  test(`stays quiet on ${name}`, () => {
    const { isReminded, reason } = run(payload)
    assert.equal(isReminded, false, `reminded on ${name}\n${reason}`)
  })
}

reminds('403 Forbidden', response({ code: 403, codeText: 'Forbidden' }))
reminds('401 Unauthorized', response({ code: 401, codeText: 'Unauthorized' }))
reminds('402 Payment Required', response({ code: 402, codeText: 'Payment Required' }))
reminds('407 Proxy Authentication Required', response({ code: 407, codeText: 'Proxy Auth' }))
reminds('429 Too Many Requests', response({ code: 429, codeText: 'Too Many Requests' }))
reminds('451 Unavailable For Legal Reasons', response({ code: 451, codeText: 'Unavailable' }))
reminds('500 Internal Server Error', response({ code: 500, codeText: 'Internal Server Error' }))
reminds('502 Bad Gateway', response({ code: 502, codeText: 'Bad Gateway' }))
reminds('503 Service Unavailable', response({ code: 503, codeText: 'Service Unavailable' }))
reminds('599 at the top of the 5xx range', response({ code: 599, codeText: '' }))
reminds('a 200 with an empty body', response({ code: 200, codeText: 'OK', bytes: 0 }))

reminds('a blocked domain', failure('Claude Code is unable to fetch from www.reddit.com'))
reminds('a safety-check failure', failure('Unable to verify if domain check.spamhaus.org is safe'))
reminds('a dropped socket', failure('socket hang up'))
reminds('a timeout', failure('timeout of 60000ms exceeded'))
reminds('a refused connection', failure('connect ECONNREFUSED 216.92.12.189:443'))
reminds('a bad certificate', failure('unable to get local issuer certificate'))

quiet('404 Not Found', response({ code: 404, codeText: 'Not Found' }))
quiet('499 below the 5xx range', response({ code: 499, codeText: '' }))
quiet('a 200 that carried a body', response({ code: 200, codeText: 'OK', bytes: 18402 }))
quiet('204 No Content, which is deliberately empty', response({ code: 204, bytes: 0 }))
quiet('205 Reset Content', response({ code: 205, bytes: 0 }))
quiet('an unrecognised failure', failure('Invalid URL'))

// The guard has to be asserted with error text the regex accepts, or the test passes on
// the regex alone and would stay green with the interrupt guard deleted.
quiet('a user interrupt', failure('socket hang up', { is_interrupt: true }))

// `bytes` is compared strictly: Number(null) is 0, which would fire on a page that
// carried content.
quiet('a 200 whose byte count is null', {
  hook_event_name: 'PostToolUse',
  tool_name: 'WebFetch',
  tool_input: { url: URL_UNDER_TEST },
  tool_response: { code: 200, bytes: null, url: URL_UNDER_TEST },
})

quiet('a 200 with no byte count at all', {
  hook_event_name: 'PostToolUse',
  tool_name: 'WebFetch',
  tool_input: { url: URL_UNDER_TEST },
  tool_response: { code: 200, url: URL_UNDER_TEST },
})

quiet('a missing tool_response', {
  hook_event_name: 'PostToolUse',
  tool_name: 'WebFetch',
  tool_input: { url: URL_UNDER_TEST },
  tool_response: null,
})

quiet('another tool returning 403', {
  ...response({ code: 403, codeText: 'Forbidden' }),
  tool_name: 'Bash',
})

test('the failure event carries additionalContext as well', () => {
  const { output } = run(failure('socket hang up'))
  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUseFailure')
  assert.match(output.hookSpecificOutput.additionalContext, /claude-in-chrome/)
})

test('the success event does not repeat itself in additionalContext', () => {
  const { output } = run(response({ code: 403, codeText: 'Forbidden' }))
  assert.equal(output.hookSpecificOutput, undefined)
})

test('the reason names the URL', () => {
  const { reason } = run(response({ code: 403, codeText: 'Forbidden' }))
  assert.match(reason, /sgpbusiness\.com/)
})

test('an empty tool_input URL falls back to the one on the response', () => {
  const { reason } = run({
    hook_event_name: 'PostToolUse',
    tool_name: 'WebFetch',
    tool_input: { url: '' },
    tool_response: { code: 403, codeText: 'Forbidden', url: 'https://real.example.com' },
  })
  assert.match(reason, /real\.example\.com/)
})

test('malformed input is survived quietly', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' })
  assert.equal(result.stderr, '')
  assert.equal(result.stdout.trim(), '')
})
