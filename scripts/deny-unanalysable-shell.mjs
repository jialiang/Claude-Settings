#!/usr/bin/env node
// PreToolUse guard for the Bash and PowerShell tools.
//
// The permission classifier can only judge a command whose targets are visible in the
// text. Anything resolved at runtime (a chained `cd`, a relative path, a shell variable)
// leaves it unjudgeable, so the call falls through to a manual approval prompt. Denying
// it here hands the reason back to Claude, which rewrites it within the same turn.
// The rules mirror the "Shell commands" section of ~/.claude/CLAUDE.md.

import { homedir } from 'node:os'

const ATOMIC_ESCAPE = /(^|\s)#\s*atomic\b/i

// One line per shell family (POSIX, then PowerShell), which the formatter would
// otherwise flatten to one name per line.
// prettier-ignore
const DIRECTORY_CHANGERS = new Set([
  'cd', 'chdir', 'pushd', 'popd',
  'set-location', 'sl', 'push-location', 'pop-location',
])

// Grouped as above: POSIX, cmd, PowerShell verb-noun, then PowerShell writers.
// prettier-ignore
const FILE_MUTATORS = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'tee', 'ln', 'install',
  'del', 'erase', 'rd', 'md', 'move', 'copy',
  'remove-item', 'move-item', 'copy-item', 'new-item', 'rename-item',
  'set-content', 'add-content', 'out-file',
])

// Sinks that name no real path, so a relative-looking target here resolves nowhere.
const SAFE_TARGETS = new Set(['/dev/null', 'nul', 'nul:', '$null'])

