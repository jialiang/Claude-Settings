#!/usr/bin/env node
// Prints the rendered text of a web page, read through the shared browser on port 9222.
// This is the browser route of rule H.5 in ~/.claude/CLAUDE.md, packaged so an agent
// runs one command instead of writing a puppeteer script each time.
//
// Usage: node ~/.claude/scripts/read-page.mjs <url> [--full]
//
// Output: a header (HTTP status, final URL, title and byline, date when found),
// a blank line, then the main article text (or the whole page when there is none).
// --full skips article detection: use it for pages that aren't articles
// (comment threads, forums, search results, docs indexes, pricing tables).
// Exit codes: 0 read, 1 navigation failed, 2 no usable browser on port 9222,
// 3 a bot check page (e.g. Cloudflare's "Just a moment...") never let it through.

import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

import { isChallengeTitle } from './lib/challenge.mjs'
import { extractArticle, printPage, readArguments } from './lib/extract-article.mjs'

const DEBUG_URL = 'http://127.0.0.1:9222'
const WINDOWS_CHROMIUM = 'C:\\Program Files\\Chromium\\Application\\chrome.exe'

// Pages keep filling in after load (client rendering, lazy feeds). Waiting until the
// text stops growing is faster than a fixed delay and does not hang on tracker traffic
// the way waiting for network idle does.
const SETTLE_CHECK_MS = 500
const SETTLE_QUIET_MS = 1500
const SETTLE_MAX_MS = 15000

// Bot checks usually pass a real browser within a few seconds, then reload the page.
const CHALLENGE_MAX_MS = 30000

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function probeBrowser() {
  try {
    const response = await fetch(`${DEBUG_URL}/json/version`)
    return await response.json()
  } catch {
    return null
  }
}

// Started detached, as the "Browser automation" rules require, so the browser outlives
// this script. Only Windows and macOS have a known launch command.
function startBrowser() {
  const profile = `${process.env.TEMP ?? '/tmp'}/claude-browser-profile`
  const flags = [
    '--remote-debugging-port=9222',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]

  if (process.platform === 'win32') {
    spawn(WINDOWS_CHROMIUM, flags, { detached: true, stdio: 'ignore' }).unref()
    return true
  }

  if (process.platform === 'darwin') {
    const args = ['-na', 'Chromium', '--args', ...flags]
    spawn('open', args, { detached: true, stdio: 'ignore' }).unref()
    return true
  }

  return false
}

async function ensureBrowser() {
  let version = await probeBrowser()

  if (!version && startBrowser()) {
    for (let attempt = 0; attempt < 20 && !version; attempt++) {
      await sleep(500)
      version = await probeBrowser()
    }
  }

  if (!version) return 'no browser answers on port 9222 and none could be started'

  // A headless browser announces itself to bot detection (rule 4.1).
  if (version.Browser?.startsWith('HeadlessChrome')) {
    return 'the browser on port 9222 is headless: replace it with a headed one (rule 4.1)'
  }

  return ''
}

// Reads the title, or '' while a navigation is replacing the page.
async function readTitle(page) {
  try {
    return await page.title()
  } catch {
    return ''
  }
}

// Returns false when the bot check still stands after CHALLENGE_MAX_MS (rule H.6).
async function waitForChallengeToClear(page) {
  const deadline = Date.now() + CHALLENGE_MAX_MS

  while (Date.now() < deadline) {
    if (!isChallengeTitle(await readTitle(page))) return true
    await sleep(SETTLE_CHECK_MS)
  }

  return false
}

async function waitForTextToSettle(page) {
  const deadline = Date.now() + SETTLE_MAX_MS
  let previousLength = -1
  let quietSince = Date.now()

  while (Date.now() < deadline) {
    const length = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => -1)

    if (length !== previousLength) {
      previousLength = length
      quietSince = Date.now()
    }

    if (Date.now() - quietSince >= SETTLE_QUIET_MS) return

    await sleep(SETTLE_CHECK_MS)
  }
}

const { url, isFullPage } = readArguments('read-page.mjs')

const browserProblem = await ensureBrowser()

if (browserProblem) {
  console.error(browserProblem)
  process.exit(2)
}

const browser = await puppeteer.connect({ browserURL: DEBUG_URL })
const page = await browser.newPage()

// A bot check answers first (often 403) and the real page arrives on a later load,
// so the status printed is the last main-page response's.
let status = 'unknown'

page.on('response', response => {
  const isPageLoad = response.request().isNavigationRequest()
  if (isPageLoad && response.frame() === page.mainFrame()) status = response.status()
})

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

  if (!(await waitForChallengeToClear(page))) {
    console.error(`Still on a bot check page after ${CHALLENGE_MAX_MS / 1000} s (HTTP ${status})`)
    process.exitCode = 3
  } else {
    await waitForTextToSettle(page)

    const extracted = extractArticle(await page.content(), { url: page.url(), isFullPage })
    printPage({ status, url: page.url(), page: extracted })
  }
} catch (error) {
  console.error(`Navigation failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await page.close()

  // Only detaches: close() would shut down the shared browser.
  await browser.disconnect()
}
