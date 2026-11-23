// Turns a page's HTML into readable text through a real DOM parser.
// Shared by fetch-page.mjs and read-page.mjs so both print the same shape.

import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

import { prepareForReadability } from './readability-workarounds.mjs'

// Elements that start a new line when flattened to text.
const BLOCK_TAGS = new Set(
  (
    'ADDRESS ARTICLE ASIDE BLOCKQUOTE CAPTION DD DIV DL DT FIGCAPTION FIGURE FOOTER ' +
    'H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION TABLE TR UL'
  ).split(' '),
)

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG'])

// Drops the parts of an address that link text often leaves out, including a
// trailing "…" from shortened display text.
const bareAddress = text =>
  text
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/(…|\.\.\.)$/, '')
    .replace(/\/$/, '')

// Returns the absolute address a link points to, or '' when printing it would add
// nothing: in-page jumps, non-web links, image links or text that shows the address.
function linkTarget(anchor, baseUrl) {
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return ''

  let address = null

  try {
    address = new URL(href, baseUrl)
  } catch {
    return ''
  }

  if (!/^https?:$/.test(address.protocol)) return ''

  // utm_* parameters only tell the linked site where the click came from.
  const trackingKeys = [...address.searchParams.keys()].filter(key => key.startsWith('utm_'))
  for (const key of trackingKeys) address.searchParams.delete(key)

  const target = address.href

  const text = bareAddress(anchor.textContent.trim())
  if (!text || bareAddress(target).startsWith(text)) return ''

  return target
}

// textContent glues paragraphs together, so walk the tree and keep line breaks.
// Links keep their address after the text, as "text (address)".
function flattenToText(root, baseUrl) {
  const parts = []

  const visit = (node, isInsidePre) => {
    if (node.nodeType === 3 && isInsidePre) {
      parts.push(node.data)
      return
    }

    // Outside <pre>, whitespace runs collapse and a line never starts with a space.
    if (node.nodeType === 3) {
      const isLineStart = parts.length === 0 || parts.at(-1).endsWith('\n')
      const text = node.data.replace(/\s+/g, ' ')
      const kept = isLineStart ? text.trimStart() : text

      // An empty part would hide the line start from the next text node.
      if (kept) parts.push(kept)
      return
    }

    if (node.nodeType !== 1 || SKIPPED_TAGS.has(node.tagName)) return

    if (node.tagName === 'BR') {
      parts.push('\n')
      return
    }

    // Table rows print as "cell | cell", each cell on one line even when it
    // wraps its text in paragraphs. The row itself already starts a new line.
    if (node.tagName === 'TD' || node.tagName === 'TH') {
      // The whitespace between two cells would double the space before the bar.
      if (parts.at(-1) === ' ') parts.pop()
      if (node.previousElementSibling) parts.push(' | ')
      parts.push(flattenToText(node, baseUrl).replace(/\s*\n\s*/g, ' '))
      return
    }

    const isBlock = BLOCK_TAGS.has(node.tagName)
    if (isBlock) parts.push('\n')

    if (node.tagName === 'LI') parts.push('- ')

    for (const child of node.childNodes) visit(child, isInsidePre || node.tagName === 'PRE')

    const target = node.tagName === 'A' ? linkTarget(node, baseUrl) : ''
    if (target) parts.push(` (${target})`)

    if (isBlock) parts.push('\n')
  }

  for (const child of root.childNodes) visit(child, false)

  return (
    parts
      .join('')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      // A list item wrapping a paragraph leaves its bullet on a line of its own.
      .replace(/^- *\n+/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

function readMeta(document, ...names) {
  for (const name of names) {
    const selector = `meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`
    const content = document.querySelector(selector)?.getAttribute('content')
    if (content) return content
  }

  return ''
}

// Structured data (JSON-LD) names the author more reliably than Readability's guess,
// which can pick up a heading such as "About the author".
function readStructuredAuthor(document) {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data = null

    try {
      data = JSON.parse(script.textContent)
    } catch {
      continue
    }

    const items = [data].flat().flatMap(item => [item, ...(item?.['@graph'] ?? [])])

    for (const item of items) {
      const authors = [item?.author ?? []].flat()
      const names = authors.map(author => (typeof author === 'string' ? author : author?.name))
      const found = names.filter(Boolean)
      if (found.length > 0) return found.join(', ')
    }
  }

  return ''
}

// Returns { title, byline, published, isArticle, text }. isArticle is false when
// the caller asked for the whole page or Readability found no main article.
// url resolves relative links.
export function extractArticle(html, { url, isFullPage = false } = {}) {
  const { document } = parseHTML(html)

  const pageTitle = document.title?.trim() ?? ''
  const published = readMeta(document, 'article:published_time', 'datePublished', 'date')
  const bodyText = document.body ? flattenToText(document.body, url) : ''

  // Some sites put a profile URL in the author tag instead of a name.
  const metaAuthor = readMeta(document, 'author', 'article:author')
  const author = readStructuredAuthor(document) || (/^https?:/.test(metaAuthor) ? '' : metaAuthor)

  if (isFullPage) {
    return { title: pageTitle, byline: author, published, isArticle: false, text: bodyText }
  }

  // Readability edits the document it is given, so it runs after the reads above.
  prepareForReadability(document)
  let article = null

  try {
    // The serializer hands back the article element itself instead of an HTML string.
    article = new Readability(document, { serializer: element => element }).parse()
  } catch {
    article = null
  }

  if (!article?.content) {
    return { title: pageTitle, byline: author, published, isArticle: false, text: bodyText }
  }

  return {
    title: article.title || pageTitle,
    byline: author || article.byline,
    published: article.publishedTime || published,
    isArticle: true,
    text: flattenToText(article.content, url),
  }
}

// Reads "<url> [--full]" from the command line, or exits with usage help.
export function readArguments(scriptName) {
  const args = process.argv.slice(2)
  const url = args.find(arg => !arg.startsWith('--'))

  if (!url) {
    console.error(`Usage: node ${scriptName} <url> [--full]`)
    process.exit(1)
  }

  return { url, isFullPage: args.includes('--full') }
}

// Header values can come from page elements that span several indented lines.
const oneLine = text => text.replace(/\s+/g, ' ').trim()

export function printPage({ status, url, page }) {
  console.log(`Status: ${status}`)
  console.log(`URL: ${url}`)
  console.log(`Title: ${oneLine(page.title)}`)
  if (page.byline) console.log(`Byline: ${oneLine(page.byline)}`)
  if (page.published) console.log(`Published: ${oneLine(page.published)}`)
  const extract = page.isArticle ? 'main article only (--full prints the whole page)' : 'whole page'
  console.log(`Extract: ${extract}`)
  console.log()
  console.log(page.text)
}