// Ordered: the specific forms have to be tried before the bare `$name` catch-all.
const RUNTIME_VALUES = [
  [/\$\(/, 'a command substitution `$(...)`'],
  [/`[^`]*`/, 'a backtick command substitution'],
  [/<\(/, 'a process substitution `<(...)`'],
  [/<</, 'a heredoc'],
  [/\$env:/i, 'a PowerShell environment variable'],
  [/\$\{?(?!null\b)[A-Za-z_][A-Za-z0-9_]*\}?/, 'a shell variable'],
]

// Splits on the operators that join commands, ignoring any inside quotes or `$(...)`.
function splitTopLevel(command) {
  const segments = []
  let current = ''
  let quote = ''
  let depth = 0

  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    const pair = command.slice(index, index + 2)

    if (quote) {
      current += character
      if (character === quote) quote = ''
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }

    if (pair === '$(' || (depth > 0 && character === '(')) {
      depth++
      current += character
      continue
    }

    if (depth > 0 && character === ')') {
      depth--
      current += character
      continue
    }

    if (character === '\\' && /[\s;|&]/.test(command[index + 1] ?? '')) {
      current += character + command[index + 1]
      index++
      continue
    }

    if (depth === 0 && (pair === '&&' || pair === '||')) {
      segments.push(current)
      current = ''
      index++
      continue
    }

    // `2>&1` and `&>log` are redirections, not the background `&` that ends a command.
    const isRedirectAmpersand =
      character === '&' && (command[index + 1] === '>' || current.endsWith('>'))

    if (depth === 0 && !isRedirectAmpersand && ';|&\n'.includes(character)) {
      segments.push(current)
      current = ''
      continue
    }

    current += character
  }

  segments.push(current)
  return segments.map(segment => segment.trim()).filter(Boolean)
}

function tokenize(segment) {
  const tokens = []
  let raw = ''
  let quote = ''

  const flush = () => {
    if (!raw) return
    tokens.push({ raw, value: raw.replace(/['"]/g, '') })
    raw = ''
  }

  for (let index = 0; index < segment.length; index++) {
    const character = segment[index]

    if (quote) {
      raw += character
      if (character === quote) quote = ''
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      raw += character
      continue
    }

    // A backslash escapes whitespace only: `My\ Project` has to stay one word on macOS,
    // while the separators in `C:\Users\x` have to survive as literal characters. A
    // backslash before a newline is a line continuation, so both characters vanish.
    if (character === '\\' && /\s/.test(segment[index + 1] ?? '')) {
      if (segment[index + 1] !== '\n') raw += segment[index + 1]
      index++
      continue
    }

    if (/\s/.test(character)) {
      flush()
      continue
    }

    raw += character
  }

  flush()
  return tokens
}

// Skips `VAR=value` prefixes and `sudo`, then reduces `/usr/bin/rm` to `rm`. The index it
// lands on is what separates the command from its arguments, so it is returned too.
function findCommand(tokens) {
  let index = 0
  while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].raw)) index++
  if (tokens[index]?.value.toLowerCase() === 'sudo') index++

  return { word: tokens[index]?.value.split(/[\\/]/).pop().toLowerCase() ?? '', index }
}

function isAbsolute(value) {
  return /^([\\/]|~[\\/]?$|~[\\/]|[A-Za-z]:[\\/])/.test(value)
}

// Everything the segment writes to: a mutator's positional arguments plus redirect targets.
function collectTargets(tokens, isMutator, commandIndex) {
  const targets = []

  for (let index = 0; index < tokens.length; index++) {
    const { raw, value } = tokens[index]

    if (/^\d?>>?&\d?$/.test(raw)) continue

    // The bare operator has to be tested first. `>>` would otherwise read as `>` writing
    // to a file named `>`, which then swallows the real target on the following token.
    if (/^\d?>>?$/.test(raw)) {
      const next = tokens[++index]
      if (next) targets.push(next.value)
      continue
    }

    const attached = raw.match(/^\d?>>?(.+)$/)
    if (attached) {
      targets.push(attached[1].replace(/['"]/g, ''))
      continue
    }

    if (!isMutator || index <= commandIndex) continue

    // A bare number is a flag value such as the mode in `install -m 755`, never a path.
    if (raw.startsWith('-') || /^\d+$/.test(value)) continue

    targets.push(value)
  }

  return targets
}

function stripSingleQuoted(segment) {
  return segment.replace(/'[^']*'/g, "''")
}

function findViolations(command) {
  const segments = splitTopLevel(command)
  const isChained = segments.length > 1
  const violations = []

  for (const segment of segments) {
    const tokens = tokenize(segment)
    const { word, index: commandIndex } = findCommand(tokens)
    const shown = segment.replace(/\s+/g, ' ')

    if (isChained && DIRECTORY_CHANGERS.has(word)) {
      const message =
        `\`${shown}\` chains a directory change into another command, so ` +
        `every later path resolves against a directory only known at runtime (rule 2). ` +
        `The working directory persists between calls: drop the \`cd\` and use absolute ` +
        `paths, or a tool flag such as \`git -C "<absolute path>"\`.`

      violations.push(message)
      continue
    }

    const isMutator = FILE_MUTATORS.has(word)
    const targets = collectTargets(tokens, isMutator, commandIndex)
    if (!isMutator && targets.length === 0) continue

    for (const [pattern, description] of RUNTIME_VALUES) {
      if (!pattern.test(stripSingleQuoted(segment))) continue

      const message =
        `\`${shown}\` writes through ${description}, whose value does not ` +
        `exist until the command runs (rule 4). Inline the literal path, or use the ` +
        `Write tool if you are producing file contents.`

      violations.push(message)
      break
    }

    for (const target of targets) {
      if (isAbsolute(target) || SAFE_TARGETS.has(target.toLowerCase())) continue
      if (RUNTIME_VALUES.some(([pattern]) => pattern.test(target))) continue

      const example = `${homedir().replace(/\\/g, '/')}/.../${target.replace(/^\.\//, '')}`

      const message =
        `\`${shown}\` writes to the relative target \`${target}\`, which ` +
        `resolves against an unknown working directory (rule 3). Spell it out in full, ` +
        `e.g. \`"${example}"\`.`

      violations.push(message)
    }
  }

  return violations
}

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

// Any failure here stays silent: a broken guard must not block the tool call.
try {
  const command = JSON.parse(await readStdin())?.tool_input?.command ?? ''
  const violations = ATOMIC_ESCAPE.test(command) ? [] : findViolations(command)

  if (violations.length > 0) {
    const reason =
      'Blocked before the permission check: this command cannot be judged ' +
      'statically, so it would stall on a manual approval prompt.\n\n' +
      violations
        .slice(0, 5)
        .map((text, index) => `${index + 1}. ${text}`)
        .join('\n\n') +
      '\n\nRewrite it as standalone calls with absolute, literal paths and run it again. ' +
      'If it genuinely has to stay atomic, append `# atomic` to the command and say why.'

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
    )
  }
} catch {}
