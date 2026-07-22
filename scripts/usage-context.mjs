// Injects rate-limit usage into the model's context when a usage band is
// crossed, so long autonomous workflows can checkpoint before hitting limits.
// Reads the state file written by usage-statusline.mjs.
// Cross-platform Node port: one `node ...` command runs on Windows and macOS.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const stateFile = join(homedir(), '.claude', 'usage-state.json')

function nowEpoch() {
  return Math.floor(Date.now() / 1000)
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function pct(window) {
  if (window && window.used_percentage != null) return Math.floor(Number(window.used_percentage))
  return -1
}

function formatReset(resetsAt) {
  let mins = Math.floor((Number(resetsAt) - nowEpoch()) / 60)
  if (mins < 0) mins = 0
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

let stdin = ''
try {
  stdin = readFileSync(0, 'utf8')
} catch {
  stdin = ''
}

const data = parseJson(stdin) || {}
const event = data.hook_event_name || 'PostToolUse'
const session = data.session_id || 'unknown'

if (!existsSync(stateFile)) process.exit(0)

const state = parseJson(readFileSync(stateFile, 'utf8'))
if (!state) process.exit(0)

// Ignore a stale snapshot: the statusline may not have refreshed recently.
const captured = Number(state.captured_at) || 0
if (nowEpoch() - captured > 3600) process.exit(0)

const p5 = pct(state.five_hour)
const p7 = pct(state.seven_day)

// Bands: silent below 70% (5h) / 80% (7d), then one injection per 5% step.
const band5 = p5 >= 70 ? Math.floor(p5 / 5) * 5 : 0
const band7 = p7 >= 80 ? Math.floor(p7 / 5) * 5 : 0

if (band5 === 0 && band7 === 0) process.exit(0)

// Throttle: emit only when the band changes within this session.
const throttleFile = join(tmpdir(), `claude-usage-band-${session}`)
const key = `${band5}-${band7}`

const prev = existsSync(throttleFile) ? readFileSync(throttleFile, 'utf8').trim() : ''
if (key === prev) process.exit(0)
writeFileSync(throttleFile, key)

const r5 = state.five_hour?.resets_at ?? 0
const r7 = state.seven_day?.resets_at ?? 0

let msg = `Rate-limit status: 5-hour window ${p5}% used (resets in ${formatReset(r5)}), weekly limit ${p7}% used (resets in ${formatReset(r7)}).`

if (p5 >= 90 || p7 >= 95) {
  msg += ' Usage is nearly exhausted. Checkpoint NOW: commit or save all progress, write a summary of remaining steps to a file so work can resume after the reset, then inform the user instead of starting anything new.'
} else if (p5 >= 80 || p7 >= 85) {
  msg += ' Approaching the limit: prefer finishing and saving current work over starting new large subtasks, and checkpoint progress at the next natural boundary.'
}

const payload = {
  hookSpecificOutput: {
    hookEventName: event,
    additionalContext: msg
  }
}

process.stdout.write(JSON.stringify(payload))
