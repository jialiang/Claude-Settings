// Renders the Claude Code statusline and persists the rate-limit block so the
// usage-context hook can inject limit awareness into the model's context.
// Cross-platform Node port: one `node ...` command runs on Windows and macOS.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

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

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function pct(window) {
  if (window && window.used_percentage != null) return Math.floor(Number(window.used_percentage))
  return -1
}

function formatTimeLeft(resetsAt) {
  let minutes = Math.floor((Number(resetsAt) - nowEpoch()) / 60)
  if (minutes < 0) minutes = 0
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

const data = parseJson(readStdin())

// Persist rate_limits (plus a capture timestamp) whenever Claude sends them.
if (data && data.rate_limits) {
  writeFileSync(stateFile, JSON.stringify({ ...data.rate_limits, captured_at: nowEpoch() }))
}

const model = data?.model?.display_name || 'Claude'
const dir = basename(data?.workspace?.current_dir || data?.cwd || '~')

let usage = ''
if (existsSync(stateFile)) {
  const state = parseJson(readFileSync(stateFile, 'utf8'))

  if (state) {
    const p5 = pct(state.five_hour)
    const p7 = pct(state.seven_day)

    if (p5 >= 0) usage += ` | 5h: ${p5}% (${formatTimeLeft(state.five_hour.resets_at)})`
    if (p7 >= 0) usage += ` | 7d: ${p7}% (${formatTimeLeft(state.seven_day.resets_at)})`
  }
}

// Live context usage: only present once the session has made an API call, and
// absent again after /compact until the next one.
const contextUsed = pct(data?.context_window)
const context = contextUsed >= 0 ? ` | Context: ${contextUsed}%` : ''

process.stdout.write(`${model} | ${dir}${usage}${context}`)
