#!/usr/bin/env node
// Prints the readable text of a web page fetched without a browser.
// This is the first step of rule H.5 in ~/.claude/CLAUDE.md: when it reports the page
// as blocked or script-rendered, read-page.mjs takes over through the shared browser.
//
// Usage: node ~/.claude/scripts/fetch-page.mjs <url> [--full]
//
// Output and --full: the same as read-page.mjs.
// Exit codes: 0 read, 1 request failed, 3 blocked or script-rendered (use read-page.mjs).

import { hasChallengeScript, isChallengeTitle } from './lib/challenge.mjs'
import { extractArticle, printPage, readArguments } from './lib/extract-article.mjs'

const TIMEOUT_MS = 30000

// Some servers turn away clients that don't look like a browser.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/142.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Below this many characters of text, a page is probably filled in by script.
// Phrases like "Please enable JavaScript" aren't checked: real pages carry them
// in <noscript> notices (a comments widget, for one).
const MIN_TEXT_LENGTH = 200

function findBlockReason(status, html, page) {
  if (status === 401 || status === 403 || status === 429 || status === 503) {
    return `HTTP ${status}`
  }

  if (isChallengeTitle(page.title)) return `bot check page "${page.title}"`
  if (hasChallengeScript(html)) return 'bot check script'
  if (page.text.length < MIN_TEXT_LENGTH) return `only ${page.text.length} characters of text`

  return ''
}

const { url, isFullPage } = readArguments('fetch-page.mjs')

let response

try {
  response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
} catch (error) {
  console.error(`Request failed: ${error.cause?.message ?? error.message}`)
  process.exit(1)
}

const html = await response.text()
const page = extractArticle(html, { url: response.url, isFullPage })
const blockReason = findBlockReason(response.status, html, page)

if (blockReason) {
  console.error(`Looks blocked or script-rendered (${blockReason}): use read-page.mjs`)
  process.exit(3)
}

printPage({ status: response.status, url: response.url, page })
