// Renders the Claude Code statusline and persists the rate-limit block so the
// usage-context hook can inject limit awareness into the model's context.
// Cross-platform Node port: one `node ...` command runs on Windows and macOS.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

const stateFile = join(homedir(), '.claude', 'usage-state.json')
const credentialsFile = join(homedir(), '.claude', '.credentials.json')

// The state file only carries reset times, so window spans have to be assumed.
const fiveHourSeconds = 5 * 60 * 60
const sevenDaySeconds = 7 * 24 * 60 * 60

// Claude Code only refreshes its own figures from API response headers, so an
// idle session never sees usage spent in another window or on the web. Polling
// the account endpoint covers that, rarely enough to keep renders cheap.
const usageEndpoint = 'https://api.anthropic.com/api/oauth/usage'
const pollIntervalSeconds = 60
const pollTimeoutMs = 2000

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

function readJsonFile(path) {
  if (!existsSync(path)) return null

  try {
    return parseJson(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function pct(window) {
  if (window && window.used_percentage != null) return Math.floor(Number(window.used_percentage))
  return -1
}

// Only hand back a token that is still valid: an expired one is a guaranteed
// 401, and refreshing it here would race Claude Code's own token rotation.
function readAccessToken() {
  const oauth = readJsonFile(credentialsFile)?.claudeAiOauth
  if (!oauth?.accessToken) return null

  return Number(oauth.expiresAt) > Date.now() ? oauth.accessToken : null
}

// The endpoint reports a plain percentage and an ISO reset time, where the
// statusline payload uses epoch seconds: normalise onto the latter.
function normaliseWindow(window) {
  if (!window || window.utilization == null) return null

  const resetsAt = Date.parse(window.resets_at)
  return {
    used_percentage: Number(window.utilization),
    resets_at: Number.isNaN(resetsAt) ? null : Math.floor(resetsAt / 1000),
  }
}

async function fetchUsage() {
  const token = readAccessToken()
  if (!token) return null

  try {
    const response = await fetch(usageEndpoint, {
      signal: AbortSignal.timeout(pollTimeoutMs),
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    })
    if (!response.ok) return null

    const usage = await response.json()
    return {
      five_hour: normaliseWindow(usage.five_hour),
      seven_day: normaliseWindow(usage.seven_day),
    }
  } catch {
    return null
  }
}

// Usage within a window only ever climbs, so the higher reading is the more
// recent one. A later reset time means a fresh window opened, and that reading
// wins outright however low it is.
function mergeWindow(current, incoming) {
  if (!incoming) return current
  if (!current) return incoming

  if (Number(incoming.resets_at) > Number(current.resets_at)) return incoming
  if (Number(incoming.resets_at) < Number(current.resets_at)) return current

  return pct(incoming) > pct(current) ? incoming : current
}

function formatTimeLeft(resetsAt) {
  let minutes = Math.floor((Number(resetsAt) - nowEpoch()) / 60)
  if (minutes < 0) minutes = 0
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

// How far through the window we are, which is also the usage a steady burn
// would show at this moment if it were on track to hit exactly 100% at reset.
// Actual above this figure means burning faster than the window allows.
function pacePercent(resetsAt, windowSeconds) {
  const elapsed = windowSeconds - (Number(resetsAt) - nowEpoch())
  return Math.min(100, Math.max(0, Math.floor((elapsed / windowSeconds) * 100)))
}

// Renders one window as a leading ` | ...` segment, or nothing at all while the
// figure is missing.
function formatWindow(label, window, windowSeconds) {
  if (pct(window) < 0) return ''
  if (window.resets_at == null) return ` | ${label}: ${pct(window)}%`

  const pace = pacePercent(window.resets_at, windowSeconds)
  return ` | ${label}: ${pct(window)}%/${pace}% (${formatTimeLeft(window.resets_at)})`
}

const data = parseJson(readStdin())
const state = readJsonFile(stateFile) || {}

const windows = { five_hour: state.five_hour ?? null, seven_day: state.seven_day ?? null }
let capturedAt = Number(state.captured_at) || 0
let fetchedAt = Number(state.fetched_at) || 0

// Whatever Claude Code sends costs nothing and arrives with the render, so fold
// that in first and only reach for the network once the interval has elapsed.
if (data?.rate_limits) {
  windows.five_hour = mergeWindow(windows.five_hour, data.rate_limits.five_hour)
  windows.seven_day = mergeWindow(windows.seven_day, data.rate_limits.seven_day)
  capturedAt = nowEpoch()
}

if (nowEpoch() - fetchedAt >= pollIntervalSeconds) {
  const usage = await fetchUsage()

  // Stamp the attempt either way, so a failing poll backs off instead of
  // stalling every render for the full timeout.
  fetchedAt = nowEpoch()

  if (usage) {
    windows.five_hour = mergeWindow(windows.five_hour, usage.five_hour)
    windows.seven_day = mergeWindow(windows.seven_day, usage.seven_day)
    capturedAt = nowEpoch()
  }
}

writeFileSync(
  stateFile,
  JSON.stringify({ ...windows, captured_at: capturedAt, fetched_at: fetchedAt }),
)

const model = data?.model?.display_name || 'Claude'
const dir = basename(data?.workspace?.current_dir || data?.cwd || '~')

const usage =
  formatWindow('5h', windows.five_hour, fiveHourSeconds) +
  formatWindow('7d', windows.seven_day, sevenDaySeconds)

// Live context usage: only present once the session has made an API call, and
// absent again after /compact until the next one.
const contextUsed = pct(data?.context_window)
const context = contextUsed >= 0 ? ` | Context: ${contextUsed}%` : ''

process.stdout.write(`${model} | ${dir}${usage}${context}`)
