// Reshapes a page before Readability scores it, so its clutter rules don't drop
// real content. Each fix below names the rule it sidesteps.

// Room for a language label or "Copy" button next to the code.
const CODE_WRAPPER_SLACK = 20

// Code viewers wrap <pre> in scroll and toolbar divs. Readability scores class names
// like "code-scroll" as clutter and drops the wrapper with the code inside.
function unwrapCodeBlocks(document) {
  for (const pre of document.querySelectorAll('pre')) {
    const maxLength = pre.textContent.trim().length + CODE_WRAPPER_SLACK
    let outermost = pre

    for (let parent = pre.parentElement; parent?.tagName === 'DIV'; parent = parent.parentElement) {
      if (parent.textContent.trim().length > maxLength) break
      outermost = parent
    }

    if (outermost !== pre) outermost.replaceWith(pre)
  }
}

const isBlankText = node => node.nodeType === 3 && !node.data.trim()

/**
 * Splits each paragraph at double line breaks into separate paragraphs.
 *
 * Why:
 * Readability does this split itself but turns the original <p> into a <div>.
 * It then deletes any div whose text is over 20% link text, so a paragraph
 * ending in a bare URL can vanish whole.
 */
function splitDoubleBreaks(document) {
  for (const paragraph of document.querySelectorAll('p')) {
    const groups = [[]]
    let breakCount = 0

    for (const child of [...paragraph.childNodes]) {
      if (child.tagName === 'BR') {
        breakCount++
        continue
      }

      if (breakCount > 0 && isBlankText(child)) continue

      if (breakCount >= 2) groups.push([])
      if (breakCount === 1) groups.at(-1).push(document.createElement('br'))

      breakCount = 0
      groups.at(-1).push(child)
    }

    if (groups.length === 1) continue

    for (const group of groups) {
      const part = document.createElement('p')
      part.append(...group)
      paragraph.before(part)
    }

    paragraph.remove()
  }
}

// Shorter hidden blocks are more likely captions or decoration.
const MIN_HIDDEN_TEXT_LENGTH = 80

const HIDDEN_BLOCK_SELECTOR = ['p', 'div', 'section', 'table', 'figure', 'ul', 'ol', 'pre']
  .map(tag => `${tag}[aria-hidden="true"]`)
  .join(', ')

/**
 * Clears aria-hidden on blocks that hold real text.
 *
 * Why:
 * Readability skips anything marked aria-hidden as invisible. Some sites
 * (Tom's Hardware, for one) mark on-screen paragraphs and tables that way for
 * screen readers, so all but the opening paragraphs would be dropped.
 */
function revealHiddenText(document) {
  for (const block of document.querySelectorAll(HIDDEN_BLOCK_SELECTOR)) {
    const isRealText = block.textContent.trim().length >= MIN_HIDDEN_TEXT_LENGTH
    if (isRealText) block.removeAttribute('aria-hidden')
  }
}

export function prepareForReadability(document) {
  // Scroll components inject <style> tags whose CSS would count as wrapper text.
  for (const element of document.querySelectorAll('script, style, noscript, template')) {
    element.remove()
  }

  unwrapCodeBlocks(document)
  splitDoubleBreaks(document)
  revealHiddenText(document)
}
