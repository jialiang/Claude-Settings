#!/usr/bin/env node
// PreToolUse guard that refuses every WebFetch call and points at the curl route of
// rule H.9 in ~/.claude/CLAUDE.md.
//
// WebFetch runs a domain blocklist with no published criteria, and the built-in web-fetch
// agent that wraps it loads neither CLAUDE.md nor memory. Its reports came back with
// causes it had guessed. curl from an agent that does load both avoids the two problems.
//
// Helpers with no shell can't take the curl route, so they keep WebFetch.
// The main session's calls carry no agent_type, so they are always blocked.

const AGENTS_WITHOUT_SHELL = new Set(['claude-code-guide'])

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

const reason =
  'WebFetch is disabled by a hook in ~/.claude/settings.json (rule H.9 of ' +
  '~/.claude/CLAUDE.md). Read the page with `curl` from a shell instead: through a ' +
  'general-purpose agent for anything bigger than a small file, so the page stays out ' +
  'of the main context.\n\n' +
  'Many default server configurations reject curl: they answer with a bot challenge, an ' +
  'empty body or a 403, or let the request time out. Before AI tools, ordinary visitors ' +
  'never used curl, so servers treat it as a bot. Such a failure says nothing about the ' +
  "page or the site's wishes: follow rule H.5 and retry through the playwright-core " +
  'browser. A script-rendered page needs the browser for the same reason.'

process.stdout.on('error', () => {})

const input = await readStdin()
const agentType = (() => {
  try {
    return JSON.parse(input).agent_type ?? ''
  } catch {
    return ''
  }
})()

if (AGENTS_WITHOUT_SHELL.has(agentType)) process.exit(0)

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }),
)
