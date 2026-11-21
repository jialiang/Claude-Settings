#!/usr/bin/env node
// Prints the rendered text of a web page, read through the shared browser on port 9222.
// This is the browser route of rule H.5 in ~/.claude/CLAUDE.md, packaged so an agent
// runs one command instead of writing a puppeteer script each time.
//
// Usage: node ~/.claude/scripts/read-page.mjs <url>
//
// Output: a header (HTTP status, final URL, title), a blank line, then the page text.
// Exit codes: 0 read, 1 navigation failed, 2 no usable browser on port 9222.

import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const DEBUG_URL = 'http://127.0.0.1:9222'
const WINDOWS_CHROMIUM = 'C:\\Program Files\\Chromium\\Application\\chrome.exe'

// Pages keep filling in after load (client rendering, lazy feeds). Waiting until the
// text stops growing is faster than a fixed delay and does not hang on tracker traffic
// the way waiting for network idle does.
const SETTLE_CHECK_MS = 500
const SETTLE_QUIET_MS = 1500
const SETTLE_MAX_MS = 15000

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

async function waitForTextToSettle(page) {
  const deadline = Date.now() + SETTLE_MAX_MS
  let previousLength = -1
  let quietSince = Date.now()

  while (Date.now() < deadline) {
    const length = await page.evaluate(() => document.body?.innerText.length ?? 0)

    if (length !== previousLength) {
      previousLength = length
      quietSince = Date.now()
    }

    if (Date.now() - quietSince >= SETTLE_QUIET_MS) return

    await sleep(SETTLE_CHECK_MS)
  }
}

const url = process.argv[2]

if (!url) {
  console.error('Usage: node read-page.mjs <url>')
  process.exit(1)
}

const browserProblem = await ensureBrowser()

if (browserProblem) {
  console.error(browserProblem)
  process.exit(2)
}

const browser = await puppeteer.connect({ browserURL: DEBUG_URL })
const page = await browser.newPage()

try {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await waitForTextToSettle(page)

  const text = await page.evaluate(() => document.body?.innerText ?? '')
  console.log(`Status: ${response?.status() ?? 'unknown'}`)
  console.log(`URL: ${page.url()}`)
  console.log(`Title: ${await page.title()}`)
  console.log()
  console.log(text)
} catch (error) {
  console.error(`Navigation failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await page.close()

  // Only detaches: close() would shut down the shared browser.
  await browser.disconnect()
}
